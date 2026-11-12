"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardCheck,
  Cpu,
  Eye,
  PackageCheck,
  Wrench,
  Search,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileEdit,
  XCircle,
  ShieldOff,
  Stamp,
  Send,
  FileUp,
  CalendarX2,
  MinusCircle,
  RefreshCw,
  WifiOff,
  Plus,
  FileSpreadsheet,
  Download,
  AlertCircle,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Building,
  CheckSquare,
  FileCheck,
  TrendingUp,
  SlidersHorizontal,
} from "lucide-react";
import { ImportChecklistModal } from "@/components/modals/import-checklist-modal";
import { UploadEvidenceModal } from "@/components/modals/upload-evidence-modal";
import { ShareSupplierLinkModal } from "@/components/modals/share-supplier-link-modal";
import { CompileHandoverModal } from "@/components/modals/compile-handover-modal";
import { RequestWaiverModal } from "@/components/modals/request-waiver-modal";
import { AddRequirementModal } from "@/components/modals/add-requirement-modal";
import { ExternalApprovalModal } from "@/components/modals/external-approval-modal";
import { apiFetch, ApiProblemError } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv-export";
import { getMemberOfflineActorPartition, setOfflineActorPartition } from "@/lib/offline-upload-queue";
import { parseProjectRequirementResponse, type ProjectRequirementRow, type RequirementStatus } from "@/lib/project-requirements";
import { formatInrPaiseExact } from "@/lib/format-money";
import { requireApiList } from "@/lib/api-list";
import { parseProjectSummaryResponse, type ProjectSummaryDto } from "@/lib/project-summary";

/* -------------------------------------------------------------------------- */
/* TYPES & CONSTANTS                                                          */
/* -------------------------------------------------------------------------- */

export type { RequirementStatus } from "@/lib/project-requirements";

export type { ProjectSummaryDto } from "@/lib/project-summary";

export interface RequirementItemDto extends ProjectRequirementRow {}

const STATUS_BADGE_MAP: Record<
  RequirementStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  NOT_STARTED: {
    label: "Not started",
    className: "bg-slate-100 border-slate-300 text-slate-700",
    icon: Clock,
  },
  REQUESTED: {
    label: "Requested",
    className: "bg-blue-50 border-blue-300 text-blue-800",
    icon: Send,
  },
  UPLOADED: {
    label: "Uploaded",
    className: "bg-indigo-50 border-indigo-300 text-indigo-900",
    icon: FileUp,
  },
  IN_REVIEW: {
    label: "Waiting for review",
    className: "bg-amber-50 border-amber-300 text-amber-900",
    icon: Clock,
  },
  UNDER_REVIEW: {
    label: "Under review",
    className: "bg-amber-50 border-amber-300 text-amber-900",
    icon: Eye,
  },
  CHANGES_REQUESTED: {
    label: "Changes requested",
    className: "bg-orange-50 border-orange-300 text-orange-900",
    icon: FileEdit,
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-red-50 border-red-300 text-red-800",
    icon: XCircle,
  },
  APPROVED: {
    label: "Approved",
    className: "bg-emerald-50 border-emerald-300 text-emerald-800",
    icon: CheckCircle2,
  },
  APPROVED_EXTERNAL: {
    label: "Approved (external)",
    className: "bg-teal-50 border-teal-400 border-dashed text-teal-900",
    icon: Stamp,
  },
  PENDING_WAIVER: {
    label: "Pending 2nd approver",
    className: "bg-purple-50 border-purple-300 border-dashed text-purple-900",
    icon: ShieldOff,
  },
  WAIVED: {
    label: "Waived",
    className: "bg-purple-50 border-purple-300 text-purple-900",
    icon: ShieldOff,
  },
  NOT_APPLICABLE: {
    label: "Not applicable",
    className: "bg-slate-50 border-slate-300 border-dashed text-slate-600",
    icon: MinusCircle,
  },
  EXPIRED: {
    label: "Expired",
    className: "bg-white border-red-600 border-[1.5px] text-red-700 font-semibold",
    icon: CalendarX2,
  },
  MISSING: {
    label: "Missing",
    className: "bg-red-100 border-red-400 text-red-900 font-semibold",
    icon: AlertTriangle,
  },
  HANDED_OVER: {
    label: "Handed over",
    className: "bg-teal-50 border-teal-300 text-teal-900",
    icon: PackageCheck,
  },
  SUPERSEDED: {
    label: "Superseded (historical)",
    className: "bg-slate-50 border-slate-300 text-slate-500",
    icon: MinusCircle,
  },
};

function formatInrPaise(paiseStr: string): string {
  return formatInrPaiseExact(paiseStr);
}

function formatDateIst(isoDate: string | null): string {
  if (!isoDate) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(isoDate));
}

type TabKey = "overview" | "checklist" | "equipment" | "reviews" | "handover" | "warranties" | "reports";

const TABS: { id: TabKey; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "checklist", label: "Checklist", icon: ClipboardCheck },
  { id: "equipment", label: "Equipment", icon: Cpu },
  { id: "reviews", label: "Reviews", icon: Eye },
  { id: "handover", label: "Handover Packages", icon: PackageCheck },
  { id: "warranties", label: "Warranties & DLP", icon: Wrench },
  { id: "reports", label: "Reports & Exports", icon: FileSpreadsheet },
];

