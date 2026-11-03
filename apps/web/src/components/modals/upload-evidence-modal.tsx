"use client";

import React, { useState, useRef } from "react";
import { Modal } from "../ui/modal";
import {
  UploadCloud,
  FileCheck2,
  AlertCircle,
  FileText,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import { enqueueFieldUpload, compressImageForFieldUpload } from "../../lib/offline-upload-queue";

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
  const [compressionNotice, setCompressionNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setFile(selected);

    if (selected.type.startsWith("image/") && selected.size > 1024 * 1024) {
      setCompressionNotice(
        `High-resolution site photo (${(selected.size / (1024 * 1024)).toFixed(1)} MB). Client-side WebP compression will reduce this to ~600 KB before transmission.`
      );
    } else {
      setCompressionNotice(null);
    }
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
      let uploadFile = file;
      if (file.type.startsWith("image/")) {
        const { processedFile } = await compressImageForFieldUpload(file);
        uploadFile = processedFile;
      }

      await enqueueFieldUpload({
        projectId,
        requirementId: requirement.id,
        file: uploadFile,
        revisionCode: revisionCode.trim().toUpperCase(),
        issueDate,
        title: requirement.title,
        externalComment: externalComment.trim() || undefined,
      });

      onUploadSuccess();
      onClose();
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
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[#CBD5E1] rounded-xl p-5 text-center hover:border-[#3157D5] hover:bg-[#F8FAFC] transition-all cursor-pointer group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.zip"
            onChange={handleFileSelect}
            className="hidden"
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
                {file ? `${(file.size / 1024).toFixed(0)} KB` : "PDF, JPEG, PNG, WebP, XLSX, DOCX (Max 250 MB)"}
              </p>
            </div>
          </div>
        </div>

        {compressionNotice && (
          <div className="rounded-md bg-blue-50 border border-blue-200 p-2.5 text-[11px] text-blue-800 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 shrink-0 text-blue-600" />
            <span>{compressionNotice}</span>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-2.5 text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Revision & Issue Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Revision Code
            </label>
            <input
              type="text"
              required
              value={revisionCode}
              onChange={(e) => setRevisionCode(e.target.value)}
              placeholder="R0"
              className="w-full rounded border border-slate-300 p-2 text-xs font-mono font-semibold focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Test / Issue Date
            </label>
            <input
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
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Transmittal Reference or Remarks (Optional)
          </label>
          <input
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
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !file}
            className="inline-flex items-center gap-1.5 rounded bg-[#3157D5] px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 transition-all cursor-pointer shadow-xs"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading Evidence...</span>
              </>
            ) : (
              <>
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Submit Evidence</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
