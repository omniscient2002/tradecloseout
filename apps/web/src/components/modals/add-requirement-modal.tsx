"use client";

import { DOCUMENT_TYPES } from "../../lib/document-catalogue";
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
  nextKeySuggestion = "",
}: AddRequirementModalProps) {
  const [key, setKey] = useState(nextKeySuggestion);
  const [title, setTitle] = useState("");
  const [docTypeCode, setDocTypeCode] = useState("");
  const [milestoneKey, setMilestoneKey] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [assetTag, setAssetTag] = useState("");
  const [reviewerRole, setReviewerRole] = useState("");
  const [dueDate, setDueDate] = useState("");
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
      subtitle="Add a document or record needed for this project."
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Requirement reference
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
              Document type
            </label>
            <select
              required
              value={docTypeCode}
              onChange={(e) => setDocTypeCode(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            >
              <option value="">Choose a document type</option>
              {DOCUMENT_TYPES.map(type => <option key={type.code} value={type.code}>{type.name}</option>)}
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
              Project stage
            </label>
            <select
              required
              value={milestoneKey}
              onChange={(e) => setMilestoneKey(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            >
              <option value="">Choose a project stage</option>
              <option value="MOBILISATION">Mobilisation</option>
              <option value="SUBMISSION">Technical submission</option>
              <option value="DELIVERY">Delivery and inspection</option>
              <option value="INSTALLATION">Installation</option>
              <option value="COMMISSIONING">Testing and commissioning</option>
              <option value="HANDOVER">Handover</option>
              <option value="FINAL_BILL">Final bill</option>
              <option value="DLP_END">End of defects liability period</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Equipment tag (optional)
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
              Reviewer
            </label>
            <select
              required
              value={reviewerRole}
              onChange={(e) => setReviewerRole(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            >
              <option value="">Choose a reviewer</option>
              <option value="R-QC">Quality reviewer</option>
              <option value="R-CONSULTANT">Consultant</option>
              <option value="R-PM">Project manager</option>
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
              Required for handover
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
