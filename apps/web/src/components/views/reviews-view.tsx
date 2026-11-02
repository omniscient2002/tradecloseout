"use client";

import React, { useState } from "react";
import clsx from "clsx";
import {
  Eye,
  CheckCircle2,
  XCircle,
  FileEdit,
  ShieldOff,
  Stamp,
  UserCheck,
} from "lucide-react";
import { RequirementItem } from "./checklist-view";
import { StatusBadge } from "../ui/status-badge";

export interface ReviewsViewProps {
  requirements: RequirementItem[];
  onDecideReview: (
    reqId: string,
    decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT",
    comment: string
  ) => Promise<void>;
  onCountersignWaiver: (reqId: string, justification: string) => Promise<void>;
  onExternalApprovalClick: (req: RequirementItem) => void;
}

export function ReviewsView({
  requirements,
  onDecideReview,
  onCountersignWaiver,
  onExternalApprovalClick,
}: ReviewsViewProps) {
  const queueItems = requirements.filter((r) =>
    ["IN_REVIEW", "UPLOADED", "PENDING_WAIVER", "CHANGES_REQUESTED"].includes(r.status)
  );

  const [selectedItem, setSelectedItem] = useState<RequirementItem | null>(
    queueItems.length > 0 ? queueItems[0] : null
  );
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);

  const handleDecision = async (decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT") => {
    if (!selectedItem) return;
    if (decision !== "APPROVE" && !comment.trim()) {
      alert("Please provide feedback or a reason for this decision.");
      return;
    }
    setSubmitting(true);
    try {
      await onDecideReview(selectedItem.id, decision, comment);
      setDecisionSuccess(`Decision ${decision} submitted successfully.`);
      setComment("");
      setTimeout(() => setDecisionSuccess(null), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWaiverCountersign = async () => {
    if (!selectedItem) return;
    if (!comment.trim()) {
      alert("Please provide the countersignature justification.");
      return;
    }
    setSubmitting(true);
    try {
      await onCountersignWaiver(selectedItem.id, comment);
      setDecisionSuccess("Mandatory waiver countersigned and sealed.");
      setComment("");
      setTimeout(() => setDecisionSuccess(null), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* 1. Header Overview */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-[#3157D5]" />
              <h1 className="text-base font-bold text-[#111827]">Consultant Review Inbox</h1>
            </div>
            <p className="text-xs text-[#667085] mt-1">
              Authoritative review queue for Lead Consultant, QC Engineers, and Fire Officers. Compliant with ISO 19650 workflow stages.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] font-semibold">
              {queueItems.length} Pending Actions
            </span>
          </div>
        </div>
      </div>

      {/* 2. Two-Column Review Desk */}
      {queueItems.length === 0 ? (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-12 text-center shadow-2xs">
          <CheckCircle2 className="h-10 w-10 text-[#159B72] mx-auto mb-3" />
          <h3 className="text-base font-semibold text-[#111827]">Review Queue Empty</h3>
          <p className="text-xs text-[#667085] mt-1 max-w-md mx-auto">
            All submitted closeout documents and waiver requests have been reviewed and certified. New submissions from contractors and suppliers will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Queue List (5 cols) */}
          <div className="lg:col-span-5 rounded-xl border border-[#E5E7EB] bg-white shadow-2xs overflow-hidden">
            <div className="p-3 border-b border-[#E5E7EB] bg-[#FAFBFD] text-xs font-semibold text-[#667085]">
              Submissions Awaiting Stamp ({queueItems.length})
            </div>
            <div className="divide-y divide-[#F3F4F6] max-h-[600px] overflow-y-auto">
              {queueItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedItem(item);
                      setComment("");
                    }}
                    className={clsx(
                      "w-full text-left p-3.5 text-xs flex flex-col gap-1.5 cursor-pointer transition-colors duration-150",
                      isSelected
                        ? "bg-[#EEF2FF] border-l-4 border-l-[#3157D5]"
                        : "hover:bg-[#F9FAFB]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-[#4B5563] bg-white px-1.5 py-0.5 rounded border border-[#E5E7EB]">
                        {item.requirementKey}
                      </span>
                      <StatusBadge status={item.status} size="sm" />
                    </div>

                    <div className="font-semibold text-[#111827] truncate">{item.title}</div>

                    <div className="flex items-center justify-between text-[11px] text-[#667085]">
                      <span>Role: {item.reviewerRole || "R-QC"}</span>
                      {item.assetTag && (
                        <span className="font-mono text-[#3157D5]">Asset: {item.assetTag}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Review Action Station (7 cols) */}
          <div className="lg:col-span-7 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4">
            {selectedItem ? (
              <>
                <div className="border-b border-[#E5E7EB] pb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#F3F4F6] text-[#374151]">
                      {selectedItem.requirementKey}
                    </span>
                    <StatusBadge status={selectedItem.status} size="sm" />
                  </div>
                  <h2 className="text-base font-bold text-[#111827] mt-2">
                    {selectedItem.title}
                  </h2>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-[#667085] bg-[#F9FAFB] p-2.5 rounded-lg border border-[#E5E7EB]">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider block text-[#9CA3AF]">
                        Doc Type
                      </span>
                      <span className="font-mono font-medium text-[#111827]">
                        {selectedItem.docTypeCode}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider block text-[#9CA3AF]">
                        Reviewer Role
                      </span>
                      <span className="font-mono font-medium text-[#111827]">
                        {selectedItem.reviewerRole || "R-QC"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider block text-[#9CA3AF]">
                        Revision
                      </span>
                      <span className="font-mono font-medium text-[#3157D5]">
                        {selectedItem.revisionCode || "Rev A"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Success Notification */}
                {decisionSuccess && (
                  <div className="p-3 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-xs font-medium text-[#159B72] flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{decisionSuccess}</span>
                  </div>
                )}

                {/* Decision Workspace */}
                {selectedItem.status === "PENDING_WAIVER" ? (
                  /* 2-Step Mandatory Waiver Countersignature */
                  <div className="space-y-3 bg-[#FAF5FF] p-4 rounded-xl border border-[#E9D5FF]">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#6B21A8]">
                      <ShieldOff className="h-4 w-4" />
                      <span>Step 2 Mandatory Waiver Countersignature Required</span>
                    </div>
                    <p className="text-xs text-[#7E22CE]">
                      This mandatory requirement was initiated for waiver by the Project Manager. As designated Senior Officer / Approver, your cryptographic countersignature is required to waive this item for the handover package snapshot.
                    </p>

                    <div>
                      <label className="block text-xs font-semibold text-[#6B21A8] mb-1">
                        Countersignature Justification / Exemption Reference
                      </label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="State technical or regulatory justification for mandatory waiver..."
                        rows={3}
                        className="w-full rounded-md border border-[#D8B4FE] bg-white p-2.5 text-xs text-[#111827] focus:border-[#7E22CE] focus:outline-none"
                      />
                    </div>

                    <button
                      disabled={submitting}
                      onClick={handleWaiverCountersign}
                      className="w-full flex items-center justify-center gap-2 rounded-md bg-[#7E22CE] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#6B21A8] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 disabled:opacity-50 cursor-pointer"
                    >
                      <UserCheck className="h-4 w-4" />
                      <span>{submitting ? "Countersigning..." : "Countersign & Seal Waiver"}</span>
                    </button>
                  </div>
                ) : (
                  /* Standard Reviewer Decisions */
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#374151] mb-1">
                        Reviewer Remarks / Feedback (Required for Changes & Rejections)
                      </label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Provide observations, compliance remarks, or reasons for rejection..."
                        rows={3}
                        className="w-full rounded-md border border-[#E5E7EB] bg-white p-2.5 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none focus:ring-1 focus:ring-[#3157D5]"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      {/* Approve */}
                      <button
                        disabled={submitting}
                        onClick={() => handleDecision("APPROVE")}
                        className="flex items-center justify-center gap-1.5 rounded-md bg-[#159B72] px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#0F766E] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 disabled:opacity-50 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </button>

                      {/* Request Changes */}
                      <button
                        disabled={submitting}
                        onClick={() => handleDecision("REQUEST_CHANGES")}
                        className="flex items-center justify-center gap-1.5 rounded-md border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-xs font-semibold text-[#C2410C] hover:bg-[#FFEDD5] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 disabled:opacity-50 cursor-pointer"
                      >
                        <FileEdit className="h-3.5 w-3.5" />
                        <span>Changes Needed</span>
                      </button>

                      {/* Reject */}
                      <button
                        disabled={submitting}
                        onClick={() => handleDecision("REJECT")}
                        className="flex items-center justify-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#DC5252] hover:bg-[#FEE2E2] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 disabled:opacity-50 cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>

                    {/* Direct External Approval Option */}
                    <div className="pt-2 border-t border-[#F3F4F6] flex items-center justify-between">
                      <span className="text-xs text-[#667085]">
                        Document approved outside TradeCloseout?
                      </span>
                      <button
                        onClick={() => onExternalApprovalClick(selectedItem)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F766E] hover:underline cursor-pointer transition-colors"
                      >
                        <Stamp className="h-3.5 w-3.5" />
                        <span>Record Stamped / External Approval</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10 text-xs text-[#9CA3AF]">
                Select a submission from the list to review.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
