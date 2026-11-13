"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "../ui/modal";
import { RequirementItem } from "../views/checklist-view";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, HardDrive } from "lucide-react";
import { set as idbSet, get as idbGet } from "idb-keyval";

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  requirement: RequirementItem | null;
  onUploadSubmit: (data: {
    requirementId: string;
    file: File;
    revisionCode: string;
    issueDate: string;
  }) => Promise<void>;
}

export function UploadModal({
  open,
  onClose,
  requirement,
  onUploadSubmit,
}: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [revisionCode, setRevisionCode] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [autosaveRestored, setAutosaveRestored] = useState(false);

  // Offline autosave draft restoration via IndexedDB (FR-DOC-033)
  useEffect(() => {
    if (open && requirement) {
      const draftKey = `tc_upload_draft_${requirement.id}`;
      idbGet(draftKey).then((saved) => {
        if (saved && typeof saved === "object") {
          if (saved.revisionCode) setRevisionCode(saved.revisionCode);
          if (saved.issueDate) setIssueDate(saved.issueDate);
          setAutosaveRestored(true);
          setTimeout(() => setAutosaveRestored(false), 2500);
        }
      });
    }
  }, [open, requirement]);

  // Persist draft on change
  const handleRevisionChange = (val: string) => {
    setRevisionCode(val);
    if (requirement) {
      idbSet(`tc_upload_draft_${requirement.id}`, { revisionCode: val, issueDate });
    }
  };

  const handleIssueDateChange = (val: string) => {
    setIssueDate(val);
    if (requirement) {
      idbSet(`tc_upload_draft_${requirement.id}`, { revisionCode, issueDate: val });
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirement || !file) return;

    setUploading(true);
    try {
      await onUploadSubmit({
        requirementId: requirement.id,
        file,
        revisionCode,
        issueDate,
      });
      // Clear autosave draft
      idbSet(`tc_upload_draft_${requirement.id}`, null);
      setFile(null);
      onClose();
    } finally {
      setUploading(false);
    }
  };

  if (!requirement) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload Compliance Document"
      subtitle={`${requirement.requirementKey} · ${requirement.title}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Autosave restored notification */}
        {autosaveRestored && (
          <div className="flex items-center gap-2 p-2 rounded bg-[#EEF2FF] border border-[#C7D2FE] text-xs text-[#3157D5]">
            <HardDrive className="h-3.5 w-3.5" />
            <span>Restored draft inputs from local offline storage</span>
          </div>
        )}

        {/* Drag and Drop Zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          className="border-2 border-dashed border-[#E5E7EB] hover:border-[#3157D5] rounded-xl p-6 text-center cursor-pointer transition-colors bg-[#FAFBFD]"
          onClick={() => {
            const input = document.getElementById("file-upload-input");
            input?.click();
          }}
        >
          <input
            id="file-upload-input"
            type="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                setFile(e.target.files[0]);
              }
            }}
          />
          {file ? (
            <div className="flex flex-col items-center gap-1.5">
              <FileText className="h-8 w-8 text-[#3157D5]" />
              <span className="text-xs font-semibold text-[#111827] truncate max-w-[240px]">
                {file.name}
              </span>
              <span className="font-mono text-[11px] text-[#667085]">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "Document"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <UploadCloud className="h-8 w-8 text-[#9CA3AF]" />
              <span className="text-xs font-semibold text-[#374151]">
                Click or drag & drop file to upload
              </span>
              <span className="text-[11px] text-[#9CA3AF]">
                PDF, DWG, XLSX, or ZIP up to 500 MB
              </span>
            </div>
          )}
        </div>

        {/* Metadata Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Document revision
            </label>
            <input
              type="text"
              required
              value={revisionCode}
              onChange={(e) => handleRevisionChange(e.target.value)}
              placeholder="Rev A or 01"
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Issue Date
            </label>
            <input
              type="date"
              required
              value={issueDate}
              onChange={(e) => handleIssueDateChange(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] p-2 text-xs font-mono text-[#111827] focus:border-[#3157D5] focus:outline-none"
            />
          </div>
        </div>

        {/* Action Buttons */}
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
            disabled={!file || uploading}
            className="rounded-md bg-[#3157D5] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] disabled:opacity-50 transition-all"
          >
            {uploading ? "Uploading document…" : "Upload Document"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
