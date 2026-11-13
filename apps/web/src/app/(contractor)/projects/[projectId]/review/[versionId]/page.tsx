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
  requirementId: string | null;
  requirementKey: string | null;
  requirementTitle: string;
  docTypeKey: string;
  assetTag: string | null;
  revisionCode: string;
  issueDate: string | null;
  expiryDate: string | null;
  fileStatus: string;
  reviewStatus: string;
  pageCount: number | null;
  sha256: string | null;
  uploadedByName: string | null;
  reviewerRole: string | null;
  rowVersion: number;
  reviewId: string | null;
  requiresRequalification?:boolean;
  requirementDescription?:string|null;
  validityRule?:Record<string,unknown>;
  dueAt?:string|null;
  linkedRequirements?:{id:string;title:string;key:string}[];
  companions?: Array<{
    ruleCode: string;
    ruleName: string;
    companionDocType: string;
    status: "SATISFIED" | "MISSING";
    isMandatory: boolean;
    message: string;
    companionRevision?: string;
  }>;
  hasMissingCompanions?: boolean;
  hasMissingMandatoryCompanions?: boolean;
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
  const [requestRequirement,setRequestRequirement]=useState(''),[reviewerOptions,setReviewerOptions]=useState<{userId:string;name:string;role:string}[]>([]),[requestedReviewer,setRequestedReviewer]=useState('');

  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; orgRole: string } | null>(null);

  // Decision & Comment Form State (11 §4.9)
  const [tab, setTab] = useState<"IN_APP" | "EXTERNAL">("IN_APP");
  const [decisionComment, setDecisionComment] = useState("");
  const [newPinPage, setNewPinPage] = useState<number>(1);
  const [newPinBody, setNewPinBody] = useState("");
  const [newPinVisibility, setNewPinVisibility] = useState<"EXTERNAL" | "INTERNAL">(
    "EXTERNAL",
  );

  // Mobile layout & Viewer Navigation State (VQ02)
  const [mobileTab, setMobileTab] = useState<"preview" | "dock">("preview");
  const [targetPage, setTargetPage] = useState<number | null>(null);

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
  const [extPartyId, setExtPartyId] = useState("");
  const [extProofVersionId, setExtProofVersionId] = useState("");
  const [externalOptions, setExternalOptions] = useState<{
    authorities: Array<{ id: string; name: string }>;
    proofVersions: Array<{ id: string; title: string; revision_code: string }>;
  } | null>(null);

  useEffect(() => {
    if (tab !== 'EXTERNAL' || !projectId) return;
    let cancelled = false;
    setExternalOptions(null);
    apiFetch<{ authorities: Array<{ id: string; name: string }>; proofVersions: Array<{ id: string; title: string; revision_code: string }> }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/external-review-options`,
    ).then((result) => { if (!cancelled) setExternalOptions(result); })
      .catch((optionError: any) => { if (!cancelled) setError(optionError.message || 'Could not load authorities and proof.'); });
    return () => { cancelled = true; };
  }, [tab, projectId]);

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

  const loadReviewers=async()=>{if(!detail)return;setSubmitting(true);setError(null);try{const requirement=requestRequirement||detail.requirementId;
    const result=await apiFetch<{items:{userId:string;name:string;role:string}[]}>(`/api/v1/requirements/${requirement}/reviewers?documentVersionId=${detail.versionId}`);
    setReviewerOptions(result.items);setRequestedReviewer(result.items.length===1?result.items[0].userId:'');if(!result.items.length)setError('No currently qualified reviewer is available. Ask an administrator to review the project team.');
   }catch(error){setError((error as Error).message);}finally{setSubmitting(false);}};
  const requestReview=async()=>{if(!detail||!requestedReviewer)return;setSubmitting(true);setError(null);try{
    await apiFetch(`/api/v1/requirements/${requestRequirement||detail.requirementId}/submit-review`,{method:'POST',body:JSON.stringify({documentVersionId:detail.versionId,reviewerUserId:requestedReviewer})});
    setReviewerOptions([]);setRequestedReviewer('');await loadVersionDetail();
   }catch(error){setError((error as Error).message);}finally{setSubmitting(false);}};

  const handleInAppDecision = async (
    decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT",
  ) => {
    if (!detail?.reviewId) {
      setError('A review must be assigned to you before you can record a decision.');
      return;
    }
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
        `/api/v1/reviews/${detail.reviewId}/decisions`,
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
      setBanner(`Review decision '${decision}' recorded.`);
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
    if (!extApproverName.trim() || !extApproverRoleOrg.trim() || !extDecisionDate || !extReference.trim() || !extPartyId || !extProofVersionId) {
      setError("Choose the authority and verified proof, and provide the approver, role, date and reference.");
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
            decision: 'APPROVE',
            externalPartyId: extPartyId,
            externalApproverName: extApproverName.trim(),
            externalApproverRole: extApproverRoleOrg.trim(),
            decidedAt: extDecisionDate,
            externalMethod: extMethod,
            externalReference: extReference.trim(),
            proofVersionId: extProofVersionId,
          }),
        },
      );
      setBanner(
        "External approval recorded with the selected authority and proof.",
      );
      await loadVersionDetail();
    } catch (err: any) {
      setError(err instanceof ApiProblemError ? err.message : "External approval failed.");
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
  )}/document-versions/${encodeURIComponent(versionId)}/stream${targetPage ? `#page=${targetPage}` : ''}`;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0F172A] font-sans">
      {/* Mobile Tab Switcher (VQ02: Pixel/Narrow Screen usability) */}
      <div className="flex md:hidden shrink-0 items-center justify-around border-b border-slate-700 bg-slate-900 p-1.5 text-xs">
        <button
          onClick={() => setMobileTab('preview')}
          className={`flex-1 py-1.5 rounded font-medium text-center transition-colors ${
            mobileTab === 'preview' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
          }`}
        >
          Document Preview
        </button>
        <button
          onClick={() => setMobileTab('dock')}
          className={`flex-1 py-1.5 rounded font-medium text-center transition-colors ${
            mobileTab === 'dock' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
          }`}
        >
          Review & Decisions
        </button>
      </div>

      <div className="flex flex-1 flex-col md:flex-row overflow-hidden min-h-0">
        {/* Left Pane: Dark Engineering PDF Stage (SCR-025, VQ02) */}
        <div className={`flex flex-1 flex-col min-w-0 ${mobileTab === 'dock' ? 'hidden md:flex' : 'flex'}`}>
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0B1120] px-4 text-xs text-slate-200">
            <div className="flex items-center gap-3 truncate">
              <button
                onClick={() => router.push(`/projects/${projectId}`)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Back to Project</span>
              </button>
              {detail && (
                <div className="flex items-center gap-2 truncate">
                  <span className="rounded bg-blue-500/20 border border-blue-400/30 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-300">
                    {detail.requirementKey || "Unlinked evidence"}
                  </span>
                  <span className="font-semibold text-white truncate max-w-[180px] sm:max-w-xs">
                    {detail.requirementTitle}
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                    Rev {detail.revisionCode}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="text-[11px] text-slate-400">Page:</span>
                <input
                  type="number"
                  min={1}
                  max={detail?.pageCount || 999}
                  placeholder="1"
                  value={targetPage ?? ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1) setTargetPage(val);
                    else if (!e.target.value) setTargetPage(null);
                  }}
                  className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <a
                href={streamUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </div>
          </header>

          {/* Real Binary PDF Stream Frame */}
          <div className="flex-1 bg-[#1E293B] p-2 sm:p-3 min-h-0">
            <iframe
              src={streamUrl}
              title="Verified Engineering PDF Preview"
              className="h-full w-full rounded border border-slate-700 bg-white shadow-2xl"
            />
          </div>
        </div>

        {/* Right Pane: Metadata, Page Comments & Decision Dock (SCR-027, VQ02) */}
        <aside className={`w-full md:w-[420px] shrink-0 border-t md:border-t-0 md:border-l border-slate-200 bg-white text-[#0F172A] flex flex-col justify-between overflow-y-auto ${
          mobileTab === 'preview' ? 'hidden md:flex' : 'flex'
        }`}>
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
                    File status: {detail.fileStatus}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600">
                  Equipment: <strong>{detail.assetTag || "Project-wide"}</strong> · Issue
                  Date: <strong className="font-mono">{detail.issueDate || "Not recorded"}</strong>
                </div>
                <div className="font-mono text-[10px] text-slate-400 truncate">
                  SHA-256: {detail.sha256 || "Not available"}
                </div>
              </div>

              {/* Evidence Companions & Missing Attachment Checks (Top 25 Item 6) */}
              {detail.companions && detail.companions.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50/80 p-3 space-y-2">
                  <div className="flex items-center justify-between font-semibold text-amber-950">
                    <span>Evidence Companions</span>
                    {detail.hasMissingCompanions ? (
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-900 font-bold">
                        Missing Attachments
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] text-emerald-950 font-bold">
                        ✓ All Satisfied
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {detail.companions.map((comp) => (
                      <div
                        key={comp.ruleCode}
                        className={`rounded border p-2 text-[11px] ${
                          comp.status === "SATISFIED"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                            : "border-amber-300 bg-white text-amber-950"
                        }`}
                      >
                        <div className="flex items-center justify-between font-medium">
                          <span>
                            {comp.ruleName} ({comp.companionDocType})
                          </span>
                          <span
                            className={
                              comp.status === "SATISFIED"
                                ? "text-emerald-700 font-bold"
                                : "text-amber-800 font-bold"
                            }
                          >
                            {comp.status === "SATISFIED" ? "✓ Satisfied" : "⚠ Missing"}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">{comp.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Page-Specific Comments List (FR-REV-004) */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800">
                  Review Comments ({detail.comments.length})
                </div>
                {detail.comments.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      if (c.pageNo) {
                        setTargetPage(c.pageNo);
                        setMobileTab("preview");
                      }
                    }}
                    className={`rounded-lg border border-slate-200 p-2.5 space-y-1 transition-colors ${
                      c.pageNo ? "cursor-pointer hover:border-blue-400 hover:bg-blue-50/40" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        {c.pageNo && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-mono text-blue-700">
                            P.{c.pageNo} ↗
                          </span>
                        )}
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

          {detail&&<section className="rounded border bg-white p-3 space-y-2 text-xs"><h3 className="font-semibold">Current requirement</h3><p>{detail.requirementTitle}</p>{detail.requirementDescription&&<p className="whitespace-pre-wrap">{detail.requirementDescription}</p>}<p>Document type: {detail.docTypeKey} · Reviewer role: {detail.reviewerRole??'Unconfigured'}</p><p>Due: {detail.dueAt?new Date(detail.dueAt).toLocaleString():'No deadline recorded'}</p>
           {Object.entries(detail.validityRule??{}).map(([key,value])=><p key={key}>{key}: {typeof value==='string'?value:JSON.stringify(value)}</p>)}
           {detail.requiresRequalification&&<p role="status" className="rounded bg-amber-50 p-2 text-amber-950">This obligation requires a current review. Earlier approvals remain historical.</p>}
          </section>}
          {detail?.requirementId&&detail.fileStatus==='READY'&&['R-OWNER','R-ADMIN','R-PM','R-QC','R-SITE','R-DOC','R-SAFETY','R-PROC'].includes(currentUser?.orgRole??'')&&<section className="rounded border bg-white p-3 text-xs space-y-2"><h3 className="font-semibold">Request an assigned review</h3>
           <label className="block">Mapped requirement<select className="block w-full border p-2" value={requestRequirement||detail.requirementId} onChange={event=>{setRequestRequirement(event.target.value);setReviewerOptions([]);setRequestedReviewer('');}}>{(detail.linkedRequirements?.length?detail.linkedRequirements:[{id:detail.requirementId,title:detail.requirementTitle,key:detail.requirementKey??''}]).map(requirement=><option key={requirement.id} value={requirement.id}>{requirement.key} · {requirement.title}</option>)}</select></label>
           <button disabled={submitting} className="underline" onClick={()=>void loadReviewers()}>Load eligible reviewers</button>
           {reviewerOptions.length>0&&<><label className="block">Reviewer<select className="block w-full border p-2" value={requestedReviewer} onChange={event=>setRequestedReviewer(event.target.value)}><option value="">Select reviewer</option>{reviewerOptions.map(reviewer=><option key={reviewer.userId} value={reviewer.userId}>{reviewer.name} · {reviewer.role}</option>)}</select></label><button disabled={submitting||!requestedReviewer} className="rounded border p-2" onClick={()=>void requestReview()}>Request review</button></>}
          </section>}

          {currentUser?.orgRole === "R-SITE" ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 space-y-1.5 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold text-amber-950">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Uploader Mode (Site Engineer) — Review Decision Restricted</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-900">
                Uploaders cannot approve their own evidence. An assigned reviewer must record the technical decision.
              </p>
            </div>
          ) : tab === "IN_APP" ? (
            <div className="space-y-2.5">
              {!detail?.reviewId && <p className="rounded bg-amber-50 p-2 text-amber-900">No review is assigned to you for this version.</p>}
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
                  disabled={submitting || !detail?.reviewId}
                  onClick={() => handleInAppDecision("APPROVE")}
                  className="flex items-center justify-center gap-1 rounded-md bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Approve</span>
                </button>
                <button
                  type="button"
                  disabled={submitting || !detail?.reviewId}
                  onClick={() => handleInAppDecision("REQUEST_CHANGES")}
                  className="flex items-center justify-center gap-1 rounded-md bg-orange-600 py-2 font-semibold text-white hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                >
                  <FileEdit className="h-3.5 w-3.5" />
                  <span>Changes</span>
                </button>
                <button
                  type="button"
                  disabled={submitting || !detail?.reviewId}
                  onClick={() => handleInAppDecision("REJECT")}
                  className="flex items-center justify-center gap-1 rounded-md bg-red-600 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Reject</span>
                </button>
              </div>

              {currentUser?.orgRole === "R-QC" && (
                <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
                  Digital signing is not enabled. Upload the signed original as evidence; TradeCloseout will not create or certify a signature.
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleRecordExternalApproval} className="space-y-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Project authority</label>
                <select required value={extPartyId} onChange={(e) => setExtPartyId(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-2 py-1.5">
                  <option value="">Select an assigned authority</option>
                  {externalOptions?.authorities.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Verified proof document</label>
                <select required value={extProofVersionId} onChange={(e) => setExtProofVersionId(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-2 py-1.5">
                  <option value="">Select the recorded response</option>
                  {externalOptions?.proofVersions.map((proof) => <option key={proof.id} value={proof.id}>{proof.title} · Rev {proof.revision_code}</option>)}
                </select>
              </div>
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
                disabled={submitting || !externalOptions || !extPartyId || !extProofVersionId}
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
    </div>
  );
}
