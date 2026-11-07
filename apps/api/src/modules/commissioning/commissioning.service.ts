import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';

export interface TabReadingInput {
  terminalOrTag: string;
  designFlow: number;
  actualFlow: number;
  unit: 'CFM' | 'L_S' | 'GPM' | 'L_MIN';
  pressureDrop?: number;
  temperatureDelta?: number;
  notes?: string;
}

export interface CreateTabWorksheetInput {
  assetId?: string;
  systemType: 'AIR_SIDE' | 'WATER_SIDE' | 'REFRIGERANT_VRF' | 'CHILLED_WATER';
  worksheetType: string;
  tolerancePercent?: number;
  readings: TabReadingInput[];
}

export interface CreateInspectionInput {
  assetId?: string;
  itrNumber: string;
  title: string;
  stageKey: string;
  checklistItems: Array<{ itemNo: number; description: string; result: 'PASS' | 'FAIL' | 'NA'; notes?: string }>;
  witnessParties?: Array<{ partyName: string; representativeName: string; role: string }>;
}

export interface CreateSeasonalScheduleInput {
  assetId?: string;
  season: 'SUMMER_PEAK' | 'MONSOON_HUMIDITY' | 'WINTER_MINIMUM';
  targetDate: string;
  parameters?: Record<string, any>;
}

@Injectable()
export class CommissioningService {
  constructor(private readonly pool: Pool) {}

  /**
   * XP17: Record Air/Water TAB Balancing Worksheet with Deterministic Tolerance Calculations
   */
  async recordTabWorksheet(
    ctx: TenantActorContext,
    projectId: string,
    input: CreateTabWorksheetInput,
  ) {
    if (!input.readings || !input.readings.length) {
      throw new UnprocessableEntityException({
        code: 'TAB_READINGS_REQUIRED',
        detail: 'A TAB balancing worksheet requires at least one flow reading.',
      });
    }

    const tolerancePercent = input.tolerancePercent ?? 10.0;
    if (tolerancePercent <= 0 || tolerancePercent > 15) {
      throw new BadRequestException({
        code: 'TOLERANCE_EXCEEDS_MAXIMUM',
        detail: 'Tolerance percentage must be between 1% and 15% per ASHRAE 111 / NEBB standards.',
      });
    }

    // Dimension and unit compatibility check (F04)
    const airUnits = new Set(['CFM', 'L_S']);
    const waterUnits = new Set(['GPM', 'L_MIN']);

    const firstUnit = input.readings[0].unit;
    if (input.systemType === 'AIR_SIDE' && !airUnits.has(firstUnit)) {
      throw new BadRequestException({
        code: 'SYSTEM_UNIT_MISMATCH',
        detail: `Air-side TAB worksheets must use CFM or L_S units, got ${firstUnit}.`,
      });
    }
    if (input.systemType === 'WATER_SIDE' && !waterUnits.has(firstUnit)) {
      throw new BadRequestException({
        code: 'SYSTEM_UNIT_MISMATCH',
        detail: `Water-side TAB worksheets must use GPM or L_MIN units, got ${firstUnit}.`,
      });
    }

    // Ensure all readings use the exact same unit
    for (let i = 0; i < input.readings.length; i++) {
      if (input.readings[i].unit !== firstUnit) {
        throw new BadRequestException({
          code: 'INCOMPATIBLE_UNITS',
          detail: `Mixed units detected: reading ${i} uses ${input.readings[i].unit} while sheet is configured for ${firstUnit}.`,
        });
      }
    }

    // Calculate flow deviations and tolerance compliance
    let totalDesignFlow = 0;
    let totalActualFlow = 0;

    const evaluatedReadings = input.readings.map((r, index) => {
      if (
        typeof r.designFlow !== 'number' ||
        typeof r.actualFlow !== 'number' ||
        !Number.isFinite(r.designFlow) ||
        !Number.isFinite(r.actualFlow) ||
        r.designFlow <= 0 ||
        r.actualFlow <= 0
      ) {
        throw new BadRequestException({
          code: 'INVALID_FLOW_VALUE',
          detail: `Reading at index ${index} must have positive numeric design and actual flows.`,
        });
      }

      totalDesignFlow += r.designFlow;
      totalActualFlow += r.actualFlow;

      // Security Invariant (Gap 7): Deterministic unrounded ratio comparison
      // Raw deviation ratio must NOT be prematurely rounded before comparing against tolerance threshold
      const rawDeviationRatio = Math.abs(r.actualFlow - r.designFlow) / r.designFlow;
      const rawToleranceRatio = tolerancePercent / 100;
      const withinTolerance = rawDeviationRatio <= rawToleranceRatio;
      const deviationPercent = Math.round(rawDeviationRatio * 10000) / 100;

      return {
        ...r,
        deviationPercent,
        rawDeviationRatio,
        withinTolerance,
      };
    });

    const rawOverallRatio =
      totalDesignFlow > 0 ? Math.abs(totalActualFlow - totalDesignFlow) / totalDesignFlow : 0;
    const overallDeviationPercent = Math.round(rawOverallRatio * 10000) / 100;
    const rawToleranceRatio = tolerancePercent / 100;

    const allWithinTolerance =
      evaluatedReadings.every((r) => r.withinTolerance) && rawOverallRatio <= rawToleranceRatio;
    const status = allWithinTolerance ? 'COMPLETED' : 'NEEDS_REBALANCING';

    const designSummary = {
      totalDesignFlow: Math.round(totalDesignFlow * 100) / 100,
      totalActualFlow: Math.round(totalActualFlow * 100) / 100,
      overallDeviationPercent,
      tolerancePercent,
      evaluationBasis: 'EXACT_RAW_UNROUNDED',
      readingsCount: evaluatedReadings.length,
      outOfToleranceCount: evaluatedReadings.filter((r) => !r.withinTolerance).length,
    };

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Verify project exists
      const { rows: projRows } = await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) {
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', detail: 'Project not found.' });
      }

