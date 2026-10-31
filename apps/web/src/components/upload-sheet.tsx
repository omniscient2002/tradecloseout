'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { get, set, del } from 'idb-keyval';

export interface UploadSheetProps {
  projectId: string;
  requirementId: string;
  documentVersionId?: string;
  onUploadComplete?: (versionId: string) => void;
}

export interface UploadDraft {
  revisionCode: string;
  issueDate: string;
  remarks: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  lastUpdated: number;
}

export function UploadSheet({
  projectId,
  requirementId,
  documentVersionId,
  onUploadComplete,
}: UploadSheetProps) {
  const draftKey = `upload_draft_${projectId}_${requirementId}`;

  const [revisionCode, setRevisionCode] = useState('A');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load offline draft from IndexedDB on mount
  useEffect(() => {
    async function loadDraft() {
      try {
        const draft = await get<UploadDraft>(draftKey);
        if (draft) {
          setRevisionCode(draft.revisionCode || 'A');
          setIssueDate(draft.issueDate || new Date().toISOString().split('T')[0]);
          setRemarks(draft.remarks || '');
        }
      } catch (err) {
        console.warn('Failed to load draft from IndexedDB', err);
      }
    }
    loadDraft();
  }, [draftKey]);

  // Save metadata to IndexedDB when inputs change
  useEffect(() => {
    const draft: UploadDraft = {
      revisionCode,
      issueDate,
      remarks,
      fileName: file?.name || '',
      fileSize: file?.size || 0,
      mimeType: file?.type || '',
      lastUpdated: Date.now(),
    };
    set(draftKey, draft).catch((err) => {
      console.warn('Failed to save draft to IndexedDB', err);
    });
  }, [draftKey, revisionCode, issueDate, remarks, file]);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const selected = e.target.files?.[0];
    if (!selected) return;

    // Strict ban on SVG files per RT-006 / SEC-VAL-002
    if (
      selected.type === 'image/svg+xml' ||
      selected.name.toLowerCase().endsWith('.svg')
    ) {
      setErrorMessage('SVG files are strictly disallowed due to script execution risks (RT-006).');
      setFile(null);
      return;
    }

    setFile(selected);
  };

  const uploadFile = useCallback(async () => {
    if (!file) {
      setErrorMessage('Please select a file to upload.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    try {
      // 1. Create upload intent
      const intentRes = await fetch(`/api/v1/projects/${projectId}/requirements/${requirementId}/documents/upload-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSizeBytes: file.size,
          revisionCode,
          issueDate,
          remarks,
        }),
      });

      if (!intentRes.ok) {
        const err = await intentRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to initiate upload intent');
      }

      const { uploadUrls, versionId, uploadId, s3Key } = await intentRes.json();

      // 2. Upload chunks (10MB parts)
      const chunkSize = 10 * 1024 * 1024;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const completedParts: { partNumber: number; etag: string }[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        const partNumber = i + 1;
        let putUrl = uploadUrls[i];

        // If offline, wait for reconnect and refresh presigned URLs if needed
        while (!navigator.onLine) {
          await new Promise((r) => setTimeout(r, 2000));
        }

        let attempts = 0;
        let uploaded = false;

        while (attempts < 3 && !uploaded) {
          try {
            const putRes = await fetch(putUrl, {
              method: 'PUT',
              body: chunk,
            });

            if (putRes.status === 403 || putRes.status === 401) {
              // URL expired, refresh via API-082A
              const refreshRes = await fetch(`/api/v1/document-versions/${versionId}/refresh-upload-urls`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ partNumbers: [partNumber], uploadId, s3Key }),
              });
              const refreshed = await refreshRes.json();
              putUrl = refreshed.uploadUrls[0];
              attempts++;
              continue;
            }

            if (!putRes.ok) {
              throw new Error(`Upload of part ${partNumber} failed`);
            }

            const etag = putRes.headers.get('ETag') || `etag-part-${partNumber}`;
            completedParts.push({ partNumber, etag: etag.replace(/"/g, '') });
            uploaded = true;
            setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
          } catch (partErr) {
            attempts++;
            if (attempts >= 3) throw partErr;
            await new Promise((r) => setTimeout(r, 1000 * attempts));
          }
        }
      }

      // 3. Complete multipart upload
      const completeRes = await fetch(`/api/v1/document-versions/${versionId}/complete-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          parts: completedParts,
        }),
      });

      if (!completeRes.ok) {
        throw new Error('Failed to complete upload');
      }

      // Clean up draft from IndexedDB upon successful upload
      await del(draftKey);
      setFile(null);
      setIsUploading(false);
      if (onUploadComplete) {
        onUploadComplete(versionId);
      }
    } catch (err: any) {
      setIsUploading(false);
      setErrorMessage(err.message || 'Upload failed');
    }
  }, [file, projectId, requirementId, revisionCode, issueDate, remarks, draftKey, onUploadComplete]);

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm max-w-lg mx-auto">
      <h3 className="text-lg font-semibold mb-3">Upload Document</h3>

      {!isOnline && (
        <div className="mb-3 p-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded">
          ⚠️ You are offline. Your draft is saved locally and upload will resume when connection restores.
        </div>
      )}

      {errorMessage && (
        <div className="mb-3 p-2 bg-red-50 border border-red-300 text-red-700 text-sm rounded">
          {errorMessage}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">File</label>
          <input
            type="file"
            onChange={handleFileChange}
            disabled={isUploading}
            className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Revision Code</label>
            <input
              type="text"
              value={revisionCode}
              onChange={(e) => setRevisionCode(e.target.value)}
              disabled={isUploading}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Issue Date</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              disabled={isUploading}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Remarks</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={isUploading}
            rows={2}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            placeholder="Add any context or comments..."
          />
        </div>

        {isUploading && (
          <div className="w-full bg-gray-200 rounded-full h-2.5 my-2">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        <button
          type="button"
          onClick={uploadFile}
          disabled={isUploading || !file}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md text-sm disabled:opacity-50"
        >
          {isUploading ? `Uploading (${uploadProgress}%)` : 'Submit Document'}
        </button>
      </div>
    </div>
  );
}
