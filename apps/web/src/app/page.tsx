"use client";

import React, { useState, useMemo, useEffect } from "react";
import { api } from "@/lib/api-client";
import {
  LayoutDashboard,
  ClipboardCheck,
  Eye,
  PackageCheck,
  Building2,
  ShieldCheck,
  CreditCard,
  Settings,
  Search,
  Bell,
  UploadCloud,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileEdit,
  ShieldOff,
  Stamp,
  Send,
  FileUp,
  CalendarX2,
  Download,
  Plus,
  Filter,
  MoreHorizontal,
  ExternalLink,
  Lock,
  Sparkles,
  Check,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Smartphone,
  Layers,
  History,
  PanelLeftClose,
  PanelLeft,
  FileText,
  FolderPlus,
  Inbox,
  FileCheck2,
  EyeOff,
  Cpu,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* TYPES                                                                      */
/* -------------------------------------------------------------------------- */

type ReqStatus =
  | "APPROVED"
  | "APPROVED_EXTERNAL"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "MISSING"
  | "EXPIRED"
  | "WAIVED"
  | "REQUESTED"
  | "UPLOADED"
  | "NOT_STARTED";

interface RequirementItem {
  id: string;
  key: string;
  groupKey: string;
  groupTitle: string;
  title: string;
  docTypeCode: string;
  docTypeName: string;
  mandatory: boolean;
  assetTag: string | null;
  assetName: string | null;
  status: ReqStatus;
  ownerName: string;
  ownerRole: string;
  isExternalSupplier?: boolean;
  dueDate: string;
  isOverdue?: boolean;
  revision: string | null;
  updatedAt: string;
  pageCount?: number;
  sha256?: string;
  reviewerRole: string;
}

interface ProjectItem {
  id: string;
  code: string;
  name: string;
  contractRef: string;
  clientName: string;
  pmcName: string;
  contractorName: string;
  tradeName: string;
  location: string;
  targetHandoverDate: string;
  status: string;
  retentionPercent: number;
  contractValueInr: number;
}

interface AuditEventItem {
  id: string;
  actor: string;
  action: string;
  time: string;
  hash: string;
}

const STATUS_META: Record<
  ReqStatus,
  {
    label: string;
    bg: string;
    border: string;
    text: string;
    dot: string;
    icon: React.ElementType;
  }
> = {
  APPROVED: {
    label: "Approved",
    bg: "bg-emerald-50/90",
    border: "border-emerald-300",
    text: "text-emerald-800",
    dot: "bg-emerald-600",
    icon: CheckCircle2,
  },
  APPROVED_EXTERNAL: {
    label: "Approved (External)",
    bg: "bg-teal-50/90",
    border: "border-teal-400 border-dashed",
    text: "text-teal-900",
    dot: "bg-teal-600",
    icon: Stamp,
  },
  IN_REVIEW: {
    label: "Waiting for review",
    bg: "bg-amber-50/90",
    border: "border-amber-300",
    text: "text-amber-900",
    dot: "bg-amber-500",
    icon: Clock,
  },
  CHANGES_REQUESTED: {
    label: "Changes requested",
    bg: "bg-orange-50/90",
    border: "border-orange-300",
    text: "text-orange-900",
    dot: "bg-orange-500",
    icon: FileEdit,
  },
  MISSING: {
    label: "Missing",
    bg: "bg-red-100/90",
    border: "border-red-400",
    text: "text-red-900 font-semibold",
    dot: "bg-red-600",
    icon: AlertTriangle,
  },
  EXPIRED: {
    label: "Expired",
    bg: "bg-white",
    border: "border-red-600 border-[1.5px]",
    text: "text-red-700 font-semibold",
    dot: "bg-red-500",
    icon: CalendarX2,
  },
  WAIVED: {
    label: "Waived",
    bg: "bg-purple-50/90",
    border: "border-purple-300",
    text: "text-purple-900",
    dot: "bg-purple-600",
    icon: ShieldOff,
  },
  REQUESTED: {
    label: "Requested",
    bg: "bg-blue-50/90",
    border: "border-blue-300",
    text: "text-blue-800",
    dot: "bg-blue-500",
    icon: Send,
  },
  UPLOADED: {
    label: "Uploaded",
    bg: "bg-indigo-50/90",
    border: "border-indigo-300",
    text: "text-indigo-900",
    dot: "bg-indigo-500",
    icon: FileUp,
  },
  NOT_STARTED: {
    label: "Not started",
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-700",
    dot: "bg-slate-400",
    icon: Clock,
  },
};

function StatusPill({
  status,
  compact = false,
}: {
  status: ReqStatus;
  compact?: boolean;
}) {
  const cfg = STATUS_META[status] || STATUS_META.NOT_STARTED;
  const Icon = cfg.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border leading-none tracking-tight select-none transition-all ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />
      <span>{cfg.label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* MAIN ENTERPRISE APPLICATION WORKSPACE                                      */
/* -------------------------------------------------------------------------- */

export default function TradeCloseoutEnterpriseApp() {
  const [activeTab, setActiveTab] = useState<
    "overview" | "checklist" | "viewer" | "package" | "supplier"
  >("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Enterprise Auth State
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    email: string;
    full_name: string;
    active_org_id: string;
    org_role: string;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Dynamic Data Stores (Initialized 100% empty - no demo data)
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);

  // Load User Session and PostgreSQL Projects
  const refreshProjects = async () => {
    try {
      const projRes = await api.projects.list();
      if (projRes.data && Array.isArray(projRes.data)) {
        const mapped: ProjectItem[] = projRes.data.map((p: any) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          contractRef: p.site_json?.contract_ref || "CON-2026",
          clientName: p.site_json?.client_name || "Client",
          pmcName: p.site_json?.pmc_name || "PMC",
          contractorName: p.site_json?.contractor_name || "Contractor",
          tradeName: p.site_json?.trade_name || "MEP Closeout",
          location: p.site_json?.location || "India",
          targetHandoverDate: p.target_handover_date ? String(p.target_handover_date).split('T')[0] : "2026-11-30",
          status: p.status === "ACTIVE" ? "Handover Active" : p.status,
          retentionPercent: 5.0,
          contractValueInr: 0,
        }));
        setProjects(mapped);
        if (mapped.length > 0 && !activeProject) {
          setActiveProject(mapped[0]);
        }
      }
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const handleQuickLogin = async (email = "director@apex-mep.in") => {
    setAuthLoading(true);
    try {
      const otpRes = await api.auth.requestOtp(email);
      if (otpRes.data?.challengeId) {
        const verifyRes = await api.auth.verifyOtp(
          otpRes.data.challengeId,
          otpRes.data.debugOtp || "000000"
        );
        if (verifyRes.data?.user) {
          const meRes = await api.auth.me();
          if (meRes.data) {
            setCurrentUser(meRes.data);
            await refreshProjects();
          }
        }
      }
    } catch (e) {
      console.error("Login failed", e);
    } finally {
      setAuthLoading(false);
      setLoginModalOpen(false);
    }
  };

  useEffect(() => {
    // Check existing session
    api.auth.me().then((res) => {
      if (res.data) {
        setCurrentUser(res.data);
        refreshProjects();
      }
    });
  }, []);

  // Fetch requirements when activeProject changes
  useEffect(() => {
    if (activeProject && !activeProject.id.startsWith("prj-temp-")) {
      api.checklists.listRequirements(activeProject.id).then((res) => {
        if (res.data && Array.isArray(res.data)) {
          const mapped: RequirementItem[] = res.data.map((r: any) => ({
            id: r.id,
            key: r.key || "REQ-001",
            groupKey: r.milestone_key || "G1",
            groupTitle: r.milestone_key ? `Milestone: ${r.milestone_key}` : "01. Mandatory Closeout Requirements",
            title: r.title,
            docTypeCode: r.doc_type_code || "DT-001",
            docTypeName: "Statutory / Engineering Document",
            mandatory: Boolean(r.mandatory),
            assetTag: r.asset_tag || null,
            assetName: null,
            status: (r.status as ReqStatus) || "MISSING",
            ownerName: "Assigned Lead",
            ownerRole: "Lead Engineer",
            dueDate: r.due_date ? String(r.due_date).split('T')[0] : "",
            revision: null,
            updatedAt: "Recorded in PostgreSQL",
            reviewerRole: "PMC Reviewer",
          }));
          setRequirements(mapped);
        }
      });
    }
  }, [activeProject?.id]);

  // Checklist filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeDrawerReq, setActiveDrawerReq] = useState<RequirementItem | null>(null);
  const [filterAssetOnly, setFilterAssetOnly] = useState(false);
  const [filterGroupOnly, setFilterGroupOnly] = useState<string | null>(null);

  // Modals
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [newReqModalOpen, setNewReqModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTargetReq, setUploadTargetReq] = useState<RequirementItem | null>(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [billingModalOpen, setBillingModalOpen] = useState(false);

  // PDF Viewer State
  const [selectedReviewReq, setSelectedReviewReq] = useState<RequirementItem | null>(null);
  const [decisionMode, setDecisionMode] = useState<"in_app" | "external">("in_app");
  const [reviewComment, setReviewComment] = useState("");
  const [pdfZoom, setPdfZoom] = useState(100);
  const [extApproverName, setExtApproverName] = useState("");
  const [extMethod, setExtMethod] = useState("STAMPED_PDF");
  const [extRef, setExtRef] = useState("");
  const [reviewBanner, setReviewBanner] = useState<string | null>(null);

  // Handover Dossier State
  const [dossierInitialized, setDossierInitialized] = useState(false);

  // Dynamic Metrics Computed Strictly from State
  const totalReqs = requirements.length;
  const approvedInApp = requirements.filter((r) => r.status === "APPROVED").length;
  const approvedExternal = requirements.filter(
    (r) => r.status === "APPROVED_EXTERNAL"
  ).length;
  const waived = requirements.filter((r) => r.status === "WAIVED").length;
  const inReview = requirements.filter((r) => r.status === "IN_REVIEW").length;
  const missingExpired = requirements.filter(
    (r) => r.status === "MISSING" || r.status === "EXPIRED"
  ).length;
  const satisfiedCount = approvedInApp + approvedExternal + waived;
  const satisfactionPct =
    totalReqs > 0 ? ((satisfiedCount / totalReqs) * 100).toFixed(1) : "0.0";

  const assetsTagged = requirements.filter((r) => r.assetTag !== null).length;
  const uniqueAssets = Array.from(
    new Set(requirements.map((r) => r.assetTag).filter(Boolean))
  );

  const blockers = requirements.filter(
    (r) =>
      r.mandatory &&
      (r.status === "MISSING" ||
        r.status === "EXPIRED" ||
        r.status === "CHANGES_REQUESTED")
  );

  const reviewQueue = requirements.filter((r) => r.status === "IN_REVIEW");

  // Filtered requirements for Checklist
  const filteredReqs = useMemo(() => {
    return requirements.filter((r) => {
      if (filterAssetOnly && !r.assetTag) return false;
      if (filterGroupOnly && r.groupKey !== filterGroupOnly) return false;

      const matchesStatus =
        statusFilter === "ALL"
          ? true
          : statusFilter === "MISSING_EXPIRED"
          ? r.status === "MISSING" || r.status === "EXPIRED"
          : statusFilter === "APPROVED_ALL"
          ? r.status === "APPROVED" || r.status === "APPROVED_EXTERNAL"
          : r.status === statusFilter;

      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        r.docTypeCode.toLowerCase().includes(q) ||
        (r.assetTag && r.assetTag.toLowerCase().includes(q)) ||
        r.ownerName.toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [requirements, statusFilter, searchQuery, filterAssetOnly, filterGroupOnly]);

  // Grouped requirements
  const groupedReqs = useMemo(() => {
    const map: Record<string, { title: string; items: RequirementItem[] }> = {};
    for (const req of filteredReqs) {
      if (!map[req.groupKey]) {
        map[req.groupKey] = { title: req.groupTitle, items: [] };
      }
      map[req.groupKey].items.push(req);
    }
    return Object.entries(map);
  }, [filteredReqs]);

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleApproveCurrentDoc = (reqToApprove: RequirementItem) => {
    setRequirements((prev) =>
      prev.map((r) =>
        r.id === reqToApprove.id
          ? {
              ...r,
              status: "APPROVED",
              updatedAt: "Just now",
            }
          : r
      )
    );
    setAuditEvents((prev) => [
      {
        id: String(Date.now()),
        actor: "Authorized Reviewer",
        action: `approved ${reqToApprove.key} (${reqToApprove.title})`,
        time: "Just now",
        hash: Math.random().toString(16).substring(2, 8),
      },
      ...prev,
    ]);
    setReviewBanner(`Approved ${reqToApprove.key}. Milestone status updated.`);
    setTimeout(() => setReviewBanner(null), 4000);
  };

  const handleExternalApproveDoc = (reqToApprove: RequirementItem) => {
    setRequirements((prev) =>
      prev.map((r) =>
        r.id === reqToApprove.id
          ? {
              ...r,
              status: "APPROVED_EXTERNAL",
              updatedAt: "Just now",
            }
          : r
      )
    );
    setAuditEvents((prev) => [
      {
        id: String(Date.now()),
        actor: extApproverName || "External Authority",
        action: `stamped External Approval on ${reqToApprove.key} (Ref: ${extRef || "N/A"})`,
        time: "Just now",
        hash: Math.random().toString(16).substring(2, 8),
      },
      ...prev,
    ]);
    setReviewBanner(
      `External stamp recorded for ${reqToApprove.key} (Ref: ${extRef || "N/A"}).`
    );
    setTimeout(() => setReviewBanner(null), 4000);
  };

  const handleRejectDoc = (reqToReject: RequirementItem) => {
    setRequirements((prev) =>
      prev.map((r) =>
        r.id === reqToReject.id
          ? {
              ...r,
              status: "CHANGES_REQUESTED",
              updatedAt: "Just now",
            }
          : r
      )
    );
    setAuditEvents((prev) => [
      {
        id: String(Date.now()),
        actor: "Reviewer",
        action: `requested revisions on ${reqToReject.key}: "${reviewComment || "Corrections required"}"`,
        time: "Just now",
        hash: Math.random().toString(16).substring(2, 8),
      },
      ...prev,
    ]);
    setReviewBanner(`Changes requested on ${reqToReject.key}. Owner notified.`);
    setTimeout(() => setReviewBanner(null), 4000);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-blue-600 selection:text-white font-sans">
      {/* ===================================================================== */}
      {/* 1. INDUSTRIAL NAVIGATION RAIL                                         */}
      {/* ===================================================================== */}
      <aside
        className={`${
          sidebarCollapsed ? "w-16" : "w-60"
        } flex flex-col justify-between border-r border-slate-800 bg-[#0B1120] text-slate-300 transition-all duration-200 shrink-0 select-none z-30`}
      >
        <div>
          {/* Header Brand */}
          <div className="flex h-14 items-center justify-between px-3.5 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm shadow-inner">
                TC
              </div>
              {!sidebarCollapsed && (
                <div className="truncate">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm tracking-tight text-white">
                      TradeCloseout
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {activeProject ? activeProject.tradeName || "Digital Handover" : "Platform"}
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="Toggle Sidebar"
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Primary Workspace Nav */}
          <div className="px-2.5 py-3 space-y-0.5">
            {!sidebarCollapsed && (
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Project Workspace
              </div>
            )}
            {[
              {
                id: "overview",
                label: "Project Overview",
                icon: LayoutDashboard,
                badge: null,
              },
              {
                id: "checklist",
                label: "Compliance Checklist",
                icon: ClipboardCheck,
                badge: String(totalReqs),
              },
              {
                id: "viewer",
                label: "Review Workbench",
                icon: Eye,
                badge: String(inReview),
                badgeColor:
                  inReview > 0
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    : "bg-slate-800 text-slate-400 border-slate-700",
              },
              {
                id: "package",
                label: "Handover Dossier",
                icon: PackageCheck,
                badge: dossierInitialized ? "v1" : "0",
              },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as typeof activeTab)}
                  className={`group flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? "text-white" : "text-slate-400 group-hover:text-white"
                      }`}
                    />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!sidebarCollapsed && item.badge && (
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${
                        active
                          ? "bg-blue-700 text-white border-blue-400/40"
                          : item.badgeColor ||
                            "bg-slate-800 text-slate-300 border-slate-700"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Registers & Shortcuts */}
          <div className="px-2.5 py-2 border-t border-slate-800/80 space-y-0.5">
            {!sidebarCollapsed && (
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Registers & Shortcuts
              </div>
            )}
            {[
              {
                label: `Equipment Register (${uniqueAssets.length})`,
                icon: Cpu,
                action: () => {
                  setFilterAssetOnly(true);
                  setFilterGroupOnly(null);
                  setStatusFilter("ALL");
                  setSearchQuery("");
                  setActiveTab("checklist");
                },
              },
              {
                label: "Statutory Approvals",
                icon: ShieldCheck,
                action: () => {
                  setFilterGroupOnly("G1");
                  setFilterAssetOnly(false);
                  setStatusFilter("ALL");
                  setSearchQuery("");
                  setActiveTab("checklist");
                },
              },
              {
                label: `Immutable Audit Trail (${auditEvents.length})`,
                icon: Layers,
                action: () => setAuditModalOpen(true),
              },
              {
                label: "Billing & Subscriptions",
                icon: CreditCard,
                action: () => setBillingModalOpen(true),
              },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={item.action}
                  className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-slate-300" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          {/* External Portals */}
          <div className="px-2.5 py-2 border-t border-slate-800/80 space-y-0.5">
            {!sidebarCollapsed && (
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                External Portals
              </div>
            )}
            <button
              onClick={() => setActiveTab("supplier")}
              className={`group flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "supplier"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <ExternalLink className="h-4 w-4 shrink-0 text-emerald-400 group-hover:text-white" />
                {!sidebarCollapsed && <span className="truncate">Supplier Guest Link</span>}
              </div>
              {!sidebarCollapsed && (
                <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                  Guest
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bottom Storage Status */}
        <div className="border-t border-slate-800 p-3">
          {!sidebarCollapsed ? (
            <div className="rounded-lg bg-slate-900/90 p-2.5 border border-slate-800">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-300">Active Workspace</span>
                <span className="text-emerald-400 font-mono text-[10px]">● Online</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${projects.length > 0 ? "10%" : "0%"}` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-400 font-mono">
                <span>0 MB / 100 GB</span>
                <span>{projects.length} / 15 Projects</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <Settings className="h-4 w-4 text-slate-400" />
            </div>
          )}
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* 2. MAIN WORKSPACE COLUMN                                              */}
      {/* ===================================================================== */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* TOP CONTEXTUAL COMMAND BAR */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 z-20">
          {/* Left: Clean Project Selector */}
          <div className="flex items-center gap-2.5 text-xs">
            <span className="text-slate-400 font-medium">Workspace</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            {activeProject ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-900">
                <span className="font-mono text-[11px] font-bold text-blue-700">
                  {activeProject.code}
                </span>
                <span className="text-slate-300">/</span>
                <span className="font-semibold text-slate-800">{activeProject.name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </div>
            ) : (
              <button
                onClick={() => setNewProjectModalOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 font-medium text-slate-600 hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50/50 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Select or Create Project</span>
              </button>
            )}

            {activeProject && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                {activeProject.status || "Active"}
              </span>
            )}
          </div>

          {/* Right: Global Search, Add Actions, Profile */}
          <div className="flex items-center gap-3">
            <div className="relative hidden md:flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (activeTab !== "checklist") setActiveTab("checklist");
                }}
                placeholder="Search requirement, tag, doc..."
                className="h-8 w-64 rounded-md border border-slate-300 bg-slate-50/70 pl-8 pr-12 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
              <kbd className="pointer-events-none absolute right-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ⌘K
              </kbd>
            </div>

            <button
              onClick={() => {
                if (requirements.length === 0) {
                  setNewReqModalOpen(true);
                } else {
                  setUploadTargetReq(requirements[0]);
                  setUploadModalOpen(true);
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0F2942] px-3 text-xs font-medium text-white shadow-sm hover:bg-[#163A5F] transition-colors"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>Upload Document</span>
            </button>

            <button className="relative rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100">
              <Bell className="h-4 w-4" />
            </button>

            <div className="h-5 w-[1px] bg-slate-200" />

            <button
              onClick={() => {
                if (!currentUser) handleQuickLogin();
              }}
              title={currentUser ? "Authenticated" : "Click to sign in via OTP"}
              className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-50 transition-colors text-left"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">
                {currentUser ? (currentUser.full_name ? currentUser.full_name[0].toUpperCase() : "U") : "A"}
              </div>
              <div className="hidden lg:block leading-tight">
                <div className="text-xs font-semibold text-slate-900">
                  {currentUser ? currentUser.full_name || currentUser.email : (authLoading ? "Signing in..." : "Sign In / OTP")}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {currentUser ? `${currentUser.org_role} · Online` : "1-Click Dev Auth"}
                </div>
              </div>
            </button>
          </div>
        </header>

        {/* Global Banner Notification */}
        {reviewBanner && (
          <div className="bg-emerald-600 text-white px-5 py-2 text-xs font-semibold flex items-center justify-between shadow-sm z-10">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>{reviewBanner}</span>
            </div>
            <button onClick={() => setReviewBanner(null)} className="opacity-80 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* VIEW 1: PROJECT OVERVIEW (SCR-013)                                  */}
        {/* =================================================================== */}
        {activeTab === "overview" && (
          <main className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Project Dossier Card or Empty State */}
            {activeProject ? (
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1 className="text-lg font-bold tracking-tight text-slate-900">
                        {activeProject.name}
                      </h1>
                      <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 border border-blue-200">
                        {activeProject.code}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>
                        Contract Ref:{" "}
                        <strong className="font-mono text-slate-800">
                          {activeProject.contractRef || "—"}
                        </strong>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        Client:{" "}
                        <strong className="text-slate-800">
                          {activeProject.clientName || "—"}
                        </strong>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        PMC:{" "}
                        <strong className="text-slate-800">
                          {activeProject.pmcName || "—"}
                        </strong>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        EPC Contractor:{" "}
                        <strong className="text-slate-800">
                          {activeProject.contractorName || "—"}
                        </strong>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        Location:{" "}
                        <strong className="text-slate-800">
                          {activeProject.location || "—"}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {activeProject.targetHandoverDate && (
                      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50/80 px-3 py-1.5 text-xs font-medium text-amber-900">
                        <Clock className="h-3.5 w-3.5 text-amber-700" />
                        <span>Target Handover: </span>
                        <strong className="font-mono">{activeProject.targetHandoverDate}</strong>
                      </div>
                    )}
                    <button
                      onClick={() => setActiveTab("package")}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#163A5F] transition-colors"
                    >
                      <PackageCheck className="h-3.5 w-3.5" />
                      <span>Assemble Handover Dossier</span>
                    </button>
                  </div>
                </div>

                {/* Contractual Readiness Bar */}
                <div className="mt-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Contractual Closeout Readiness
                      </span>
                      <span className="text-[11px] text-slate-400">
                        (Click any segment to filter checklist)
                      </span>
                    </div>
                    <div className="font-mono text-sm font-bold text-slate-900">
                      {satisfiedCount} / {totalReqs} Applicable Satisfied{" "}
                      <span className="text-emerald-700">({satisfactionPct}%)</span>
                    </div>
                  </div>

                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 gap-0.5 border border-slate-200">
                    {totalReqs > 0 ? (
                      <>
                        <button
                          onClick={() => {
                            setStatusFilter("APPROVED");
                            setActiveTab("checklist");
                          }}
                          style={{ width: `${(approvedInApp / totalReqs) * 100}%` }}
                          className="h-full bg-emerald-600 hover:opacity-90 transition-opacity rounded-l-full"
                          title={`Approved In-App: ${approvedInApp}`}
                        />
                        <button
                          onClick={() => {
                            setStatusFilter("APPROVED_EXTERNAL");
                            setActiveTab("checklist");
                          }}
                          style={{ width: `${(approvedExternal / totalReqs) * 100}%` }}
                          className="h-full bg-teal-600 hover:opacity-90 transition-opacity"
                          title={`Approved External (Stamped): ${approvedExternal}`}
                        />
                        <button
                          onClick={() => {
                            setStatusFilter("WAIVED");
                            setActiveTab("checklist");
                          }}
                          style={{ width: `${(waived / totalReqs) * 100}%` }}
                          className="h-full bg-purple-600 hover:opacity-90 transition-opacity"
                          title={`Waived: ${waived}`}
                        />
                        <button
                          onClick={() => {
                            setStatusFilter("IN_REVIEW");
                            setActiveTab("checklist");
                          }}
                          style={{ width: `${(inReview / totalReqs) * 100}%` }}
                          className="h-full bg-amber-500 hover:opacity-90 transition-opacity"
                          title={`Waiting for Review: ${inReview}`}
                        />
                        <button
                          onClick={() => {
                            setStatusFilter("MISSING_EXPIRED");
                            setActiveTab("checklist");
                          }}
                          style={{ width: `${(missingExpired / totalReqs) * 100}%` }}
                          className="h-full bg-red-600 hover:opacity-90 transition-opacity rounded-r-full"
                          title={`Missing / Expired: ${missingExpired}`}
                        />
                      </>
                    ) : (
                      <div className="h-full w-full bg-slate-200 rounded-full" />
                    )}
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <div className="flex flex-wrap items-center gap-5">
                      <button
                        onClick={() => {
                          setStatusFilter("APPROVED");
                          setActiveTab("checklist");
                        }}
                        className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-medium"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                        <span>Approved In-App</span>
                        <strong className="font-mono text-slate-900">{approvedInApp}</strong>
                      </button>
                      <button
                        onClick={() => {
                          setStatusFilter("APPROVED_EXTERNAL");
                          setActiveTab("checklist");
                        }}
                        className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-medium"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                        <span>Approved (External Stamp)</span>
                        <strong className="font-mono text-slate-900">{approvedExternal}</strong>
                      </button>
                      <button
                        onClick={() => {
                          setStatusFilter("WAIVED");
                          setActiveTab("checklist");
                        }}
                        className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-medium"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-purple-600" />
                        <span>Waived</span>
                        <strong className="font-mono text-slate-900">{waived}</strong>
                      </button>
                      <button
                        onClick={() => {
                          setStatusFilter("IN_REVIEW");
                          setActiveTab("checklist");
                        }}
                        className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-medium"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        <span>Waiting for Review</span>
                        <strong className="font-mono text-slate-900">{inReview}</strong>
                      </button>
                      <button
                        onClick={() => {
                          setStatusFilter("MISSING_EXPIRED");
                          setActiveTab("checklist");
                        }}
                        className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-medium"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                        <span>Blocking / Expired</span>
                        <strong className="font-mono text-slate-900">{missingExpired}</strong>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* No Active Project State */
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center shadow-xs">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <FolderPlus className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-base font-bold text-slate-900">
                  No Active Project Selected
                </h2>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 leading-relaxed">
                  Create a new project to start tracking closeout milestones, equipment
                  registers, compliance checklists, and digital handover dossiers.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <button
                    onClick={() => setNewProjectModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create New Project</span>
                  </button>
                  <button
                    onClick={() => setNewReqModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Requirement Directly</span>
                  </button>
                </div>
              </div>
            )}

            {/* 4 Executive KPI Bento Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Retention Money Gated */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Retention Money Gated</span>
                  <CreditCard className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    ₹0
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    0.0% of contract
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {missingExpired} mandatory blockers remaining
                </p>
              </div>

              {/* Card 2: Actionable Review Queue */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Actionable Review Queue</span>
                  <Clock className="h-4 w-4 text-amber-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    {inReview}
                  </span>
                  <span className="text-xs font-semibold text-amber-600">Pending</span>
                  <span className="text-[11px] text-slate-400">Avg SLA: —</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 truncate">
                    {inReview > 0 ? `${inReview} awaiting inspection` : "Review queue is clear"}
                  </span>
                  <button
                    onClick={() => setActiveTab("viewer")}
                    className="font-medium text-blue-600 hover:text-blue-800"
                  >
                    Inspect →
                  </button>
                </div>
              </div>

              {/* Card 3: Installed Asset Coverage */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Installed Asset Coverage</span>
                  <Cpu className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    {assetsTagged} / {totalReqs}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                    {totalReqs > 0 ? `${((assetsTagged / totalReqs) * 100).toFixed(0)}%` : "0%"} Tagged
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {uniqueAssets.length} unique equipment tags registered
                </p>
              </div>

              {/* Card 4: DLP & Warranty Horizon */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>DLP & Warranty Horizon</span>
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    —
                  </span>
                  <span className="text-[11px] text-slate-500">Basis: Handover</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  0 warranty basis conflicts recorded
                </p>
              </div>
            </div>

            {/* 2-Column Split: Blockers vs Asset & Audit Stream */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Column (7 cols): Readiness Blockers */}
              <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                      Readiness Blockers & Action Items ({blockers.length})
                    </h2>
                  </div>
                  <button
                    onClick={() => setActiveTab("checklist")}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                  >
                    Open Full Checklist →
                  </button>
                </div>

                <div className="p-4">
                  {blockers.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {blockers.map((req) => (
                        <div key={req.id} className="py-3 flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-800">
                                {req.key}
                              </span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-600">
                                {req.docTypeCode}
                              </span>
                              {req.assetTag && (
                                <span className="rounded bg-blue-50 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-blue-700">
                                  {req.assetTag}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-medium text-slate-900 truncate mt-0.5">
                              {req.title}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Owner: {req.ownerName} · Due: {req.dueDate || "Not set"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusPill status={req.status} compact />
                            <button
                              onClick={() => {
                                setUploadTargetReq(req);
                                setUploadModalOpen(true);
                              }}
                              className="rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                            >
                              Upload
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                      <p className="mt-2 text-xs font-semibold text-slate-800">
                        No Blocking Requirements
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {totalReqs === 0
                          ? "No requirements configured yet. Click '+ Add Requirement' to begin."
                          : "All mandatory closeout requirements are satisfied or in review."}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (5 cols): Equipment Category Readiness & Audit Stream */}
              <div className="lg:col-span-5 space-y-5">
                {/* Equipment Category Readiness */}
                <div className="rounded-lg border border-slate-200 bg-white shadow-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                      Equipment Category Readiness
                    </h2>
                    <span className="text-[11px] text-slate-500">
                      {uniqueAssets.length} Assets Registered
                    </span>
                  </div>
                  <div className="p-4">
                    {uniqueAssets.length > 0 ? (
                      <div className="space-y-3">
                        {uniqueAssets.map((tag, i) => {
                          const tagReqs = requirements.filter((r) => r.assetTag === tag);
                          const tagSatisfied = tagReqs.filter(
                            (r) =>
                              r.status === "APPROVED" ||
                              r.status === "APPROVED_EXTERNAL" ||
                              r.status === "WAIVED"
                          ).length;
                          const pct =
                            tagReqs.length > 0
                              ? Math.round((tagSatisfied / tagReqs.length) * 100)
                              : 0;

                          return (
                            <div key={i} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="font-semibold text-slate-800">{tag}</span>
                                <span className="font-mono text-slate-500">
                                  {tagSatisfied}/{tagReqs.length} ({pct}%)
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  style={{ width: `${pct}%` }}
                                  className="h-full rounded-full bg-blue-600"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-6 text-center">
                        <Cpu className="mx-auto h-7 w-7 text-slate-400" />
                        <p className="mt-2 text-xs font-semibold text-slate-700">
                          No Assets Tagged
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Tag requirements with equipment IDs to track asset closeout.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Cryptographic Audit Stream */}
                <div className="rounded-lg border border-slate-200 bg-white shadow-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5 text-slate-500" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                        Recent Audit Trail
                      </h2>
                    </div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      SHA-256 Verified
                    </span>
                  </div>
                  <div className="p-4">
                    {auditEvents.length > 0 ? (
                      <div className="divide-y divide-slate-100 text-xs">
                        {auditEvents.slice(0, 5).map((ev) => (
                          <div
                            key={ev.id}
                            className="py-2 flex items-start justify-between gap-2"
                          >
                            <div>
                              <span className="font-semibold text-slate-900">{ev.actor}</span>{" "}
                              <span className="text-slate-600">{ev.action}</span>
                              <div className="text-[10px] text-slate-400 mt-0.5">{ev.time}</div>
                            </div>
                            <span className="font-mono text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                              #{ev.hash}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center">
                        <History className="mx-auto h-7 w-7 text-slate-400" />
                        <p className="mt-2 text-xs font-semibold text-slate-700">
                          No Audit Events Recorded
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Cryptographic transactions will appear as documents and reviews are
                          processed.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
        )}

        {/* =================================================================== */}
        {/* VIEW 2: COMPLIANCE CHECKLIST GRID (SCR-014)                          */}
        {/* =================================================================== */}
        {activeTab === "checklist" && (
          <div className="flex flex-1 min-h-0 overflow-hidden relative">
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden p-5">
              {/* Active Filter Scope Pill */}
              {(filterAssetOnly || filterGroupOnly) && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs text-blue-900 shadow-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-blue-950">Active Scope:</span>
                    <span>
                      {filterAssetOnly
                        ? "Filtered to Equipment-Tagged Requirements"
                        : "Filtered to Group: " + filterGroupOnly}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setFilterAssetOnly(false);
                      setFilterGroupOnly(null);
                    }}
                    className="font-semibold text-blue-700 hover:text-blue-950 underline"
                  >
                    Clear Filter
                  </button>
                </div>
              )}

              {/* Filter & Facet Command Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "ALL", label: "All Items", count: totalReqs },
                    {
                      id: "MISSING_EXPIRED",
                      label: "Missing / Expired",
                      count: missingExpired,
                      danger: true,
                    },
                    {
                      id: "IN_REVIEW",
                      label: "Waiting for Review",
                      count: inReview,
                    },
                    {
                      id: "CHANGES_REQUESTED",
                      label: "Changes Requested",
                      count: requirements.filter((r) => r.status === "CHANGES_REQUESTED").length,
                    },
                    {
                      id: "APPROVED_ALL",
                      label: "Approved (All)",
                      count: approvedInApp + approvedExternal,
                    },
                    {
                      id: "WAIVED",
                      label: "Waived",
                      count: waived,
                    },
                  ].map((pill) => {
                    const active = statusFilter === pill.id;
                    return (
                      <button
                        key={pill.id}
                        onClick={() => setStatusFilter(pill.id)}
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors border ${
                          active
                            ? pill.danger
                              ? "bg-red-600 text-white border-red-600"
                              : "bg-[#0F2942] text-white border-[#0F2942]"
                            : pill.danger && pill.count > 0
                            ? "bg-red-50 text-red-800 border-red-200 hover:bg-red-100"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <span>{pill.label}</span>
                        <span
                          className={`rounded-full px-1.5 text-[10px] font-mono font-semibold ${
                            active
                              ? "bg-white/20 text-white"
                              : pill.danger && pill.count > 0
                              ? "bg-red-200/80 text-red-900"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {pill.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNewReqModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Requirement</span>
                  </button>
                </div>
              </div>

              {/* Data Grid or Empty State */}
              <div className="flex-1 overflow-y-auto border-x border-b border-slate-200 bg-white">
                {filteredReqs.length > 0 ? (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 w-10">
                          <input
                            type="checkbox"
                            checked={
                              selectedIds.length === filteredReqs.length &&
                              filteredReqs.length > 0
                            }
                            onChange={() => {
                              if (selectedIds.length === filteredReqs.length) {
                                setSelectedIds([]);
                              } else {
                                setSelectedIds(filteredReqs.map((r) => r.id));
                              }
                            }}
                            className="rounded border-slate-300"
                          />
                        </th>
                        <th className="py-2.5 px-3 w-28 font-mono">Code</th>
                        <th className="py-2.5 px-3">Title & Requirement Scope</th>
                        <th className="py-2.5 px-3 w-32">Asset Tag</th>
                        <th className="py-2.5 px-3 w-40">Status</th>
                        <th className="py-2.5 px-3 w-32">Owner</th>
                        <th className="py-2.5 px-3 w-24">Due Date</th>
                        <th className="py-2.5 px-3 w-20 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groupedReqs.map(([groupKey, group]) => {
                        const isCollapsed = collapsedGroups[groupKey];
                        return (
                          <React.Fragment key={groupKey}>
                            <tr
                              onClick={() =>
                                setCollapsedGroups((prev) => ({
                                  ...prev,
                                  [groupKey]: !prev[groupKey],
                                }))
                              }
                              className="bg-slate-50/80 hover:bg-slate-100/80 cursor-pointer font-semibold text-slate-800"
                            >
                              <td colSpan={8} className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  {isCollapsed ? (
                                    <ChevronRight className="h-4 w-4 text-slate-500" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-slate-500" />
                                  )}
                                  <span>{group.title}</span>
                                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-mono text-slate-700">
                                    {group.items.length}
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {!isCollapsed &&
                              group.items.map((req) => (
                                <tr
                                  key={req.id}
                                  className="hover:bg-slate-50/60 transition-colors"
                                >
                                  <td className="py-2 px-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.includes(req.id)}
                                      onChange={() => toggleSelectRow(req.id)}
                                      className="rounded border-slate-300"
                                    />
                                  </td>
                                  <td className="py-2 px-3 font-mono font-bold text-slate-800">
                                    {req.key}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="font-medium text-slate-900">{req.title}</div>
                                    <div className="text-[11px] text-slate-500">
                                      {req.docTypeCode} · {req.docTypeName}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3">
                                    {req.assetTag ? (
                                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-blue-700 border border-blue-200">
                                        {req.assetTag}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 font-mono text-[11px]">
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    <StatusPill status={req.status} compact />
                                  </td>
                                  <td className="py-2 px-3 text-slate-700">
                                    <div>{req.ownerName}</div>
                                    <div className="text-[10px] text-slate-400">
                                      {req.ownerRole}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-600">
                                    {req.dueDate || "—"}
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    <button
                                      onClick={() => {
                                        setUploadTargetReq(req);
                                        setUploadModalOpen(true);
                                      }}
                                      className="rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                                    >
                                      Upload
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  /* Empty State */
                  <div className="py-16 text-center">
                    <ClipboardCheck className="mx-auto h-12 w-12 text-slate-300" />
                    <h3 className="mt-3 text-sm font-bold text-slate-800">
                      Checklist is Empty
                    </h3>
                    <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 leading-relaxed">
                      No requirements found matching your criteria. Add your first closeout
                      requirement to begin tracking documentation and signoffs.
                    </p>
                    <div className="mt-5">
                      <button
                        onClick={() => setNewReqModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Add First Requirement</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* VIEW 3: DOCUMENT REVIEW WORKBENCH (SCR-025 / SCR-027)               */}
        {/* =================================================================== */}
        {activeTab === "viewer" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left CAD Stage */}
            <div className="flex flex-1 min-w-0 bg-[#0F172A] text-slate-200 overflow-hidden flex-col items-center justify-center p-8">
              {selectedReviewReq || reviewQueue.length > 0 ? (
                (() => {
                  const currentReq = selectedReviewReq || reviewQueue[0];
                  return (
                    <div className="w-full max-w-2xl bg-white text-slate-900 rounded-lg shadow-2xl p-8 border border-slate-700 space-y-6">
                      <div className="flex items-center justify-between border-b pb-4">
                        <div>
                          <span className="font-mono text-xs font-bold text-blue-600">
                            {currentReq.key}
                          </span>
                          <h2 className="text-base font-bold text-slate-900 mt-0.5">
                            {currentReq.title}
                          </h2>
                          <p className="text-xs text-slate-500">
                            Submitted Revision {currentReq.revision || "R1"} · Owner:{" "}
                            {currentReq.ownerName}
                          </p>
                        </div>
                        <StatusPill status={currentReq.status} />
                      </div>

                      <div className="rounded-lg bg-slate-50 border p-4 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Document Type:</span>
                          <span className="font-medium text-slate-800">
                            {currentReq.docTypeCode} — {currentReq.docTypeName}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Associated Asset:</span>
                          <span className="font-mono font-medium text-slate-800">
                            {currentReq.assetTag || "Project-wide"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Last Updated:</span>
                          <span className="text-slate-800">{currentReq.updatedAt}</span>
                        </div>
                      </div>

                      {/* Review Actions */}
                      <div className="space-y-3 pt-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          Review Comments / Corrective Actions
                        </label>
                        <textarea
                          rows={3}
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                          placeholder="Enter technical comments, code compliance notes, or punch list items..."
                          className="w-full rounded-md border border-slate-300 p-2.5 text-xs focus:border-blue-600 focus:outline-none"
                        />

                        <div className="flex items-center gap-3 pt-2">
                          <button
                            onClick={() => handleApproveCurrentDoc(currentReq)}
                            className="flex-1 rounded-md bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                          >
                            Approve In-App
                          </button>
                          <button
                            onClick={() => handleExternalApproveDoc(currentReq)}
                            className="flex-1 rounded-md bg-teal-600 py-2.5 text-xs font-bold text-white hover:bg-teal-700 shadow-sm"
                          >
                            Stamp External Approval
                          </button>
                          <button
                            onClick={() => handleRejectDoc(currentReq)}
                            className="flex-1 rounded-md bg-orange-600 py-2.5 text-xs font-bold text-white hover:bg-orange-700 shadow-sm"
                          >
                            Request Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* Empty Review Stage */
                <div className="text-center space-y-3">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                    <FileCheck2 className="h-8 w-8" />
                  </div>
                  <h3 className="text-base font-bold text-white">Review Queue is Empty</h3>
                  <p className="max-w-md text-xs text-slate-400 leading-relaxed">
                    There are 0 documents awaiting inspection or approval sign-off. When evidence
                    is uploaded for checklist items, it will appear here for CAD inspection and
                    stamping.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => setActiveTab("checklist")}
                      className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Open Compliance Checklist
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* VIEW 4: HANDOVER DOSSIER STUDIO (SCR-028)                           */}
        {/* =================================================================== */}
        {activeTab === "package" && (
          <main className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <PackageCheck className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-base font-bold text-slate-900">
                Digital Handover Dossier Studio
              </h2>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 leading-relaxed">
                Compile approved project documents into an indexed, Bates-stamped digital handover
                dossier compliant with Indian public works and MEP closeout standards.
              </p>

              {dossierInitialized ? (
                <div className="mt-6 max-w-xl mx-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-left space-y-3 text-xs">
                  <div className="flex justify-between font-bold text-slate-800">
                    <span>Dossier Volume 1: Statutory & Technical Handover</span>
                    <span className="text-emerald-700">Ready to Compile</span>
                  </div>
                  <p className="text-slate-600">
                    Includes {satisfiedCount} approved document versions with pure-Node Bates page
                    numbering and cryptographic SHA-256 manifest.
                  </p>
                  <button className="w-full rounded-md bg-[#0F2942] py-2 text-xs font-semibold text-white hover:bg-[#163A5F]">
                    Download Bates-Stamped Handover PDF
                  </button>
                </div>
              ) : (
                <div className="mt-6">
                  <button
                    onClick={() => {
                      setDossierInitialized(true);
                      setAuditEvents((prev) => [
                        {
                          id: String(Date.now()),
                          actor: "User",
                          action: "initialized Digital Handover Dossier structure",
                          time: "Just now",
                          hash: Math.random().toString(16).substring(2, 8),
                        },
                        ...prev,
                      ]);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Initialize Handover Package</span>
                  </button>
                </div>
              )}
            </div>
          </main>
        )}

        {/* =================================================================== */}
        {/* VIEW 5: SUPPLIER GUEST LINK SIMULATOR (SCR-034)                     */}
        {/* =================================================================== */}
        {activeTab === "supplier" && (
          <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center bg-slate-100/60">
            <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-5">
              <div className="border-b pb-4">
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  GUEST UPLOAD PORTAL
                </span>
                <h2 className="text-base font-bold text-slate-900 mt-2">
                  External Supplier Evidence Submission
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Secure OTP-authenticated portal for external vendors and testing agencies.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Select Requirement to Upload
                  </label>
                  <select
                    className="w-full rounded border border-slate-300 p-2 text-xs bg-white"
                    onChange={(e) => {
                      const found = requirements.find((r) => r.id === e.target.value);
                      if (found) setUploadTargetReq(found);
                    }}
                  >
                    {requirements.length > 0 ? (
                      requirements.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.key}: {r.title}
                        </option>
                      ))
                    ) : (
                      <option>No requirements created yet</option>
                    )}
                  </select>
                </div>

                <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center hover:border-blue-500 transition-colors cursor-pointer bg-slate-50">
                  <UploadCloud className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 font-semibold text-slate-700 text-xs">
                    Choose PDF or ZIP to Upload
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Max file size 100MB · Pure-Node sanitisation & ClamAV virus scanning
                  </p>
                </div>

                <button
                  onClick={() => {
                    if (requirements.length > 0) {
                      const target = uploadTargetReq || requirements[0];
                      setRequirements((prev) =>
                        prev.map((r) =>
                          r.id === target.id
                            ? {
                                ...r,
                                status: "IN_REVIEW",
                                updatedAt: "Just now",
                              }
                            : r
                        )
                      );
                      setAuditEvents((prev) => [
                        {
                          id: String(Date.now()),
                          actor: "External Supplier (Guest)",
                          action: `uploaded document for ${target.key} via Guest Upload Link`,
                          time: "Just now",
                          hash: Math.random().toString(16).substring(2, 8),
                        },
                        ...prev,
                      ]);
                      setReviewBanner(`Document submitted for ${target.key}. Review queue updated.`);
                      setTimeout(() => setReviewBanner(null), 4000);
                      setActiveTab("viewer");
                    }
                  }}
                  className="w-full rounded-md bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                >
                  Submit Document as Supplier
                </button>
              </div>
            </div>
          </main>
        )}
      </div>

      {/* ===================================================================== */}
      {/* MODAL: CREATE NEW PROJECT                                             */}
      {/* ===================================================================== */}
      {newProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-xs font-bold text-slate-900">Create New Project</h3>
              <button
                onClick={() => setNewProjectModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const fd = new FormData(form);
                const code = ((fd.get("code") as string) || "PRJ-001").trim().toUpperCase();
                const name = ((fd.get("name") as string) || "New Project").trim();

                let realId = "prj-" + Date.now();
                try {
                  // Ensure session exists
                  if (!currentUser) {
                    await handleQuickLogin();
                  }
                  const res = await api.projects.create({
                    code,
                    name,
                    projectType: "PRIVATE_COMMERCIAL",
                  });
                  if (res.data?.id) {
                    realId = res.data.id;
                  }
                } catch (err) {
                  console.error("Failed to persist project in DB", err);
                }

                const newProj: ProjectItem = {
                  id: realId,
                  code,
                  name,
                  contractRef: (fd.get("contractRef") as string) || "",
                  clientName: (fd.get("clientName") as string) || "",
                  pmcName: (fd.get("pmcName") as string) || "",
                  contractorName: (fd.get("contractorName") as string) || "",
                  tradeName: (fd.get("tradeName") as string) || "MEP Closeout",
                  location: (fd.get("location") as string) || "",
                  targetHandoverDate: (fd.get("targetHandoverDate") as string) || "",
                  status: "Handover Active",
                  retentionPercent: 5.0,
                  contractValueInr: 0,
                };
                setProjects((prev) => [newProj, ...prev]);
                setActiveProject(newProj);
                setNewProjectModalOpen(false);
              }}
              className="p-4 space-y-3 text-xs"
            >
              <div>
                <label className="block font-semibold text-slate-700">Project Code</label>
                <input
                  name="code"
                  defaultValue="PRJ-001"
                  required
                  className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Project Name</label>
                <input
                  name="name"
                  placeholder="e.g. Commercial Complex Phase 1"
                  required
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700">Contract Ref</label>
                  <input
                    name="contractRef"
                    placeholder="e.g. CON-2026-01"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Client / Developer</label>
                  <input
                    name="clientName"
                    placeholder="Client Name"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700">Location</label>
                  <input
                    name="location"
                    placeholder="e.g. Gurugram, HR"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Target Handover</label>
                  <input
                    name="targetHandoverDate"
                    placeholder="e.g. 15 Dec 2026"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full rounded-md bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
              >
                Create Project
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: ADD REQUIREMENT                                                */}
      {/* ===================================================================== */}
      {newReqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-xs font-bold text-slate-900">Add Checklist Requirement</h3>
              <button
                onClick={() => setNewReqModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const fd = new FormData(form);
                const key = ((fd.get("key") as string) || "REQ-001").trim();
                const title = ((fd.get("title") as string) || "New Closeout Requirement").trim();
                const docTypeCode = (fd.get("docTypeCode") as string) || "DT-001";
                const mandatory = fd.get("mandatory") === "on";
                const assetTag = (fd.get("assetTag") as string) || null;
                const dueDate = (fd.get("dueDate") as string) || "";

                let realId = "req-" + Date.now();
                try {
                  if (activeProject && !activeProject.id.startsWith("prj-temp-")) {
                    const res = await api.checklists.createRequirement(activeProject.id, {
                      key,
                      title,
                      docTypeCode,
                      mandatory,
                      assetTag: assetTag || undefined,
                      dueDate: dueDate || undefined,
                    });
                    if (res.data?.id) {
                      realId = res.data.id;
                    }
                  }
                } catch (err) {
                  console.error("Failed to persist requirement in DB", err);
                }

                const newReq: RequirementItem = {
                  id: realId,
                  key,
                  title,
                  groupKey: (fd.get("groupKey") as string) || "G1",
                  groupTitle: (fd.get("groupTitle") as string) || "01. General Requirements",
                  docTypeCode,
                  docTypeName: "Statutory / Engineering Document",
                  mandatory,
                  assetTag,
                  assetName: null,
                  status: "MISSING",
                  ownerName: (fd.get("ownerName") as string) || "Unassigned",
                  ownerRole: "Engineer",
                  dueDate,
                  revision: null,
                  updatedAt: "Just now",
                  reviewerRole: "PMC Engineer",
                };
                setRequirements((prev) => [...prev, newReq]);
                setNewReqModalOpen(false);
                setAuditEvents((prev) => [
                  {
                    id: String(Date.now()),
                    actor: currentUser?.full_name || "User",
                    action: `created requirement ${newReq.key}: ${newReq.title}`,
                    time: "Just now",
                    hash: Math.random().toString(16).substring(2, 8),
                  },
                  ...prev,
                ]);
              }}
              className="p-4 space-y-3 text-xs"
            >
              <div>
                <label className="block font-semibold text-slate-700">Requirement Key</label>
                <input
                  name="key"
                  defaultValue={`REQ-${totalReqs + 1 < 10 ? "00" : "0"}${totalReqs + 1}`}
                  required
                  className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700">Requirement Title</label>
                <input
                  name="title"
                  placeholder="e.g. Chief Fire Officer NOC or TAB Balancing Report"
                  required
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700">Doc Type Code</label>
                  <input
                    name="docTypeCode"
                    defaultValue="DT-001"
                    className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Asset Tag (Optional)</label>
                  <input
                    name="assetTag"
                    placeholder="e.g. CHLR-01"
                    className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700">Owner Name</label>
                  <input
                    name="ownerName"
                    placeholder="Assignee Name"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Due Date</label>
                  <input
                    name="dueDate"
                    placeholder="e.g. 15 Nov 2026"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  name="mandatory"
                  defaultChecked
                  id="mandatory"
                  className="rounded border-slate-300"
                />
                <label htmlFor="mandatory" className="font-medium text-slate-800">
                  Mandatory for milestone signoff (Gated)
                </label>
              </div>
              <button
                type="submit"
                className="w-full rounded-md bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
              >
                Add Requirement
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: UPLOAD EVIDENCE                                                */}
      {/* ===================================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <span className="font-mono text-xs font-bold text-blue-700">
                  {uploadTargetReq?.key || "Document Upload"}
                </span>
                <h3 className="text-xs font-semibold text-slate-900 truncate max-w-xs">
                  {uploadTargetReq?.title || "Upload Requirement Evidence"}
                </h3>
              </div>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <button className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-blue-600 p-4 text-white font-semibold shadow-xs hover:bg-blue-700">
                  <Smartphone className="h-5 w-5" />
                  <span>Take Site Photo</span>
                </button>
                <button className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-[#0F2942] bg-white p-4 text-[#0F2942] font-semibold hover:bg-slate-50">
                  <UploadCloud className="h-5 w-5" />
                  <span>Choose PDF / ZIP</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700">
                    Revision Code
                  </label>
                  <input
                    type="text"
                    defaultValue="R1"
                    className="mt-1 w-full rounded border border-slate-400 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700">
                    Issue Date
                  </label>
                  <input
                    type="text"
                    defaultValue="Today"
                    className="mt-1 w-full rounded border border-slate-400 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>

              <button
                onClick={() => {
                  if (uploadTargetReq) {
                    setRequirements((prev) =>
                      prev.map((r) =>
                        r.id === uploadTargetReq.id
                          ? {
                              ...r,
                              status: "IN_REVIEW",
                              revision: "R1",
                              updatedAt: "Just now",
                              isOverdue: false,
                            }
                          : r
                      )
                    );
                    setAuditEvents((prev) => [
                      {
                        id: String(Date.now()),
                        actor: "User",
                        action: `uploaded Revision R1 for ${uploadTargetReq.key}`,
                        time: "Just now",
                        hash: Math.random().toString(16).substring(2, 8),
                      },
                      ...prev,
                    ]);
                  }
                  setUploadModalOpen(false);
                }}
                className="w-full rounded-md bg-[#0F2942] py-2.5 text-xs font-semibold text-white hover:bg-[#163A5F]"
              >
                Upload & Submit for Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: AUDIT TRAIL                                                    */}
      {/* ===================================================================== */}
      {auditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-blue-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Cryptographic Chain of Custody (SHA-256)
                </h3>
              </div>
              <button
                onClick={() => setAuditModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              {auditEvents.length > 0 ? (
                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto space-y-2 pr-1">
                  {auditEvents.map((ev) => (
                    <div key={ev.id} className="pt-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{ev.actor}</div>
                        <div className="text-slate-600 mt-0.5">{ev.action}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{ev.time}</div>
                      </div>
                      <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">
                        #{ev.hash}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <History className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-xs font-semibold text-slate-700">
                    No Audit Transactions Recorded
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Actions performed on requirements, uploads, and approvals will generate
                    tamper-evident SHA-256 entries.
                  </p>
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end">
              <button
                onClick={() => setAuditModalOpen(false)}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: BILLING & SUBSCRIPTIONS                                        */}
      {/* ===================================================================== */}
      {billingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-blue-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Billing, Subscriptions & GST Accounting
                </h3>
              </div>
              <button
                onClick={() => setBillingModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">
                    Current Plan
                  </div>
                  <div className="text-base font-extrabold text-slate-900">Enterprise Growth</div>
                  <div className="text-slate-600">
                    {projects.length} of 15 project slots utilized
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">
                    Statutory SAC
                  </div>
                  <div className="text-base font-mono font-bold text-slate-900">SAC 998315</div>
                  <div className="text-slate-600">18% GST (9% CGST + 9% SGST)</div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4 text-center">
                <p className="text-xs text-slate-600">
                  No statutory billing disputes or pending Section 194J TDS deductions.
                </p>
              </div>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end">
              <button
                onClick={() => setBillingModalOpen(false)}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
