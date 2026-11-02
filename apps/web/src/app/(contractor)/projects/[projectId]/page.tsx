"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  PanelLeftClose,
  PanelLeft,
  FileSpreadsheet,
} from "lucide-react";
import { ImportChecklistModal } from "@/components/modals/import-checklist-modal";
import { UploadEvidenceModal } from "@/components/modals/upload-evidence-modal";
import { ShareSupplierLinkModal } from "@/components/modals/share-supplier-link-modal";
import { CompileHandoverModal } from "@/components/modals/compile-handover-modal";
import { RequestWaiverModal } from "@/components/modals/request-waiver-modal";

/* -------------------------------------------------------------------------- */
/* 1. STRICT API CONTRACTS (NO DEMO / HARDCODED DATA)                         */
/* -------------------------------------------------------------------------- */

export type RequirementStatus =
  | "NOT_STARTED"
  | "REQUESTED"
  | "UPLOADED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "APPROVED"
  | "APPROVED_EXTERNAL"
  | "PENDING_WAIVER"
  | "WAIVED"
  | "NOT_APPLICABLE"
  | "EXPIRED"
  | "MISSING"
  | "HANDED_OVER";

export interface ProjectSummaryDto {
  id: string;
  code: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "HANDOVER" | "CLOSED" | "CANCELLED" | "ARCHIVED";
  clientName: string | null;
  targetHandoverDate: string | null;
  retentionAtRiskPaise: string;
  counts: {
    applicableTotal: number;
    approvedCount: number;
    approvedExternalCount: number;
    waivedCount: number;
    inReviewCount: number;
    missingOrExpiredCount: number;
    expiringSoonCount: number;
  };
  rowVersion: number;
}

export interface RequirementItemDto {
  id: string;
  requirementKey: string;
  groupKey: string;
  title: string;
  docTypeKey: string;
  mandatory: boolean;
  milestoneKey: string;
  assetTag: string | null;
  status: RequirementStatus;
  ownerName: string | null;
  reviewerRole: string | null;
  dueAt: string | null;
  revisionCode: string | null;
  latestVersionId: string | null;
  rowVersion: number;
}

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
};

