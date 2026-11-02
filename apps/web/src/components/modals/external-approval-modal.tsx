"use client";

import React, { useState } from "react";
import { Modal } from "../ui/modal";
import { RequirementItem } from "../views/checklist-view";
import { Stamp, CheckCircle2 } from "lucide-react";

interface ExternalApprovalModalProps {
  open: boolean;
  onClose: () => void;
  requirement: RequirementItem | null;
  onSubmit: (data: {
    externalMethod: "STAMPED_PDF" | "EMAIL" | "PORTAL" | "PHYSICAL";
    externalApproverName: string;
    externalApproverRole?: string;
    externalReference?: string;
    comment?: string;
  }) => Promise<void>;
}

export function ExternalApprovalModal({
  open,
  onClose,
  requirement,
  onSubmit,
}: ExternalApprovalModalProps) {
  const [externalMethod, setExternalMethod] = useState<
    "STAMPED_PDF" | "EMAIL" | "PORTAL" | "PHYSICAL"
  >("STAMPED_PDF");
  const [approverName, setApproverName] = useState("");
  const [approverRole, setApproverRole] = useState("Chief Fire Officer / Consultant");
  const [reference, setReference] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approverName.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        externalMethod,
        externalApproverName: approverName.trim(),
        externalApproverRole: approverRole.trim() || undefined,
        externalReference: reference.trim() || undefined,
        comment: comment.trim() || undefined,
      });
      setApproverName("");
      setReference("");
      setComment("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!requirement) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Direct External Approval"
      subtitle={`${requirement.requirementKey} · ${requirement.title}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#F0FDFA] border border-[#99F6E4] text-xs text-[#0F766E]">
          <Stamp className="h-4 w-4 shrink-0" />
          <span>
            Records third-party approvals (e.g. Stamped statutory NOCs, architect email sign-offs, or client PM portal references) without requiring them to register.
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            External Approval Medium
          </label>
          <select
            value={externalMethod}
            onChange={(e) => setExternalMethod(e.target.value as any)}
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#0F766E] focus:outline-none"
          >
            <option value="STAMPED_PDF">Stamped & Signed PDF (Official Seal)</option>
            <option value="EMAIL">Formal Client / Consultant Approval Email</option>
            <option value="PORTAL">External Client Web Portal Reference</option>
            <option value="PHYSICAL">Hard-Copy Signed Site Acceptance Certificate</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              External Signatory Name
            </label>
            <input
              type="text"
              required
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              placeholder="e.g. Er. V. K. Bansal"
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#0F766E] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Signatory Role / Authority
            </label>
            <input
              type="text"
              value={approverRole}
              onChange={(e) => setApproverRole(e.target.value)}
              placeholder="e.g. Lead Electrical Consultant"
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#0F766E] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Tracking / Reference Number
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. NOC/FIRE/2026/8841-B or EMAIL-2026-10-18"
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#0F766E] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Verification Remarks (Optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Physical copy archived in Site Office Binder #3..."
            rows={2}
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#0F766E] focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F3F4F6]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] px-3.5 py-1.5 text-xs font-medium text-[#667085] hover:bg-[#F9FAFB]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !approverName.trim()}
            className="rounded-md bg-[#0F766E] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#0D655E] disabled:opacity-50 transition-all"
          >
            {submitting ? "Recording..." : "Record External Approval"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
