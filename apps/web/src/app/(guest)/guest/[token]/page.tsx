"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Download,
} from "lucide-react";
import { apiFetch, ApiProblemError, setCsrfToken } from "../../../../lib/api-client";
import { enqueueFieldUpload, setOfflineActorPartition } from "../../../../lib/offline-upload-queue";

interface GuestPortalContextDto {
  grantId: string;
  grantType: "SUPPLIER_UPLOAD" | "CLIENT_VIEW";
  contractorName: string;
  brandColor: string;
  projectId: string;
  projectName: string;
  otpRequired: boolean;
  otpVerified: boolean;
  supportContactText: string;
  assignedRequirements?: Array<{
    id: string;
    requirementKey: string;
    title: string;
    docTypeKey: string;
    status: string;
    dueAt: string | null;
  }>;
  submissionPackage?: {
    submissionId: string;
    recipientId: string;
    packageVersionNo: number;
    documentCount: number;
    totalPages: number;
    downloadUrl: string;
    currentDecision: string | null;
  };
}

export default function StandaloneGuestPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [ctx, setCtx] = useState<GuestPortalContextDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guest OTP State (05 §6.2 & RT-014)
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);

  // Supplier Upload State (SCR-034)
  const [selectedReqId, setSelectedReqId] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [revCode, setRevCode] = useState("R0");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Client Acceptance State (SCR-031 / AUD-P-16)
  const [clientDecision, setClientDecision] = useState<
    "ACCEPTED" | "ACCEPT_WITH_EXCEPTIONS" | "REJECTED"
  >("ACCEPTED");
  const [clientRemarks, setClientRemarks] = useState("");
  const [clientDecisionSaved, setClientDecisionSaved] = useState(false);

  const loadGuestContext = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<GuestPortalContextDto>(
        `/api/v1/guest/${encodeURIComponent(token)}`,
      );
      let resolved = res;
      try {
        const session = await apiFetch<Pick<GuestPortalContextDto, "grantId" | "projectId" | "otpVerified" | "assignedRequirements">>(
          '/api/v1/guest/me/context',
        );
        if (session.grantId === res.grantId && session.projectId === res.projectId) {
          resolved = { ...res, ...session };
          setOfflineActorPartition(`guest:${session.grantId}`);
          if (session.assignedRequirements?.[0]) setSelectedReqId(session.assignedRequirements[0].id);
        } else {
          setOfflineActorPartition(null);
        }
      } catch (sessionError: any) {
        setOfflineActorPartition(null);
        if (!(sessionError instanceof ApiProblemError) || ![401, 403, 404].includes(sessionError.status)) {
          throw sessionError;
        }
      }
      setCtx(resolved);
    } catch (err: any) {
      setError(
        err instanceof ApiProblemError
          ? err.message
          : "This link has expired or been revoked. Ask the contractor for a new link.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadGuestContext();
  }, [loadGuestContext]);

  const handleRequestGuestOtp = async () => {
    setError(null);
    try {
      const result = await apiFetch<{ challengeId: string }>(`/api/v1/guest/${encodeURIComponent(token)}/otp/request`, {
        method: "POST",
      });
      setOtpChallengeId(result.challengeId);
      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || "Could not send OTP.");
    }
  };

  const handleVerifyGuestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallengeId) {
      setError("Request a new verification code first.");
      return;
    }
    setError(null);
    try {
      const res = await apiFetch<{ csrfToken: string }>(
        `/api/v1/guest/${encodeURIComponent(token)}/otp/verify`,
        {
          method: "POST",
          body: JSON.stringify({ code: otpCode.trim(), challengeId: otpChallengeId }),
        },
      );
      if (res?.csrfToken) {
        setCsrfToken(res.csrfToken);
      }
      await loadGuestContext();
    } catch (err: any) {
      setError(err.message || "Invalid OTP code.");
    }
  };

  const handleSupplierUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx || !selectedFile || !selectedReqId) return;
    if (/\.(svg|exe|bat|docm|xlsm)$/i.test(selectedFile.name)) {
      setError(
        "This file type isn't supported. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG or ZIP (SVG is strictly banned).",
      );
      return;
    }

    setError(null);
    try {
      await enqueueFieldUpload({
        actorPartition: `guest:${ctx.grantId}`,
        projectId: ctx.projectId,
        requirementId: selectedReqId,
        file: selectedFile,
        revisionCode: revCode,
        issueDate,
        title: selectedFile.name,
        externalComment: remarks,
      });
      setUploadSuccess(`Uploaded. ${ctx.contractorName} will review it.`);
    } catch (err: any) {
      setError(err.message || "Upload failed.");
    }
  };

  const handleClientDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctx?.submissionPackage) return;
    if (clientDecision !== "ACCEPTED" && clientRemarks.trim().length < 5) {
      setError("Remarks are required when accepting with exceptions or rejecting.");
      return;
    }

    const canonicalDecision =
      clientDecision === "REJECTED"
        ? "REJECT"
        : clientDecision === "ACCEPT_WITH_EXCEPTIONS"
        ? "ACCEPT_WITH_EXCEPTIONS"
        : "ACCEPT";

    setError(null);
    try {
      await apiFetch(
        `/api/v1/submissions/${ctx.submissionPackage.submissionId}/recipients/${ctx.submissionPackage.recipientId}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision: canonicalDecision,
            remarks: clientRemarks.trim() || undefined,
            comment: clientRemarks.trim() || undefined,
          }),
        },
      );
      setClientDecisionSaved(true);
    } catch (err: any) {
      setError(err.message || "Could not record decision.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center text-xs text-slate-600">
        Loading external request…
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-red-300 bg-white p-6 text-xs text-red-900 space-y-2">
          <div className="font-bold text-sm">External Link Unavailable</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] font-sans py-8 px-4">
      <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Sandboxed Contractor Brand Accent Bar (FR-ORG-007) */}
        <div
          style={{ backgroundColor: ctx.brandColor || "#0F2942" }}
          className="h-1.5 w-full"
        />

        {/* Simplified Guest Header (11 §2.3 & §2.4: Zero internal navigation) */}
        <header className="border-b border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-slate-900">{ctx.contractorName}</h1>
            <p className="text-xs text-slate-600">Project: {ctx.projectName}</p>
          </div>
          <span className="rounded-full bg-amber-50 border border-amber-300 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
            External access
          </span>
        </header>

        <div className="p-6 space-y-5 text-xs">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: OTP Gate if required (05 §6.2 & RT-014) */}
          {ctx.otpRequired && !ctx.otpVerified ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <KeyRound className="h-4 w-4 text-blue-600" />
                <span>Verify your identity to access this request</span>
              </div>
              {!otpSent ? (
                <button
                  type="button"
                  onClick={handleRequestGuestOtp}
                  className="w-full rounded-md bg-[#0F2942] py-2.5 font-semibold text-white hover:bg-[#163A5F]"
                >
                  Send 6-Digit Verification Code
                </button>
              ) : (
                <form onSubmit={handleVerifyGuestOtp} className="space-y-3">
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="Enter 6-digit OTP"
                    className="w-full rounded-md border border-slate-400 px-3 py-2 text-center font-mono text-base font-bold tracking-widest"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-md bg-[#0F2942] py-2.5 font-semibold text-white"
                  >
                    Verify & Continue
                  </button>
                </form>
              )}
            </div>
          ) : ctx.grantType === "SUPPLIER_UPLOAD" ? (
            /* Step 2A: Supplier Request Upload View (SCR-034) */
            <form onSubmit={handleSupplierUploadSubmit} className="space-y-4">
              {uploadSuccess && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{uploadSuccess}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Assigned Requirement (Scoped to this link)
                </label>
                <select
                  value={selectedReqId}
                  onChange={(e) => setSelectedReqId(e.target.value)}
                  className="w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-xs font-medium"
                >
                  {(ctx.assignedRequirements ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.requirementKey} — {r.title}
                    </option>
                  ))}
                </select>
              </div>

              <label className="block cursor-pointer rounded-lg border-2 border-dashed border-blue-600 bg-blue-50/40 p-6 text-center hover:bg-blue-50/70">
                <UploadCloud className="mx-auto h-7 w-7 text-blue-700" />
                <div className="mt-2 font-semibold text-slate-900">
                  {selectedFile
                    ? `Selected: ${selectedFile.name}`
                    : "Tap to Choose File or Take Photo"}
                </div>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.zip"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Revision (Required)
                  </label>
                  <input
                    type="text"
                    required
                    value={revCode}
                    onChange={(e) => setRevCode(e.target.value)}
                    className="w-full rounded border border-slate-400 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Issue Date (Required)
                  </label>
                  <input
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full rounded border border-slate-400 px-2.5 py-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-2"
                />
              </div>

              <button
                type="submit"
                disabled={!selectedFile}
                className="w-full rounded-md bg-[#1D4ED8] py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                Upload Document
              </button>
            </form>
          ) : (
            /* Step 2B: Client Package Acceptance View (SCR-031 / AUD-P-16) */
            <form onSubmit={handleClientDecisionSubmit} className="space-y-4">
              {ctx.submissionPackage && (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <div>
                    <div className="font-bold text-slate-900">
                      Handover Package v{ctx.submissionPackage.packageVersionNo}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {ctx.submissionPackage.documentCount} Documents ·{" "}
                      {ctx.submissionPackage.totalPages} Pages
                    </div>
                  </div>
                  <a
                    href={ctx.submissionPackage.downloadUrl}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download PDF</span>
                  </a>
                </div>
              )}

              {!clientDecisionSaved ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "ACCEPTED", label: "Accept" },
                      {
                        id: "ACCEPT_WITH_EXCEPTIONS",
                        label: "Accept with exceptions",
                      },
                      { id: "REJECTED", label: "Reject" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setClientDecision(opt.id as typeof clientDecision)
                        }
                        className={`rounded border p-2.5 font-semibold ${
                          clientDecision === opt.id
                            ? "border-blue-600 bg-blue-50 text-blue-900"
                            : "border-slate-200"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={3}
                    value={clientRemarks}
                    onChange={(e) => setClientRemarks(e.target.value)}
                    placeholder="Remarks or exception details (required for exceptions or rejection)..."
                    className="w-full rounded border border-slate-300 p-2.5"
                  />

                  <p className="text-[11px] text-slate-500">
                    This decision will be recorded with your name and timestamp.
                  </p>

                  <button
                    type="submit"
                    className="w-full rounded-md bg-[#0F2942] py-2.5 font-semibold text-white"
                  >
                    Confirm & Record Decision
                  </button>
                </>
              ) : (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 font-semibold">
                  Decision recorded with timestamp. Any noted exceptions have been
                  logged as follow-up requirement change requests.
                </div>
              )}
            </form>
          )}

          <footer className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            {ctx.supportContactText}
          </footer>
        </div>
      </div>
    </div>
  );
}