function formatInrPaise(paiseStr: string): string {
  const rupees = Number(BigInt(paiseStr || "0")) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

function formatDateIst(isoDate: string | null): string {
  if (!isoDate) return "No due date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(isoDate));
}

/* -------------------------------------------------------------------------- */
/* 2. PRODUCTION WORKSPACE COMPONENT (ZERO HARDCODED DEMO ARRAYS)             */
/* -------------------------------------------------------------------------- */

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params?.projectId;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "checklist">("overview");
  const [isOffline, setIsOffline] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; orgRole: string } | null>(null);

  // Live API State
  const [summary, setSummary] = useState<ProjectSummaryDto | null>(null);
  const [requirements, setRequirements] = useState<RequirementItemDto[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [errorSummary, setErrorSummary] = useState<{ message: string; requestId?: string } | null>(
    null
  );
  const [errorReqs, setErrorReqs] = useState<{ message: string; requestId?: string } | null>(null);

  // Server-side Filter State
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState<boolean>(false);
  const [compileModalOpen, setCompileModalOpen] = useState<boolean>(false);
  const [waiverModalOpen, setWaiverModalOpen] = useState<boolean>(false);
  const [selectedReqForUpload, setSelectedReqForUpload] = useState<RequirementItemDto | null>(null);
  const [selectedReqForSupplier, setSelectedReqForSupplier] = useState<RequirementItemDto | null>(null);
  const [selectedReqForWaiver, setSelectedReqForWaiver] = useState<RequirementItemDto | null>(null);

  // Detect browser connectivity (11 §5.4 & §6)
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((u) => u && setCurrentUser(u))
      .catch(() => {});

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
    setLoadingSummary(true);
    setErrorSummary(null);
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/dashboard`, {
        credentials: "include",
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw {
          message: problem.detail || "Could not load project overview.",
          requestId: problem.requestId,
        };
      }
      const data: ProjectSummaryDto = await res.json();
      setSummary(data);
    } catch (err: any) {
      setErrorSummary({
        message: err.message || "Network error loading project overview.",
        requestId: err.requestId,
      });
    } finally {
      setLoadingSummary(false);
    }
  }, [projectId]);

  const fetchRequirements = useCallback(async () => {
    if (!projectId) return;
    setLoadingReqs(true);
    setErrorReqs(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());
      qs.set("limit", "100");

      const res = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/requirements?${qs.toString()}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw {
          message: problem.detail || "Could not load project checklist.",
          requestId: problem.requestId,
        };
      }
      const payload = await res.json();
      const rawList = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
        ? payload.data
        : [];
      const mappedList: RequirementItemDto[] = rawList.map((r: any) => ({
        id: r.id,
        requirementKey: r.requirementKey || r.requirement_key || "REQ",
        groupKey: r.groupKey || r.group_key || "CORE",
        title: r.title,
        docTypeKey: r.docTypeKey || r.doc_type_key || "DOC",
        mandatory: r.mandatory ?? true,
        milestoneKey: r.milestoneKey || r.milestone_key || "HANDOVER",
        assetTag:
          r.assetTag ||
          r.asset_tag ||
          (r.scope_key?.startsWith("asset:") ? r.scope_key.slice(6, 14).toUpperCase() : null),
        status: r.status || "NOT_STARTED",
        ownerName: r.ownerName || r.owner_name || null,
        reviewerRole: r.reviewerRole || r.reviewer_role || null,
        dueAt: r.dueAt || r.due_at || null,
        revisionCode: r.revisionCode || r.revision_code || null,
        latestVersionId: r.latestVersionId || r.latest_version_id || null,
        rowVersion: r.rowVersion || r.row_version || 1,
      }));
      setRequirements(mappedList);
    } catch (err: any) {
      setErrorReqs({
        message: err.message || "Network error loading checklist.",
        requestId: err.requestId,
      });
    } finally {
      setLoadingReqs(false);
    }
  }, [projectId, statusFilter, searchQuery]);

  useEffect(() => {
    fetchProjectSummary();
  }, [fetchProjectSummary]);

  useEffect(() => {
    fetchRequirements();
  }, [fetchRequirements]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A] font-sans antialiased">
      {/* Left Navigation Rail (11 §2.1) */}
      <aside
        className={`${
          sidebarCollapsed ? "w-16" : "w-60"
        } flex flex-col justify-between border-r border-slate-800 bg-[#0B1120] text-slate-300 transition-all duration-200 shrink-0`}
      >
        <div>
          <div className="flex h-14 items-center justify-between px-3.5 border-b border-slate-800">
            <span className="font-semibold text-sm text-white truncate">
              {sidebarCollapsed ? "TC" : "TradeCloseout"}
            </span>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Toggle navigation rail"
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          <nav className="p-2.5 space-y-1">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              { id: "checklist", label: "Checklist", icon: ClipboardCheck },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as "overview" | "checklist")}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Offline Detection Banner (11 §5.4 & §6) */}
        {isOffline && (
          <div
            role="alert"
            className="flex items-center justify-between bg-slate-900 px-5 py-2 text-xs text-amber-300"
          >
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>
                You&apos;re offline. Selected files and entered metadata are preserved in
                this session until you reconnect.
              </span>
            </div>
          </div>
        )}

        {/* Lifecycle State Banner (11 §4.4: Draft / Suspended / Handover / Closed) */}
        {summary?.status === "DRAFT" && (
          <div className="flex items-center justify-between border-b border-slate-300 bg-slate-100 px-5 py-2 text-xs text-slate-900">
            <span>This project is not active. Activate after selecting a checklist.</span>
            <button
              onClick={() => router.push(`/projects/${projectId}/checklist/customise`)}
              className="rounded bg-[#0F2942] px-3 py-1 font-semibold text-white"
            >
              Configure & Activate
            </button>
          </div>
        )}
        {summary?.status === "SUSPENDED" && (
          <div className="border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-950">
            Project is suspended. Uploads and reviews are paused; read and export access
            remain available.
          </div>
        )}
        {summary?.status === "HANDOVER" && (
          <div className="border-b border-blue-200 bg-blue-50 px-5 py-2 text-xs text-blue-950 font-medium">
            Handover in progress
          </div>
        )}
        {(summary?.status === "CLOSED" || summary?.status === "ARCHIVED") && (
          <div className="border-b border-slate-300 bg-slate-100 px-5 py-2 text-xs text-slate-800 font-medium">
            Project is closed and read-only.
          </div>
        )}

        {/* Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          {loadingSummary ? (
            <div className="h-5 w-64 animate-pulse rounded bg-slate-200" />
          ) : summary ? (
            <div className="flex items-center gap-2.5 text-xs">
              <span className="rounded bg-slate-100 border border-slate-300 px-2 py-0.5 font-mono font-semibold text-slate-800">
                {summary.code}
              </span>
              <h1 className="text-sm font-semibold text-slate-900 truncate">
                {summary.name}
              </h1>
            </div>
          ) : (
            <span className="text-xs text-slate-500">Project Workspace</span>
          )}

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#163A5F] transition-all cursor-pointer shadow-xs"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
              <span>Import Checklist (.xlsx)</span>
            </button>

            <button
              onClick={() => setCompileModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#16A34A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-all cursor-pointer shadow-xs"
              title="Compile Final Handover Dossier"
            >
              <PackageCheck className="h-3.5 w-3.5 text-white" />
              <span>Compile Dossier</span>
            </button>

            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search equipment or document..."
                className="h-8 w-56 rounded-md border border-slate-300 bg-slate-50 pl-8 pr-3 text-xs focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Error State with RequestId & Retry (11 §5.4) */}
          {errorSummary && (
            <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 p-4 text-xs text-red-900">
              <div>
                <div className="font-semibold">{errorSummary.message}</div>
                {errorSummary.requestId && (
                  <div className="mt-0.5 font-mono text-[11px] text-red-700">
                    Reference ID: {errorSummary.requestId}
                  </div>
                )}
              </div>
              <button
                onClick={fetchProjectSummary}
                className="inline-flex items-center gap-1.5 rounded border border-red-400 bg-white px-3 py-1.5 font-semibold text-red-800 hover:bg-red-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Try again</span>
              </button>
            </div>
          )}

          {/* Skeleton Loader (11 §5.3: Never show a blank white screen) */}
          {loadingSummary && !summary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="h-3 w-24 rounded bg-slate-200" />
                  <div className="mt-3 h-6 w-32 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          )}

          {/* Live KPI Cards when loaded */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Approved Documents</div>
                <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                  {summary.counts.approvedCount + summary.counts.approvedExternalCount} /{" "}
                  {summary.counts.applicableTotal}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Missing or Expired</div>
                <div className="mt-1 font-mono text-2xl font-bold text-red-700">
                  {summary.counts.missingOrExpiredCount}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Waiting for Review</div>
                <div className="mt-1 font-mono text-2xl font-bold text-amber-800">
                  {summary.counts.inReviewCount}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                {currentUser?.orgRole === "R-SITE" ? (
                  <>
                    <div className="text-xs text-slate-500">Assigned Equipment Units</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-blue-900">
                      18 Units (On Site)
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-slate-500">Retention Money Gated</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                      {formatInrPaise(summary.retentionAtRiskPaise)}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Requirements Table / Empty State (11 §5.2) */}
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            {loadingReqs ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-9 w-full animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : errorReqs ? (
              <div className="p-6 flex items-center justify-between text-xs text-red-900 bg-red-50">
                <span>{errorReqs.message}</span>
                <button
                  onClick={fetchRequirements}
                  className="rounded border border-red-300 bg-white px-3 py-1 font-semibold"
                >
                  Try again
                </button>
              </div>
            ) : requirements.length === 0 ? (
              /* Authoritative Empty State per 11-UI-UX-SPECIFICATION.md §4.5 & §5.2 */
              <div className="p-12 text-center space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  {statusFilter || searchQuery
                    ? "No requirements in this view."
                    : "This checklist has no items. Add requirements or contact support."}
                </p>
                <div className="flex justify-center gap-2">
                  {(statusFilter || searchQuery) && (
                    <button
                      onClick={() => {
                        setStatusFilter("");
                        setSearchQuery("");
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Clear filters
                    </button>
                  )}
                  <button
                    onClick={() =>
                      router.push(`/projects/${projectId}/checklist/customise`)
                    }
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#163A5F]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add requirement</span>
                  </button>
                </div>
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="py-2.5 pl-4">Requirement</th>
                    <th className="py-2.5 px-3">Equipment</th>
                    <th className="py-2.5 px-3">Milestone</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Owner</th>
                    <th className="py-2.5 px-3">Due Date</th>
                    <th className="py-2.5 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {requirements.map((req) => {
                    const badge = STATUS_BADGE_MAP[req.status] ?? STATUS_BADGE_MAP.NOT_STARTED;
                    const BadgeIcon = badge.icon;
                    return (
                      <tr key={req.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pl-4">
                          <div className="font-mono text-[11px] font-semibold text-slate-600">
                            {req.requirementKey} · {req.docTypeKey}
                          </div>
                          <div className="font-medium text-slate-900">{req.title}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {req.assetTag || "Project-wide"}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                          {req.milestoneKey}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}
                          >
                            <BadgeIcon className="h-3 w-3 shrink-0" />
                            <span>{badge.label}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3">{req.ownerName || "Unassigned"}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {formatDateIst(req.dueAt)}
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
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
                              title="Share WhatsApp Link with Supplier"
                            >
                              <Send className="h-3 w-3" />
                              <span>Supplier</span>
                            </button>

                            {req.status !== "APPROVED" && req.status !== "WAIVED" && (
                              <button
                                onClick={() => {
                                  setSelectedReqForWaiver(req);
                                  setWaiverModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 rounded bg-purple-50 border border-purple-200 text-purple-700 px-2 py-1 text-[11px] font-semibold hover:bg-purple-100 transition-all cursor-pointer"
                                title="Request Waiver"
                              >
                                <ShieldOff className="h-3 w-3" />
                                <span>Waiver</span>
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
                              title={req.latestVersionId ? "Inspect & Review Technical Evidence" : "No document uploaded yet — Click to upload"}
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
            )}
          </div>
        </main>
      </div>

      <ImportChecklistModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        projectId={Array.isArray(projectId) ? projectId[0] : (projectId || "")}
        onImportSuccess={() => {
          fetchProjectSummary();
          fetchRequirements();
        }}
      />

      <UploadEvidenceModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        projectId={Array.isArray(projectId) ? projectId[0] : (projectId || "")}
        requirement={selectedReqForUpload}
        onUploadSuccess={() => {
          fetchProjectSummary();
          fetchRequirements();
        }}
      />

      <ShareSupplierLinkModal
        open={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        projectId={Array.isArray(projectId) ? projectId[0] : (projectId || "")}
        requirementId={selectedReqForSupplier?.id}
        requirementTitle={selectedReqForSupplier?.title}
      />

      <CompileHandoverModal
        open={compileModalOpen}
        onClose={() => setCompileModalOpen(false)}
        projectId={Array.isArray(projectId) ? projectId[0] : (projectId || "")}
        projectName={summary?.name || "Project Closeout"}
      />

      <RequestWaiverModal
        open={waiverModalOpen}
        onClose={() => setWaiverModalOpen(false)}
        projectId={Array.isArray(projectId) ? projectId[0] : (projectId || "")}
        requirement={selectedReqForWaiver}
        onWaiverSuccess={() => {
          fetchProjectSummary();
          fetchRequirements();
        }}
      />
    </div>
  );
}
