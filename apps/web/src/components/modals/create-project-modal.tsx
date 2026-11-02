"use client";

import React, { useState } from "react";
import { Modal } from "../ui/modal";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    code: string;
    name: string;
    targetHandoverDate?: string;
  }) => Promise<void>;
}

export function CreateProjectModal({
  open,
  onClose,
  onSubmit,
}: CreateProjectModalProps) {
  const [code, setCode] = useState("PRJ-002");
  const [name, setName] = useState("");
  const [targetHandoverDate, setTargetHandoverDate] = useState("2026-12-31");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        targetHandoverDate: targetHandoverDate || undefined,
      });
      setName("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create New Project"
      subtitle="Initialize an isolated closeout workspace with tenant RLS isolation"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Project Code
          </label>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="PRJ-002"
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
          />
          <span className="text-[10px] text-[#667085] mt-0.5 block">
            2–30 alphanumeric uppercase characters or hyphens.
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Project Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Skyview Commercial Towers (HVAC & Fire)"
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#374151] mb-1">
            Target Handover Date
          </label>
          <input
            type="date"
            value={targetHandoverDate}
            onChange={(e) => setTargetHandoverDate(e.target.value)}
            className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
          />
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
            disabled={submitting || !name.trim()}
            className="rounded-md bg-[#3157D5] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] disabled:opacity-50 transition-all"
          >
            {submitting ? "Creating Project..." : "Create Project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
