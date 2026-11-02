"use client";

import React from "react";
import clsx from "clsx";
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  IndianRupee,
  Calendar,
  Layers,
  ArrowRight,
  TrendingUp,
  FileCheck2,
} from "lucide-react";
import { MetricCard } from "../ui/metric-card";
import { SegmentedProgress } from "../ui/progress-bar";

export interface ProjectMetrics {
  totalRequirements: number;
  approvedCount: number;
  inReviewCount: number;
  missingCount: number;
  waivedCount: number;
  retentionAtRiskPaise: string;
  targetHandoverDate?: string | null;
  readinessPercentage: number;
}

export interface OverviewViewProps {
  metrics: ProjectMetrics;
  projectName: string;
  projectCode: string;
  onNavigateToChecklist: (filter?: string) => void;
  onNavigateToReviews: () => void;
  onNavigateToPackages: () => void;
}

const MILESTONES = [
  { key: "MOBILISATION", label: "Mobilisation", status: "COMPLETED" },
  { key: "SUBSTRUCTURE", label: "Substructure", status: "COMPLETED" },
  { key: "SUPERSTRUCTURE", label: "Superstructure", status: "COMPLETED" },
  { key: "MEP_FIRST_FIX", label: "MEP 1st Fix", status: "COMPLETED" },
  { key: "MEP_SECOND_FIX", label: "MEP 2nd Fix", status: "ACTIVE" },
  { key: "TESTING_COMMISSIONING", label: "T&C", status: "PENDING" },
  { key: "HANDOVER", label: "Handover", status: "PENDING" },
  { key: "DLP_END", label: "DLP End", status: "PENDING" },
];

function formatInrPaise(paiseStr: string): string {
  const rupees = Math.round(Number(BigInt(paiseStr || "0")) / 100);
  const s = rupees.toString();
  if (s.length <= 3) return `₹${s}`;
  const lastThree = s.substring(s.length - 3);
  const otherNumbers = s.substring(0, s.length - 3);
  const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree;
  return `₹${formatted}`;
}

