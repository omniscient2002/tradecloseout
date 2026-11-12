"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Modal } from "../ui/modal";
import {
  UploadCloud,
  FileCheck2,
  AlertCircle,
  FileText,
  Loader2,
} from "lucide-react";
import {
  enqueueFieldUpload,
  listOfflineUploadDrafts,
  discardOfflineUploadDraft,
  recoverOfflineUploadDraft,
  MAX_UPLOAD_FILE_BYTES,
  type OfflineUploadDraftSummary,
} from "../../lib/offline-upload-queue";

interface UploadEvidenceModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  requirement: {
    id: string;
    requirementKey: string;
    title: string;
    docTypeKey: string;
    rowVersion: number;
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
  const captureControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedLocally, setQueuedLocally] = useState(false);
  const [drafts, setDrafts] = useState<OfflineUploadDraftSummary[]>([]);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);

  const refreshDrafts = useCallback(async () => {
    try {
      const entries = await listOfflineUploadDrafts();
      setDrafts(entries);
      setDraftsError(null);
    } catch (error) {
      setDrafts([]);
      setDraftsError(error instanceof Error ? error.message : "Unable to read browser drafts.");
    }
  }, []);

  const discardDraft = async (draft: OfflineUploadDraftSummary) => {
    if (!window.confirm("Discard the local original for " + draft.filename +
        "? If an upload intent exists, the server must confirm abort first. This cannot be undone.")) return;
    setDiscardingId(draft.queueId);
    setDraftsError(null);
    try {
      await discardOfflineUploadDraft(draft.queueId);
      await refreshDrafts();
    } catch (error) {
      setDraftsError(error instanceof Error ? error.message : "Draft could not be discarded.");
    } finally {
      setDiscardingId(null);
    }
  };

  const recoverDraft = async (draft: OfflineUploadDraftSummary) => {
    if (!window.confirm("Recover " + draft.filename +
        " for project " + draft.projectId + ", requirement " + draft.requirementId +
        " from your previous session? The server will recheck your identity and upload permission. No remote upload will be started by this action.")) return;
    setRecoveringId(draft.queueId);
    setDraftsError(null);
    try {
      await recoverOfflineUploadDraft(draft.queueId);
      await refreshDrafts();
    } catch (error) {
      setDraftsError(error instanceof Error ? error.message : "Draft could not be recovered.");
    } finally {
      setRecoveringId(null);
    }
  };

  useEffect(() => {
    if (open) {
      setQueuedLocally(false);
      setError(null);
      void refreshDrafts();
    } else {
      // Closing the dialog stops uncommitted hashing, but never discards an
      // original that already successfully reached IndexedDB.
      captureControllerRef.current?.abort();
    }
  }, [open, requirement?.id, refreshDrafts]);

  if (!requirement) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (/\.(svg|exe|bat|docm|xlsm)$/i.test(selected.name)) {
      setError("This file type is not permitted. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG, or ZIP.");
      setFile(null);
      return;
    }

    if (selected.size > MAX_UPLOAD_FILE_BYTES || selected.size < 1) {
      setError("Choose a non-empty file up to 100 MiB; the server rejects larger uploads.");
      setFile(null);
      return;
    }
    setError(null);
    setQueuedLocally(false);
    setFile(selected);

  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!file) {
      setError("Please select a document or test record file.");
      return;
    }

    const controller = new AbortController();
    captureControllerRef.current = controller;
    setSubmitting(true);
    setError(null);

    try {
      await enqueueFieldUpload({
        signal: controller.signal,
        projectId,
        requirementId: requirement.id,
        requirementRowVersion: requirement.rowVersion,
        file,
        revisionCode: revisionCode.trim().toUpperCase(),
        issueDate,
        title: requirement.title,
        externalComment: externalComment.trim() || undefined,
      });

      // Persisted locally is not provider-uploaded, scan-verified or approved.
      setQueuedLocally(true);
      setFile(null);
      setExternalComment("");
      // Clear the native file input as well, so selecting the same file later
      // fires onChange and the user can deliberately queue a new revision.
      form.reset();
      void refreshDrafts();
      try {
        onUploadSuccess(); // Re-query authoritative server state, if available.
      } catch {
        // A page refresh callback failure does not undo the saved local draft.
      }
    } catch (err: any) {
      setError(err?.name === "AbortError" ? "Local capture cancelled before saving." :
        err?.message || "Failed to enqueue upload.");
    } finally {
      if (captureControllerRef.current === controller) captureControllerRef.current = null;
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

        {/* Local unsynced evidence is not a server document or an accepted submission. */}
        <section aria-label="Drafts saved in this browser" className="rounded-lg border border-slate-200 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-slate-800">Your local upload drafts</strong>
            <button type="button" onClick={() => void refreshDrafts()}
              className="font-semibold text-indigo-700 underline">Refresh</button>
          </div>
          <p className="text-slate-500">
            Saved in this browser, not necessarily uploaded. Browser storage is not guaranteed against eviction;
            do not use shared browser profiles for confidential evidence.
          </p>
          {draftsError && <p role="alert" className="text-red-800">{draftsError}</p>}
          {drafts.length === 0 ? (
            <p className="text-slate-600">No drafts visible for the current account.</p>
          ) : (
            <ul className="max-h-36 overflow-y-auto divide-y divide-slate-100">
              {drafts.map((draft) => (
                <li key={draft.queueId} className="py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="break-all font-semibold">{draft.filename}</span>
                    <span className="block text-slate-600">
                      {draft.status.replaceAll("_", " ")} · {(draft.sizeBytes / 1024 / 1024).toFixed(1)} MiB
                    </span>
                    <span className="block text-slate-500 break-all">
                      Project: {draft.projectId === projectId ? "Current project" : draft.projectId}
                      {" · "}Requirement: {draft.requirementId === requirement.id ? "Current requirement" : draft.requirementId}
                    </span>
                    {draft.lastError && <span className="block text-red-700">{draft.lastError}</span>}
                    {draft.status === "BLOCKED_SCOPE" && !draft.canRecoverLocalOnly && (
                      <span className="block text-amber-700">
                        Automatic recovery unavailable; this draft may have remote state. Keep the original and resolve the server outcome.
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {draft.status === "BLOCKED_SCOPE" && draft.canRecoverLocalOnly && (
                      <button type="button"
                        disabled={recoveringId !== null || discardingId !== null}
                        onClick={() => void recoverDraft(draft)}
                        className="text-indigo-700 font-semibold underline disabled:opacity-50">
                        {recoveringId === draft.queueId ? "Checking…" : "Recover"}
                      </button>
                    )}
                    <button type="button"
                      disabled={discardingId !== null || recoveringId !== null || draft.status === "PROCESSING"}
                      onClick={() => void discardDraft(draft)}
                      className="text-red-700 font-semibold underline disabled:opacity-50">
                      {discardingId === draft.queueId ? "Discarding…" : "Discard"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

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
            onClick={() => submitting ? captureControllerRef.current?.abort() : onClose()}
            className="rounded border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            {submitting ? "Stop Local Capture" : queuedLocally ? "Close" : "Cancel"}
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
