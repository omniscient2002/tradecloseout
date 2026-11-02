"use client";

import React, { useState } from "react";
import { Modal } from "../ui/modal";
import { RequirementItem } from "../views/checklist-view";
import { ShieldOff, AlertTriangle } from "lucide-react";

interface WaiverModalProps {
  open: boolean;
  onClose: () => void;
  requirement: RequirementItem | null;
  onSubmit: (data: { reason: string; justification: string }) => Promise<void>;
}

export function WaiverModal({
  open,
  onClose,
  requirement,
  onSubmit,
}: WaiverModalProps) {
  const [reason, setReason] = useState("ALTERNATIVE_PROVIDED");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!justification.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({ reason, justification: justification.trim() });
      setJustification("");
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
      title="Request Requirement Waiver"
      subtitle={`${requirement.requirementKey} · ${requirement.title}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {requirement.mandatory && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF] text-xs text-[#6B21A8]">
            <ShieldOff className="h-4 w-4 shrink-0 mt-0.5 text-[#7E22CE]" />
            <div>
              <strong className="block font-semibold">2-Step Mandatory Waiver Rule (WF-25 / RT-021)</strong>
              Because this requirement is mandatory, initiating this waiver will set its status to{" "}
              <code className="font-mono font-bold">PENDING_WAIVER</code>. It will require second-approver countersignature before it is formally waived.
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Waiver Reason Category
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
          >
            <option value="ALTERNATIVE_PROVIDED">Equivalent Alternative Document Provided</option>
            <option value="CLIENT_EXEMPTION">Formal Client Scope Exemption / Variation</option>
            <option value="UNAVAILABLE">Original Factory Document Destroyed / Unavailable</option>
            <option value="REGULATORY_EXCEPTION">Statutory Regulatory Exception Applicable</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Technical & Commercial Justification
          </label>
          <textarea
            required
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Detail engineering rationale, alternative references, or contractual variation clauses..."
            rows={4}
            className="w-full rounded-md border border-[#E5E7EB] p-2.5 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none focus:ring-1 focus:ring-[#3157D5]"
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
            disabled={submitting || !justification.trim()}
            className="rounded-md bg-[#6366F1] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#4F46E5] disabled:opacity-50 transition-all"
          >
            {submitting ? "Initiating Waiver..." : "Initiate Waiver Request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
