"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "../ui/modal";
import {
  UploadCloud,
  FileCheck2,
  AlertCircle,
  FileText,
  Loader2,
} from "lucide-react";
import { enqueueFieldUpload } from "../../lib/offline-upload-queue";

interface UploadEvidenceModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  requirement: {
    id: string;
    requirementKey: string;
    title: string;
    docTypeKey: string;
    assetTag?: string | null;
  } | null;
  onUploadSuccess: () => void;
}

export function UploadEvidenceModal({
  open,
  onClose,
  projectId,
  requirement,
  onUploadSuccess,
}: UploadEvidenceModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [revisionCode, setRevisionCode] = useState("R0");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [externalComment, setExternalComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedLocally, setQueuedLocally] = useState(false);

  useEffect(() => {
    if (open) {
      setQueuedLocally(false);
      setError(null);
    }
  }, [open, requirement?.id]);

  if (!requirement) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (/\.(svg|exe|bat|docm|xlsm)$/i.test(selected.name)) {
      setError("This file type is not permitted. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG, or ZIP.");
      setFile(null);
      return;
    }

    setError(null);
    setQueuedLocally(false);
    setFile(selected);

  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a document or test record file.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await enqueueFieldUpload({
        projectId,
        requirementId: requirement.id,
        file,
        revisionCode: revisionCode.trim().toUpperCase(),
        issueDate,
        title: requirement.title,
        externalComment: externalComment.trim() || undefined,
      });

      // Persisted locally is not provider-uploaded, scan-verified or approved.
      onUploadSuccess();
      setQueuedLocally(true);
      setFile(null);
      setExternalComment("");
    } catch (err: any) {
      setError(err?.message || "Failed to enqueue upload.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload Technical Evidence"
      subtitle={`${requirement.requirementKey} · ${requirement.docTypeKey} (${requirement.assetTag || "Project-wide"})`}
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Requirement Header */}
        <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-xs">
          <span className="font-semibold text-slate-900 block truncate">{requirement.title}</span>
          <span className="text-slate-500 text-[11px] font-mono mt-0.5 block">
            Target Equipment: {requirement.assetTag || "Project General"}
          </span>
        </div>

        {/* File Dropzone */}
        <label
          htmlFor="evidence-upload-file"
          className="block border-2 border-dashed border-[#CBD5E1] rounded-xl p-5 text-center hover:border-[#3157D5] hover:bg-[#F8FAFC] focus-within:ring-2 focus-within:ring-blue-500 transition-all cursor-pointer group"
        >
          <input
            id="evidence-upload-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.zip"
            onChange={handleFileSelect}
            className="sr-only"
            aria-label="Select evidence file"
          />
          <div className="flex flex-col items-center justify-center gap-1.5">
            <div className="w-9 h-9 rounded-full bg-[#EEF2FF] flex items-center justify-center text-[#3157D5] group-hover:scale-105 transition-transform">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-800">
                {file ? file.name : "Click to select certificate, drawing, or photo"}
              </p>
              <p className="text-[11px] text-slate-500">
                {file ? `${(file.size / 1024).toFixed(0)} KB` : "File type and size must be accepted by the server"}
              </p>
            </div>
          </div>
        </label>

        {queuedLocally && (
          <div role="status" aria-live="polite" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Draft saved in this browser. It is <strong>not yet uploaded, scanned, verified or approved</strong>.
            Keep the app open while online so synchronization can run. Browser storage may be evicted; do not discard the original file until verification is confirmed.
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-2.5 text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Revision & Issue Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="evidence-revision-code" className="block text-xs font-semibold text-slate-700 mb-1">
              Revision Code
            </label>
            <input
              id="evidence-revision-code"
              type="text"
              required
              value={revisionCode}
              onChange={(e) => setRevisionCode(e.target.value)}
              placeholder="R0"
              className="w-full rounded border border-slate-300 p-2 text-xs font-mono font-semibold focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="evidence-issue-date" className="block text-xs font-semibold text-slate-700 mb-1">
              Test / Issue Date
            </label>
            <input
              id="evidence-issue-date"
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Remarks / Transmittal Reference */}
        <div>
          <label htmlFor="evidence-external-comment" className="block text-xs font-semibold text-slate-700 mb-1">
            Transmittal Reference or Remarks (Optional)
          </label>
          <input
            id="evidence-external-comment"
            type="text"
            value={externalComment}
            onChange={(e) => setExternalComment(e.target.value)}
            placeholder="e.g. Witnessed by Consultant Mr. Sharma on site"
            className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            {queuedLocally ? "Close" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={submitting || !file}
            className="inline-flex items-center gap-1.5 rounded bg-[#3157D5] px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 transition-all cursor-pointer shadow-xs"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving Draft...</span>
              </>
            ) : (
              <>
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Save Upload Draft</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