      // Verify asset if specified
      if (input.assetId) {
        const { rows: assetRows } = await client.query(
          `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, input.assetId],
        );
        if (!assetRows.length) {
          throw new NotFoundException({ code: 'ASSET_NOT_FOUND', detail: 'Asset not found in project.' });
        }
      }

      const worksheetId = uuidv7();

      await client.query(
        `INSERT INTO tab_worksheets (
          id, org_id, project_id, asset_id, system_type, worksheet_type,
          readings_json, design_summary_json, tolerance_percent, is_within_tolerance,
          tested_by, tested_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)`,
        [
          worksheetId,
          ctx.orgId,
          projectId,
          input.assetId || null,
          input.systemType,
          input.worksheetType,
          JSON.stringify(evaluatedReadings),
          JSON.stringify(designSummary),
          tolerancePercent,
          allWithinTolerance,
          ctx.userId,
          status,
        ],
      );

      emit({
        eventType: 'TAB_WORKSHEET_RECORDED',
        projectId,
        entityType: 'TAB_WORKSHEET',
        entityId: worksheetId,
        afterJson: {
          systemType: input.systemType,
          worksheetType: input.worksheetType,
          isWithinTolerance: allWithinTolerance,
          status,
        },
      });

      return {
        id: worksheetId,
        projectId,
        assetId: input.assetId || null,
        systemType: input.systemType,
        worksheetType: input.worksheetType,
        isWithinTolerance: allWithinTolerance,
        status,
        designSummary,
        readings: evaluatedReadings,
        testedAt: new Date().toISOString(),
      };
    });
  }

  async listTabWorksheets(ctx: TenantActorContext, projectId: string, assetId?: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const params: any[] = [ctx.orgId, projectId];
      let assetFilter = '';
      if (assetId) {
        assetFilter = 'AND tw.asset_id = $3';
        params.push(assetId);
      }

      const { rows } = await client.query(
        `SELECT tw.*, a.tag AS asset_tag, a.name AS asset_name, u.name AS tested_by_name
           FROM tab_worksheets tw
           LEFT JOIN assets a ON a.id = tw.asset_id
           LEFT JOIN users u ON u.id = tw.tested_by
          WHERE tw.org_id = $1 AND tw.project_id = $2 ${assetFilter}
          ORDER BY tw.tested_at DESC`,
        params,
      );

      return rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        assetId: r.asset_id,
        assetTag: r.asset_tag,
        assetName: r.asset_name,
        systemType: r.system_type,
        worksheetType: r.worksheet_type,
        tolerancePercent: parseFloat(r.tolerance_percent),
        isWithinTolerance: r.is_within_tolerance,
        status: r.status,
        designSummary: r.design_summary_json,
        readings: r.readings_json,
        testedBy: r.tested_by_name,
        testedAt: r.tested_at,
      }));
    });
  }

  /**
   * XP16: Record Native Quality Inspection Test Request (ITR) & Checklist
   */
  async recordQualityInspection(
    ctx: TenantActorContext,
    projectId: string,
    input: CreateInspectionInput,
  ) {
    if (!input.itrNumber || !input.title || !input.stageKey) {
      throw new UnprocessableEntityException({
        code: 'INSPECTION_FIELDS_REQUIRED',
        detail: 'ITR number, title, and stageKey are required for quality inspection.',
      });
    }

    // F03: Validation of checklist items
    if (!input.checklistItems || !Array.isArray(input.checklistItems) || input.checklistItems.length === 0) {
      throw new UnprocessableEntityException({
        code: 'EMPTY_CHECKLIST',
        detail: 'Quality inspection requires at least one checklist item.',
      });
    }

    const validResults = new Set(['PASS', 'FAIL', 'NA']);
    for (const item of input.checklistItems) {
      if (!item.itemNo || !item.description || !validResults.has(item.result)) {
        throw new BadRequestException({
          code: 'INVALID_CHECKLIST_ITEM',
          detail: `Invalid checklist item: result must be PASS, FAIL, or NA.`,
        });
      }
    }

    const passCount = input.checklistItems.filter((i) => i.result === 'PASS').length;
    const failCount = input.checklistItems.filter((i) => i.result === 'FAIL').length;
    const naCount = input.checklistItems.filter((i) => i.result === 'NA').length;

    let outcome: 'PASSED' | 'FAILED' | 'PENDING' = 'PASSED';
    if (failCount > 0) {
      outcome = 'FAILED';
    } else if (passCount === 0 && naCount === input.checklistItems.length) {
      // All-NA cannot produce an accepted PASS
      outcome = 'PENDING';
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Verify project exists
      const { rows: projRows } = await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) {
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', detail: 'Project not found.' });
      }

      // F02: Verify asset exists under exact composite scope (org_id, project_id, id)
      if (input.assetId) {
        const { rows: assetRows } = await client.query(
          `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, input.assetId],
        );
        if (!assetRows.length) {
          throw new NotFoundException({
            code: 'ASSET_NOT_FOUND',
            detail: `Asset ${input.assetId} not found in project ${projectId}.`,
          });
        }
      }

      const inspectionId = uuidv7();

      await client.query(
        `INSERT INTO quality_inspections (
          id, org_id, project_id, asset_id, itr_number, title, stage_key,
          checklist_items_json, witness_parties_json, outcome, inspected_by, inspected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
          inspectionId,
          ctx.orgId,
          projectId,
          input.assetId || null,
          input.itrNumber,
          input.title,
          input.stageKey,
          JSON.stringify(input.checklistItems),
          JSON.stringify(input.witnessParties || []),
          outcome,
          ctx.userId,
        ],
      );

      emit({
        eventType: 'INSPECTION_TEST_RECORDED',
        projectId,
        entityType: 'QUALITY_INSPECTION',
        entityId: inspectionId,
        afterJson: { itrNumber: input.itrNumber, outcome, stageKey: input.stageKey },
      });

      return {
        id: inspectionId,
        projectId,
        assetId: input.assetId || null,
        itrNumber: input.itrNumber,
        title: input.title,
        stageKey: input.stageKey,
        outcome,
        checklistItems: input.checklistItems,
        witnessParties: input.witnessParties || [],
        inspectedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * XP16: Witness sign-off for inspection test request
   */
  async signInspectionWitness(
    ctx: TenantActorContext,
    projectId: string,
    inspectionId: string,
    signData: { partyName: string; representativeName: string; role: string; notes?: string; partyId?: string },
  ) {
    if (!signData.partyName?.trim() || !signData.representativeName?.trim() || !signData.role?.trim()) {
      throw new BadRequestException({
        code: 'WITNESS_DATA_REQUIRED',
        detail: 'Witness partyName, representativeName, and role are mandatory.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Validate party existence if partyId is provided (NP01)
      let isVerified = false;
      let attestationType = 'RECORDED_ATTENDANCE';
      let requiresConfirmation = true;

      if (signData.partyId) {
        const partyRes = await client.query(
          `SELECT id, name FROM parties WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [ctx.orgId, signData.partyId],
        );
        if (!partyRes.rows.length) {
          throw new NotFoundException({ code: 'PARTY_NOT_FOUND', detail: 'Witness party not found.' });
        }
        isVerified = true;
        attestationType = 'AUTHENTICATED_ATTESTATION';
        requiresConfirmation = false;
      }

      const { rows } = await client.query(
        `SELECT * FROM quality_inspections
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, inspectionId],
      );

      if (!rows.length) {
        throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', detail: 'Quality inspection not found.' });
      }

      const existing = rows[0];
      const witnessList: any[] = existing.witness_parties_json || [];

      const newWitness = {
        ...signData,
        attestationType,
        isVerified,
        requiresConfirmation,
        recordedByUserId: ctx.userId,
        signedByUserId: ctx.userId,
        signedAt: new Date().toISOString(),
      };
      witnessList.push(newWitness);

      await client.query(
        `UPDATE quality_inspections
            SET witness_parties_json = $4
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, inspectionId, JSON.stringify(witnessList)],
      );

      emit({
        eventType: 'INSPECTION_WITNESS_SIGNED',
        projectId,
        entityType: 'QUALITY_INSPECTION',
        entityId: inspectionId,
        afterJson: { witness: newWitness },
      });

      return {
        inspectionId,
        witnesses: witnessList,
        lastSigned: newWitness,
      };
    });
  }

  /**
   * XP18: Seasonal Commissioning Deferred Test Scheduling
   */
  async createSeasonalSchedule(
    ctx: TenantActorContext,
    projectId: string,
    input: CreateSeasonalScheduleInput,
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Verify project exists
      const { rows: projRows } = await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) {
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', detail: 'Project not found.' });
      }

      // F02: Verify asset exists under exact composite scope (org_id, project_id, id)
      if (input.assetId) {
        const { rows: assetRows } = await client.query(
          `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, input.assetId],
        );
        if (!assetRows.length) {
          throw new NotFoundException({
            code: 'ASSET_NOT_FOUND',
            detail: `Asset ${input.assetId} not found in project ${projectId}.`,
          });
        }
      }

      const scheduleId = uuidv7();

      await client.query(
        `INSERT INTO seasonal_commissioning_schedules (
          id, org_id, project_id, asset_id, season, target_date, parameters_json, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SCHEDULED')`,
        [
          scheduleId,
          ctx.orgId,
          projectId,
          input.assetId || null,
          input.season,
          input.targetDate,
          JSON.stringify(input.parameters || {}),
        ],
      );

      emit({
        eventType: 'SEASONAL_COMMISSIONING_SCHEDULED',
        projectId,
        entityType: 'SEASONAL_COMMISSIONING_SCHEDULE',
        entityId: scheduleId,
        afterJson: { season: input.season, targetDate: input.targetDate },
      });

      return {
        id: scheduleId,
        projectId,
        assetId: input.assetId || null,
        season: input.season,
        targetDate: input.targetDate,
        status: 'SCHEDULED',
      };
    });
  }

  async listSeasonalSchedules(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT scs.*, a.tag AS asset_tag, a.name AS asset_name
           FROM seasonal_commissioning_schedules scs
           LEFT JOIN assets a ON a.id = scs.asset_id
          WHERE scs.org_id = $1 AND scs.project_id = $2
          ORDER BY scs.target_date ASC`,
        [ctx.orgId, projectId],
      );

      return rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        assetId: r.asset_id,
        assetTag: r.asset_tag,
        assetName: r.asset_name,
        season: r.season,
        targetDate: r.target_date,
        status: r.status,
        parameters: r.parameters_json,
        testResults: r.test_results_json,
        completedAt: r.completed_at,
        createdAt: r.created_at,
      }));
    });
  }

  /**
   * XP18: Transition seasonal commissioning schedule lifecycle (IN_PROGRESS | COMPLETED | DEFERRED | WAIVED)
   */
  async updateSeasonalSchedule(
    ctx: TenantActorContext,
    projectId: string,
    scheduleId: string,
    input: {
      status: 'PERFORMED' | 'COMPLETED' | 'DEFERRED' | 'WAIVED' | 'SCHEDULED' | string;
      testResults?: Record<string, any>;
      notes?: string;
    },
  ) {
    const statusMap: Record<string, string> = {
      COMPLETED: 'PERFORMED',
      PERFORMED: 'PERFORMED',
      DEFERRED: 'DEFERRED',
      WAIVED: 'WAIVED',
      SCHEDULED: 'SCHEDULED',
    };
    const targetStatus = statusMap[input.status];
    if (!targetStatus) {
      throw new BadRequestException({
        code: 'INVALID_SCHEDULE_STATUS',
        detail: `Status must be one of: PERFORMED, DEFERRED, WAIVED, SCHEDULED`,
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows } = await client.query(
        `SELECT * FROM seasonal_commissioning_schedules
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, scheduleId],
      );

      if (!rows.length) {
        throw new NotFoundException({
          code: 'SCHEDULE_NOT_FOUND',
          detail: `Seasonal schedule ${scheduleId} not found in project ${projectId}.`,
        });
      }

      const existing = rows[0];
      const isCompleted = targetStatus === 'PERFORMED';

      if (targetStatus === 'PERFORMED') {
        const hasResults =
          (input.testResults && Object.keys(input.testResults).length > 0) ||
          (existing.test_results_json && Object.keys(existing.test_results_json).length > 0);
        if (!hasResults) {
          throw new BadRequestException({
            code: 'TEST_RESULTS_REQUIRED',
            detail: 'Seasonal commissioning cannot be marked PERFORMED or COMPLETED without test results.',
          });
        }
      }

      if ((targetStatus === 'DEFERRED' || targetStatus === 'WAIVED') && !input.notes?.trim() && !existing.parameters_json?.notes) {
        throw new BadRequestException({
          code: 'REASON_REQUIRED',
          detail: `Notes or reason required when status is set to ${targetStatus}.`,
        });
      }

      await client.query(
        `UPDATE seasonal_commissioning_schedules
            SET status = $4,
                test_results_json = COALESCE($5, test_results_json),
                completed_at = CASE
                  WHEN $4 = 'PERFORMED' THEN now()
                  WHEN $4 IN ('SCHEDULED', 'DEFERRED', 'WAIVED') THEN NULL
                  ELSE completed_at
                END,
                parameters_json = CASE
                  WHEN $6::text IS NOT NULL THEN jsonb_set(parameters_json, '{notes}', to_jsonb($6::text))
                  ELSE parameters_json
                END
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [
          ctx.orgId,
          projectId,
          scheduleId,
          targetStatus,
          input.testResults ? JSON.stringify(input.testResults) : null,
          input.notes?.trim() || null,
        ],
      );

      emit({
        eventType: 'SEASONAL_COMMISSIONING_UPDATED',
        projectId,
        entityType: 'SEASONAL_COMMISSIONING_SCHEDULE',
        entityId: scheduleId,
        afterJson: { status: targetStatus, isCompleted },
      });

      return {
        id: scheduleId,
        projectId,
        status: targetStatus,
        completedAt: isCompleted ? new Date().toISOString() : existing.completed_at,
        testResults: input.testResults || existing.test_results_json,
      };
    });
  }
}
