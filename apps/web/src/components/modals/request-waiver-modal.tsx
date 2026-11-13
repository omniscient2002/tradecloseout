"use client";

import React, { useState } from "react";
import { Modal } from "../ui/modal";
import {
  ShieldOff,
  AlertTriangle,
  FileCheck2,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { apiFetch, ApiProblemError } from "../../lib/api-client";

interface RequestWaiverModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  requirement: {
    id: string;
    requirementKey: string;
    title: string;
    docTypeKey: string;
    mandatory: boolean;
  } | null;
  onWaiverSuccess: () => void;
}

export function RequestWaiverModal({
  open,
  onClose,
  projectId,
  requirement,
  onWaiverSuccess,
}: RequestWaiverModalProps) {
  const [waiverType, setWaiverType] = useState<"WAIVE" | "NOT_APPLICABLE">("WAIVE");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!requirement) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 10) {
      setError("Please provide a detailed technical or commercial justification (minimum 10 characters).");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiFetch(`/api/v1/requirements/${encodeURIComponent(requirement.id)}/waivers`, {
        method: "POST",
        body: JSON.stringify({
          type: waiverType,
          reason: reason.trim(),
        }),
      });

      onWaiverSuccess();
      onClose();
      setReason("");
    } catch (err: any) {
      setError(err?.message || "Failed to submit waiver request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request Requirement Waiver"
      subtitle={`${requirement.requirementKey} · ${requirement.docTypeKey}`}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Requirement Header */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
          <span className="font-semibold text-slate-900 block truncate">{requirement.title}</span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {requirement.mandatory ? (
              <span className="text-amber-800 font-bold">
                Mandatory requirement: two approvals needed
              </span>
            ) : (
              <span>Optional Item: Single-approver sign-off</span>
            )}
          </span>
        </div>

        {/* Waiver Type Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Waiver Classification
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setWaiverType("WAIVE")}
              className={`rounded-lg border p-2.5 text-left transition-all cursor-pointer ${
                waiverType === "WAIVE"
                  ? "border-[#3157D5] bg-[#EEF2FF] text-[#3157D5] font-bold"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-xs block">Waive Requirement</span>
              <span className="text-[10px] text-slate-500 font-normal">
                Concession granted by Client/PMC
              </span>
            </button>

            <button
              type="button"
              onClick={() => setWaiverType("NOT_APPLICABLE")}
              className={`rounded-lg border p-2.5 text-left transition-all cursor-pointer ${
                waiverType === "NOT_APPLICABLE"
                  ? "border-[#3157D5] bg-[#EEF2FF] text-[#3157D5] font-bold"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-xs block">Not Applicable (N/A)</span>
              <span className="text-[10px] text-slate-500 font-normal">
                Scope descoped or omitted from BOQ
              </span>
            </button>
          </div>
        </div>

        {/* Justification Textarea */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Engineering / Commercial Justification (Required)
          </label>
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. As agreed in Site Coordination Meeting #12 (Minute 4.2), duct leakage testing on gravity relief vents was waived because line pressure is under 50 Pa."
            className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
          />
        </div>

        {/* Mandatory Two-Approver Rule (FR-CHK-016) */}
        {requirement.mandatory && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-900">
            <strong>Mandatory Two-Approver Rule:</strong> Upon submission, this requirement enters{" "}
            <span className="font-semibold">awaiting a second approval</span> status until an authorised owner signs off.
          </div>
        )}

        {error && (
          <div className="rounded bg-red-50 p-2.5 text-xs text-red-800">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || reason.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded bg-purple-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-800 disabled:opacity-50 transition-all cursor-pointer shadow-xs"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Submitting Waiver...</span>
              </>
            ) : (
              <>
                <ShieldOff className="w-3.5 h-3.5" />
                <span>Submit Waiver Request</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
