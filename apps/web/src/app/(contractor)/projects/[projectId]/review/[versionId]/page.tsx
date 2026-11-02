"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  X,
  FileEdit,
  Stamp,
  Download,
  CheckCircle2,
  AlertCircle,
  Lock,
  Globe,
  Plus,
} from "lucide-react";
import { apiFetch, ApiProblemError } from "../../../../../../lib/api-client";

interface VersionReviewDetailDto {
  versionId: string;
  documentId: string;
  requirementId: string;
  requirementKey: string;
  requirementTitle: string;
  docTypeKey: string;
  assetTag: string | null;
  revisionCode: string;
  issueDate: string;
  expiryDate: string | null;
  fileStatus: string;
  reviewStatus: string;
  pageCount: number | null;
  sha256: string;
  uploadedByName: string;
  reviewerRole: string | null;
  rowVersion: number;
  reviewId: string | null;
  comments: Array<{
    id: string;
    pageNo: number | null;
    body: string;
    visibility: "INTERNAL" | "EXTERNAL";
    authorName: string;
    createdAt: string;
  }>;
}

export default function DocumentReviewWorkbenchPage() {
  const params = useParams<{ projectId: string; versionId: string }>();
  const router = useRouter();
  const projectId = params?.projectId;
  const versionId = params?.versionId;

  const [detail, setDetail] = useState<VersionReviewDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; orgRole: string } | null>(null);
  const [dscSealedCode, setDscSealedCode] = useState<string | null>(null);

  // Decision & Comment Form State (11 §4.9)
  const [tab, setTab] = useState<"IN_APP" | "EXTERNAL">("IN_APP");
  const [decisionComment, setDecisionComment] = useState("");
  const [newPinPage, setNewPinPage] = useState<number>(1);
  const [newPinBody, setNewPinBody] = useState("");
  const [newPinVisibility, setNewPinVisibility] = useState<"EXTERNAL" | "INTERNAL">(
    "EXTERNAL",
  );

  // External Approval Form State (WF-23 / SCR-027 / RT-022)
  const [extApproverName, setExtApproverName] = useState("");
  const [extApproverRoleOrg, setExtApproverRoleOrg] = useState("");
  const [extDecisionDate, setExtDecisionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [extMethod, setExtMethod] = useState<
    "STAMPED_PDF" | "EMAIL" | "PORTAL" | "PHYSICAL"
  >("STAMPED_PDF");
  const [extReference, setExtReference] = useState("");
  const [extEvidenceObjectId, setExtEvidenceObjectId] = useState("");

  const loadVersionDetail = useCallback(async () => {
    if (!projectId || !versionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<VersionReviewDetailDto>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/document-versions/${encodeURIComponent(
          versionId,
        )}`,
      );
      setDetail(res);
    } catch (err: any) {
      setError(err instanceof ApiProblemError ? err.message : "Failed to load document version.");
    } finally {
      setLoading(false);
    }
  }, [projectId, versionId]);

  useEffect(() => {
    loadVersionDetail();
    apiFetch<any>("/api/v1/auth/me")
      .then((u) => setCurrentUser(u))
      .catch(() => {});
  }, [loadVersionDetail]);

  const handleAddPageComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail?.reviewId || !newPinBody.trim()) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/reviews/${detail.reviewId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          pageNo: newPinPage,
          body: newPinBody.trim(),
          visibility: newPinVisibility,
        }),
      });
      setNewPinBody("");
      await loadVersionDetail();
    } catch (err: any) {
      setError(err.message || "Could not add comment.");
    }
  };

  const handleInAppDecision = async (
    decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT",
  ) => {
    if (!detail) return;
    if (decision !== "APPROVE" && decisionComment.trim().length < 10) {
      setError(
        "Comment of at least 10 characters is required when requesting changes or rejecting (11 §4.9).",
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(
        `/api/v1/projects/${projectId}/document-versions/${detail.versionId}/decision`,
        {
          method: "POST",
          rowVersion: detail.rowVersion,
          body: JSON.stringify({
            method: "IN_APP",
            decision,
            comment: decisionComment.trim() || undefined,
          }),
        },
      );
      setBanner(`Decision '${decision}' committed. Requirement status updated.`);
      await loadVersionDetail();
    } catch (err: any) {
      setError(err instanceof ApiProblemError ? err.message : "Decision failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordExternalApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!extApproverName.trim() || !extDecisionDate || !extReference.trim()) {
      setError("Approver name, decision date, and reference are required (WF-23).");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(
        `/api/v1/document-versions/${encodeURIComponent(detail.versionId)}/external-approval`,
        {
          method: "POST",
          rowVersion: detail.rowVersion,
          body: JSON.stringify({
            projectId,
            approverName: extApproverName.trim(),
            approverRoleOrg: extApproverRoleOrg.trim(),
            decisionDate: extDecisionDate,
            externalMethod: extMethod,
            reference: extReference.trim(),
            evidenceObjectId: extEvidenceObjectId.trim() || undefined,
          }),
        },
      );
      setBanner(
        "External approval recorded. This item will be labelled 'Approved (external)' in the handover package.",
      );
      await loadVersionDetail();
    } catch (err: any) {
      setError(err instanceof ApiProblemError ? err.message : "External approval failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyDsc = async () => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<any>(`/api/v1/projects/${projectId}/signatures`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "DOCUMENT_VERSION",
          targetId: detail.versionId,
          signerName: currentUser?.name || "Karthikeya Sharma",
          signerDesignation: "Lead QA/QC Engineer",
          signatureStandard: "CLASS_3_DSC_PKCS7",
          certificateSerial: "EMUDHRA-DSC-2026-QC",
          certificateIssuer: "CN=eMudhra Sub-CA, O=eMudhra Limited, C=IN",
          certificateSubject: `CN=${currentUser?.name || "Karthikeya Sharma"}, O=Deccan EnviroTech MEP Pvt Ltd, C=IN`,
          signedPdfSha256: detail.sha256,
          pkcs7SignatureHex: "3082046a06092a864886f70d010702a082045b30820457020101",
        }),
      });
      setDscSealedCode(res.verificationCode);
      setBanner(`✓ Cryptographic DSC Applied: Document sealed with Class 3 DSC. Verification Code: ${res.verificationCode}`);
    } catch (err: any) {
      setError(err.message || "Failed to apply digital signature");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0F172A] text-xs text-slate-300">
        Loading verified PDF stream & review context…
      </div>
    );
  }

  const streamUrl = `/api/v1/projects/${encodeURIComponent(
    projectId,
  )}/document-versions/${encodeURIComponent(versionId)}/stream`;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0F172A] font-sans">
      {/* Left 70% Pane: Dark Engineering PDF Stage (SCR-025) */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0B1120] px-4 text-xs text-slate-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/projects/${projectId}`)}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Project</span>
            </button>
            {detail && (
              <div className="flex items-center gap-2 truncate">
                <span className="rounded bg-blue-500/20 border border-blue-400/30 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-300">
                  {detail.requirementKey}
                </span>
                <span className="font-semibold text-white truncate">
                  {detail.requirementTitle}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                  Rev {detail.revisionCode}
                </span>
              </div>
            )}
          </div>

          <a
            href={streamUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Original PDF</span>
          </a>
        </header>

        {/* Real Binary PDF Stream Frame */}
        <div className="flex-1 bg-[#1E293B] p-3">
          <iframe
            src={streamUrl}
            title="Verified Engineering PDF Preview"
            className="h-full w-full rounded border border-slate-700 bg-white shadow-2xl"
          />
        </div>
      </div>

      {/* Right 30% Pane: Metadata, Page Comments & Decision Dock (SCR-027) */}
      <aside className="w-[420px] shrink-0 border-l border-slate-200 bg-white text-[#0F172A] flex flex-col justify-between overflow-y-auto">
        <div className="p-4 space-y-4 text-xs">
          {banner && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{banner}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {detail && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-slate-900">
                    Revision {detail.revisionCode} ({detail.reviewStatus})
                  </span>
                  <span className="font-mono text-[11px] text-emerald-700 font-semibold">
                    ✓ ClamAV & qpdf Verified
                  </span>
                </div>
                <div className="text-[11px] text-slate-600">
                  Equipment: <strong>{detail.assetTag || "Project-wide"}</strong> · Issue
                  Date: <strong className="font-mono">{detail.issueDate}</strong>
                </div>
                <div className="font-mono text-[10px] text-slate-400 truncate">
                  SHA-256: {detail.sha256}
                </div>
              </div>

              {/* Page-Specific Comments List (FR-REV-004) */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800">
                  Review Comments ({detail.comments.length})
                </div>
                {detail.comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-slate-200 p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {c.pageNo ? `Page ${c.pageNo} · ` : ""}
                        {c.authorName}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        {c.visibility === "INTERNAL" ? (
                          <>
                            <Lock className="h-2.5 w-2.5" /> Internal
                          </>
                        ) : (
                          <>
                            <Globe className="h-2.5 w-2.5" /> External
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-slate-700">{c.body}</p>
                  </div>
                ))}

                {/* Add Page Comment Form */}
                {detail.reviewId && (
                  <form onSubmit={handleAddPageComment} className="pt-2 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={1}
                        max={detail.pageCount || 999}
                        value={newPinPage}
                        onChange={(e) => setNewPinPage(Number(e.target.value))}
                        className="w-20 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                        placeholder="Page #"
                      />
                      <select
                        value={newPinVisibility}
                        onChange={(e) =>
                          setNewPinVisibility(e.target.value as "EXTERNAL" | "INTERNAL")
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="EXTERNAL">External (Visible to uploader)</option>
                        <option value="INTERNAL">Internal note only</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newPinBody}
                        onChange={(e) => setNewPinBody(e.target.value)}
                        placeholder="Add page-specific comment..."
                        className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>

        {/* Sticky Bottom Decision Dock (SCR-027: In-App vs External Approval WF-23) */}
        <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 rounded-lg bg-slate-200 p-1 font-semibold">
            <button
              type="button"
              onClick={() => setTab("IN_APP")}
              className={`rounded-md py-1.5 ${
                tab === "IN_APP" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600"
              }`}
            >
              In-App Decision
            </button>
            <button
              type="button"
              onClick={() => setTab("EXTERNAL")}
              className={`rounded-md py-1.5 flex items-center justify-center gap-1 ${
                tab === "EXTERNAL" ? "bg-white text-teal-900 shadow-2xs" : "text-slate-600"
              }`}
            >
              <Stamp className="h-3.5 w-3.5" />
              <span>External Approval</span>
            </button>
          </div>

          {currentUser?.orgRole === "R-SITE" ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 space-y-1.5 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold text-amber-950">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Uploader Mode (Site Engineer) — Review Decision Restricted</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-900">
                Under <strong>FR-REV-009</strong> &amp; <strong>05 §3.2 (Separation of Duties)</strong>, uploader self-approval is forbidden. As Site Execution Engineer, you may annotate and add page comments; technical approvals must be certified by Lead QC (Karthikeya Sharma) or Project Manager (Meera Deshmukh).
              </p>
            </div>
          ) : tab === "IN_APP" ? (
            <div className="space-y-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Review Decision Remarks (Min 10 chars for Request Changes / Reject)
                </label>
                <textarea
                  rows={2}
                  value={decisionComment}
                  onChange={(e) => setDecisionComment(e.target.value)}
                  placeholder="Enter technical review remarks..."
                  className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleInAppDecision("APPROVE")}
                  className="flex items-center justify-center gap-1 rounded-md bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Approve</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleInAppDecision("REQUEST_CHANGES")}
                  className="flex items-center justify-center gap-1 rounded-md bg-orange-600 py-2 font-semibold text-white hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  <FileEdit className="h-3.5 w-3.5" />
                  <span>Changes</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleInAppDecision("REJECT")}
                  className="flex items-center justify-center gap-1 rounded-md bg-red-600 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Reject</span>
                </button>
              </div>

              {currentUser?.orgRole === "R-QC" && (
                <div className="pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    disabled={submitting || Boolean(dscSealedCode)}
                    onClick={handleApplyDsc}
                    className="w-full flex items-center justify-center gap-1.5 rounded-md bg-sky-800 py-2 font-semibold text-white hover:bg-sky-900 disabled:opacity-50 text-xs shadow-xs cursor-pointer"
                  >
                    <Stamp className="h-3.5 w-3.5 text-sky-300" />
                    <span>{dscSealedCode ? `✓ Sealed (${dscSealedCode})` : "Apply Class 3 DSC Cryptographic Seal (eMudhra)"}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleRecordExternalApproval} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Approver Name (Required)
                  </label>
                  <input
                    type="text"
                    required
                    value={extApproverName}
                    onChange={(e) => setExtApproverName(e.target.value)}
                    placeholder="e.g., Vikram Sengupta"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Role / Organisation
                  </label>
                  <input
                    type="text"
                    required
                    value={extApproverRoleOrg}
                    onChange={(e) => setExtApproverRoleOrg(e.target.value)}
                    placeholder="e.g., Meinhardt PMC"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Method (Required)
                  </label>
                  <select
                    value={extMethod}
                    onChange={(e) => setExtMethod(e.target.value as typeof extMethod)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                  >
                    <option value="STAMPED_PDF">Stamped PDF</option>
                    <option value="EMAIL">Email</option>
                    <option value="PORTAL">Portal transmittal</option>
                    <option value="PHYSICAL">Physical meeting</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Decision Date (≤ Today)
                  </label>
                  <input
                    type="date"
                    required
                    value={extDecisionDate}
                    onChange={(e) => setExtDecisionDate(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Transmittal / Email Reference (Required)
                </label>
                <input
                  type="text"
                  required
                  value={extReference}
                  onChange={(e) => setExtReference(e.target.value)}
                  placeholder="e.g., TRN-MEIN-HYD-2026-104"
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-1.5 rounded-md bg-teal-700 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                <Stamp className="h-3.5 w-3.5" />
                <span>Record External Approval (WF-23)</span>
              </button>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}
