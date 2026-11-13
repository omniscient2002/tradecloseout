'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api-client';
import {
  UploadCloud,
  FileCheck,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

export interface UploadSheetProps {
  projectId: string;
  requirementId: string;
  requirementTitle?: string;
  documentVersionId?: string;
  onUploadComplete?: (versionId: string) => void;
}

export function UploadSheet({
  projectId,
  requirementId,
  requirementTitle = 'Chilled Water Pipe Pressure Test Certificate',
  documentVersionId,
  onUploadComplete,
}: UploadSheetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [revisionCode, setRevisionCode] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Monitor connectivity status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const validateAndSelectFile = (selected: File) => {
    setErrorMessage(null);
    setUploadSuccess(false);

    // Strict ban on SVG files per RT-006 / SEC-VAL-002
    if (
      selected.type === 'image/svg+xml' ||
      selected.name.toLowerCase().endsWith('.svg')
    ) {
      setErrorMessage('SVG files are strictly disallowed due to script execution risks (RT-006).');
      setFile(null);
      return;
    }

    // The API currently accepts uploads up to 100 MB.
    if (selected.size > 100 * 1024 * 1024) {
      setErrorMessage('File exceeds the current maximum upload size of 100 MB.');
      setFile(null);
      return;
    }

    setFile(selected);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) validateAndSelectFile(selected);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) validateAndSelectFile(droppedFile);
  };

  const uploadFile = useCallback(async () => {
    if (!file) {
      setErrorMessage('Please select a file to upload.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setUploadSuccess(false);

    try {
      if (!navigator.onLine) {
        throw new Error('Reconnect to the internet and select the file again. Only draft metadata is saved offline.');
      }

      const intent = await apiFetch<{
        versionId: string;
        isMultipart: boolean;
        s3UploadId: string | null;
        partSizeBytes: number;
        parts: Array<{ partNumber: number; uploadUrl: string; requiredHeaders: Record<string, string> }>;
      }>(`/api/v1/projects/${projectId}/documents/upload-intents`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          requirementId,
          revisionCode,
          issueDate,
          title: file.name,
        }),
      });

      if (!intent.parts.length || !intent.versionId || intent.partSizeBytes < 1) {
        throw new Error('The server returned an incomplete upload plan. No file was reported as uploaded.');
      }

      const parts = [...intent.parts].sort((a, b) => a.partNumber - b.partNumber);
      const completedParts: { partNumber: number; etag: string }[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const start = i * intent.partSizeBytes;
        const end = Math.min(start + intent.partSizeBytes, file.size);
        const chunk = file.slice(start, end);
        const partNumber = part.partNumber;
        let putUrl = part.uploadUrl;
        let requiredHeaders = part.requiredHeaders || {};

        let attempts = 0;
        let uploaded = false;

        while (attempts < 3 && !uploaded) {
          try {
            if (!navigator.onLine) throw new Error('Connection lost. Reconnect and retry the upload.');
            const putRes = await fetch(putUrl, {
              method: 'PUT',
              headers: requiredHeaders,
              body: chunk,
            });

            if ((putRes.status === 403 || putRes.status === 401) && intent.isMultipart && intent.s3UploadId) {
              const refreshed = await apiFetch<{
                refreshedParts: Array<{ partNumber: number; uploadUrl: string; requiredHeaders: Record<string, string> }>;
              }>(`/api/v1/document-versions/${intent.versionId}/refresh-upload-urls`, { method: 'POST' });
              const replacement = refreshed.refreshedParts.find((candidate) => candidate.partNumber === partNumber);
              if (!replacement) throw new Error(`No refreshed upload URL was returned for part ${partNumber}.`);
              putUrl = replacement.uploadUrl;
              requiredHeaders = replacement.requiredHeaders || {};
              attempts++;
              continue;
            }

            if (!putRes.ok) throw new Error(`Upload of part ${partNumber} failed`);

            if (intent.isMultipart) {
              const etag = putRes.headers.get('ETag');
              if (!etag) throw new Error(`Storage did not return an ETag for part ${partNumber}.`);
              completedParts.push({ partNumber, etag: etag.replace(/"/g, '') });
            }
            uploaded = true;
            setUploadProgress(Math.round(((i + 1) / parts.length) * 100));
          } catch (partErr) {
            attempts++;
            if (attempts >= 3) throw partErr;
            await new Promise((r) => setTimeout(r, 1000 * attempts));
          }
        }
      }

      const completion = await apiFetch<{ fileStatus: string }>(`/api/v1/document-versions/${intent.versionId}/complete-upload`, {
        method: 'POST',
        body: JSON.stringify({ parts: completedParts }),
      });
      if (!['PROCESSING', 'READY'].includes(completion.fileStatus)) {
        throw new Error(`Upload completion returned unexpected file state ${completion.fileStatus || 'unknown'}.`);
      }

      setUploadSuccess(true);
      setIsUploading(false);
      if (onUploadComplete) onUploadComplete(intent.versionId);
    } catch (err: any) {
      setIsUploading(false);
      setErrorMessage(err.message || 'Upload failed');
    }
  }, [file, projectId, requirementId, revisionCode, issueDate, onUploadComplete]);

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase bg-sky-100 text-sky-800">
              Upload a document
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-900">{requirementTitle}</h3>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 font-medium">Req ID: {requirementId}</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Offline Alert */}
        {!isOnline && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg flex items-start gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Offline Mode Active</p>
              <p className="text-amber-700 mt-0.5">
                Upload is unavailable offline. The selected file remains only in this open page; reconnect before starting or retrying the upload.
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Upload Notice</p>
              <p className="text-rose-700 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Success Alert */}
        {uploadSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Upload received — verification pending</p>
              <p className="text-emerald-700 mt-0.5">The file is being scanned. It is not available for review until verification completes.</p>
            </div>
          </div>
        )}

        {/* Drag & Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-sky-500 bg-sky-50/50'
              : file
              ? 'border-emerald-300 bg-emerald-50/30'
              : 'border-slate-200 hover:border-sky-400 hover:bg-slate-50/60'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            disabled={isUploading}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.dwg,.zip"
            className="hidden"
          />

          {file ? (
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <FileCheck className="w-5 h-5" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800 truncate max-w-xs">{file.name}</p>
                <p className="text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to submit</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 mx-auto flex items-center justify-center">
                <UploadCloud className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-slate-700">
                Tap to upload or drag & drop files here
              </p>
              <p className="text-xs text-slate-400">
                PDF, DWG, DOCX, XLSX, ZIP, PNG, JPG, WebP (SVG is not supported)
              </p>
            </div>
          )}
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Document revision</label>
            <input
              type="text"
              value={revisionCode}
              onChange={(e) => setRevisionCode(e.target.value.toUpperCase())}
              disabled={isUploading}
              maxLength={5}
              className="w-full text-sm font-medium bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Issue Date</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              disabled={isUploading}
              className="w-full text-sm font-medium bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>
        </div>

        {/* Remarks */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Draft-only notes (not included with this upload)</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={isUploading}
            rows={2}
            placeholder="Add specific comments, calibration tag numbers, or site location notes..."
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 resize-none"
          />
        </div>

        {/* Upload Progress Bar */}
        {isUploading && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-xs text-slate-600 font-medium">
              <span>Uploading chunked parts...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-sky-600 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Submit Action */}
        <button
          type="button"
          onClick={uploadFile}
          disabled={isUploading || !file}
          className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-medium rounded-lg text-sm transition-all shadow-sm shadow-sky-600/20 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
        >
          {isUploading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Uploading Document ({uploadProgress}%)</span>
            </>
          ) : (
            <>
              <UploadCloud className="w-4 h-4" />
              <span>Submit for Verification</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
