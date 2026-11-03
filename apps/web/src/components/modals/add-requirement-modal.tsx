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
  const [docTypeCode, setDocTypeCode] = useState("DT-022");
  const [milestoneKey, setMilestoneKey] = useState("COMMISSIONING");
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
              <option value="DT-022">DT-022: Factory Acceptance Test (AHRI/FAT)</option>
              <option value="DT-033">DT-033: Hydrostatic / Line Pressure Test</option>
              <option value="DT-035">DT-035: Duct Air Leakage Test (DW/144)</option>
              <option value="DT-050">DT-050: Testing, Adjusting & Balancing (TAB)</option>
              <option value="DT-011">DT-011: As-Built Engineering Drawing</option>
              <option value="DT-026">DT-026: OEM Manufacturer Warranty Certificate</option>
              <option value="DT-058">DT-058: Operation & Maintenance (O&M) Manual</option>
              <option value="DT-086">DT-086: Statutory CFO Final Fire NOC</option>
              <option value="DT-028">DT-028: Attic Stock & Critical Spares Handover</option>
              <option value="DT-061">DT-061: Client Engineering Operations Training</option>
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
              <option value="MOBILISATION">MOBILISATION (Advance Release)</option>
              <option value="SUBMISSION">SUBMISSION (Technical Reviews)</option>
              <option value="DELIVERY">DELIVERY (Factory & Material Inspection)</option>
              <option value="INSTALLATION">INSTALLATION (Erection & Pressure Tests)</option>
              <option value="COMMISSIONING">COMMISSIONING (TAB & Functional Tests)</option>
              <option value="HANDOVER">HANDOVER (Interim Handover Dossier)</option>
              <option value="FINAL_BILL">FINAL_BILL (Final Commercial Closeout)</option>
              <option value="DLP_END">DLP_END (Defect Liability Expiry)</option>
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
