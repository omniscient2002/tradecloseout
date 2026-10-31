"use client";

import React, { useState, useMemo } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  ClipboardCheck,
  Cpu,
  FileText,
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
  XCircle,
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
  MapPin,
  Smartphone,
  Monitor,
  ArrowUpRight,
  RefreshCw,
  FileSpreadsheet,
  Layers,
  History,
  MessageSquare,
  CornerDownRight,
  Phone,
  HelpCircle,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* TYPES & AUTHORITATIVE STATUS SYSTEM (11-UI-UX-SPECIFICATION.md §5.1)       */
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

/* -------------------------------------------------------------------------- */
/* REALISTIC INDIAN COMMERCIAL HVAC DATASET (PRJ-024 SKYVIEW TOWERS)          */
/* -------------------------------------------------------------------------- */

const INITIAL_REQUIREMENTS: RequirementItem[] = [
  {
    id: "req-1",
    key: "REQ-HVAC-001",
    groupKey: "G1",
    groupTitle: "01. Commercial, Contractual & Statutory NOCs",
    title: "Chief Fire Officer Statutory Fire & Smoke Damper NOC",
    docTypeCode: "DT-086",
    docTypeName: "Fire NOC / Certificate",
    mandatory: true,
    assetTag: null,
    assetName: "Project-wide",
    status: "MISSING",
    ownerName: "Anil Pillai",
    ownerRole: "Project Manager",
    dueDate: "27 Oct 2026",
    isOverdue: true,
    revision: null,
    updatedAt: "4d overdue",
    reviewerRole: "Client / PMC",
  },
  {
    id: "req-2",
    key: "REQ-HVAC-002",
    groupKey: "G1",
    groupTitle: "01. Commercial, Contractual & Statutory NOCs",
    title: "Workmen Compensation & CAR Insurance Endorsement Policy",
    docTypeCode: "DT-004",
    docTypeName: "Insurance Certificate",
    mandatory: true,
    assetTag: null,
    assetName: "Project-wide",
    status: "EXPIRED",
    ownerName: "Fatima Shaikh",
    ownerRole: "Document Controller",
    dueDate: "15 Oct 2026",
    isOverdue: true,
    revision: "R1",
    updatedAt: "Expired 16d ago",
    pageCount: 12,
    sha256: "8f4a2e...91c0",
    reviewerRole: "Main Contractor",
  },
  {
    id: "req-3",
    key: "REQ-HVAC-003",
    groupKey: "G1",
    groupTitle: "01. Commercial, Contractual & Statutory NOCs",
    title: "Performance Bank Guarantee (5% Contract Value - HDFC Bank)",
    docTypeCode: "DT-003",
    docTypeName: "Bank Guarantee",
    mandatory: true,
    assetTag: null,
    assetName: "Project-wide",
    status: "APPROVED",
    ownerName: "Anil Pillai",
    ownerRole: "Project Manager",
    dueDate: "01 Sep 2026",
    revision: "R0",
    updatedAt: "12 Sep 2026",
    pageCount: 6,
    sha256: "3c91b4...7e21",
    reviewerRole: "Client Representative",
  },
  {
    id: "req-4",
    key: "REQ-HVAC-011",
    groupKey: "G2",
    groupTitle: "02. As-Built Drawings & Technical Submittals",
    title: "Basement-2 Chiller Plant Room Coordinated As-Built Layout & Sections",
    docTypeCode: "DT-011",
    docTypeName: "As-Built Drawing",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Water-Cooled Chiller #1",
    status: "APPROVED_EXTERNAL",
    ownerName: "Meera Deshmukh",
    ownerRole: "Senior Design Eng",
    dueDate: "20 Oct 2026",
    revision: "R3",
    updatedAt: "25 Oct 2026",
    pageCount: 4,
    sha256: "7a12d9...44b8",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-5",
    key: "REQ-HVAC-012",
    groupKey: "G2",
    groupTitle: "02. As-Built Drawings & Technical Submittals",
    title: "Typical Floor (L1–L18) VAV & Supply Ducting As-Built Redline Set",
    docTypeCode: "DT-011",
    docTypeName: "As-Built Drawing",
    mandatory: true,
    assetTag: "AHU-FL08",
    assetName: "Floor 08 Double-Skin AHU (24,000 CFM)",
    status: "CHANGES_REQUESTED",
    ownerName: "Meera Deshmukh",
    ownerRole: "Senior Design Eng",
    dueDate: "29 Oct 2026",
    isOverdue: true,
    revision: "R2",
    updatedAt: "Yesterday",
    pageCount: 18,
    sha256: "1d55e0...89a2",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-6",
    key: "REQ-HVAC-018",
    groupKey: "G4",
    groupTitle: "04. Procurement, Factory Tests (FAT) & Calibration",
    title: "Centrifugal Chiller Factory Acceptance Test & Run Curve (AHRI 550/590)",
    docTypeCode: "DT-022",
    docTypeName: "Factory Acceptance Test",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Water-Cooled Chiller #1",
    status: "REQUESTED",
    ownerName: "Carrier Aircon India",
    ownerRole: "OEM Supplier",
    isExternalSupplier: true,
    dueDate: "05 Nov 2026",
    revision: null,
    updatedAt: "Link opened 3h ago",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-7",
    key: "REQ-HVAC-019",
    groupKey: "G4",
    groupTitle: "04. Procurement, Factory Tests (FAT) & Calibration",
    title: "NABL Traceable Pressure Gauge & Anemometer Calibration Certificates",
    docTypeCode: "DT-025",
    docTypeName: "Calibration Certificate",
    mandatory: true,
    assetTag: null,
    assetName: "Testing Instruments Batch",
    status: "APPROVED",
    ownerName: "Sunil Rao",
    ownerRole: "QC Lead",
    dueDate: "10 Oct 2026",
    revision: "R0",
    updatedAt: "09 Oct 2026",
    pageCount: 9,
    sha256: "5e82f1...02d4",
    reviewerRole: "QC Lead",
  },
  {
    id: "req-8",
    key: "REQ-HVAC-033",
    groupKey: "G8",
    groupTitle: "08. Installation, Hydrostatic Testing & TAB Commissioning",
    title: "Chilled Water Header & Riser Hydrostatic Pressure Test Report (10.5 Bar)",
    docTypeCode: "DT-033",
    docTypeName: "Pressure Test Report",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Water-Cooled Chiller #1",
    status: "IN_REVIEW",
    ownerName: "Amit Verma",
    ownerRole: "Site Engineer",
    dueDate: "02 Nov 2026",
    revision: "R2",
    updatedAt: "2h ago",
    pageCount: 48,
    sha256: "9f2c8b...31e7",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-9",
    key: "REQ-HVAC-034",
    groupKey: "G8",
    groupTitle: "08. Installation, Hydrostatic Testing & TAB Commissioning",
    title: "Supply & Return GI Ductwork Class-B Air Leakage Test Dossier",
    docTypeCode: "DT-035",
    docTypeName: "Duct Leakage Report",
    mandatory: true,
    assetTag: "AHU-FL08",
    assetName: "Floor 08 Double-Skin AHU (24,000 CFM)",
    status: "IN_REVIEW",
    ownerName: "Amit Verma",
    ownerRole: "Site Engineer",
    dueDate: "03 Nov 2026",
    revision: "R1",
    updatedAt: "5h ago",
    pageCount: 22,
    sha256: "6b09c3...11f5",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-10",
    key: "REQ-HVAC-039",
    groupKey: "G8",
    groupTitle: "08. Installation, Hydrostatic Testing & TAB Commissioning",
    title: "Motorised Fire & Smoke Damper Drop-Test & BMS Actuation Log (42 Units)",
    docTypeCode: "DT-039",
    docTypeName: "Fire Damper Test",
    mandatory: true,
    assetTag: "FD-Z01",
    assetName: "Zone 1-4 Motorized Fire Dampers",
    status: "IN_REVIEW",
    ownerName: "SmartControls India",
    ownerRole: "BMS Subcontractor",
    isExternalSupplier: true,
    dueDate: "04 Nov 2026",
    revision: "R0",
    updatedAt: "1d ago",
    pageCount: 34,
    sha256: "4a77d2...60c8",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-11",
    key: "REQ-HVAC-050",
    groupKey: "G8",
    groupTitle: "08. Installation, Hydrostatic Testing & TAB Commissioning",
    title: "NEBB-Standard Air & Hydronic Testing, Adjusting & Balancing (TAB) Report",
    docTypeCode: "DT-050",
    docTypeName: "TAB Report",
    mandatory: true,
    assetTag: null,
    assetName: "Complete Building Air/Water Loop",
    status: "APPROVED",
    ownerName: "Sunil Rao",
    ownerRole: "QC Lead",
    dueDate: "24 Oct 2026",
    revision: "R1",
    updatedAt: "26 Oct 2026",
    pageCount: 64,
    sha256: "2f18a9...93d1",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-12",
    key: "REQ-HVAC-058",
    groupKey: "G9",
    groupTitle: "09. Handover Documentation, O&M Manuals & Warranties",
    title: "Project-Specific Chiller Plant Operation & Preventive Maintenance Manual",
    docTypeCode: "DT-058",
    docTypeName: "O&M Manual",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Water-Cooled Chiller #1",
    status: "APPROVED",
    ownerName: "Fatima Shaikh",
    ownerRole: "Document Controller",
    dueDate: "25 Oct 2026",
    revision: "R2",
    updatedAt: "28 Oct 2026",
    pageCount: 142,
    sha256: "0c44e8...55b9",
    reviewerRole: "MEP Consultant",
  },
  {
    id: "req-13",
    key: "REQ-HVAC-026",
    groupKey: "G9",
    groupTitle: "09. Handover Documentation, O&M Manuals & Warranties",
    title: "5-Year Compressor & 12-Month Comprehensive OEM Warranty Certificate",
    docTypeCode: "DT-026",
    docTypeName: "Warranty Certificate",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Water-Cooled Chiller #1",
    status: "APPROVED_EXTERNAL",
    ownerName: "Carrier Aircon India",
    ownerRole: "OEM Supplier",
    isExternalSupplier: true,
    dueDate: "28 Oct 2026",
    revision: "R0",
    updatedAt: "29 Oct 2026",
    pageCount: 4,
    sha256: "9b11c7...20a3",
    reviewerRole: "Client Representative",
  },
  {
    id: "req-14",
    key: "REQ-HVAC-052",
    groupKey: "G9",
    groupTitle: "09. Handover Documentation, O&M Manuals & Warranties",
    title: "Third-Party Acoustic & Octave-Band Vibration Isolation Verification",
    docTypeCode: "DT-052",
    docTypeName: "Noise & Vibration Report",
    mandatory: false,
    assetTag: "CT-01",
    assetName: " Paharpur Induced-Draft Cooling Tower",
    status: "WAIVED",
    ownerName: "Sunil Rao",
    ownerRole: "QC Lead",
    dueDate: "20 Oct 2026",
    revision: null,
    updatedAt: "Waived by PMC",
    reviewerRole: "MEP Consultant",
  },
];