/* -------------------------------------------------------------------------- */
/* MAIN COMPONENT                                                             */
/* -------------------------------------------------------------------------- */

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = Array.isArray(params?.projectId) ? params.projectId[0] : params?.projectId;

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [isOffline, setIsOffline] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; orgRole: string } | null>(null);

  // Live API State
  const [summary, setSummary] = useState<ProjectSummaryDto | null>(null);
  const [requirements, setRequirements] = useState<RequirementItemDto[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [errorSummary, setErrorSummary] = useState<{ message: string; requestId?: string } | null>(null);
  const [errorReqs, setErrorReqs] = useState<{ message: string; requestId?: string } | null>(null);

  // Sub-resource state
  const [assets, setAssets] = useState<any[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [errorAssets, setErrorAssets] = useState<string | null>(null);
  const [errorReviews, setErrorReviews] = useState<string | null>(null);
  const [errorPackages, setErrorPackages] = useState<string | null>(null);
  const requestGeneration = useRef({ summary: 0, reqs: 0, assets: 0, reviews: 0, packages: 0 });
  const viewedProjectRef = useRef(projectId);
  viewedProjectRef.current = projectId;
  const [warranties, setWarranties] = useState<any[]>([]);
  const [defects, setDefects] = useState<any[]>([]);
  const [loadingWarranties, setLoadingWarranties] = useState(false);
  const [warrantyLoadError, setWarrantyLoadError] = useState<string | null>(null);
  const [defectsLoadError, setDefectsLoadError] = useState<string | null>(null);
  const warrantyRequestGeneration = useRef(0);

  // Filter & Modals State
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState<boolean>(false);
  const [compileModalOpen, setCompileModalOpen] = useState<boolean>(false);
  const [waiverModalOpen, setWaiverModalOpen] = useState<boolean>(false);
  const [addReqModalOpen, setAddReqModalOpen] = useState<boolean>(false);
  const [externalApprovalModalOpen, setExternalApprovalModalOpen] = useState<boolean>(false);
  const [addAssetModalOpen, setAddAssetModalOpen] = useState<boolean>(false);
  const [addDefectModalOpen, setAddDefectModalOpen] = useState<boolean>(false);

  const [selectedReqForUpload, setSelectedReqForUpload] = useState<RequirementItemDto | null>(null);
  const [selectedReqForSupplier, setSelectedReqForSupplier] = useState<RequirementItemDto | null>(null);
  const [selectedReqForWaiver, setSelectedReqForWaiver] = useState<RequirementItemDto | null>(null);
  const [selectedReqForExternal, setSelectedReqForExternal] = useState<RequirementItemDto | null>(null);

  // New Asset Form State
  const [newAssetTag, setNewAssetTag] = useState("");
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetCategory, setNewAssetCategory] = useState("CHILLER");
  const [newAssetSerial, setNewAssetSerial] = useState("");
  const [newAssetLocation, setNewAssetLocation] = useState("");

  // New Defect Form State
  const [defectTitle, setDefectTitle] = useState("");
  const [defectDesc, setDefectDesc] = useState("");
  const [defectSeverity, setDefectSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");

  // Lifecycle Transition Loading
  const [transitioning, setTransitioning] = useState(false);

  // Detect connectivity
  useEffect(() => {
    apiFetch<any>("/api/v1/auth/me")
      .then((user: any) => {
        if (!user?.userId || !user?.activeOrgId) {
          setCurrentUser(null);
          setOfflineActorPartition(null);
          return;
        }
        setCurrentUser(user);
        // Actor and tenant come from the authenticated server session, not
        // a form field or stale browser preference. An org change re-partitions
        // queued drafts rather than replaying them under another authority.
        setOfflineActorPartition(getMemberOfflineActorPartition(user.userId, user.activeOrgId));
      })
      .catch(() => {
        setCurrentUser(null);
        setOfflineActorPartition(null);
      });

    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const fetchProjectSummary = useCallback(async () => {
    if (!projectId) return;
    const generation = ++requestGeneration.current.summary;
    setLoadingSummary(true);
    setErrorSummary(null);
    setSummary(null);
    try {
      const data = await apiFetch<ProjectSummaryDto>(`/api/v1/projects/${encodeURIComponent(projectId)}/dashboard`);
      if (generation !== requestGeneration.current.summary || viewedProjectRef.current !== projectId) return;
      setSummary(parseProjectSummaryResponse(data, projectId));
    } catch (err: any) {
      if (generation !== requestGeneration.current.summary || viewedProjectRef.current !== projectId) return;
      setErrorSummary({
        message: err?.message || "Network error loading project overview.",
        requestId: err?.requestId,
      });
    } finally {
      if (generation === requestGeneration.current.summary && viewedProjectRef.current === projectId) {
        setLoadingSummary(false);
      }
    }
  }, [projectId]);

  const fetchRequirements = useCallback(async () => {
    if (!projectId) return;
    const generation = ++requestGeneration.current.reqs;
    setLoadingReqs(true);
    setErrorReqs(null);
    setRequirements([]);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());
      qs.set("limit", "100");

      const payload = await apiFetch<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/requirements?${qs.toString()}`);
      if (generation !== requestGeneration.current.reqs || viewedProjectRef.current !== projectId) return;
      const mappedList: RequirementItemDto[] = parseProjectRequirementResponse(payload);
      setRequirements(mappedList);
    } catch (err: any) {
      if (generation !== requestGeneration.current.reqs || viewedProjectRef.current !== projectId) return;
      setRequirements([]);
      setErrorReqs({
        message: err?.message || "Network error loading checklist.",
        requestId: err?.requestId,
      });
    } finally {
      if (generation === requestGeneration.current.reqs && viewedProjectRef.current === projectId) {
        setLoadingReqs(false);
      }
    }
  }, [projectId, statusFilter, searchQuery]);

  const fetchAssets = useCallback(async () => {
    if (!projectId) return;
    const generation = ++requestGeneration.current.assets;
    setLoadingAssets(true);
    setAssets([]);
    setErrorAssets(null);
    try {
      const data = await apiFetch<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/assets`);
      if (generation !== requestGeneration.current.assets || viewedProjectRef.current !== projectId) return;
      setAssets(requireApiList(data, "ASSET"));
    } catch (err) {
      if (generation !== requestGeneration.current.assets || viewedProjectRef.current !== projectId) return;
      setErrorAssets(err instanceof Error ? err.message : "Equipment list unavailable.");
    } finally {
      if (generation === requestGeneration.current.assets && viewedProjectRef.current === projectId) {
        setLoadingAssets(false);
      }
    }
  }, [projectId]);

  const fetchReviews = useCallback(async () => {
    if (!projectId) return;
    const generation = ++requestGeneration.current.reviews;
    setLoadingReviews(true);
    setReviews([]);
    setErrorReviews(null);
    try {
      const data = await apiFetch<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/reviews`);
      if (generation !== requestGeneration.current.reviews || viewedProjectRef.current !== projectId) return;
      setReviews(requireApiList(data, "REVIEW"));
    } catch (err) {
      if (generation !== requestGeneration.current.reviews || viewedProjectRef.current !== projectId) return;
      setErrorReviews(err instanceof Error ? err.message : "Review list unavailable.");
    } finally {
      if (generation === requestGeneration.current.reviews && viewedProjectRef.current === projectId) {
        setLoadingReviews(false);
      }
    }
  }, [projectId]);

  const fetchPackages = useCallback(async () => {
    if (!projectId) return;
    const generation = ++requestGeneration.current.packages;
    setLoadingPackages(true);
    setPackages([]);
    setErrorPackages(null);
    try {
      const data = await apiFetch<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/packages`);
      if (generation !== requestGeneration.current.packages || viewedProjectRef.current !== projectId) return;
      setPackages(requireApiList(data, "PACKAGE"));
    } catch (err) {
      if (generation !== requestGeneration.current.packages || viewedProjectRef.current !== projectId) return;
      setErrorPackages(err instanceof Error ? err.message : "Handover dossiers unavailable.");
    } finally {
      if (generation === requestGeneration.current.packages && viewedProjectRef.current === projectId) {
        setLoadingPackages(false);
      }
    }
  }, [projectId]);

  const fetchWarranties = useCallback(async () => {
    if (!projectId) return;
    const generation = ++warrantyRequestGeneration.current;
    // Do not leave another project's old records on screen after a context
    // change, or convert denied/failed requests into fictitious empty data.
    setWarranties([]);
    setDefects([]);
    setWarrantyLoadError(null);
    setDefectsLoadError(null);
    setLoadingWarranties(true);
    const parseRows = (data: unknown): any[] => {
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object" && "data" in data &&
          Array.isArray((data as { data: unknown }).data)) {
        return (data as { data: any[] }).data;
      }
      throw new Error("Unexpected response format.");
    };
    try {
      const [warrantyResult, defectResult] = await Promise.allSettled([
        apiFetch<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/warranty-events`),
        apiFetch<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/defects`),
      ]);
      // A late response from a previous project or a slower retry must never
      // repopulate this view with an old project's privileged records.
      if (generation !== warrantyRequestGeneration.current) return;
      try {
        if (warrantyResult.status === "rejected") throw warrantyResult.reason;
        setWarranties(parseRows(warrantyResult.value));
      } catch (error) {
        setWarrantyLoadError(error instanceof Error ? error.message : "Unable to load warranties.");
      }
      try {
        if (defectResult.status === "rejected") throw defectResult.reason;
        setDefects(parseRows(defectResult.value));
      } catch (error) {
        setDefectsLoadError(error instanceof Error ? error.message : "Unable to load defects.");
      }
    } finally {
      if (generation === warrantyRequestGeneration.current) {
        setLoadingWarranties(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    fetchProjectSummary();
    fetchRequirements();
    fetchAssets();
  }, [fetchProjectSummary, fetchRequirements, fetchAssets]);

  useEffect(() => {
    if (activeTab === "equipment") fetchAssets();
    else if (activeTab === "reviews") fetchReviews();
    else if (activeTab === "handover") fetchPackages();
    else if (activeTab === "warranties") fetchWarranties();
  }, [activeTab, fetchAssets, fetchReviews, fetchPackages, fetchWarranties]);

  // Project Lifecycle Actions
  const handleLifecycleTransition = async (action: "activate" | "handover" | "close" | "reopen") => {
    if (!projectId) return;
    setTransitioning(true);
    try {
      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/${action}`, {
        method: "POST",
      });
      await fetchProjectSummary();
    } catch (err: any) {
      alert(err?.message || `Failed to transition project to ${action}`);
    } finally {
      setTransitioning(false);
    }
  };

  // Countersign Waiver Action
  const handleCountersignWaiver = async (req: RequirementItemDto) => {
    try {
      await apiFetch(`/api/v1/requirements/${encodeURIComponent(req.id)}/waivers/countersign`, {
        method: "POST",
      });
      fetchProjectSummary();
      fetchRequirements();
    } catch (err: any) {
      alert(err?.message || "Failed to countersign waiver.");
    }
  };

  // Add Asset Action
  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssetTag || !newAssetName) return;
    try {
      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/assets`, {
        method: "POST",
        body: JSON.stringify({
          tag: newAssetTag.trim().toUpperCase(),
          name: newAssetName.trim(),
          categoryKey: newAssetCategory,
          serialNo: newAssetSerial.trim() || undefined,
          location: newAssetLocation.trim() || undefined,
        }),
      });
      setNewAssetTag("");
      setNewAssetName("");
      setNewAssetSerial("");
      setNewAssetLocation("");
      setAddAssetModalOpen(false);
      fetchAssets();
    } catch (err: any) {
      alert(err?.message || "Failed to add equipment unit.");
    }
  };

  // Add Defect Action
  const handleCreateDefect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!defectTitle) return;
    try {
      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/defects`, {
        method: "POST",
        body: JSON.stringify({
          title: defectTitle.trim(),
          description: defectDesc.trim() || undefined,
          severity: defectSeverity,
        }),
      });
      setDefectTitle("");
      setDefectDesc("");
      setAddDefectModalOpen(false);
      fetchWarranties();
    } catch (err: any) {
      alert(err?.message || "Failed to log defect snag.");
    }
  };

  // Add Requirement from Modal
  const handleAddRequirement = async (data: any) => {
    try {
      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/checklists/import-l3`, {
        method: "POST",
        body: JSON.stringify({
          profileName: "Custom Requirement Addition",
          requirements: [
            {
              key: data.key,
              title: data.title,
              docTypeKey: data.docTypeCode,
              mandatory: data.mandatory,
            },
          ],
        }),
      });
      fetchProjectSummary();
      fetchRequirements();
    } catch (err: any) {
      alert(err?.message || "Failed to add requirement.");
    }
  };

  // External Approval from Modal
  const handleExternalApproval = async (data: any) => {
    if (!selectedReqForExternal?.latestVersionId) return;
    try {
      await apiFetch(`/api/v1/document-versions/${selectedReqForExternal.latestVersionId}/external-approval`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      fetchProjectSummary();
      fetchRequirements();
    } catch (err: any) {
      alert(err?.message || "Failed to record external approval.");
    }
  };

  // Export only the rows already authorized for this project; the serializer
  // also neutralizes spreadsheet formulas without corrupting CSV delimiters.
  const exportCsv = downloadCsv;

  const progressPercent = summary && summary.counts.applicableTotal > 0
    ? Math.round(
        ((summary.counts.approvedCount + summary.counts.approvedExternalCount + summary.counts.waivedCount) /
          summary.counts.applicableTotal) *
          100
      )
    : 0;

  const isOwnerOrAdmin = currentUser?.orgRole === "R-OWNER" || currentUser?.orgRole === "R-ADMIN";

  return (
    <div className="min-h-full pb-16">
      {/* Offline Alert */}
      {isOffline && (
        <div
          role="alert"
          className="flex items-center justify-between bg-slate-900 px-6 py-2.5 text-xs text-amber-300"
        >
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>
              You&apos;re offline. Selected files and metadata will queue locally until reconnection.
            </span>
          </div>
        </div>
      )}

      {/* Project Status Lifecycle Banner & State Action Buttons */}
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-700">Project Stage:</span>
          <span className="font-bold text-slate-900">{summary?.status || "LOADING"}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">
            {summary?.status === "DRAFT"
              ? "Draft mode. Import checklist template to activate for site execution."
              : summary?.status === "ACTIVE"
              ? "Active site construction & testing stage. Progressing towards milestone closeout."
              : summary?.status === "HANDOVER"
              ? "Handover dossier compilation in progress. All submittals being certified for client sign-off."
              : summary?.status === "CLOSED"
              ? "Project is closed and in Defect Liability Period (DLP). Requirements are locked."
              : "Project workspace is active."}
          </span>
        </div>

        {/* State Transition Actions */}
        <div className="flex items-center gap-2">
          {summary?.status === "DRAFT" && (
            <button
              onClick={() => handleLifecycleTransition("activate")}
              disabled={transitioning}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded shadow-xs cursor-pointer"
            >
              Activate Project
            </button>
          )}

          {summary?.status === "ACTIVE" && (
            <button
              onClick={() => handleLifecycleTransition("handover")}
              disabled={transitioning}
              className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded shadow-xs cursor-pointer"
            >
              Start Handover Stage
            </button>
          )}

          {summary?.status === "HANDOVER" && (
            <button
              onClick={() => handleLifecycleTransition("close")}
              disabled={transitioning}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded shadow-xs cursor-pointer"
            >
              Close Project (Enter DLP)
            </button>
          )}

          {summary?.status === "CLOSED" && (
            <button
              onClick={() => handleLifecycleTransition("reopen")}
              disabled={transitioning}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded shadow-xs cursor-pointer"
            >
              Reopen Project
            </button>
          )}
        </div>
      </div>

      {/* Project Header Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="rounded bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 font-mono text-xs font-bold text-indigo-700">
                {summary?.code || "PROJECT"}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                summary?.status === "ACTIVE"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : summary?.status === "HANDOVER"
                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                  : summary?.status === "CLOSED"
                  ? "bg-slate-100 text-slate-700 border border-slate-300"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}>
                {summary?.status || "LOADING"}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1">
              {summary?.name || "Loading Project..."}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Client: <span className="font-semibold text-slate-700">{summary?.clientName || "Direct Subcontract"}</span> · Target Handover: <span className="font-semibold text-slate-700">{formatDateIst(summary?.targetHandoverDate || null)}</span>
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => setAddReqModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4 text-blue-600" />
              <span>Add Requirement</span>
            </button>

            <button
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-all cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>Import Checklist (.xlsx)</span>
            </button>

            <button
              onClick={() => setCompileModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs transition-all cursor-pointer"
            >
              <PackageCheck className="h-4 w-4" />
              <span>Compile Dossier</span>
            </button>
          </div>
        </div>

        {/* Horizontal Navigation Tabs */}
        <div className="flex items-center gap-1 border-t border-slate-100 mt-5 pt-3 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-emerald-400" : "text-slate-500"}`} />
                <span>{tab.label}</span>
                {tab.id === "checklist" && requirements.length > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${active ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-700"}`}>
                    {requirements.length}
                  </span>
                )}
                {tab.id === "equipment" && assets.length > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${active ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-700"}`}>
                    {assets.length}
                  </span>
                )}
                {tab.id === "warranties" && defects.length > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${active ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-800"}`}>
                    {defects.length} snags
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Error Notification */}
        {errorSummary && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
            <div>
              <div className="font-semibold">{errorSummary.message}</div>
              {errorSummary.requestId && (
                <div className="mt-0.5 font-mono text-[11px] text-red-700">Ref: {errorSummary.requestId}</div>
              )}
            </div>
            <button
              onClick={fetchProjectSummary}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-800 hover:bg-red-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* KPI Metrics */}
            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                  <div className="text-xs font-medium text-slate-500">Approved Submittals</div>
                  <div className="mt-2 font-mono text-3xl font-bold text-slate-900">
                    {summary.counts.approvedCount + summary.counts.approvedExternalCount}{" "}
                    <span className="text-sm font-normal text-slate-400">/ {summary.counts.applicableTotal}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-700">{progressPercent}%</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                  <div className="text-xs font-medium text-slate-500">Missing or Expired</div>
                  <div className="mt-2 font-mono text-3xl font-bold text-red-600">
                    {summary.counts.missingOrExpiredCount}
                  </div>
                  <div className="mt-3 text-xs text-slate-500 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span>Requires contractor upload</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                  <div className="text-xs font-medium text-slate-500">Under Consultant Review</div>
                  <div className="mt-2 font-mono text-3xl font-bold text-amber-700">
                    {summary.counts.inReviewCount}
                  </div>
                  <div className="mt-3 text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>Awaiting approval or comments</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                  {currentUser?.orgRole === "R-SITE" ? (
                    <>
                      <div className="text-xs font-medium text-slate-500">Assigned Equipment Units</div>
                      <div className="mt-2 font-mono text-3xl font-bold text-blue-900">
                        {assets.length} Units
                      </div>
                      <div className="mt-3 text-xs text-slate-500">Installed and tagged on site</div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-medium text-slate-500">Retention Money Gated</div>
                      <div className="mt-2 font-mono text-2xl font-bold text-slate-900">
                        {formatInrPaise(summary.retentionAtRiskPaise)}
                      </div>
                      <div className="mt-3 text-xs text-slate-500">
                        Subject to 100% closeout dossier release
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Quick Actions Panel */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                onClick={() => setActiveTab("checklist")}
                className="rounded-xl border border-slate-200 bg-white p-5 hover:border-indigo-300 hover:shadow-xs transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <ClipboardCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Execute Technical Checklist</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Upload FATs, hydrostatic tests, and as-built drawings.</p>
                  </div>
                </div>
              </div>

              <div
                onClick={() => setCompileModalOpen(true)}
                className="rounded-xl border border-slate-200 bg-white p-5 hover:border-emerald-300 hover:shadow-xs transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <PackageCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Compile Handover Dossier</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Bates-numbered, bookmarked ISO 32000-1 PDF bundle.</p>
                  </div>
                </div>
              </div>

              <div
                onClick={() => setActiveTab("reports")}
                className="rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-xs transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-blue-50 text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Reports & Compliance Registers</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Retention risk, equipment matrix, and consultant SLA reports.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Checklist Preview Table in Overview */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Recent Requirements Status</h3>
                  <p className="text-xs text-slate-500">Overview of key submittals and their technical approval state.</p>
                </div>
                <button
                  onClick={() => setActiveTab("checklist")}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
                >
                  View all requirements →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Code</th>
                      <th className="py-2.5 px-4">Requirement Title</th>
                      <th className="py-2.5 px-4">Equipment</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requirements.slice(0, 5).map((req) => {
                      const badge = STATUS_BADGE_MAP[req.status] ?? STATUS_BADGE_MAP.NOT_STARTED;
                      const BadgeIcon = badge.icon;
                      return (
                        <tr key={req.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-600">{req.requirementKey}</td>
                          <td className="py-3 px-4 font-medium text-slate-900">{req.title}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{req.assetTag || "Project-wide"}</td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>
                              <BadgeIcon className="h-3 w-3" />
                              <span>{badge.label}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setSelectedReqForUpload(req);
                                setUploadModalOpen(true);
                              }}
                              className="text-blue-700 hover:text-blue-900 font-semibold text-xs cursor-pointer"
                            >
                              Upload
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CHECKLIST */}
        {activeTab === "checklist" && (
          <div className="space-y-4">
            {/* Search & Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search requirement key, equipment, doc type..."
                    className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-3 text-xs focus:border-blue-600 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  <option value="NOT_STARTED">Not Started</option>
                  <option value="REQUESTED">Requested</option>
                  <option value="UPLOADED">Uploaded</option>
                  <option value="IN_REVIEW">In Review</option>
                  <option value="APPROVED">Approved</option>
                  <option value="CHANGES_REQUESTED">Changes Requested</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="PENDING_WAIVER">Pending Waiver</option>
                  <option value="WAIVED">Waived</option>
                </select>

                <button
                  onClick={() => setAddReqModalOpen(true)}
                  className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold text-xs hover:bg-indigo-100 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Requirement</span>
                </button>

                {(searchQuery || statusFilter) && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("");
                    }}
                    className="h-9 px-3 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Checklist Table */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              {loadingReqs ? (
                <div className="p-8 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />
                  ))}
                </div>
              ) : errorReqs ? (
                <div className="p-8 text-center text-xs text-red-700 bg-red-50">
                  <p>{errorReqs.message}</p>
                  <button
                    onClick={fetchRequirements}
                    className="mt-3 px-3 py-1.5 rounded-lg border border-red-300 bg-white font-semibold cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              ) : requirements.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <p className="text-sm font-medium text-slate-700">
                    {searchQuery || statusFilter ? "No requirements match your active filter." : "No requirements in this checklist yet."}
                  </p>
                  <button
                    onClick={() => setImportModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2942] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163A5F] cursor-pointer"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                    <span>Import Standard HVAC Checklist</span>
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Requirement</th>
                        <th className="py-3 px-3">Equipment</th>
                        <th className="py-3 px-3">Milestone</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Due Date</th>
                        <th className="py-3 pr-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {requirements.map((req) => {
                        const badge = STATUS_BADGE_MAP[req.status] ?? STATUS_BADGE_MAP.NOT_STARTED;
                        const BadgeIcon = badge.icon;
                        const isPendingWaiver = req.status === "PENDING_WAIVER";

                        return (
                          <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-mono text-[11px] font-bold text-slate-600">
                                {req.requirementKey} · <span className="text-slate-500">{req.docTypeKey}</span>
                              </div>
                              <div className="font-semibold text-slate-900 mt-0.5">{req.title}</div>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                              {req.assetTag || "Project-wide"}
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                              {req.milestoneKey}
                            </td>
                            <td className="py-3 px-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>
                                <BadgeIcon className="h-3 w-3" />
                                <span>{badge.label}</span>
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                              {formatDateIst(req.dueAt)}
                            </td>
                            <td className="py-3 pr-4 text-right">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {/* Countersign Waiver (Owner/Admin only) */}
                                {isPendingWaiver && isOwnerOrAdmin && (
                                  <button
                                    onClick={() => handleCountersignWaiver(req)}
                                    className="inline-flex items-center gap-1 rounded bg-purple-700 text-white px-2 py-1 text-[11px] font-bold hover:bg-purple-800 transition-all cursor-pointer shadow-2xs"
                                    title="Countersign & Officially Waive Requirement"
                                  >
                                    <ShieldCheck className="h-3 w-3" />
                                    <span>Countersign</span>
                                  </button>
                                )}

                                <button
                                  onClick={() => {
                                    setSelectedReqForUpload(req);
                                    setUploadModalOpen(true);
                                  }}
                                  className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 text-blue-700 px-2 py-1 text-[11px] font-semibold hover:bg-blue-100 transition-all cursor-pointer"
                                  title="Upload Technical Evidence"
                                >
                                  <UploadCloud className="h-3 w-3" />
                                  <span>Upload</span>
                                </button>

                                <button
                                  onClick={() => {
                                    setSelectedReqForSupplier(req);
                                    setSupplierModalOpen(true);
                                  }}
                                  className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 text-[11px] font-semibold hover:bg-emerald-100 transition-all cursor-pointer"
                                  title="Share WhatsApp Upload Link with Supplier"
                                >
                                  <Send className="h-3 w-3" />
                                  <span>Supplier</span>
                                </button>

                                {req.status !== "APPROVED" && req.status !== "WAIVED" && !isPendingWaiver && (
                                  <button
                                    onClick={() => {
                                      setSelectedReqForWaiver(req);
                                      setWaiverModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-purple-50 border border-purple-200 text-purple-700 px-2 py-1 text-[11px] font-semibold hover:bg-purple-100 transition-all cursor-pointer"
                                    title="Request Technical Waiver"
                                  >
                                    <ShieldOff className="h-3 w-3" />
                                    <span>Waiver</span>
                                  </button>
                                )}

                                {req.latestVersionId && (
                                  <button
                                    onClick={() => {
                                      setSelectedReqForExternal(req);
                                      setExternalApprovalModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-teal-50 border border-teal-200 text-teal-800 px-2 py-1 text-[11px] font-semibold hover:bg-teal-100 transition-all cursor-pointer"
                                    title="Record External Consultant Stamp or Physical NOC"
                                  >
                                    <Stamp className="h-3 w-3" />
                                    <span>Stamp</span>
                                  </button>
                                )}

                                <button
                                  onClick={() => {
                                    if (req.latestVersionId) {
                                      router.push(`/projects/${projectId}/review/${req.latestVersionId}`);
                                    } else {
                                      setSelectedReqForUpload(req);
                                      setUploadModalOpen(true);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white text-slate-700 px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 transition-all cursor-pointer"
                                  title={req.latestVersionId ? "Inspect & Review Technical Evidence" : "Upload Evidence"}
                                >
                                  <Eye className="h-3 w-3" />
                                  <span>{req.latestVersionId ? "Inspect" : "Upload"}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: EQUIPMENT */}
        {activeTab === "equipment" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Project Equipment & Assets Matrix</h2>
                <p className="text-xs text-slate-500">Installed chillers, AHUs, pumps, and fire dampers tagged on site.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAddAssetModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-xs cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Equipment Tag</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              {loadingAssets ? (
                <div className="p-8 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />
                  ))}
                </div>
              ) : errorAssets ? (
                <div role="alert" className="p-8 space-y-3 text-sm text-red-800">
                  <p>Equipment could not be loaded: {errorAssets}</p>
                  <button type="button" onClick={() => void fetchAssets()}
                    className="rounded-md border border-red-300 px-3 py-2 font-semibold hover:bg-red-50">
                    Retry equipment
                  </button>
                </div>
              ) : assets.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500 space-y-3">
                  <p>No equipment assets catalogued for this project yet.</p>
                  <button
                    onClick={() => setAddAssetModalOpen(true)}
                    className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white font-semibold cursor-pointer"
                  >
                    Add First Equipment Tag
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Asset Tag</th>
                        <th className="py-3 px-4">Equipment Description</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4">Location</th>
                        <th className="py-3 px-4">Serial Number</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {assets.map((asset) => (
                        <tr key={asset.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">{asset.tag}</td>
                          <td className="py-3 px-4 font-medium text-slate-900">{asset.name || asset.description || "HVAC Equipment"}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{asset.category_key || asset.categoryKey || "HVAC"}</td>
                          <td className="py-3 px-4 text-slate-600">{asset.location || "Main Plant Room"}</td>
                          <td className="py-3 px-4 font-mono text-slate-500">{asset.serial_no || asset.serialNo || "—"}</td>
                          <td className="py-3 px-4">
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              {asset.status || "INSTALLED"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: REVIEWS */}
        {activeTab === "reviews" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Technical Reviews Workbench</h2>
                <p className="text-xs text-slate-500">Consultant sign-offs and peer engineer approvals.</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              {loadingReviews ? (
                <div className="p-8 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />
                  ))}
                </div>
              ) : errorReviews ? (
                <div role="alert" className="p-8 space-y-3 text-sm text-red-800">
                  <p>Reviews could not be loaded: {errorReviews}</p>
                  <button type="button" onClick={() => void fetchReviews()}
                    className="rounded-md border border-red-300 px-3 py-2 font-semibold hover:bg-red-50">
                    Retry reviews
                  </button>
                </div>
              ) : reviews.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">
                  No active reviews pending for this project.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Submittal / Version</th>
                        <th className="py-3 px-4">Reviewer Role</th>
                        <th className="py-3 px-4">Method</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Decision</th>
                        <th className="py-3 pr-4 text-right">Workbench</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reviews.map((rev) => (
                        <tr key={rev.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{rev.document_title || rev.title || "Technical Document"}</div>
                            <div className="font-mono text-[11px] text-slate-500">Version: {rev.version_id || rev.id}</div>
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-700">{rev.reviewer_role || "R-QC"}</td>
                          <td className="py-3 px-4 text-slate-600">{rev.method || "IN_APP"}</td>
                          <td className="py-3 px-4">
                            <span className="rounded-full bg-slate-100 border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-800">
                              {rev.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              rev.decision === "APPROVED"
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : rev.decision === "CHANGES_REQUESTED"
                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                : rev.decision === "REJECTED"
                                ? "bg-red-50 text-red-800 border border-red-200"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {rev.decision || "PENDING"}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {rev.version_id ? (
                              <button
                                onClick={() => router.push(`/projects/${projectId}/review/${rev.version_id}`)}
                                className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-semibold text-xs cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Inspect</span>
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: HANDOVER PACKAGES */}
        {activeTab === "handover" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Compiled Handover Dossiers</h2>
                <p className="text-xs text-slate-500">ISO 32000-1 statutory dossiers with Bates numbering and bookmarks.</p>
              </div>
              <button
                onClick={() => setCompileModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs cursor-pointer"
              >
                <PackageCheck className="h-4 w-4" />
                <span>Compile New Dossier</span>
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              {loadingPackages ? (
                <div className="p-8 space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-12 w-full animate-pulse rounded bg-slate-100" />
                  ))}
                </div>
              ) : errorPackages ? (
                <div role="alert" className="p-8 space-y-3 text-sm text-red-800">
                  <p>Handover dossiers could not be loaded: {errorPackages}</p>
                  <button type="button" onClick={() => void fetchPackages()}
                    className="rounded-md border border-red-300 px-3 py-2 font-semibold hover:bg-red-50">
                    Retry dossiers
                  </button>
                </div>
              ) : packages.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">
                  <p>No handover dossiers compiled yet for this project.</p>
                  <button
                    onClick={() => setCompileModalOpen(true)}
                    className="mt-3 px-3.5 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 cursor-pointer"
                  >
                    Compile First Dossier
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {packages.map((pkg) => (
                    <div key={pkg.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 font-mono text-xs font-bold text-indigo-700">
                            Rev {pkg.version_no || pkg.versionNo}
                          </span>
                          <span className="font-bold text-slate-900 text-sm">{pkg.title || `Handover Dossier (Rev ${pkg.version_no})`}</span>
                          <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            {pkg.status}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 mt-1">
                          Snapshot Checksum: {pkg.snapshot_checksum?.slice(0, 16) || "—"}... · Created: {formatDateIst(pkg.created_at)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <a
                          href={`/api/v1/projects/${projectId}/dossier/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                        >
                          <Download className="h-3.5 w-3.5 text-blue-600" />
                          <span>Download Dossier PDF</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: WARRANTIES & DLP */}
        {activeTab === "warranties" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Warranties & Defect Liability Period (DLP)</h2>
                <p className="text-xs text-slate-500">OEM manufacturer certificates, coverage periods, and defect punch list.</p>
              </div>

              <button
                onClick={() => setAddDefectModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 shadow-xs cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Log Defect / Snag</span>
              </button>
            </div>

            {/* Warranty Registrations */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 font-bold text-sm text-slate-900">
                OEM Warranty Registrations
              </div>
              {loadingWarranties ? (
                <div className="p-6 space-y-2" role="status" aria-label="Loading warranty registrations">
                  <div className="h-8 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-8 w-full animate-pulse rounded bg-slate-100" />
                </div>
              ) : warrantyLoadError ? (
                <div className="p-6 text-red-800 text-xs" role="alert">
                  Warranty records could not be loaded: {warrantyLoadError}. The list below is not a verified empty result.
                  <button type="button" onClick={() => void fetchWarranties()}
                    className="ml-3 font-semibold underline">Retry</button>
                </div>
              ) : warranties.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No warranty registrations recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Asset Tag</th>
                        <th className="py-3 px-4">OEM Reference</th>
                        <th className="py-3 px-4">Basis</th>
                        <th className="py-3 px-4">Warranty Start</th>
                        <th className="py-3 px-4">Warranty End</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {warranties.map((w) => (
                        <tr key={w.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">{w.asset_tag || w.tag || "—"}</td>
                          <td className="py-3 px-4 font-mono text-slate-700">{w.oem_reference || "—"}</td>
                          <td className="py-3 px-4 font-medium text-slate-600">{w.basis || "—"}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{formatDateIst(w.warranty_start)}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{formatDateIst(w.warranty_end)}</td>
                          <td className="py-3 px-4">
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              {w.status || "Not recorded"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Defects Register */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 font-bold text-sm text-slate-900">
                Defect Liability & Rectification Register
              </div>
              {loadingWarranties ? (
                <div role="status" className="p-6 text-slate-500 text-xs">Loading defect records…</div>
              ) : defectsLoadError ? (
                <div className="p-6 text-red-800 text-xs" role="alert">
                  Defect records could not be loaded: {defectsLoadError}. No zero-defects claim can be made.
                  <button type="button" onClick={() => void fetchWarranties()}
                    className="ml-3 font-semibold underline">Retry</button>
                </div>
              ) : defects.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No defects returned for this project.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Severity</th>
                        <th className="py-3 px-4">Title & Description</th>
                        <th className="py-3 px-4">Equipment</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Closure Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {defects.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4">
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              d.severity === "CRITICAL"
                                ? "bg-red-100 text-red-800"
                                : d.severity === "HIGH"
                                ? "bg-orange-100 text-orange-800"
                                : d.severity === "MEDIUM"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700"
                            }`}>
                              {d.severity}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{d.title}</div>
                            <div className="text-slate-500 text-[11px] mt-0.5">{d.description}</div>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700">{d.asset_tag || "—"}</td>
                          <td className="py-3 px-4">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              d.status === "CLOSED"
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : "bg-amber-50 text-amber-800 border border-amber-200"
                            }`}>
                              {d.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs">
                            {d.closure_evidence_object_id ? (
                              <span className="font-mono text-emerald-700 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Verified Attached</span>
                              </span>
                            ) : (
                              <span className="text-slate-400">Pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 7: REPORTS & EXPORTS */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Executive & Site Compliance Reports Center</h2>
              <p className="text-xs text-slate-500">
                1-click exports and compliance analytics for project meetings, client billing, and consultant reviews.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Report 1 */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700 text-[11px] bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    REPORT #1
                  </span>
                  <span className="text-emerald-700 font-bold text-[11px]">COMMERCIAL</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Retention & Milestone Cash-Flow Gate Report</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Rupees unlocked vs. gated per commercial milestone (Mobilisation, Delivery, Erection, Commissioning, Handover).
                  </p>
                </div>
                <button
                  onClick={() => {
                    const milestones = ["MOBILISATION", "DELIVERY", "INSTALLATION", "COMMISSIONING", "HANDOVER", "FINAL_BILL"];
                    const rows = milestones.map((m) => {
                      const reqs = requirements.filter((r) => r.milestoneKey === m);
                      const approved = reqs.filter((r) => r.status === "APPROVED" || r.status === "APPROVED_EXTERNAL").length;
                      return [m, reqs.length, approved, reqs.length - approved, approved === reqs.length ? "UNLOCKED" : "GATED"];
                    });
                    exportCsv(`${summary?.code || "PRJ"}_Milestone_CashFlow_Report.csv`, ["Milestone", "Total Requirements", "Approved", "Pending", "Payment Gate Status"], rows);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Export Cash-Flow Gate CSV</span>
                </button>
              </div>

              {/* Report 2 */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700 text-[11px] bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    REPORT #2
                  </span>
                  <span className="text-blue-700 font-bold text-[11px]">TECHNICAL MATRIX</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Equipment-to-Document Compliance Matrix</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Full cross-tab of equipment tags against required submittals (Datasheet, FAT, Hydro, Leak Test, TAB, O&M).
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = assets.map((a) => {
                      const linked = requirements.filter((r) => r.assetTag === a.tag);
                      const approved = linked.filter((r) => r.status === "APPROVED" || r.status === "APPROVED_EXTERNAL").length;
                      return [a.tag, a.name || "HVAC Unit", a.category_key || "HVAC", linked.length, approved, linked.length - approved];
                    });
                    exportCsv(`${summary?.code || "PRJ"}_Equipment_Document_Matrix.csv`, ["Asset Tag", "Description", "Category", "Required Submittals", "Approved", "Pending"], rows);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-blue-600" />
                  <span>Export Equipment Matrix CSV</span>
                </button>
              </div>

              {/* Report 3 */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700 text-[11px] bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    REPORT #3
                  </span>
                  <span className="text-amber-700 font-bold text-[11px]">PROCUREMENT</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Supplier Pending & Delay Scorecard</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Tracks pending OEM certificates (Blue Star, Daikin, Grundfos, Caryaire) with delay days and status.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = requirements
                      .filter((r) => r.status === "REQUESTED" || r.status === "NOT_STARTED")
                      .map((r) => [r.requirementKey, r.title, r.assetTag || "Project General", r.status, formatDateIst(r.dueAt)]);
                    exportCsv(`${summary?.code || "PRJ"}_Supplier_Pending_Scorecard.csv`, ["Requirement Key", "Title", "Equipment", "Status", "Due Date"], rows);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-amber-600" />
                  <span>Export Supplier Scorecard CSV</span>
                </button>
              </div>

              {/* Report 4 */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700 text-[11px] bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    REPORT #4
                  </span>
                  <span className="text-red-700 font-bold text-[11px]">SAFETY & LEGAL</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Expiring Certificates & Calibration Radar</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Insurance, labour licences, fire NOCs, and pressure gauge calibrations expiring in &lt;30 days.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = requirements
                      .filter((r) => r.status === "EXPIRED" || r.docTypeKey === "DT-004" || r.docTypeKey === "DT-086")
                      .map((r) => [r.requirementKey, r.title, r.docTypeKey, r.status, formatDateIst(r.dueAt)]);
                    exportCsv(`${summary?.code || "PRJ"}_Expiring_Certificates_Radar.csv`, ["Requirement Key", "Title", "Doc Type", "Status", "Expiry Date"], rows);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-red-600" />
                  <span>Export Calibration Radar CSV</span>
                </button>
              </div>

              {/* Report 5 */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700 text-[11px] bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    REPORT #5
                  </span>
                  <span className="text-purple-700 font-bold text-[11px]">CONSULTANT SLA</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Consultant Review SLA Turnaround Log</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Submittals under consultant review with turnaround timestamps for Extension of Time (EOT) claims.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = requirements
                      .filter((r) => r.status === "IN_REVIEW")
                      .map((r) => [r.requirementKey, r.title, r.reviewerRole || "R-QC", r.status, "Awaiting Sign-off"]);
                    exportCsv(`${summary?.code || "PRJ"}_Consultant_SLA_Turnaround_Log.csv`, ["Requirement Key", "Title", "Reviewer Role", "Status", "SLA Flag"], rows);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-purple-600" />
                  <span>Export Consultant SLA CSV</span>
                </button>
              </div>

              {/* Report 6 */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-indigo-700 text-[11px] bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    REPORT #6
                  </span>
                  <span className="text-slate-800 font-bold text-[11px]">MASTER REGISTER</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Master Closeout Submittal Register</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Complete project checklist in official L&T / Shapoorji / CPWD submittal register format.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = requirements.map((r, i) => [
                      i + 1,
                      r.requirementKey,
                      r.title,
                      r.docTypeKey,
                      r.assetTag || "Project General",
                      r.milestoneKey,
                      r.status,
                      r.mandatory ? "YES" : "NO",
                      formatDateIst(r.dueAt),
                      r.ownerName || "Unassigned",
                    ]);
                    exportCsv(`${summary?.code || "PRJ"}_Master_Submittal_Register.csv`, ["Sr No", "Doc Code", "Requirement Description", "Doc Type", "Equipment Tag", "Milestone", "Status", "Mandatory", "Due Date", "Owner"], rows);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#0F2942] hover:bg-[#163A5F] font-semibold text-xs text-white cursor-pointer shadow-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export Master Register CSV</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      <ImportChecklistModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        projectId={projectId || ""}
        onImportSuccess={() => {
          fetchProjectSummary();
          fetchRequirements();
        }}
      />

      <UploadEvidenceModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        projectId={projectId || ""}
        requirement={selectedReqForUpload}
        onUploadSuccess={() => {
          fetchProjectSummary();
          fetchRequirements();
        }}
      />

      <ShareSupplierLinkModal
        open={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        projectId={projectId || ""}
        requirementId={selectedReqForSupplier?.id}
        requirementTitle={selectedReqForSupplier?.title}
      />

      <CompileHandoverModal
        open={compileModalOpen}
        onClose={() => setCompileModalOpen(false)}
        projectId={projectId || ""}
        projectName={summary?.name || "Project Closeout"}
      />

      <RequestWaiverModal
        open={waiverModalOpen}
        onClose={() => setWaiverModalOpen(false)}
        projectId={projectId || ""}
        requirement={selectedReqForWaiver}
        onWaiverSuccess={() => {
          fetchProjectSummary();
          fetchRequirements();
        }}
      />

      <AddRequirementModal
        open={addReqModalOpen}
        onClose={() => setAddReqModalOpen(false)}
        onSubmit={handleAddRequirement}
        nextKeySuggestion={`REQ-${summary?.code || "HVAC"}-0${requirements.length + 1}`}
      />

      <ExternalApprovalModal
        open={externalApprovalModalOpen}
        onClose={() => setExternalApprovalModalOpen(false)}
        requirement={selectedReqForExternal as any}
        onSubmit={handleExternalApproval}
      />

      {/* Add Equipment Modal */}
      {addAssetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900">Add Equipment Asset Tag</h3>
              <button onClick={() => setAddAssetModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateAsset} className="space-y-3">
              <div>
                <label className="block font-semibold mb-1">Equipment Tag</label>
                <input
                  type="text"
                  required
                  value={newAssetTag}
                  onChange={(e) => setNewAssetTag(e.target.value)}
                  placeholder="e.g. CHLR-03 or AHU-05"
                  className="w-full rounded border border-slate-300 p-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Equipment Description</label>
                <input
                  type="text"
                  required
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  placeholder="e.g. 500 TR Water-Cooled Screw Chiller"
                  className="w-full rounded border border-slate-300 p-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1">Category</label>
                  <select
                    value={newAssetCategory}
                    onChange={(e) => setNewAssetCategory(e.target.value)}
                    className="w-full rounded border border-slate-300 p-2 bg-white"
                  >
                    <option value="CHILLER">Chiller</option>
                    <option value="AHU">Air Handling Unit (AHU)</option>
                    <option value="FCU">Fan Coil Unit (FCU)</option>
                    <option value="COOLING_TOWER">Cooling Tower</option>
                    <option value="PUMP">Chilled Water Pump</option>
                    <option value="FIRE_DAMPER">Motorized Fire Damper</option>
                    <option value="VRF">VRF Outdoor Unit</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Serial Number</label>
                  <input
                    type="text"
                    value={newAssetSerial}
                    onChange={(e) => setNewAssetSerial(e.target.value)}
                    placeholder="e.g. BSL-2026-9921"
                    className="w-full rounded border border-slate-300 p-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Physical Location</label>
                <input
                  type="text"
                  value={newAssetLocation}
                  onChange={(e) => setNewAssetLocation(e.target.value)}
                  placeholder="e.g. Basement-2 Main Plant Room"
                  className="w-full rounded border border-slate-300 p-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setAddAssetModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded bg-indigo-600 text-white font-semibold"
                >
                  Save Equipment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Defect Modal */}
      {addDefectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900">Log DLP Punch List Snag / Defect</h3>
              <button onClick={() => setAddDefectModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateDefect} className="space-y-3">
              <div>
                <label className="block font-semibold mb-1">Defect Title</label>
                <input
                  type="text"
                  required
                  value={defectTitle}
                  onChange={(e) => setDefectTitle(e.target.value)}
                  placeholder="e.g. AHU-02 Return Air Damper Actuator Hunting"
                  className="w-full rounded border border-slate-300 p-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Severity</label>
                <select
                  value={defectSeverity}
                  onChange={(e) => setDefectSeverity(e.target.value as any)}
                  className="w-full rounded border border-slate-300 p-2 bg-white"
                >
                  <option value="LOW">Low (Minor cosmetic / label)</option>
                  <option value="MEDIUM">Medium (Vibration / minor deviation)</option>
                  <option value="HIGH">High (Leakage / cooling degradation)</option>
                  <option value="CRITICAL">Critical (Tripping / safety hazard)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Engineering Description & Location</label>
                <textarea
                  rows={3}
                  value={defectDesc}
                  onChange={(e) => setDefectDesc(e.target.value)}
                  placeholder="Describe observed issue, room number, and recommended rectification..."
                  className="w-full rounded border border-slate-300 p-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setAddDefectModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded bg-amber-600 text-white font-semibold"
                >
                  Log Defect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