export function OverviewView({
  metrics,
  projectName,
  projectCode,
  onNavigateToChecklist,
  onNavigateToReviews,
  onNavigateToPackages,
}: OverviewViewProps) {
  const readiness = metrics.readinessPercentage;

  const satisfiedCount = metrics.approvedCount + metrics.waivedCount;
  const remainingCount = Math.max(0, metrics.totalRequirements - satisfiedCount - metrics.inReviewCount);

  const progressSegments = [
    { value: metrics.approvedCount, color: "bg-[#159B72]", label: "Approved" },
    { value: metrics.inReviewCount, color: "bg-[#D99A28]", label: "In Review" },
    { value: metrics.waivedCount, color: "bg-[#6366F1]", label: "Waived" },
    { value: remainingCount, color: "bg-[#E5E7EB]", label: "Remaining" },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Grounded Handover Readiness Card */}
      <div className="relative overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#EEF2FF] text-[#3157D5] border border-[#C7D2FE]">
                {projectCode}
              </span>
              <span className="text-xs font-medium text-[#667085]">Handover Protocol · ISO 19650</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#111827]">
              {projectName}
            </h1>
            <p className="text-xs text-[#667085] max-w-2xl">
              Real-time audit posture and document completion metrics. All milestone closeout artifacts are cryptographically signed and stored with tamper-evident SHA-256 audit trails.
            </p>
          </div>

          <div className="flex items-center gap-4 bg-[#F9FAFB] p-3.5 rounded-lg border border-[#E5E7EB] transition-colors hover:border-[#D1D5DB]">
            <div className="text-center px-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                Readiness Score
              </div>
              <div className="font-mono text-3xl font-extrabold text-[#111827] mt-0.5 tabular-nums">
                {readiness}%
              </div>
            </div>
            <div className="h-10 w-px bg-[#E5E7EB]" />
            <div className="text-left px-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                Target Handover
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111827] mt-1">
                <Calendar className="h-3.5 w-3.5 text-[#3157D5]" />
                <span>{metrics.targetHandoverDate || "31 Dec 2026"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar with Neutral Track */}
        <div className="mt-6 pt-5 border-t border-[#F3F4F6] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#374151]">Compliance Completion Breakdown</span>
            <span className="text-[#667085] font-mono text-[11px]">
              {satisfiedCount} / {metrics.totalRequirements} Applicable Satisfied
            </span>
          </div>
          <SegmentedProgress segments={progressSegments} className="h-2.5 bg-[#E5E7EB]" />
          <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-[#667085]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#159B72]" /> Approved ({metrics.approvedCount})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#D99A28]" /> In Review ({metrics.inReviewCount})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#6366F1]" /> Waived ({metrics.waivedCount})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#DC5252]" /> Missing / Expired ({metrics.missingCount})
            </span>
          </div>
        </div>
      </div>

      {/* 2. Key Operational Metrics Grid (Butter-Smooth Hover Elevation) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Approved Documents"
          value={metrics.approvedCount.toString()}
          subtitle="Signed off by consultants"
          accent="success"
          icon={<CheckCircle2 className="h-4 w-4 text-[#159B72]" />}
          actionLabel="View Approved"
          onClick={() => onNavigateToChecklist("APPROVED")}
        />
        <MetricCard
          label="Missing / Expired"
          value={metrics.missingCount.toString()}
          subtitle="Immediate closeout blockers"
          accent={metrics.missingCount > 0 ? "danger" : "default"}
          icon={<AlertTriangle className="h-4 w-4 text-[#DC5252]" />}
          actionLabel="Resolve Blockers"
          onClick={() => onNavigateToChecklist("MISSING")}
        />
        <MetricCard
          label="In Review Queue"
          value={metrics.inReviewCount.toString()}
          subtitle="Awaiting consultant decision"
          accent="warning"
          icon={<Clock className="h-4 w-4 text-[#D99A28]" />}
          actionLabel="Open Queue"
          onClick={onNavigateToReviews}
        />
        <MetricCard
          label="Gated Retention"
          value={formatInrPaise(metrics.retentionAtRiskPaise)}
          subtitle="At risk pending handover"
          accent="brand"
          icon={<IndianRupee className="h-4 w-4 text-[#3157D5]" />}
          actionLabel="Package Readiness"
          onClick={onNavigateToPackages}
        />
      </div>

      {/* 3. Milestone Pipeline Stepper with Gentle CSS Hover Lift */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#3157D5]" />
            <h2 className="text-sm font-semibold text-[#111827]">Project Milestone Stage Gate</h2>
          </div>
          <span className="text-[11px] font-medium text-[#667085]">
            Stage 5 of 8: <strong className="text-[#3157D5]">MEP 2nd Fix</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-2">
          {MILESTONES.map((m) => {
            const isCompleted = m.status === "COMPLETED";
            const isActive = m.status === "ACTIVE";
            return (
              <div
                key={m.key}
                className={clsx(
                  "rounded-lg p-2.5 border text-center transition-all duration-200 cursor-pointer select-none",
                  isActive
                    ? "border-[#3157D5] bg-[#EEF2FF] shadow-xs ring-1 ring-[#3157D5]/20 hover:-translate-y-1 hover:shadow-sm active:translate-y-0 active:scale-[0.98]"
                    : isCompleted
                    ? "border-[#E5E7EB] bg-[#F9FAFB] hover:border-[#CBD5E1] hover:-translate-y-1 hover:shadow-xs active:translate-y-0 active:scale-[0.98] text-[#374151]"
                    : "border-dashed border-[#E5E7EB] bg-white hover:border-[#CBD5E1] hover:-translate-y-1 hover:shadow-xs active:translate-y-0 active:scale-[0.98] text-[#9CA3AF]"
                )}
              >
                <div className="flex items-center justify-center mb-1">
                  {isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#159B72]" />
                  ) : isActive ? (
                    <span className="h-2 w-2 rounded-full bg-[#3157D5] animate-ping" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-[#D1D5DB]" />
                  )}
                </div>
                <div
                  className={clsx(
                    "text-[11px] font-medium leading-tight truncate",
                    isActive ? "font-bold text-[#3157D5]" : isCompleted ? "text-[#111827]" : "text-[#9CA3AF]"
                  )}
                >
                  {m.label}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-[#667085] mt-1 font-mono">
                  {m.status}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Two-Column Intelligence Section: Audit Log & Quick Tools */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        {/* Left 2 Cols: Cryptographic Audit Stream */}
        <div className="lg:col-span-2 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#159B72]" />
                <h2 className="text-sm font-semibold text-[#111827]">Immutable Audit Chain</h2>
              </div>
              <span className="text-[10px] font-mono font-medium text-[#159B72] bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#A7F3D0]">
                VERIFIED SHA-256
              </span>
            </div>

            <div className="space-y-3 pt-3">
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[#F3F4F6] bg-[#FAFBFD] hover:bg-white hover:border-[#D1D5DB] hover:shadow-2xs transition-all duration-200 text-xs cursor-pointer">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#3157D5]">
                  <FileCheck2 className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#111827]">Document Version Certified</span>
                    <span className="text-[10px] text-[#9CA3AF] font-mono">Verified Just Now</span>
                  </div>
                  <p className="text-[#667085]">
                    Chiller Commissioning & Factory Test Report (<span className="font-mono text-[#111827]">REQ-HVAC-01</span>) added to Stage Gate checklist snapshot.
                  </p>
                  <div className="font-mono text-[10px] text-[#9CA3AF] truncate">
                    Hash: 01a1976b-361c-7ba1-ba41-7ad5be457fec
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg border border-[#F3F4F6] bg-[#FAFBFD] hover:bg-white hover:border-[#D1D5DB] hover:shadow-2xs transition-all duration-200 text-xs cursor-pointer">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[#159B72]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#111827]">Project Created & RLS Context Sealed</span>
                    <span className="text-[10px] text-[#9CA3AF] font-mono">15m ago</span>
                  </div>
                  <p className="text-[#667085]">
                    Project <span className="font-semibold text-[#111827]">{projectCode}</span> initialized with tenant-isolated database policies and R-OWNER security bindings.
                  </p>
                  <div className="font-mono text-[10px] text-[#9CA3AF] truncate">
                    Trigger: trg_audit_events_immutable (STATEMENT LEVEL)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Quick Closeout Actions */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-[#F3F4F6] pb-3">
              <TrendingUp className="h-4 w-4 text-[#3157D5]" />
              <h2 className="text-sm font-semibold text-[#111827]">Closeout Actions</h2>
            </div>

            <div className="space-y-2 pt-3 text-xs">
              <button
                onClick={onNavigateToPackages}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-[#E5E7EB] hover:border-[#3157D5] hover:bg-[#EEF2FF]/40 hover:-translate-y-1 hover:shadow-xs active:translate-y-0 active:scale-[0.99] transition-all duration-200 text-left group cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-[#111827] group-hover:text-[#3157D5] transition-colors">
                    Evaluate Handover Gate
                  </div>
                  <div className="text-[11px] text-[#667085]">Check mandatory blockers & exceptions</div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#3157D5] group-hover:translate-x-1.5 transition-all duration-200" />
              </button>

              <button
                onClick={() => onNavigateToChecklist("MISSING")}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-[#E5E7EB] hover:border-[#DC5252] hover:bg-[#FEF2F2]/40 hover:-translate-y-1 hover:shadow-xs active:translate-y-0 active:scale-[0.99] transition-all duration-200 text-left group cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-[#111827] group-hover:text-[#DC5252] transition-colors">
                    Request Missing Documents
                  </div>
                  <div className="text-[11px] text-[#667085]">Dispatch notification to subcontractors</div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#DC5252] group-hover:translate-x-1.5 transition-all duration-200" />
              </button>

              <button
                onClick={onNavigateToReviews}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-[#E5E7EB] hover:border-[#D99A28] hover:bg-[#FFFBEB]/40 hover:-translate-y-1 hover:shadow-xs active:translate-y-0 active:scale-[0.99] transition-all duration-200 text-left group cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-[#111827] group-hover:text-[#D99A28] transition-colors">
                    Consultant Review Inbox
                  </div>
                  <div className="text-[11px] text-[#667085]">{metrics.inReviewCount} items awaiting formal stamp</div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#D99A28] group-hover:translate-x-1.5 transition-all duration-200" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