/* -------------------------------------------------------------------------- */
/* REUSABLE STATUS PILL COMPONENT                                             */
/* -------------------------------------------------------------------------- */

function StatusPill({ status, compact = false }: { status: ReqStatus; compact?: boolean }) {
  const cfg = STATUS_META[status];
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

  // Interactive Checklist State
  const [requirements, setRequirements] = useState<RequirementItem[]>(INITIAL_REQUIREMENTS);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeDrawerReq, setActiveDrawerReq] = useState<RequirementItem | null>(null);

  // Mobile/Field Upload Sheet State (SCR-023)
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTargetReq, setUploadTargetReq] = useState<RequirementItem | null>(null);

  // PDF Reviewer State (SCR-025 / SCR-027)
  const [decisionMode, setDecisionMode] = useState<"in_app" | "external">("in_app");
  const [reviewComment, setReviewComment] = useState("");
  const [pdfZoom, setPdfZoom] = useState(115);
  const [extApproverName, setExtApproverName] = useState("Vikram Sengupta (Meinhardt PMC)");
  const [extMethod, setExtMethod] = useState("STAMPED_PDF");
  const [extRef, setExtRef] = useState("TRN-MEIN-HVAC-2026-089");
  const [reviewBanner, setReviewBanner] = useState<string | null>(null);

  // Supplier Portal State (SCR-034)
  const [supplierViewport, setSupplierViewport] = useState<"desktop" | "mobile">("desktop");
  const [supplierUploaded, setSupplierUploaded] = useState(false);

  // Filtered requirements
  const filteredReqs = useMemo(() => {
    return requirements.filter((r) => {
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
  }, [requirements, statusFilter, searchQuery]);

  // Grouped requirements for SCR-014
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

  const handleApproveCurrentDoc = () => {
    setRequirements((prev) =>
      prev.map((r) =>
        r.key === "REQ-HVAC-033"
          ? {
              ...r,
              status: decisionMode === "external" ? "APPROVED_EXTERNAL" : "APPROVED",
              updatedAt: "Just now",
            }
          : r
      )
    );
    setReviewBanner(
      decisionMode === "external"
        ? "External approval recorded (Method: Stamped PDF · Ref: TRN-MEIN-HVAC-2026-089). Requirement REQ-HVAC-033 is now satisfied."
        : "Document Version R2 approved in-app. Requirement REQ-HVAC-033 is now satisfied."
    );
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-blue-600 selection:text-white font-sans">
      {/* ===================================================================== */}
      {/* 1. LEFT ENTERPRISE NAVIGATION RAIL (11-UI-UX-SPECIFICATION.md §2.1)   */}
      {/* ===================================================================== */}
      <aside
        className={`${
          sidebarCollapsed ? "w-16" : "w-60"
        } flex flex-col justify-between border-r border-slate-800 bg-[#0B1120] text-slate-300 transition-all duration-200 shrink-0 select-none z-30`}
      >
        <div>
          {/* Brand Header */}
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
                    <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300 border border-blue-400/20">
                      INDIA
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">Apex MEP Contractors</p>
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
                badge: "77",
              },
              {
                id: "viewer",
                label: "Review Workbench",
                icon: Eye,
                badge: "4",
                badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
              },
              {
                id: "package",
                label: "Handover Dossier",
                icon: PackageCheck,
                badge: "v2",
              },
              {
                id: "supplier",
                label: "Supplier Link Portal",
                icon: ExternalLink,
                badge: "Guest",
                badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
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

          {/* Directory & Governance Nav */}
          <div className="px-2.5 py-2 border-t border-slate-800/80 space-y-0.5">
            {!sidebarCollapsed && (
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Registers & Governance
              </div>
            )}
            {[
              { label: "Equipment Register (42)", icon: Cpu, action: () => setActiveTab("checklist") },
              { label: "Supplier & Party Directory", icon: Building2, action: () => setActiveTab("supplier") },
              { label: "HVAC Template Packs", icon: Layers, action: () => setActiveTab("checklist") },
              { label: "Immutable Audit Trail", icon: ShieldCheck, action: () => setActiveTab("overview") },
              { label: "Billing, GST & TDS", icon: CreditCard, action: () => setActiveTab("overview") },
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
        </div>

        {/* Bottom Storage & India Region Status */}
        <div className="border-t border-slate-800 p-3">
          {!sidebarCollapsed ? (
            <div className="rounded-lg bg-slate-900/90 p-2.5 border border-slate-800">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-300">Growth Plan · INR</span>
                <span className="text-emerald-400 font-mono text-[10px]">● ap-south-1</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full w-[38%] bg-blue-500 rounded-full" />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-400 font-mono">
                <span>38.4 GB / 100 GB</span>
                <span>11 / 15 Projects</span>
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
          {/* Left: Breadcrumbs & Active Project Switcher */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Projects</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-900">
              <span className="font-mono text-[11px] font-semibold text-blue-700">
                PRJ-024
              </span>
              <span className="text-slate-300">|</span>
              <span>Skyview Commercial Towers (Package A - HVAC)</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              Handover Active
            </span>
          </div>

          {/* Right: Global Search (Cmd+K), Primary Upload Action, Profile */}
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
                placeholder="Search tag (CHLR-01), doc, requirement..."
                className="h-8 w-64 rounded-md border border-slate-300 bg-slate-50/70 pl-8 pr-12 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
              <kbd className="pointer-events-none absolute right-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ⌘K
              </kbd>
            </div>

            <button
              onClick={() => {
                setUploadTargetReq(requirements[0]);
                setUploadModalOpen(true);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0F2942] px-3 text-xs font-medium text-white shadow-sm hover:bg-[#163A5F] transition-colors"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>Upload Evidence</span>
            </button>

            <button className="relative rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">
                3
              </span>
            </button>

            <div className="h-5 w-[1px] bg-slate-200" />

            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                AP
              </div>
              <div className="hidden lg:block leading-tight">
                <div className="text-xs font-semibold text-slate-900">Anil Pillai</div>
                <div className="text-[10px] text-slate-500">Projects Head</div>
              </div>
            </div>
          </div>
        </header>

        {/* SECONDARY WORKSPACE TAB BAR */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <nav className="flex items-center gap-6 -mb-px">
            {[
              { id: "overview", label: "Project Overview", icon: LayoutDashboard },
              {
                id: "checklist",
                label: "Compliance Checklist",
                icon: ClipboardCheck,
                count: requirements.length,
              },
              {
                id: "viewer",
                label: "Document Review Workbench",
                icon: Eye,
                count: requirements.filter((r) => r.status === "IN_REVIEW").length,
                alert: true,
              },
              { id: "package", label: "Handover Dossier & Submissions", icon: PackageCheck },
              { id: "supplier", label: "Supplier Portal View", icon: ExternalLink },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as typeof activeTab)}
                  className={`flex items-center gap-2 border-b-2 py-2.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-[#0F2942] text-[#0F2942] font-semibold"
                      : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                  {t.count !== undefined && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-semibold ${
                        t.alert
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="hidden xl:flex items-center gap-4 text-[11px] text-slate-500">
            <span>
              Snapshot: <strong className="font-mono text-slate-700">v2 (Locked)</strong>
            </span>
            <span>·</span>
            <span>
              Client: <strong className="text-slate-700">DLF CyberCity Developers</strong>
            </span>
            <span>·</span>
            <span>
              PMC: <strong className="text-slate-700">Meinhardt Singapore</strong>
            </span>
          </div>
        </div>

        {/* =================================================================== */}
        {/* VIEW 1: PROJECT OVERVIEW (SCR-013) - FULL DENSITY BENTO GRID        */}
        {/* =================================================================== */}
        {activeTab === "overview" && (
          <main className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Hero Readiness & Contract Header Card */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800 border border-slate-300">
                      PRJ-024
                    </span>
                    <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                      Skyview Commercial Towers — Package A (HVAC High-Side & Low-Side)
                    </h1>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Contract Ref:{" "}
                    <span className="font-mono font-medium text-slate-800">
                      DLF/CYB/MEP/2025-08
                    </span>{" "}
                    · Main Contractor:{" "}
                    <span className="font-medium text-slate-800">L&T Construction</span> ·
                    Location: <span className="font-medium text-slate-800">Gurugram, HR</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50/80 px-3 py-1.5 text-xs font-medium text-amber-900">
                    <Clock className="h-3.5 w-3.5 text-amber-700" />
                    <span>Target Handover: </span>
                    <strong className="font-mono">18 Nov 2026 (17 days)</strong>
                  </div>
                  <button
                    onClick={() => setActiveTab("package")}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#163A5F] transition-colors"
                  >
                    <PackageCheck className="h-3.5 w-3.5" />
                    <span>Assemble Handover Dossier</span>
                  </button>
                </div>
              </div>

              {/* Interactive Multi-Segment Readiness Bar */}
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
                    71 / 77 Applicable Satisfied{" "}
                    <span className="text-emerald-700">(92.2%)</span>
                  </div>
                </div>

                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 gap-0.5 border border-slate-200">
                  <button
                    onClick={() => {
                      setStatusFilter("APPROVED");
                      setActiveTab("checklist");
                    }}
                    style={{ width: "74%" }}
                    className="h-full bg-emerald-600 hover:opacity-90 transition-opacity rounded-l-full"
                    title="Approved In-App: 57"
                  />
                  <button
                    onClick={() => {
                      setStatusFilter("APPROVED_EXTERNAL");
                      setActiveTab("checklist");
                    }}
                    style={{ width: "11.7%" }}
                    className="h-full bg-teal-600 hover:opacity-90 transition-opacity"
                    title="Approved External (Stamped): 9"
                  />
                  <button
                    onClick={() => {
                      setStatusFilter("WAIVED");
                      setActiveTab("checklist");
                    }}
                    style={{ width: "6.5%" }}
                    className="h-full bg-purple-600 hover:opacity-90 transition-opacity"
                    title="Waived with Approval: 5"
                  />
                  <button
                    onClick={() => {
                      setStatusFilter("IN_REVIEW");
                      setActiveTab("checklist");
                    }}
                    style={{ width: "5.2%" }}
                    className="h-full bg-amber-500 hover:opacity-90 transition-opacity"
                    title="Waiting for Review: 4"
                  />
                  <button
                    onClick={() => {
                      setStatusFilter("MISSING_EXPIRED");
                      setActiveTab("checklist");
                    }}
                    style={{ width: "2.6%" }}
                    className="h-full bg-red-600 hover:opacity-90 transition-opacity rounded-r-full"
                    title="Missing / Expired Blockers: 2"
                  />
                </div>

                {/* Segment Legend */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div className="flex flex-wrap items-center gap-5">
                    <button
                      onClick={() => {
                        setStatusFilter("APPROVED");
                        setActiveTab("checklist");
                      }}
                      className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900"
                    >
                      <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                      <span>Approved In-App</span>
                      <strong className="font-mono text-slate-900">57</strong>
                    </button>
                    <button
                      onClick={() => {
                        setStatusFilter("APPROVED_EXTERNAL");
                        setActiveTab("checklist");
                      }}
                      className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900"
                    >
                      <span className="h-2.5 w-2.5 rounded-xs bg-teal-600" />
                      <span>Approved (External Stamp)</span>
                      <strong className="font-mono text-slate-900">9</strong>
                    </button>
                    <button
                      onClick={() => {
                        setStatusFilter("WAIVED");
                        setActiveTab("checklist");
                      }}
                      className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900"
                    >
                      <span className="h-2.5 w-2.5 rounded-xs bg-purple-600" />
                      <span>Waived</span>
                      <strong className="font-mono text-slate-900">5</strong>
                    </button>
                    <button
                      onClick={() => {
                        setStatusFilter("IN_REVIEW");
                        setActiveTab("checklist");
                      }}
                      className="flex items-center gap-1.5 text-amber-800 font-medium hover:underline"
                    >
                      <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" />
                      <span>Waiting for Review</span>
                      <strong className="font-mono">4</strong>
                    </button>
                    <button
                      onClick={() => {
                        setStatusFilter("MISSING_EXPIRED");
                        setActiveTab("checklist");
                      }}
                      className="flex items-center gap-1.5 text-red-700 font-semibold hover:underline"
                    >
                      <span className="h-2.5 w-2.5 rounded-xs bg-red-600" />
                      <span>Blocking / Expired</span>
                      <strong className="font-mono">2</strong>
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-500 font-mono">
                    Last snapshot verification: Today, 00:42 IST
                  </span>
                </div>
              </div>
            </div>

            {/* 4 Executive KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Retention Money Gated</span>
                  <CreditCard className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    ₹75,00,000
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                    5.0% of ₹15.0 Cr
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  2 mandatory blockers remaining before final bill release.
                </p>
              </div>

              <div
                onClick={() => setActiveTab("viewer")}
                className="cursor-pointer rounded-lg border border-amber-300 bg-white p-4 shadow-xs hover:border-amber-400 transition-colors"
              >
                <div className="flex items-center justify-between text-xs font-medium text-amber-900">
                  <span>Actionable Review Queue</span>
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-amber-800">
                    4 Pending
                  </span>
                  <span className="text-xs font-medium text-emerald-700">
                    Avg SLA: 3.2 hrs
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-600 flex items-center justify-between">
                  <span>Includes Chiller Hydrostatic Test (R2)</span>
                  <span className="font-semibold text-blue-700">Inspect →</span>
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Installed Asset Coverage</span>
                  <Cpu className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    39 / 42
                  </span>
                  <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-800">
                    92.8% Tagged
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  3 Assets awaiting OEM FAT or redline drawing sign-off.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>DLP & Warranty Horizon</span>
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                    12 Months
                  </span>
                  <span className="text-xs text-slate-500 font-medium">Basis: Handover</span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  0 warranty basis conflicts · 2 open minor snags.
                </p>
              </div>
            </div>

            {/* Two-Column Operational Split: Blockers (Left) & Asset Matrix + Activity (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 7 Columns: Needs Immediate Attention (Blockers & Overdue) */}
              <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white shadow-xs flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                      Readiness Blockers & Supplier Chasers (4)
                    </h2>
                  </div>
                  <button
                    onClick={() => setActiveTab("checklist")}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Open Full Checklist →
                  </button>
                </div>

                <div className="divide-y divide-slate-200">
                  {requirements
                    .filter((r) =>
                      ["MISSING", "EXPIRED", "CHANGES_REQUESTED", "REQUESTED"].includes(
                        r.status
                      )
                    )
                    .map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-slate-700">
                              {item.key}
                            </span>
                            {item.mandatory && (
                              <span className="rounded bg-red-50 border border-red-200 px-1.5 py-0.2 text-[10px] font-semibold text-red-700">
                                Mandatory
                              </span>
                            )}
                            <span className="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-600">
                              {item.docTypeCode}
                            </span>
                            {item.assetTag && (
                              <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 font-mono text-[10px] font-medium text-blue-800">
                                {item.assetTag}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium text-slate-900 truncate">
                            {item.title}
                          </p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500">
                            <span>
                              Owner: <strong className="text-slate-700">{item.ownerName}</strong>
                            </span>
                            <span>·</span>
                            <span
                              className={
                                item.isOverdue
                                  ? "text-red-700 font-semibold font-mono"
                                  : "font-mono"
                              }
                            >
                              Due: {item.dueDate}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <StatusPill status={item.status} compact />
                          {item.isExternalSupplier ? (
                            <button
                              onClick={() => setActiveTab("supplier")}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Send className="h-3 w-3 text-emerald-600" />
                              <span>WhatsApp Link</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setUploadTargetReq(item);
                                setUploadModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-[#0F2942] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#163A5F]"
                            >
                              <UploadCloud className="h-3 w-3" />
                              <span>Upload</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Right 5 Columns: Equipment Coverage Matrix & Immutable Audit Log */}
              <div className="lg:col-span-5 space-y-5">
                {/* Equipment Matrix */}
                <div className="rounded-lg border border-slate-200 bg-white shadow-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                      Equipment Category Readiness (42 Assets)
                    </h2>
                    <span className="font-mono text-[11px] text-slate-500">
                      Asset-Scoped Docs
                    </span>
                  </div>
                  <div className="p-4 space-y-3">
                    {[
                      {
                        cat: "Water-Cooled Centrifugal Chillers (CHLR-01..03)",
                        done: 17,
                        total: 18,
                        pct: 94,
                      },
                      {
                        cat: "Double-Skin Floor AHUs (AHU-FL01..14)",
                        done: 40,
                        total: 42,
                        pct: 95,
                      },
                      {
                        cat: "Primary & Secondary Hydronic Pumps (PMP-01..08)",
                        done: 24,
                        total: 24,
                        pct: 100,
                      },
                      {
                        cat: "Motorised Fire & Smoke Dampers (FD-Z01..17)",
                        done: 16,
                        total: 17,
                        pct: 94,
                      },
                    ].map((row, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-slate-800">{row.cat}</span>
                          <span className="font-mono text-slate-600">
                            {row.done}/{row.total} ({row.pct}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${row.pct}%` }}
                            className={`h-full rounded-full ${
                              row.pct === 100 ? "bg-emerald-600" : "bg-blue-600"
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Cryptographic Audit Stream */}
                <div className="rounded-lg border border-slate-200 bg-white shadow-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5 text-slate-500" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                        Recent Audit Trail (Hash-Chained)
                      </h2>
                    </div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      SHA-256 Verified
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 px-4 py-2 text-xs">
                    {[
                      {
                        actor: "Amit Verma (Site Eng)",
                        action: "uploaded Revision R2 for REQ-HVAC-033 (CHLR-01 Pressure Test)",
                        time: "2h ago",
                        hash: "9f2c8b",
                      },
                      {
                        actor: "Vikram Sengupta (Meinhardt PMC)",
                        action: "stamped External Approval on REQ-HVAC-011 (As-Built Layout)",
                        time: "Yesterday",
                        hash: "7a12d9",
                      },
                      {
                        actor: "Carrier Aircon India (Guest)",
                        action: "authenticated via OTP on Supplier Upload Link",
                        time: "Yesterday",
                        hash: "4e01c2",
                      },
                    ].map((ev, i) => (
                      <div key={i} className="py-2 flex items-start justify-between gap-2">
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
                </div>
              </div>
            </div>
          </main>
        )}

        {/* =================================================================== */}
        {/* VIEW 2: COMPLIANCE CHECKLIST GRID (SCR-014) + SLIDE-OVER (SCR-015)  */}
        {/* =================================================================== */}
        {activeTab === "checklist" && (
          <div className="flex flex-1 min-h-0 overflow-hidden relative">
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden p-5">
              {/* Filter & Facet Command Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "ALL", label: "All Items", count: requirements.length },
                    {
                      id: "MISSING_EXPIRED",
                      label: "Missing / Expired",
                      count: requirements.filter(
                        (r) => r.status === "MISSING" || r.status === "EXPIRED"
                      ).length,
                      danger: true,
                    },
                    {
                      id: "IN_REVIEW",
                      label: "Waiting for Review",
                      count: requirements.filter((r) => r.status === "IN_REVIEW").length,
                    },
                    {
                      id: "CHANGES_REQUESTED",
                      label: "Changes Requested",
                      count: requirements.filter((r) => r.status === "CHANGES_REQUESTED")
                        .length,
                    },
                    {
                      id: "APPROVED_ALL",
                      label: "Approved (All)",
                      count: requirements.filter(
                        (r) =>
                          r.status === "APPROVED" || r.status === "APPROVED_EXTERNAL"
                      ).length,
                    },
                    {
                      id: "WAIVED",
                      label: "Waived",
                      count: requirements.filter((r) => r.status === "WAIVED").length,
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
                              : "bg-white text-slate-700 border border-slate-200"
                          }`}
                        >
                          {pill.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter by key, asset tag (CHLR-01), owner..."
                      className="h-7 w-64 rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <button className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
                    <span>Export Register</span>
                  </button>
                </div>
              </div>

              {/* High-Density Data Grid */}
              <div className="flex-1 overflow-y-auto border-x border-b border-slate-200 bg-white rounded-b-lg shadow-xs">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="w-9 py-2.5 pl-4">
                        <input
                          type="checkbox"
                          checked={
                            selectedIds.length > 0 &&
                            selectedIds.length === filteredReqs.length
                          }
                          onChange={(e) =>
                            setSelectedIds(
                              e.target.checked ? filteredReqs.map((r) => r.id) : []
                            )
                          }
                          className="rounded border-slate-300"
                        />
                      </th>
                      <th className="py-2.5 px-3">Requirement Key & Deliverable</th>
                      <th className="py-2.5 px-3 w-36">Equipment Scope</th>
                      <th className="py-2.5 px-3 w-44">Status</th>
                      <th className="py-2.5 px-3 w-44">Owner / Assignee</th>
                      <th className="py-2.5 px-3 w-28">Revision</th>
                      <th className="py-2.5 px-3 w-32">Due Date</th>
                      <th className="py-2.5 pr-4 text-right w-36">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {groupedReqs.map(([groupKey, group]) => {
                      const isCollapsed = collapsedGroups[groupKey];
                      const approvedCount = group.items.filter(
                        (i) =>
                          i.status === "APPROVED" ||
                          i.status === "APPROVED_EXTERNAL" ||
                          i.status === "WAIVED"
                      ).length;

                      return (
                        <React.Fragment key={groupKey}>
                          {/* Group Accordion Header */}
                          <tr
                            onClick={() =>
                              setCollapsedGroups((p) => ({
                                ...p,
                                [groupKey]: !p[groupKey],
                              }))
                            }
                            className="cursor-pointer bg-slate-50/90 hover:bg-slate-100/80 transition-colors select-none"
                          >
                            <td colSpan={8} className="py-2 px-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 font-semibold text-slate-800">
                                  {isCollapsed ? (
                                    <ChevronRight className="h-4 w-4 text-slate-500" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-slate-500" />
                                  )}
                                  <span>{group.title}</span>
                                </div>
                                <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                                  {approvedCount} / {group.items.length} Satisfied
                                </span>
                              </div>
                            </td>
                          </tr>

                          {/* Requirement Rows */}
                          {!isCollapsed &&
                            group.items.map((req) => {
                              const isSelected = selectedIds.includes(req.id);
                              const isDrawerActive = activeDrawerReq?.id === req.id;
                              return (
                                <tr
                                  key={req.id}
                                  onClick={() => setActiveDrawerReq(req)}
                                  className={`cursor-pointer transition-colors ${
                                    isSelected || isDrawerActive
                                      ? "bg-blue-50/70"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <td
                                    className="py-2.5 pl-4"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleSelectRow(req.id)}
                                      className="rounded border-slate-300"
                                    />
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[11px] font-semibold text-slate-700">
                                        {req.key}
                                      </span>
                                      {req.mandatory && (
                                        <span className="rounded bg-red-50 border border-red-200 px-1 py-0.2 text-[9px] font-bold uppercase text-red-700">
                                          Req
                                        </span>
                                      )}
                                      <span className="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-600">
                                        {req.docTypeCode}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 font-medium text-slate-900">
                                      {req.title}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {req.assetTag ? (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-300 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                                        <Cpu className="h-3 w-3 text-blue-600" />
                                        {req.assetTag}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-500">
                                        Project-wide
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <StatusPill status={req.status} compact />
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                                          req.isExternalSupplier
                                            ? "bg-amber-100 text-amber-900 border border-amber-300"
                                            : "bg-slate-200 text-slate-800"
                                        }`}
                                      >
                                        {req.ownerName
                                          .split(" ")
                                          .map((n) => n[0])
                                          .join("")
                                          .slice(0, 2)}
                                      </div>
                                      <div className="truncate">
                                        <div className="font-medium text-slate-800 truncate">
                                          {req.ownerName}
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                          {req.ownerRole}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono">
                                    {req.revision ? (
                                      <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800">
                                        {req.revision}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-[11px]">
                                    <div
                                      className={
                                        req.isOverdue
                                          ? "text-red-700 font-semibold"
                                          : "text-slate-700"
                                      }
                                    >
                                      {req.dueDate}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-sans">
                                      {req.updatedAt}
                                    </div>
                                  </td>
                                  <td
                                    className="py-2.5 pr-4 text-right"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {req.status === "IN_REVIEW" ? (
                                      <button
                                        onClick={() => setActiveTab("viewer")}
                                        className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                      >
                                        <Eye className="h-3 w-3" />
                                        <span>Review {req.revision}</span>
                                      </button>
                                    ) : req.status === "APPROVED" ||
                                      req.status === "APPROVED_EXTERNAL" ? (
                                      <button
                                        onClick={() => setActiveTab("viewer")}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                      >
                                        <FileText className="h-3 w-3 text-slate-500" />
                                        <span>Inspect {req.revision}</span>
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setUploadTargetReq(req);
                                          setUploadModalOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md bg-[#0F2942] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#163A5F]"
                                      >
                                        <UploadCloud className="h-3 w-3" />
                                        <span>Upload</span>
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Floating Dark-Glass Bulk Action Dock */}
              {selectedIds.length > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-xl bg-slate-900/95 px-4 py-2.5 text-xs text-white shadow-2xl border border-slate-700 backdrop-blur-md">
                  <span className="font-mono font-semibold text-blue-400">
                    {selectedIds.length} selected
                  </span>
                  <div className="h-4 w-[1px] bg-slate-700" />
                  <button className="hover:text-blue-300 font-medium">Reassign Owner</button>
                  <button
                    onClick={() => setActiveTab("supplier")}
                    className="hover:text-emerald-300 font-medium"
                  >
                    Generate Supplier Link
                  </button>
                  <button className="hover:text-purple-300 font-medium">
                    Request Waiver (2-Step)
                  </button>
                  <button
                    onClick={() => setSelectedIds([])}
                    className="ml-2 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* =============================================================== */}
            {/* SLIDE-OVER REQUIREMENT DETAIL DRAWER (SCR-015)                  */}
            {/* =============================================================== */}
            {activeDrawerReq && (
              <div className="w-96 shrink-0 border-l border-slate-200 bg-white flex flex-col justify-between overflow-y-auto shadow-xl z-20">
                <div className="p-4 space-y-4">
                  <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">
                          {activeDrawerReq.key}
                        </span>
                        <StatusPill status={activeDrawerReq.status} compact />
                      </div>
                      <h3 className="mt-1.5 text-sm font-semibold text-slate-900">
                        {activeDrawerReq.title}
                      </h3>
                    </div>
                    <button
                      onClick={() => setActiveDrawerReq(null)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs">
                    <div>
                      <div className="text-[10px] uppercase text-slate-400 font-semibold">
                        Document Type
                      </div>
                      <div className="mt-0.5 font-medium text-slate-800">
                        {activeDrawerReq.docTypeCode} · {activeDrawerReq.docTypeName}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400 font-semibold">
                        Asset Link
                      </div>
                      <div className="mt-0.5 font-mono font-semibold text-slate-800">
                        {activeDrawerReq.assetTag || "Project-wide"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400 font-semibold">
                        Required Reviewer
                      </div>
                      <div className="mt-0.5 font-medium text-slate-800">
                        {activeDrawerReq.reviewerRole}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-400 font-semibold">
                        Due Date
                      </div>
                      <div className="mt-0.5 font-mono font-medium text-slate-800">
                        {activeDrawerReq.dueDate}
                      </div>
                    </div>
                  </div>

                  {/* Naming Convention Hint */}
                  <div className="rounded-md border border-slate-200 p-2.5 text-[11px]">
                    <div className="font-semibold text-slate-700">
                      Enforced Naming Pattern:
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-blue-800 bg-blue-50/60 px-2 py-1 rounded break-all">
                      PRJ-024-HVAC-{activeDrawerReq.docTypeCode}-
                      {activeDrawerReq.assetTag || "GEN"}-{activeDrawerReq.revision || "R0"}
                      -20261031.pdf
                    </div>
                  </div>

                  {/* Version & Review Lineage */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      Evidence & Revision Lineage
                    </h4>
                    {activeDrawerReq.revision ? (
                      <div className="space-y-2">
                        <div className="rounded-md border border-slate-200 p-2.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-slate-900">
                              Version {activeDrawerReq.revision} (Current)
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {activeDrawerReq.pageCount || 12} pp · PDF
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600">
                            Uploaded by {activeDrawerReq.ownerName} ·{" "}
                            {activeDrawerReq.updatedAt}
                          </div>
                          <div className="mt-1.5 font-mono text-[10px] text-slate-400">
                            SHA-256: {activeDrawerReq.sha256 || "9f2c8b...31e7"}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                        No evidence version uploaded yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Drawer Footer Actions */}
                <div className="border-t border-slate-200 p-4 bg-slate-50 flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setUploadTargetReq(activeDrawerReq);
                        setUploadModalOpen(true);
                      }}
                      className="flex items-center justify-center gap-1.5 rounded-md bg-[#0F2942] py-2 text-xs font-medium text-white hover:bg-[#163A5F]"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      <span>Upload Revision</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("viewer")}
                      className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Open Viewer</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* VIEW 3: SPLIT-PANE PDF INSPECTION WORKBENCH (SCR-025 & SCR-027)     */}
        {/* =================================================================== */}
        {activeTab === "viewer" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* LEFT PANE: Thumbnail Rail + Dark CAD/PDF Stage */}
            <div className="flex flex-1 min-w-0 bg-[#0F172A] text-slate-200 overflow-hidden">
              {/* Thumbnail Strip */}
              <div className="w-24 shrink-0 border-r border-slate-800 bg-[#0B1120] p-2.5 overflow-y-auto space-y-2.5 select-none hidden sm:block">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
                  48 Pages
                </div>
                {[1, 2, 11, 12, 13, 14].map((pg) => (
                  <div
                    key={pg}
                    className={`cursor-pointer rounded border p-1 transition-all ${
                      pg === 12
                        ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500"
                        : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                    }`}
                  >
                    <div className="aspect-[1/1.35] w-full rounded-xs bg-white p-1.5 text-[5px] text-slate-400 flex flex-col justify-between">
                      <div className="h-1 w-2/3 bg-slate-300" />
                      <div className="space-y-0.5">
                        <div className="h-0.5 w-full bg-slate-200" />
                        <div className="h-0.5 w-4/5 bg-slate-200" />
                      </div>
                      {pg === 12 && (
                        <div className="self-end h-2 w-2 rounded-full bg-orange-500" />
                      )}
                    </div>
                    <div className="mt-1 text-center font-mono text-[10px] text-slate-400">
                      p. {pg}
                    </div>
                  </div>
                ))}
              </div>

              {/* Center Dark Inspection Canvas */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Floating Viewer HUD Toolbar */}
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-500/20 border border-blue-400/30 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-300">
                      REQ-HVAC-033
                    </span>
                    <span className="font-medium text-white truncate max-w-md">
                      PRJ-024-HVAC-DT033-CHLR-01-R2-20261031.pdf
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px]">
                      <span>Page 12 / 48</span>
                    </div>
                    <div className="flex items-center rounded-md border border-slate-700 bg-slate-800">
                      <button
                        onClick={() => setPdfZoom((z) => Math.max(80, z - 15))}
                        className="px-2 py-1 hover:bg-slate-700"
                      >
                        <ZoomOut className="h-3.5 w-3.5" />
                      </button>
                      <span className="px-2 font-mono text-[11px]">{pdfZoom}%</span>
                      <button
                        onClick={() => setPdfZoom((z) => Math.min(160, z + 15))}
                        className="px-2 py-1 hover:bg-slate-700"
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button className="inline-flex items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/10 px-2.5 py-1 text-xs font-medium text-orange-300 hover:bg-orange-500/20">
                      <MapPin className="h-3.5 w-3.5 text-orange-400" />
                      <span>Drop Page Pin</span>
                    </button>
                    <button className="rounded-md border border-slate-700 bg-slate-800 p-1.5 hover:bg-slate-700">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Realistic Engineering PDF Sheet Stage */}
                <div className="flex-1 overflow-auto p-6 flex justify-center items-start">
                  <div
                    style={{ width: `${(pdfZoom / 100) * 680}px` }}
                    className="relative rounded-xs bg-white text-slate-900 shadow-2xl border border-slate-400 p-8 transition-all"
                  >
                    {/* Engineering Title Block Header */}
                    <div className="flex items-start justify-between border-2 border-slate-900 p-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          CARRIER AIR CONDITIONING & REFRIGERATION LTD · QUALITY ASSURANCE
                        </div>
                        <h2 className="mt-1 text-base font-bold tracking-tight text-slate-900">
                          HYDROSTATIC PIPING & SHELL PRESSURE TEST CERTIFICATE
                        </h2>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-600">
                          Standard: ASME B31.5 / ISHRAE HVAC Code · Cert No:
                          CARR-2026-CHLR-4401
                        </div>
                      </div>
                      <div className="text-right font-mono text-[10px] border-l border-slate-300 pl-3">
                        <div>PROJECT: SKYVIEW TOWERS</div>
                        <div>TAG: CHLR-01 (650 TR)</div>
                        <div>REV: R2 · 31 OCT 2026</div>
                      </div>
                    </div>

                    {/* Equipment & Test Instrument Metadata Table */}
                    <div className="mt-4 grid grid-cols-4 border border-slate-800 text-[11px]">
                      <div className="border-b border-r border-slate-300 bg-slate-100 p-2 font-semibold">
                        Equipment Tag
                      </div>
                      <div className="border-b border-r border-slate-300 p-2 font-mono font-bold">
                        CHLR-01 (Basement-2)
                      </div>
                      <div className="border-b border-r border-slate-300 bg-slate-100 p-2 font-semibold">
                        Serial Number
                      </div>
                      <div className="border-b border-slate-300 p-2 font-mono">
                        19XR-2026-88412IN
                      </div>

                      <div className="border-b border-r border-slate-300 bg-slate-100 p-2 font-semibold">
                        Working Pressure
                      </div>
                      <div className="border-b border-r border-slate-300 p-2 font-mono">
                        6.8 Bar (g)
                      </div>
                      <div className="border-b border-r border-slate-300 bg-slate-100 p-2 font-semibold">
                        Hydro Test Pressure
                      </div>
                      <div className="border-b border-slate-300 p-2 font-mono font-bold text-blue-800">
                        10.5 Bar (g) (1.5x)
                      </div>

                      <div className="border-r border-slate-300 bg-slate-100 p-2 font-semibold">
                        Master Gauge ID
                      </div>
                      <div className="border-r border-slate-300 p-2 font-mono">
                        PG-NABL-409 (WIKA)
                      </div>
                      <div className="border-r border-slate-300 bg-slate-100 p-2 font-semibold">
                        Calibration Valid Till
                      </div>
                      <div className="p-2 font-mono text-emerald-700 font-semibold">
                        14 Aug 2027 (NABL)
                      </div>
                    </div>

                    {/* Hourly Pressure Hold Log Table */}
                    <div className="mt-5">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1.5">
                        4.0-Hour Continuous Hydrostatic Hold Log
                      </div>
                      <table className="w-full border border-slate-800 text-[11px] font-mono">
                        <thead className="bg-slate-100 border-b border-slate-800">
                          <tr>
                            <th className="p-1.5 border-r border-slate-300 text-left">
                              Time (IST)
                            </th>
                            <th className="p-1.5 border-r border-slate-300 text-left">
                              Gauge #1 (Supply)
                            </th>
                            <th className="p-1.5 border-r border-slate-300 text-left">
                              Gauge #2 (Return)
                            </th>
                            <th className="p-1.5 border-r border-slate-300 text-left">
                              Water Temp
                            </th>
                            <th className="p-1.5 text-left">Weld / Flange Inspection</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          <tr>
                            <td className="p-1.5 border-r border-slate-300">10:00 hrs</td>
                            <td className="p-1.5 border-r border-slate-300">10.52 Bar</td>
                            <td className="p-1.5 border-r border-slate-300">10.50 Bar</td>
                            <td className="p-1.5 border-r border-slate-300">26.4 °C</td>
                            <td className="p-1.5 text-emerald-700 font-semibold">
                              Zero Weeping / Dry
                            </td>
                          </tr>
                          <tr>
                            <td className="p-1.5 border-r border-slate-300">12:00 hrs</td>
                            <td className="p-1.5 border-r border-slate-300">10.51 Bar</td>
                            <td className="p-1.5 border-r border-slate-300">10.50 Bar</td>
                            <td className="p-1.5 border-r border-slate-300">26.8 °C</td>
                            <td className="p-1.5 text-emerald-700 font-semibold">
                              Zero Drop Observed
                            </td>
                          </tr>
                          <tr className="bg-amber-50/70">
                            <td className="p-1.5 border-r border-slate-300">14:00 hrs</td>
                            <td className="p-1.5 border-r border-slate-300">10.51 Bar</td>
                            <td className="p-1.5 border-r border-slate-300">10.49 Bar</td>
                            <td className="p-1.5 border-r border-slate-300">27.1 °C</td>
                            <td className="p-1.5 text-emerald-700 font-semibold">
                              PASS — Depressurised Safely
                            </td>
                          </tr>
                        </tbody>
                      </table>

                      {/* Interactive Pin #1 on the PDF Canvas */}
                      <div
                        className="absolute right-16 top-72 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white shadow-lg ring-4 ring-orange-500/30"
                        title="Pin #1 by Sunil Rao (QC)"
                      >
                        1
                      </div>
                    </div>

                    {/* Stamp & Sign-off Block */}
                    <div className="mt-6 flex items-center justify-between border-t border-slate-300 pt-4">
                      <div className="text-[10px] text-slate-600 space-y-0.5">
                        <div className="font-bold text-slate-900">
                          Tested By (Apex MEP Site QC):
                        </div>
                        <div>Amit Verma · B.Tech Mech · 31 Oct 2026</div>
                      </div>

                      <div className="rotate-[-2deg] rounded border-2 border-emerald-700 bg-emerald-50/60 px-3 py-1.5 text-center font-mono text-[10px] font-bold text-emerald-800">
                        <div>WITNESSED & VERIFIED ON SITE</div>
                        <div>VIKRAM SENGUPTA · MEINHARDT PMC</div>
                        <div>25-OCT-2026 · REG #MN-8821</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT PANE: Verification, Comments & High-Contrast Decision Dock (SCR-027) */}
            <div className="w-[410px] shrink-0 border-l border-slate-200 bg-white flex flex-col justify-between overflow-y-auto">
              <div className="p-4 space-y-4">
                {reviewBanner && (
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>{reviewBanner}</div>
                  </div>
                )}

                {/* Version Switcher & Lineage */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        Revision R2
                      </span>
                      <StatusPill
                        status={
                          requirements.find((r) => r.key === "REQ-HVAC-033")?.status ||
                          "IN_REVIEW"
                        }
                        compact
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Supersedes R1 · Uploaded by Amit Verma 2h ago
                    </p>
                  </div>
                  <select className="rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">
                    <option>R2 (Current)</option>
                    <option>R1 (Superseded)</option>
                  </select>
                </div>

                {/* Automated Verification Checks (WF-11) */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Automated Pipeline Verification (WF-11)
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>PDF/A Valid (48 pp)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>ClamAV Scan Clean</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>0 Active JS Scripts</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>NABL ID Verified</span>
                    </div>
                  </div>
                </div>

                {/* Page Pins & Internal/External Comments */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                    <span>Review Annotations & Notes (2)</span>
                    <span className="text-[11px] text-slate-400">Page-linked</span>
                  </div>

                  <div className="rounded-lg border border-orange-200 bg-orange-50/70 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 font-semibold text-orange-900">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                          1
                        </span>
                        Page 12 · Gauge Calibration Check
                      </span>
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">
                        External
                      </span>
                    </div>
                    <p className="text-slate-700">
                      Master gauge WIKA PG-NABL-409 certificate is attached on annexure
                      page 39. Hold pressure verified at 10.5 Bar.
                    </p>
                    <div className="text-[10px] text-slate-500">
                      Sunil Rao (QC Lead) · 1h ago
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-100/80 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        Anil Pillai (Projects Head)
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        <Lock className="h-2.5 w-2.5" />
                        Internal Only
                      </span>
                    </div>
                    <p className="text-slate-600">
                      Approve this immediately so we can lock Package v2 for DLF billing
                      milestone.
                    </p>
                  </div>
                </div>
              </div>

              {/* STICKY BOTTOM DECISION DOCK (SCR-027) - HIGH CONTRAST & LEGIBLE */}
              <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
                {/* Mode Segmented Control */}
                <div className="grid grid-cols-2 rounded-lg bg-slate-200/80 p-1 text-xs font-semibold">
                  <button
                    onClick={() => setDecisionMode("in_app")}
                    className={`rounded-md py-1.5 transition-all ${
                      decisionMode === "in_app"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    In-App Decision
                  </button>
                  <button
                    onClick={() => setDecisionMode("external")}
                    className={`rounded-md py-1.5 transition-all flex items-center justify-center gap-1 ${
                      decisionMode === "external"
                        ? "bg-white text-teal-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Stamp className="h-3.5 w-3.5" />
                    <span>External Approval</span>
                  </button>
                </div>

                {decisionMode === "in_app" ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Review Remarks{" "}
                        <span className="font-normal text-slate-500">
                          (Required for Changes / Reject, min 10 chars)
                        </span>
                      </label>
                      <textarea
                        rows={2}
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder="Add technical review note or page reference..."
                        className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    {/* High-Contrast Action Buttons */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={handleApproveCurrentDoc}
                        className="flex items-center justify-center gap-1 rounded-md bg-emerald-700 py-2 px-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 transition-colors"
                      >
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() =>
                          setReviewBanner(
                            "Changes requested on R2. Uploader Amit Verma has been notified via WhatsApp & Email."
                          )
                        }
                        className="flex items-center justify-center gap-1 rounded-md bg-orange-600 py-2 px-2 text-xs font-semibold text-white shadow-xs hover:bg-orange-700 transition-colors"
                      >
                        <FileEdit className="h-3.5 w-3.5" />
                        <span>Changes</span>
                      </button>
                      <button
                        onClick={() =>
                          setReviewBanner("Document Version R2 rejected and returned.")
                        }
                        className="flex items-center justify-center gap-1 rounded-md bg-red-600 py-2 px-2 text-xs font-semibold text-white shadow-xs hover:bg-red-700 transition-colors"
                      >
                        <X className="h-3.5 w-3.5 stroke-[2.5]" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700">
                          External Approver
                        </label>
                        <input
                          type="text"
                          value={extApproverName}
                          onChange={(e) => setExtApproverName(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700">
                          Approval Method
                        </label>
                        <select
                          value={extMethod}
                          onChange={(e) => setExtMethod(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        >
                          <option value="STAMPED_PDF">Stamped Physical PDF</option>
                          <option value="PORTAL">Aconex / Asite Transmittal</option>
                          <option value="EMAIL">Consultant Email Sign-off</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Transmittal / Reference Number
                      </label>
                      <input
                        type="text"
                        value={extRef}
                        onChange={(e) => setExtRef(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs"
                      />
                    </div>
                    <button
                      onClick={handleApproveCurrentDoc}
                      className="w-full flex items-center justify-center gap-1.5 rounded-md bg-teal-700 py-2 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition-colors"
                    >
                      <Stamp className="h-3.5 w-3.5" />
                      <span>Record External Approval & Satisfy Requirement</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* VIEW 4: HANDOVER DOSSIER STUDIO (SCR-028 & SCR-057)                 */}
        {/* =================================================================== */}
        {activeTab === "package" && (
          <main className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Stepper & Readiness Gate Banner */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-center gap-6 text-xs">
                {[
                  { step: 1, label: "Scope & Preview (SCR-057)", done: true },
                  { step: 2, label: "Readiness Gate (2 Exceptions)", active: true },
                  { step: 3, label: "CPWD / PMC Section Order", done: false },
                  { step: 4, label: "Multi-Party Submission", done: false },
                ].map((s) => (
                  <div key={s.step} className="flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                        s.done
                          ? "bg-emerald-600 text-white"
                          : s.active
                          ? "bg-[#0F2942] text-white ring-4 ring-blue-100"
                          : "bg-slate-100 text-slate-500 border border-slate-300"
                      }`}
                    >
                      {s.done ? "✓" : s.step}
                    </span>
                    <span
                      className={
                        s.active
                          ? "font-semibold text-slate-900"
                          : "font-medium text-slate-600"
                      }
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs font-semibold text-slate-700">
                  71 Docs · 482 Pages · 184.2 MB
                </span>
                <button className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#163A5F]">
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Merged PDF + Manifest ZIP</span>
                </button>
              </div>
            </div>

            {/* Split View: Left Section Breakdown | Right Live A4 Cover & Recipients */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 7 Columns: 13 Contractual Sections with Page Ranges */}
              <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                      Compiled Dossier Index (13 Contractual Sections)
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Bookmarked PDF/A with automatic page-range numbering and SHA-256
                      manifest
                    </p>
                  </div>
                  <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800">
                    Snapshot Checksum: #8b3e19f0
                  </span>
                </div>

                <div className="divide-y divide-slate-200 text-xs">
                  {[
                    {
                      sec: "Section 01 · Cover, Signature Block & Master Approval Register",
                      docs: "Generated Cover + CPWD/PMC Stamp Grid + 77-Item Index",
                      pages: "pp. 001–008",
                      count: "8 Pages",
                      status: "READY",
                    },
                    {
                      sec: "Section 02 · Completion Certificate & Client Handover Sign-Offs",
                      docs: "DT-062 Provisional Completion, DT-063 Handover Transmittal",
                      pages: "pp. 009–018",
                      count: "10 Pages",
                      status: "READY",
                    },
                    {
                      sec: "Section 05 · Coordinated As-Built Drawings & Equipment Schedules",
                      docs: "Plant Room Layout (R3), Riser Schematic (R2), Chiller Schedule",
                      pages: "pp. 019–086",
                      count: "68 Pages",
                      status: "READY",
                    },
                    {
                      sec: "Section 07 · OEM Technical Datasheets, O&M Manuals & Spares",
                      docs: "Carrier 19XR O&M Manual (142 pp), Paharpur CT Manual, Spares List",
                      pages: "pp. 087–294",
                      count: "208 Pages",
                      status: "READY",
                    },
                    {
                      sec: "Section 08 · Installation, Hydrostatic, Duct Leakage & TAB Reports",
                      docs: "CHLR-01 Pressure Test (10.5 Bar), NEBB TAB Report, Fire Damper Log",
                      pages: "pp. 295–438",
                      count: "144 Pages",
                      status: "READY",
                    },
                    {
                      sec: "Section 10 · OEM Warranties, Guarantee Undertakings & Waivers",
                      docs: "5-Year Compressor Warranty, 12-Month DLP Undertaking, 5 Waivers",
                      pages: "pp. 439–482",
                      count: "44 Pages",
                      status: "READY",
                    },
                  ].map((s, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900">{s.sec}</div>
                        <div className="text-[11px] text-slate-500">{s.docs}</div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div className="text-xs font-semibold text-slate-800">
                          {s.pages}
                        </div>
                        <div className="text-[10px] text-slate-500">{s.count}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right 5 Columns: Live Executive Cover Preview & Multi-Recipient Status */}
              <div className="lg:col-span-5 space-y-5">
                {/* Multi-Recipient Submission Tracker (FR-HND-019) */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                    Multi-Recipient Submission Register (FR-HND-019)
                  </h3>
                  <div className="mt-3 space-y-2.5 text-xs">
                    {[
                      {
                        party: "Meinhardt Singapore (MEP Consultant)",
                        role: "Technical Review",
                        state: "Accepted (66/71)",
                        badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
                      },
                      {
                        party: "L&T Construction (Main Contractor)",
                        role: "Dossier Transmittal",
                        state: "Acknowledged",
                        badge: "bg-blue-50 text-blue-800 border-blue-200",
                      },
                      {
                        party: "DLF CyberCity Developers (Client)",
                        role: "Final Bill & Retention Release",
                        state: "Pending 2 Items",
                        badge: "bg-amber-50 text-amber-800 border-amber-200",
                      },
                    ].map((rec, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-md border border-slate-200 p-2.5"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{rec.party}</div>
                          <div className="text-[11px] text-slate-500">{rec.role}</div>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${rec.badge}`}
                        >
                          {rec.state}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live A4 Dossier Cover & Stamp Preview */}
                <div className="rounded-lg border border-slate-300 bg-slate-800 p-4 shadow-xs">
                  <div className="flex items-center justify-between text-[11px] text-slate-300 mb-3">
                    <span className="font-semibold uppercase tracking-wider">
                      Generated A4 Cover & Signature Block Preview
                    </span>
                    <span className="font-mono text-slate-400">Page 001 of 482</span>
                  </div>
                  <div className="rounded-xs bg-white p-5 text-slate-900 shadow-lg border border-slate-300 space-y-4">
                    <div className="h-2 w-full bg-[#0F2942]" />
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-blue-800">
                          APEX MEP CONTRACTORS PVT LTD
                        </div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">
                          FINAL HVAC HANDOVER & O&M DOSSIER
                        </div>
                      </div>
                      <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border">
                        PACKAGE v2
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border border-slate-300 p-2 text-[9px]">
                      <div className="border-r border-slate-200 pr-2">
                        <div className="font-bold text-slate-500">PREPARED BY</div>
                        <div className="mt-3 font-semibold text-slate-800">
                          Apex MEP Signatory
                        </div>
                      </div>
                      <div className="border-r border-slate-200 pr-2">
                        <div className="font-bold text-slate-500">REVIEWED BY (PMC)</div>
                        <div className="mt-3 font-semibold text-slate-800">
                          Meinhardt Stamp
                        </div>
                      </div>
                      <div>
                        <div className="font-bold text-slate-500">CLIENT ACCEPTANCE</div>
                        <div className="mt-3 font-semibold text-slate-800">
                          DLF Authorised
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 pt-2 flex justify-between font-mono text-[9px] text-slate-400">
                      <span>SNAPSHOT SHA256: 8B3E19F0...44A1</span>
                      <span>31 OCT 2026 IST</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        )}

        {/* =================================================================== */}
        {/* VIEW 5: SCOPED SUPPLIER GUEST PORTAL (SCR-034)                      */}
        {/* =================================================================== */}
        {activeTab === "supplier" && (
          <main className="flex-1 overflow-y-auto bg-slate-200/70 p-5 flex flex-col items-center">
            {/* Simulator Frame Switcher */}
            <div className="mb-4 flex items-center justify-between w-full max-w-3xl rounded-lg bg-slate-900 px-4 py-2 text-xs text-slate-200 shadow-md">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>
                  <strong>Scoped Guest Portal Preview</strong> — Zero internal navigation
                  exposed to external supplier (`SCR-034`)
                </span>
              </div>
              <div className="flex items-center gap-1 rounded bg-slate-800 p-0.5">
                <button
                  onClick={() => setSupplierViewport("desktop")}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                    supplierViewport === "desktop"
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Monitor className="h-3 w-3" />
                  <span>Desktop</span>
                </button>
                <button
                  onClick={() => setSupplierViewport("mobile")}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                    supplierViewport === "mobile"
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Smartphone className="h-3 w-3" />
                  <span>360px Field Phone</span>
                </button>
              </div>
            </div>

            {/* Isolated External Supplier Frame */}
            <div
              className={`${
                supplierViewport === "mobile" ? "w-[375px]" : "w-full max-w-2xl"
              } rounded-xl border border-slate-300 bg-white shadow-xl overflow-hidden transition-all`}
            >
              {/* 4px Tenant Brand Top Bar (FR-ORG-007) */}
              <div className="h-1.5 w-full bg-[#0F2942]" />

              {/* Guest Header */}
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0F2942] text-xs font-bold text-white">
                    AM
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Apex MEP Contractors Pvt Ltd
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Project: Skyview Commercial Towers (PRJ-024)
                    </div>
                  </div>
                </div>
                <span className="rounded-full bg-amber-50 border border-amber-300 px-2.5 py-0.5 text-[10px] font-semibold text-amber-900">
                  External Supplier Link · OTP Verified
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500">Assigned Vendor: </span>
                    <strong className="text-slate-900">
                      Carrier Air Conditioning India Pvt Ltd
                    </strong>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">
                    Link expires: 28 Nov 2026
                  </span>
                </div>

                {/* Assigned Requirement Upload Card */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 shadow-2xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                          REQ-HVAC-018
                        </span>
                        <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-800">
                          Tag: CHLR-01
                        </span>
                      </div>
                      <h3 className="mt-1.5 text-sm font-semibold text-slate-900">
                        Centrifugal Chiller Factory Acceptance Test & Run Curve (AHRI
                        550/590)
                      </h3>
                    </div>
                    <span className="shrink-0 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                      Due: 05 Nov 2026
                    </span>
                  </div>

                  {!supplierUploaded ? (
                    <>
                      {/* Sunlight-Contrast Dropzone */}
                      <div
                        onClick={() => setSupplierUploaded(true)}
                        className="cursor-pointer rounded-lg border-2 border-dashed border-blue-600 bg-blue-50/40 p-6 text-center hover:bg-blue-50/80 transition-colors"
                      >
                        <UploadCloud className="mx-auto h-7 w-7 text-blue-700" />
                        <div className="mt-2 text-xs font-semibold text-slate-900">
                          Tap to Select PDF or Take Photo of Signed Test Certificate
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          PDF, JPG, PNG up to 100 MB · Resumable on 4G
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Revision Code (Required)
                          </label>
                          <input
                            type="text"
                            defaultValue="R0"
                            className="mt-1 w-full rounded-md border border-slate-400 px-2.5 py-1.5 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            Certificate Issue Date (Required)
                          </label>
                          <input
                            type="text"
                            defaultValue="31 Oct 2026"
                            className="mt-1 w-full rounded-md border border-slate-400 px-2.5 py-1.5 font-mono text-xs"
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => setSupplierUploaded(true)}
                        className="w-full rounded-md bg-[#1D4ED8] py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 transition-colors"
                      >
                        Upload & Submit Certificate to Apex MEP
                      </button>
                    </>
                  ) : (
                    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 font-bold text-emerald-900">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Uploaded Successfully · Waiting for Apex MEP Review
                        </span>
                        <button
                          onClick={() => setSupplierUploaded(false)}
                          className="text-[11px] font-semibold text-emerald-800 underline"
                        >
                          Replace File
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-emerald-800">
                        File: CARRIER-CHLR01-FAT-AHRI-R0.pdf · SHA-256 Verified
                      </div>
                    </div>
                  )}
                </div>

                {/* Direct WhatsApp Assistance Footer */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                  <span>Need help with equipment serial numbers?</span>
                  <span className="font-semibold text-blue-700 cursor-pointer hover:underline">
                    WhatsApp Procurement (Meera: +91 98200 XXXXX)
                  </span>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 3. FAST 3-TAP MOBILE/FIELD UPLOAD MODAL (SCR-023)                     */}
      {/* ===================================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-blue-700">
                    {uploadTargetReq?.key || "REQ-HVAC-001"}
                  </span>
                  <span className="rounded bg-slate-200 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-slate-700">
                    {uploadTargetReq?.assetTag || "Project-wide"}
                  </span>
                </div>
                <h3 className="text-xs font-semibold text-slate-900 mt-0.5 truncate max-w-xs">
                  {uploadTargetReq?.title || "Upload Requirement Evidence"}
                </h3>
              </div>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <button className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-[#1D4ED8] p-4 text-white font-semibold shadow-xs hover:bg-blue-800">
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
                    defaultValue="31 Oct 2026"
                    className="mt-1 w-full rounded border border-slate-400 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 bg-slate-50 px-3 py-2 rounded border border-slate-200">
                <span>✓ Draft metadata saved to localStorage</span>
                <span className="font-mono">Max 100 MB · S3 Multipart</span>
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
    </div>
  );
}
