import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
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

/**
 * Share the project row lock with project closure. Baseline-changing technical
 * records must not be written after handover is legally CLOSED. Deferred tests
 * require an explicit future post-close policy and are intentionally denied.
 */
async function lockOpenCommissioningProject(client: PoolClient, orgId: string, projectId: string) {
  const { rows } = await client.query(
    `SELECT id, status FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
    [orgId, projectId],
  );
  if (!rows.length) {
    throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', detail: 'Project not found.' });
  }
  if (!['ACTIVE', 'HANDOVER'].includes(rows[0].status)) {
    throw new ConflictException({
      code: 'PROJECT_COMMISSIONING_LIFECYCLE_BLOCKED',
      detail: 'Technical baseline changes require an ACTIVE or HANDOVER project. Accepted projects require formal reopening.',
    });
  }
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
      await lockOpenCommissioningProject(client, ctx.orgId, projectId);

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
      await lockOpenCommissioningProject(client, ctx.orgId, projectId);

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
   * Legally attributable inspection witness attestation. Only an OTP-authenticated
   * party-bound guest grant with a dedicated capability may attest. An employee
   * uploading a photo or entering a party ID is NOT the external signatory.
   */
  async signInspectionWitness(
    ctx: TenantActorContext,
    projectId: string,
    inspectionId: string,
    signData: { partyName: string; representativeName: string; role: string; notes?: string; partyId?: string },
  ) {
    if (ctx.actorType !== 'GUEST' || !ctx.guestGrantId ||
        !ctx.guestCapabilities?.includes('inspection.witness')) {
      throw new ForbiddenException({
        code: 'WITNESS_AUTHORITY_REQUIRED',
        detail: 'Witness sign-off requires an authenticated, party-bound external grant.',
      });
    }
    return this.recordInspectionWitness(ctx, projectId, inspectionId, signData, true);
  }

  /**
   * Contractor recording of attendance is never a verified witness signature.
   * Keep this separate from the externally authenticated sign-off endpoint.
   */
  async recordInspectionWitnessAttendance(
    ctx: TenantActorContext,
    projectId: string,
    inspectionId: string,
    signData: { partyName: string; representativeName: string; role: string; notes?: string; partyId?: string },
  ) {
    if (ctx.actorType === 'GUEST') {
      throw new ForbiddenException('WITNESS_ATTENDANCE_RECORDING_REQUIRES_MEMBER');
    }
    return this.recordInspectionWitness(ctx, projectId, inspectionId, signData, false);
  }

  private async recordInspectionWitness(
    ctx: TenantActorContext,
    projectId: string,
    inspectionId: string,
    signData: { partyName: string; representativeName: string; role: string; notes?: string; partyId?: string },
    attest: boolean,
  ) {
    if (!signData?.partyName?.trim() || !signData?.representativeName?.trim() || !signData?.role?.trim()) {
      throw new BadRequestException({
        code: 'WITNESS_DATA_REQUIRED',
        detail: 'Witness partyName, representativeName, and role are mandatory.',
      });
    }
    if (attest && !signData.partyId) {
      throw new BadRequestException({
        code: 'WITNESS_PARTY_REQUIRED',
        detail: 'A verified witness must identify the assigned party by ID.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      await lockOpenCommissioningProject(client, ctx.orgId, projectId);
      const { rows } = await client.query(
        `SELECT * FROM quality_inspections
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, inspectionId],
      );
      if (!rows.length) {
        throw new NotFoundException({ code: 'INSPECTION_NOT_FOUND', detail: 'Quality inspection not found.' });
      }
      const witnessList: any[] = Array.isArray(rows[0].witness_parties_json)
        ? rows[0].witness_parties_json : [];

      let canonicalPartyName = signData.partyName.trim();
      let representativeName = signData.representativeName.trim();
      let grantId: string | null = null;
      let assignedRole = signData.role.trim();

      if (attest) {
        // OTP/session verification is performed by SessionCsrfGuard. Recheck
        // revocation, expiry, party identity and scoped capability in this very
        // transaction to prevent a revoked or cross-party attestation.
        const { rows: grants } = await client.query(
          `SELECT gg.id, gg.party_id, gg.target_email, gg.target_phone_e164,
                  p.name AS party_name
             FROM guest_grants gg
             JOIN parties p ON p.org_id = gg.org_id AND p.id = gg.party_id
            WHERE gg.org_id = $1 AND gg.project_id = $2 AND gg.id = $3
              AND gg.party_id = $4 AND gg.status = 'ACTIVE'
              AND gg.expires_at > now()
              AND gg.capabilities @> ARRAY['inspection.witness']::text[]
              AND gg.grant_type IN ('CONSULTANT_REVIEW', 'CLIENT_VIEW')
              AND gg.independent_authority_verified_at IS NOT NULL
              AND p.deleted_at IS NULL
            LIMIT 1`,
          [ctx.orgId, projectId, ctx.guestGrantId, signData.partyId],
        );
        if (!grants.length) {
          throw new ForbiddenException({
            code: 'WITNESS_AUTHORITY_DENIED',
            detail: 'No active independent witness authority for this party and project.',
          });
        }
        const grant = grants[0];
        // The inspection creator must name the intended party in the inspection
        // witness list. A grant for one party cannot sign for another.
        const assigned = witnessList.find((w: any) =>
          (w.partyId && w.partyId === grant.party_id) ||
          (typeof w.partyName === 'string' &&
            w.partyName.trim().toLocaleLowerCase() === String(grant.party_name).trim().toLocaleLowerCase()));
        if (!assigned) {
          throw new ForbiddenException({
            code: 'WITNESS_NOT_ASSIGNED',
            detail: 'This party is not listed as a witness for this inspection.',
          });
        }
        if (witnessList.some((w: any) => w.isVerified === true && w.partyId === grant.party_id)) {
          throw new ConflictException({ code: 'WITNESS_ALREADY_SIGNED', detail: 'This party has already attested.' });
        }
        canonicalPartyName = grant.party_name;
        representativeName = grant.target_email || grant.target_phone_e164;
        assignedRole = assigned.role || assignedRole;
        grantId = grant.id;
      } else if (signData.partyId) {
        const { rows: parties } = await client.query(
          `SELECT name FROM parties WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [ctx.orgId, signData.partyId],
        );
        if (!parties.length) throw new NotFoundException('WITNESS_PARTY_NOT_FOUND');
        canonicalPartyName = parties[0].name;
      }

      const recordedAt = new Date().toISOString();
      const newWitness = {
        partyId: signData.partyId || null,
        partyName: canonicalPartyName,
        // The verified identity is the OTP destination bound to the grant,
        // not the arbitrary person name supplied by the caller.
        representativeName,
        claimedRepresentativeName: signData.representativeName.trim(),
        role: assignedRole,
        notes: signData.notes || null,
        attestationType: attest ? 'AUTHENTICATED_ATTESTATION' : 'RECORDED_ATTENDANCE',
        isVerified: attest,
        requiresConfirmation: !attest,
        recordedByUserId: ctx.userId,
        signedByUserId: attest ? ctx.userId : null,
        authenticatedGrantId: grantId,
        signedAt: attest ? recordedAt : null,
        recordedAt,
      };
      witnessList.push(newWitness);
      await client.query(
        `UPDATE quality_inspections
            SET witness_parties_json = $4
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, inspectionId, JSON.stringify(witnessList)],
      );

      emit({
        eventType: attest ? 'INSPECTION_WITNESS_SIGNED' : 'INSPECTION_WITNESS_ATTENDANCE_RECORDED',
        projectId,
        entityType: 'QUALITY_INSPECTION',
        entityId: inspectionId,
        afterJson: { witness: newWitness },
      });
      return { inspectionId, witnesses: witnessList, lastSigned: newWitness };
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
      await lockOpenCommissioningProject(client, ctx.orgId, projectId);

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
    const targetStatus = statusMap[input?.status];
    if (!targetStatus) {
      throw new BadRequestException({
        code: 'INVALID_SCHEDULE_STATUS',
        detail: 'Status must be one of: PERFORMED, DEFERRED, WAIVED, SCHEDULED',
      });
    }
    const notes = input.notes?.trim();
    if (input.notes !== undefined && (typeof input.notes !== 'string' || !notes || notes.length > 1000)) {
      throw new BadRequestException({ code: 'SEASONAL_REASON_INVALID' });
    }
    if (input.testResults !== undefined) {
      const results = input.testResults;
      if (!results || Array.isArray(results) || typeof results !== 'object' ||
          Object.keys(results).length === 0 || Object.keys(results).length > 64 ||
          Object.entries(results).some(([key, value]) =>
            !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
            typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000)) {
        throw new BadRequestException({
          code: 'SEASONAL_RESULTS_SCHEMA_INVALID',
          detail: 'Results must contain 1–64 named, finite numeric measurements within supported bounds.',
        });
      }
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      await lockOpenCommissioningProject(client, ctx.orgId, projectId);
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
      const allowed: Record<string, string[]> = {
        SCHEDULED: ['PERFORMED', 'DEFERRED', 'WAIVED'],
        DEFERRED: ['SCHEDULED', 'PERFORMED', 'WAIVED'],
        PERFORMED: [], // Results are immutable; corrections require a new reviewed attempt.
        WAIVED: [], // Unwaiving requires a separate audited authorization workflow.
      };
      if (!allowed[String(existing.status)]?.includes(targetStatus)) {
        throw new ConflictException({
          code: 'SEASONAL_TRANSITION_NOT_ALLOWED',
          detail: 'This result is terminal or the proposed schedule transition is not permitted.',
        });
      }
      const isCompleted = targetStatus === 'PERFORMED';

      if (targetStatus === 'PERFORMED') {
        // Never carry forward a previous attempt's values as proof that a
        // rescheduled test has actually been performed.
        if (!input.testResults || Object.keys(input.testResults).length === 0) {
          throw new BadRequestException({
            code: 'TEST_RESULTS_REQUIRED',
            detail: 'Seasonal commissioning cannot be marked PERFORMED or COMPLETED without test results.',
          });
        }
      }

      if ((targetStatus === 'DEFERRED' || targetStatus === 'WAIVED' ||
           (existing.status === 'DEFERRED' && targetStatus === 'SCHEDULED')) && !notes) {
        throw new BadRequestException({
          code: 'REASON_REQUIRED',
          detail: `Notes or reason required when status is set to ${targetStatus}.`,
        });
      }

      const { rows: savedRows } = await client.query(
        `UPDATE seasonal_commissioning_schedules
            SET status = $4,
                test_results_json = CASE
                  WHEN $4 = 'PERFORMED' THEN $5::jsonb
                  WHEN $4 = 'SCHEDULED' THEN NULL
                  ELSE test_results_json
                END,
                completed_at = CASE
                  WHEN $4 = 'PERFORMED' THEN now()
                  WHEN $4 IN ('SCHEDULED', 'DEFERRED', 'WAIVED') THEN NULL
                  ELSE completed_at
                END,
                parameters_json = CASE
                  WHEN $6::text IS NOT NULL THEN jsonb_set(parameters_json, '{notes}', to_jsonb($6::text))
                  ELSE parameters_json
                END
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          RETURNING status, test_results_json, completed_at`,
        [
          ctx.orgId,
          projectId,
          scheduleId,
          targetStatus,
          input.testResults ? JSON.stringify(input.testResults) : null,
          notes || null,
        ],
      );
      if (!savedRows.length) {
        throw new ConflictException({ code: 'SEASONAL_UPDATE_NOT_PERSISTED' });
      }
      const committed = savedRows[0];

      emit({
        eventType: 'SEASONAL_COMMISSIONING_UPDATED',
        projectId,
        entityType: 'SEASONAL_COMMISSIONING_SCHEDULE',
        entityId: scheduleId,
        afterJson: {
          previousStatus: existing.status, status: committed.status, isCompleted,
          previousCompletedAt: existing.completed_at,
          completedAt: committed.completed_at,
          reason: notes ?? null,
          resultKeys: isCompleted ? Object.keys(input.testResults || {}) : [],
        },
      });

      return {
        id: scheduleId,
        projectId,
        status: committed.status,
        completedAt: committed.completed_at,
        testResults: committed.test_results_json,
      };
    });
  }
}
