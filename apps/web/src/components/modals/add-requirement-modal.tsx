"use client";

import React, { useState } from "react";
import { Modal } from "../ui/modal";

interface AddRequirementModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    key: string;
    title: string;
    docTypeCode: string;
    milestoneKey: string;
    mandatory: boolean;
    assetTag?: string;
    reviewerRole: string;
    dueDate?: string;
  }) => Promise<void>;
  nextKeySuggestion?: string;
}

export function AddRequirementModal({
  open,
  onClose,
  onSubmit,
  nextKeySuggestion = "REQ-MEP-02",
}: AddRequirementModalProps) {
  const [key, setKey] = useState(nextKeySuggestion);
  const [title, setTitle] = useState("");
  const [docTypeCode, setDocTypeCode] = useState("TEST_REPORT");
  const [milestoneKey, setMilestoneKey] = useState("HANDOVER");
  const [mandatory, setMandatory] = useState(true);
  const [assetTag, setAssetTag] = useState("");
  const [reviewerRole, setReviewerRole] = useState("R-QC");
  const [dueDate, setDueDate] = useState("2026-12-15");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        key: key.toUpperCase().trim(),
        title: title.trim(),
        docTypeCode,
        milestoneKey,
        mandatory,
        assetTag: assetTag.trim() ? assetTag.trim().toUpperCase() : undefined,
        reviewerRole,
        dueDate: dueDate || undefined,
      });
      setTitle("");
      setAssetTag("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Closeout Requirement"
      subtitle="Define a new compliance artifact in the project stage gate checklist"
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Requirement Key
            </label>
            <input
              type="text"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="REQ-HVAC-01"
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Document Type Code
            </label>
            <select
              value={docTypeCode}
              onChange={(e) => setDocTypeCode(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            >
              <option value="TEST_REPORT">Test & Commissioning Report</option>
              <option value="AS_BUILT_DRAWING">As-Built Drawing (CAD/BIM)</option>
              <option value="WARRANTY_CERTIFICATE">OEM Warranty Certificate</option>
              <option value="O_AND_M_MANUAL">Operation & Maintenance Manual</option>
              <option value="STATUTORY_NOC">Statutory Authority NOC / Approval</option>
              <option value="TRAINING_RECORD">Client Training Sign-Off Record</option>
              <option value="SPARE_PARTS_LIST">Attic Stock & Spare Parts Ledger</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Requirement Title
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Chiller Commissioning & Factory Acceptance Test Report"
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Milestone Stage Gate
            </label>
            <select
              value={milestoneKey}
              onChange={(e) => setMilestoneKey(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            >
              <option value="MOBILISATION">Mobilisation</option>
              <option value="SUBSTRUCTURE">Substructure</option>
              <option value="SUPERSTRUCTURE">Superstructure</option>
              <option value="MEP_FIRST_FIX">MEP 1st Fix</option>
              <option value="MEP_SECOND_FIX">MEP 2nd Fix</option>
              <option value="TESTING_COMMISSIONING">Testing & Commissioning</option>
              <option value="HANDOVER">Handover</option>
              <option value="DLP_END">DLP End</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Equipment Asset Tag (Optional)
            </label>
            <input
              type="text"
              value={assetTag}
              onChange={(e) => setAssetTag(e.target.value)}
              placeholder="e.g. CH-01 or AHU-04"
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Reviewer Role
            </label>
            <select
              value={reviewerRole}
              onChange={(e) => setReviewerRole(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            >
              <option value="R-QC">Quality Control Engineer (R-QC)</option>
              <option value="R-CONSULTANT">Lead MEP Consultant (R-CONSULTANT)</option>
              <option value="R-PM">Client Project Manager (R-PM)</option>
              <option value="R-FIRE">Chief Fire Officer (R-FIRE)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Submission Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
            />
          </div>
        </div>

        <div className="pt-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
              className="rounded border-[#D1D5DB] text-[#3157D5] focus:ring-[#3157D5]"
            />
            <span className="text-xs font-semibold text-[#111827]">
              Mandatory Gate Blocker (Strictly required for Handover Package snapshot)
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#F3F4F6]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] px-3.5 py-1.5 text-xs font-medium text-[#667085] hover:bg-[#F9FAFB]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="rounded-md bg-[#3157D5] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] disabled:opacity-50 transition-all"
          >
            {submitting ? "Adding..." : "Add Requirement"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
