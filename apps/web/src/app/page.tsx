"use client";

import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/lib/api-client";
import {
  LayoutDashboard,
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
  ExternalLink,
  Lock,
  Check,
  X,
  ZoomIn,
  ZoomOut,
  MapPin,
  Smartphone,
  Monitor,
  FileSpreadsheet,
  Layers,
  History,
  PanelLeftClose,
  PanelLeft,
  Wrench,
  Award,
  UserCheck,
  MinusCircle,
  Plus,
  RefreshCw,
  FolderPlus,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* 1. DOMAIN TYPES & WCAG 2.1 AA STATUS PALETTE (11-UI-UX-SPECIFICATION §5.1) */
/* -------------------------------------------------------------------------- */

type VisualStatus =
  | "NOT_STARTED"
  | "REQUESTED"
  | "UPLOADED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "APPROVED"
  | "APPROVED_EXTERNAL"
  | "WAIVED"
  | "NOT_APPLICABLE"
  | "EXPIRED"
  | "MISSING";

interface RequirementRow {
  id: string;
  key: string;
  groupKey: string;
  groupName: string;
  title: string;
  docTypeCode: string;
  docTypeName: string;
  mandatory: boolean;
  assetTag: string | null;
  assetName: string;
  status: VisualStatus;
  ownerName: string;
  ownerRole: string;
  isSupplier?: boolean;
  reviewerRole: string;
  dueDate: string | null; // null = never MISSING (FR-CHK-010)
  isOverdue?: boolean;
  revision: string | null;
  updatedAt: string;
  pages?: number;
  sha256?: string;
  excludedFromPackage?: boolean;
  exclusionReason?: string;
  waiverSecondApprover?: string;
}

interface DefectItem {
  id: string;
  code: string;
  assetTag: string;
  title: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  assignee: string;
  dueDate: string;
  status: "OPEN" | "IN_PROGRESS" | "RECTIFIED" | "CLOSED";
}

const STATUS_STYLE: Record<
  VisualStatus,
  {
    label: string; // Plain English per 11 §5.1 & §10
    bg: string;
    border: string;
    text: string;
    icon: React.ElementType;
  }
> = {
  NOT_STARTED: {
    label: "Not started",
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-700",
    icon: Clock,
  },
  REQUESTED: {
    label: "Requested",
    bg: "bg-blue-50",
    border: "border-blue-300",
    text: "text-blue-800",
    icon: Send,
  },
  UPLOADED: {
    label: "Uploaded",
    bg: "bg-indigo-50",
    border: "border-indigo-300",
    text: "text-indigo-900",
    icon: FileUp,
  },
  IN_REVIEW: {
    label: "Waiting for review",
    bg: "bg-amber-50",
    border: "border-amber-300",
    text: "text-amber-900",
    icon: Clock,
  },
  CHANGES_REQUESTED: {
    label: "Changes requested",
    bg: "bg-orange-50",
    border: "border-orange-300",
    text: "text-orange-900",
    icon: FileEdit,
  },
  REJECTED: {
    label: "Rejected",
    bg: "bg-red-50",
    border: "border-red-300",
    text: "text-red-800",
    icon: XCircle,
  },
  APPROVED: {
    label: "Approved",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    text: "text-emerald-800",
    icon: CheckCircle2,
  },
  APPROVED_EXTERNAL: {
    label: "Approved (external)",
    bg: "bg-teal-50",
    border: "border-teal-400 border-dashed",
    text: "text-teal-900",
    icon: Stamp,
  },
  WAIVED: {
    label: "Waived",
    bg: "bg-purple-50",
    border: "border-purple-300",
    text: "text-purple-900",
    icon: ShieldOff,
  },
  NOT_APPLICABLE: {
    label: "Not applicable",
    bg: "bg-slate-50",
    border: "border-slate-300 border-dashed",
    text: "text-slate-600",
    icon: MinusCircle,
  },
  EXPIRED: {
    label: "Expired",
    bg: "bg-white",
    border: "border-red-600 border-[1.5px]",
    text: "text-red-700 font-semibold",
    icon: CalendarX2,
  },
  MISSING: {
    label: "Missing",
    bg: "bg-red-100",
    border: "border-red-400",
    text: "text-red-900 font-semibold",
    icon: AlertTriangle,
  },
};

function StatusBadge({ status, sm = false }: { status: VisualStatus; sm?: boolean }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span
      role="status"
      aria-label={`Status: ${s.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium leading-none select-none ${
        sm ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } ${s.bg} ${s.border} ${s.text}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 stroke-[2.2]"/>
      <span>{s.label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. INITIAL REALISTIC DATASET                                               */
/* -------------------------------------------------------------------------- */

const SEED_REQUIREMENTS: RequirementRow[] = [
  {
    id: "r1",
    key: "REQ-HVAC-001",
    groupKey: "G1",
    groupName: "01. Commercial, Insurance & Statutory Approvals",
    title: "Chief Fire Officer Statutory Fire & Smoke Damper NOC",
    docTypeCode: "DT-086",
    docTypeName: "Fire NOC / Safety Certificate",
    mandatory: true,
    assetTag: null,
    assetName: "Project-wide",
    status: "MISSING",
    ownerName: "Anil Pillai",
    ownerRole: "Project Manager",
    reviewerRole: "Client Representative",
    dueDate: "27 Oct 2026",
    isOverdue: true,
    revision: null,
    updatedAt: "4 days overdue",
  },
  {
    id: "r2",
    key: "REQ-HVAC-002",
    groupKey: "G1",
    groupName: "01. Commercial, Insurance & Statutory Approvals",
    title: "Workmen Compensation & Contractor All-Risk (CAR) Insurance Policy",
    docTypeCode: "DT-004",
    docTypeName: "Insurance Certificate",
    mandatory: true,
    assetTag: null,
    assetName: "Project-wide",
    status: "EXPIRED",
    ownerName: "Fatima Shaikh",
    ownerRole: "Document Controller",
    reviewerRole: "Main Contractor",
    dueDate: "15 Oct 2026",
    isOverdue: true,
    revision: "R1",
    updatedAt: "Expired 16 days ago",
    pages: 12,
    sha256: "8f4a2e...91c0",
  },
  {
    id: "r3",
    key: "REQ-HVAC-011",
    groupKey: "G2",
    groupName: "02. Design, Shop Drawings & As-Built Records",
    title: "Basement-2 Chiller Plant Room Coordinated As-Built Layout",
    docTypeCode: "DT-011",
    docTypeName: "As-Built Drawing",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Centrifugal Chiller #1",
    status: "APPROVED_EXTERNAL",
    ownerName: "Meera Deshmukh",
    ownerRole: "Project Manager",
    reviewerRole: "Consultant Reviewer",
    dueDate: "20 Oct 2026",
    revision: "R3",
    updatedAt: "25 Oct 2026",
    pages: 4,
    sha256: "7a12d9...44b8",
  },
  {
    id: "r4",
    key: "REQ-HVAC-012",
    groupKey: "G2",
    groupName: "02. Design, Shop Drawings & As-Built Records",
    title: "Typical Floor (L1–L18) VAV & Supply Ducting As-Built Redline Set",
    docTypeCode: "DT-011",
    docTypeName: "As-Built Drawing",
    mandatory: true,
    assetTag: "AHU-FL08",
    assetName: "Floor 08 Double-Skin AHU (24,000 CFM)",
    status: "CHANGES_REQUESTED",
    ownerName: "Meera Deshmukh",
    ownerRole: "Project Manager",
    reviewerRole: "Consultant Reviewer",
    dueDate: "29 Oct 2026",
    isOverdue: true,
    revision: "R2",
    updatedAt: "Yesterday",
    pages: 18,
    sha256: "1d55e0...89a2",
  },
  {
    id: "r5",
    key: "REQ-HVAC-018",
    groupKey: "G4",
    groupName: "04. Procurement, Factory Tests (FAT) & Calibration",
    title: "Centrifugal Chiller Factory Acceptance Test & Run Curve (AHRI 550/590)",
    docTypeCode: "DT-022",
    docTypeName: "Factory Acceptance Test",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Centrifugal Chiller #1",
    status: "REQUESTED",
    ownerName: "Carrier Aircon India",
    ownerRole: "OEM Supplier",
    isSupplier: true,
    reviewerRole: "Consultant Reviewer",
    dueDate: "05 Nov 2026",
    revision: null,
    updatedAt: "Requested 2 days ago",
  },
  {
    id: "r6",
    key: "REQ-HVAC-033",
    groupKey: "G6",
    groupName: "06. Installation, Hydrostatic Testing & Commissioning",
    title: "Chilled Water Header & Riser Hydrostatic Pressure Test Report (10.5 Bar)",
    docTypeCode: "DT-033",
    docTypeName: "Pressure Test Report",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Centrifugal Chiller #1",
    status: "IN_REVIEW",
    ownerName: "Amit Verma",
    ownerRole: "Site Engineer",
    reviewerRole: "QC Engineer",
    dueDate: "02 Nov 2026",
    revision: "R2",
    updatedAt: "2 hours ago",
    pages: 48,
    sha256: "9f2c8b...31e7",
  },
  {
    id: "r7",
    key: "REQ-HVAC-035",
    groupKey: "G6",
    groupName: "06. Installation, Hydrostatic Testing & Commissioning",
    title: "Supply & Return GI Ductwork Class-B Air Leakage Test Dossier",
    docTypeCode: "DT-035",
    docTypeName: "Duct Leakage Report",
    mandatory: true,
    assetTag: "AHU-FL08",
    assetName: "Floor 08 Double-Skin AHU (24,000 CFM)",
    status: "IN_REVIEW",
    ownerName: "Amit Verma",
    ownerRole: "Site Engineer",
    reviewerRole: "QC Engineer",
    dueDate: "03 Nov 2026",
    revision: "R1",
    updatedAt: "5 hours ago",
    pages: 22,
    sha256: "6b09c3...11f5",
  },
  {
    id: "r8",
    key: "REQ-HVAC-050",
    groupKey: "G6",
    groupName: "06. Installation, Hydrostatic Testing & Commissioning",
    title: "NEBB-Standard Air & Hydronic Testing, Adjusting & Balancing (TAB) Report",
    docTypeCode: "DT-050",
    docTypeName: "TAB Report",
    mandatory: true,
    assetTag: null,
    assetName: "Complete Building Loop",
    status: "APPROVED",
    ownerName: "Sunil Rao",
    ownerRole: "QC Engineer",
    reviewerRole: "Consultant Reviewer",
    dueDate: "24 Oct 2026",
    revision: "R1",
    updatedAt: "26 Oct 2026",
    pages: 64,
    sha256: "2f18a9...93d1",
  },
  {
    id: "r9",
    key: "REQ-HVAC-058",
    groupKey: "G9",
    groupName: "09. Handover Manuals, Warranties & Training",
    title: "Project-Specific Chiller Plant Operation & Maintenance (O&M) Manual",
    docTypeCode: "DT-058",
    docTypeName: "O&M Manual",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Centrifugal Chiller #1",
    status: "APPROVED",
    ownerName: "Fatima Shaikh",
    ownerRole: "Document Controller",
    reviewerRole: "Consultant Reviewer",
    dueDate: "25 Oct 2026",
    revision: "R2",
    updatedAt: "28 Oct 2026",
    pages: 142,
    sha256: "0c44e8...55b9",
  },
  {
    id: "r10",
    key: "REQ-HVAC-090",
    groupKey: "G9",
    groupName: "09. Handover Manuals, Warranties & Training",
    title: "OEM 5-Year Compressor Warranty Registration Confirmation",
    docTypeCode: "DT-090",
    docTypeName: "Warranty Registration",
    mandatory: true,
    assetTag: "CHLR-01",
    assetName: "Carrier 650 TR Centrifugal Chiller #1",
    status: "APPROVED_EXTERNAL",
    ownerName: "Carrier Aircon India",
    ownerRole: "OEM Supplier",
    isSupplier: true,
    reviewerRole: "Project Manager",
    dueDate: "28 Oct 2026",
    revision: "R0",
    updatedAt: "29 Oct 2026",
    pages: 4,
    sha256: "9b11c7...20a3",
  },
  {
    id: "r11",
    key: "REQ-HVAC-072",
    groupKey: "G9",
    groupName: "09. Handover Manuals, Warranties & Training",
    title: "Concealed Above-Ceiling Insulation & Hanger Photo Log",
    docTypeCode: "DT-072",
    docTypeName: "As-Built Photo Record",
    mandatory: false,
    assetTag: null,
    assetName: "Project-wide",
    status: "NOT_STARTED",
    ownerName: "Amit Verma",
    ownerRole: "Site Engineer",
    reviewerRole: "QC Engineer",
    dueDate: null, // FR-CHK-010: due_at IS NULL => never MISSING
    revision: null,
    updatedAt: "No deadline",
  },
];

const SEED_DEFECTS: DefectItem[] = [
  {
    id: "d1",
    code: "SNAG-014",
    assetTag: "AHU-FL08",
    title: "Condensate drain pan secondary trap nitrile insulation joint gap",
    severity: "MAJOR",
    assignee: "Amit Verma (Site Engineer)",
    dueDate: "04 Nov 2026",
    status: "IN_PROGRESS",
  },
  {
    id: "d2",
    code: "SNAG-019",
    assetTag: "CHLR-01",
    title: "Replace temporary pressure gauge on evaporator outlet with NABL unit",
    severity: "CRITICAL",
    assignee: "Carrier Aircon Service",
    dueDate: "02 Nov 2026",
    status: "RECTIFIED",
  },
];

/* -------------------------------------------------------------------------- */
/* 3. MAIN APPLICATION COMPONENT                                              */
/* -------------------------------------------------------------------------- */

export default function TradeCloseoutProductionUI() {
  // Actor Plane Switcher (Proves strict isolation between Contractor, Supplier, and Client planes)
  const [actorPlane, setActorPlane] = useState<
    "CONTRACTOR" | "SUPPLIER_GUEST" | "CLIENT_GUEST"
  >("CONTRACTOR");

  // Contractor Workspace Navigation
  const [activeTab, setActiveTab] = useState<
    "overview" | "checklist" | "reviews" | "packages" | "warranty_dlp"
  >("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Core Data State (Starts EMPTY per specification & user directive; load sample data on demand)
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [defects, setDefects] = useState<DefectItem[]>([]);
  const [changeRequests, setChangeRequests] = useState<
    { id: string; reason: string; createdBy: string; createdAt: string; status: string }[]
  >([]);
  const [isDemoDataLoaded, setIsDemoDataLoaded] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [activeProject, setActiveProject] = useState<{ id: string; code: string; name: string } | null>(null);
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string; phone?: string; full_name?: string } | null>(null);
  const [newReqModalOpen, setNewReqModalOpen] = useState(false);
  const [newReqTitle, setNewReqTitle] = useState("");
  const [newReqDocType, setNewReqDocType] = useState("DT-001");
  const [newReqMandatory, setNewReqMandatory] = useState(true);
  const [newReqAssetTag, setNewReqAssetTag] = useState("");
  const [newReqDueDate, setNewReqDueDate] = useState("2026-11-15");
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [newProjCode, setNewProjCode] = useState("PRJ-025");
  const [newProjName, setNewProjName] = useState("Metro Line Extension Package 4");

  const handleToggleDemoData = () => {
    if (isDemoDataLoaded) {
      setRequirements([]);
      setDefects([]);
      setIsDemoDataLoaded(false);
    } else {
      setRequirements(SEED_REQUIREMENTS);
      setDefects(SEED_DEFECTS);
      setIsDemoDataLoaded(true);
    }
  };

  const refreshProjects = async () => {
    try {
      const res = await api.projects.list();
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        setProjects(res.data);
        if (!activeProject) {
          setActiveProject(res.data[0]);
        }
      }
    } catch {
      // offline / fallback
    }
  };

  const loadRequirementsFromApi = async (projectId: string) => {
    try {
      const res = await api.checklists.listRequirements(projectId);
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        const mapped: RequirementRow[] = res.data.map((r: any, idx: number) => ({
          id: r.id,
          key: r.key || `REQ-${String(idx + 1).padStart(3, "0")}`,
          groupKey: r.milestone_key || "G1",
          groupName: r.milestone_key ? `Milestone: ${r.milestone_key}` : "01. Mandatory Closeout Requirements",
          title: r.title,
          docTypeCode: r.doc_type_code || "DT-001",
          docTypeName: "Statutory / Engineering Document",
          mandatory: Boolean(r.mandatory),
          assetTag: r.asset_tag || null,
          assetName: r.asset_tag ? `Asset ${r.asset_tag}` : "Project-wide",
          status: (r.status as VisualStatus) || "MISSING",
          ownerName: "Assigned Lead",
          ownerRole: "Lead Engineer",
          reviewerRole: r.reviewer_role || "Project Director",
          dueDate: r.due_date ? String(r.due_date).split("T")[0] : null,
          revision: r.revision || null,
          updatedAt: "Recorded in PostgreSQL",
          pages: 4,
          sha256: "db" + r.id.replace(/-/g, "").slice(0, 12),
        }));
        setRequirements(mapped);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    api.auth.me().then((res) => {
      if (res.data) setSessionUser(res.data);
    }).catch(() => {});
    refreshProjects();
  }, []);

  useEffect(() => {
    if (activeProject && !isDemoDataLoaded) {
      loadRequirementsFromApi(activeProject.id);
    }
  }, [activeProject, isDemoDataLoaded]);

  // Checklist Filter & Selection State
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailReq, setDetailReq] = useState<RequirementRow | null>(null);

  // Two-Approver Mandatory Waiver Modal (FR-CHK-016)
  const [waiverModalReq, setWaiverModalReq] = useState<RequirementRow | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverSecondApprover, setWaiverSecondApprover] = useState(
    "Rajesh Sharma (Owner)"
  );

  // Mobile/Field Upload Sheet State with localStorage persistence (SCR-023 / 11 §4.8)
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<RequirementRow | null>(null);
  const [draftRev, setDraftRev] = useState("R1");
  const [draftDate, setDraftDate] = useState("2026-10-31");
  const [draftRemarks, setDraftRemarks] = useState("");
  const [uploadFileError, setUploadFileError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Load/save upload metadata draft to localStorage per project (11 §4.8)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("tc_draft_PRJ024");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.rev) setDraftRev(parsed.rev);
        if (parsed.remarks) setDraftRemarks(parsed.remarks);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const updateDraftRemarks = (val: string) => {
    setDraftRemarks(val);
    try {
      window.localStorage.setItem(
        "tc_draft_PRJ024",
        JSON.stringify({ rev: draftRev, remarks: val })
      );
    } catch {
      // Ignore
    }
  };

  // Document Viewer & Review State (SCR-025 / SCR-027)
  const [reviewTab, setReviewTab] = useState<"in_app" | "external">("in_app");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [extApprover, setExtApprover] = useState("Vikram Sengupta (Meinhardt PMC)");
  const [extMethod, setExtMethod] = useState<
    "STAMPED_PDF" | "EMAIL" | "PORTAL" | "PHYSICAL"
  >("STAMPED_PDF");
  const [extDate, setExtDate] = useState("2026-10-25");
  const [extRef, setExtRef] = useState("TRN-MEIN-HVAC-089");
  const [extEvidenceAttached, setExtEvidenceAttached] = useState(true);
  const [pdfPins, setPdfPins] = useState<
    { id: number; page: number; x: number; y: number; text: string; author: string }[]
  >([
    {
      id: 1,
      page: 12,
      x: 78,
      y: 62,
      text: "Master gauge WIKA PG-NABL-409 calibration verified against annexure p.39.",
      author: "Sunil Rao (QC Engineer)",
    },
  ]);

  // Package Builder & Preview Exclusion State (SCR-028 / SCR-057)
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [packageGeneratedBanner, setPackageGeneratedBanner] = useState<string | null>(
    null
  );

  // Guest Planes State (SCR-034 & SCR-031)
  const [supplierUploaded, setSupplierUploaded] = useState(false);
  const [clientDecisionType, setClientDecisionType] = useState<
    "ACCEPT" | "ACCEPT_WITH_EXCEPTIONS" | "REJECT"
  >("ACCEPT_WITH_EXCEPTIONS");
  const [clientExceptionText, setClientExceptionText] = useState(
    "Provide renewed Workmen Compensation Insurance endorsement and CFO Fire Damper NOC within 7 days."
  );
  const [clientDecisionSubmitted, setClientDecisionSubmitted] = useState(false);

  // Filtered checklist rows
  const filteredReqs = useMemo(() => {
    return requirements.filter((r) => {
      const statusOk =
        statusFilter === "ALL"
          ? true
          : statusFilter === "BLOCKERS"
          ? r.status === "MISSING" || r.status === "EXPIRED"
          : statusFilter === "APPROVED_ALL"
          ? r.status === "APPROVED" || r.status === "APPROVED_EXTERNAL"
          : r.status === statusFilter;

      const q = searchQuery.trim().toLowerCase();
      const searchOk =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        r.docTypeCode.toLowerCase().includes(q) ||
        (r.assetTag && r.assetTag.toLowerCase().includes(q)) ||
        r.ownerName.toLowerCase().includes(q);

      return statusOk && searchOk;
    });
  }, [requirements, statusFilter, searchQuery]);

  // File Selection Validation (Enforces 11 §4.8 SVG / Macro Ban)
  const handleSimulateFileSelect = (filename: string) => {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".svg") || lower.endsWith(".exe") || lower.endsWith(".xlsm")) {
      setUploadFileError(
        "This file type isn't supported. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG or ZIP (SVG is strictly banned)."
      );
      // 11 §4.8: Never lose previously selected valid file or entered metadata
      return;
    }
    setUploadFileError(null);
    setSelectedFileName(filename);
  };

  // Review Decision Handler (Enforces 11 §4.9 10-char rule & WF-23 External Approval)
  const handleReviewDecision = (decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT") => {
    setReviewError(null);
    if (reviewTab === "in_app") {
      if (decision !== "APPROVE" && reviewComment.trim().length < 10) {
        setReviewError(
          "Please enter at least 10 characters explaining what needs to be corrected before returning this document."
        );
        return;
      }
      const nextStatus: VisualStatus =
        decision === "APPROVE"
          ? "APPROVED"
          : decision === "REQUEST_CHANGES"
          ? "CHANGES_REQUESTED"
          : "REJECTED";

      setRequirements((prev) =>
        prev.map((r) =>
          r.key === "REQ-HVAC-033"
            ? { ...r, status: nextStatus, updatedAt: "Just now" }
            : r
        )
      );
      setReviewSuccess(
        `Decision recorded: ${STATUS_STYLE[nextStatus].label}. Audit event written.`
      );
    } else {
      if (!extApprover.trim() || !extDate) {
        setReviewError("Approver name and decision date are required.");
        return;
      }
      if (
        (extMethod === "STAMPED_PDF" || extMethod === "EMAIL") &&
        !extEvidenceAttached
      ) {
        setReviewError(
          "Evidence file upload is required for Stamped PDF and Email approvals."
        );
        return;
      }
      setRequirements((prev) =>
        prev.map((r) =>
          r.key === "REQ-HVAC-033"
            ? { ...r, status: "APPROVED_EXTERNAL", updatedAt: "Just now" }
            : r
        )
      );
      setReviewSuccess(
        `External approval recorded (${extMethod} · Ref: ${extRef}). Marked as 'Approved (external)' in handover package.`
      );
    }
  };

  /* ======================================================================= */
  /* ISOLATED GUEST PLANE 1: SUPPLIER UPLOAD LINK (SCR-034, 11 §2.3 & §4.12) */
  /* ======================================================================= */
  if (actorPlane === "SUPPLIER_GUEST") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col justify-between font-sans">
        {/* Top Preview Mode Bar (For Founder/Demo Switching Only) */}
        <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>
              Viewing Isolated Guest Route: <strong>/guest/sup_0192f8a...</strong> (Zero
              contractor navigation exposed)
            </span>
          </div>
          <button
            onClick={() => setActorPlane("CONTRACTOR")}
            className="rounded bg-blue-600 px-2.5 py-1 text-white font-medium hover:bg-blue-500"
          >
            Return to Contractor Workspace
          </button>
        </div>

        {/* Standalone Single-Purpose Supplier Page (11 §2.3) */}
        <main className="mx-auto w-full max-w-xl px-4 py-8 flex-1">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* 4px Sandboxed Contractor Brand Accent Bar (FR-ORG-007) */}
            <div className="h-1.5 w-full bg-[#0F2942]" />

            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F2942] text-white font-bold text-xs">
                  AM
                </div>
                <div>
                  <h1 className="text-sm font-bold text-slate-900">
                    Apex MEP Contractors Pvt Ltd
                  </h1>
                  <p className="text-xs text-slate-600">
                    Project: Skyview Commercial Towers
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-amber-50 border border-amber-300 px-2.5 py-0.5 text-[11px] font-medium text-amber-900">
                External access
              </span>
            </div>

            <div className="p-6 space-y-5">
              <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-200 text-xs space-y-1">
                <div className="font-semibold text-slate-900">
                  Document Request for Carrier Air Conditioning India Pvt Ltd
                </div>
                <p className="text-slate-600">
                  Please upload the requested certificate below. No account login is
                  required. Status remains visible via this link for 30 days.
                </p>
              </div>

              {/* Scoped Requirement Item (AUD-P-15: Shows ONLY assigned requirement) */}
              <div className="rounded-lg border border-slate-200 p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-800">
                      Equipment: CHLR-01
                    </span>
                    <h2 className="mt-1.5 text-sm font-semibold text-slate-900">
                      Centrifugal Chiller Factory Acceptance Test & Run Curve (AHRI
                      550/590)
                    </h2>
                  </div>
                  <span className="shrink-0 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-900">
                    Due: 05 Nov 2026
                  </span>
                </div>

                {!supplierUploaded ? (
                  <>
                    <div
                      onClick={() => setSupplierUploaded(true)}
                      className="cursor-pointer rounded-lg border-2 border-dashed border-blue-600 bg-blue-50/40 p-6 text-center hover:bg-blue-50/80 transition-colors"
                    >
                      <UploadCloud className="mx-auto h-7 w-7 text-blue-700"/>
                      <div className="mt-2 text-xs font-semibold text-slate-900">
                        Take Photo or Choose PDF File
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        PDF, JPG, PNG up to 100 MB
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          Revision (Required)
                        </label>
                        <input
                          type="text"
                          defaultValue="R0"
                          className="w-full rounded-md border border-slate-400 px-2.5 py-2 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          Issue Date (Required)
                        </label>
                        <input
                          type="date"
                          defaultValue="2026-10-31"
                          className="w-full rounded-md border border-slate-400 px-2.5 py-2 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setSupplierUploaded(true);
                        setRequirements((prev) =>
                          prev.map((r) =>
                            r.key === "REQ-HVAC-018"
                              ? {
                                  ...r,
                                  status: "UPLOADED",
                                  revision: "R0",
                                  updatedAt: "Uploaded by supplier",
                                }
                              : r
                          )
                        );
                      }}
                      className="w-full rounded-md bg-[#1D4ED8] py-3 text-xs font-semibold text-white shadow-xs hover:bg-blue-800"
                    >
                      Upload Document
                    </button>
                  </>
                ) : (
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5 text-emerald-900">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600"/>
                        Uploaded. Apex MEP Contractors Pvt Ltd will review it.
                      </span>
                      <button
                        onClick={() => setSupplierUploaded(false)}
                        className="text-emerald-800 underline font-medium"
                      >
                        Replace file
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Need assistance with this request?</span>
                <span className="font-semibold text-blue-700">
                  Contact Meera Deshmukh (+91 98200 XXXXX)
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  /* ======================================================================= */
  /* ISOLATED GUEST PLANE 2: CLIENT ACCEPTANCE PORTAL (SCR-031, AUD-P-16)    */
  /* ======================================================================= */
  if (actorPlane === "CLIENT_GUEST") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col font-sans">
        <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs flex items-center justify-between">
          <span>
            Viewing Isolated Client Acceptance Portal (Writes
            exceptions back as requirement change requests per AUD-P-16)
          </span>
          <button
            onClick={() => setActorPlane("CONTRACTOR")}
            className="rounded bg-blue-600 px-2.5 py-1 text-white font-medium hover:bg-blue-500"
          >
            Return to Contractor Workspace
          </button>
        </div>

        <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[#0F2942] text-white font-bold text-xs">
              AM
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">
                Skyview Commercial Towers — HVAC Handover Package v2
              </div>
              <div className="text-xs text-slate-500">
                Submitted by Apex MEP Contractors Pvt Ltd · 31 Oct 2026
              </div>
            </div>
          </div>
          <span className="rounded-full bg-amber-50 border border-amber-300 px-3 py-1 text-xs font-medium text-amber-900">
            External access · Client Representative
          </span>
        </header>

        <main className="mx-auto w-full max-w-3xl p-6 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Handover Package Summary
                </h2>
                <p className="text-xs text-slate-500">
                  71 Approved Documents · 482 Pages · SHA-256 Verified Manifest
                </p>
              </div>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                <Download className="h-4 w-4"/>
                <span>Download Package PDF (184 MB)</span>
              </button>
            </div>

            {!clientDecisionSubmitted ? (
              <div className="space-y-4 text-xs">
                <div className="font-semibold text-slate-800">
                  Record Formal Handover Decision
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: "ACCEPT", label: "Accept Package" },
                    {
                      id: "ACCEPT_WITH_EXCEPTIONS",
                      label: "Accept with Exceptions",
                    },
                    { id: "REJECT", label: "Reject Package" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() =>
                        setClientDecisionType(opt.id as typeof clientDecisionType)
                      }
                      className={`rounded-lg border p-3 text-left font-semibold transition-all ${
                        clientDecisionType === opt.id
                          ? "border-blue-600 bg-blue-50/60 text-blue-900 ring-1 ring-blue-600"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {clientDecisionType !== "ACCEPT" && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Exceptions / Rejection Remarks (Required — creates follow-up change
                      request)
                    </label>
                    <textarea
                      rows={3}
                      value={clientExceptionText}
                      onChange={(e) => setClientExceptionText(e.target.value)}
                      className="w-full rounded-md border border-slate-300 p-2.5 text-xs"
                    />
                  </div>
                )}

                <div className="rounded-md bg-slate-50 p-3 border border-slate-200 text-[11px] text-slate-600">
                  This decision will be recorded with your name (DLF CyberCity
                  Authorised Representative) and timestamp.
                </div>

                <button
                  onClick={() => {
                    setClientDecisionSubmitted(true);
                    if (clientDecisionType === "ACCEPT_WITH_EXCEPTIONS") {
                      setChangeRequests((prev) => [
                        ...prev,
                        {
                          id: `CR-0${prev.length + 1}`,
                          reason: `Client Acceptance Exception: ${clientExceptionText}`,
                          createdBy: "DLF Client Representative (External)",
                          createdAt: "31 Oct 2026, 10:05 IST",
                          status: "SUBMITTED",
                        },
                      ]);
                    }
                  }}
                  className="w-full rounded-md bg-[#0F2942] py-2.5 text-xs font-semibold text-white hover:bg-[#163A5F]"
                >
                  Confirm & Record Decision
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-1.5">
                <div className="font-bold text-emerald-900">
                  ✓ Decision Recorded ({clientDecisionType.replace(/_/g, " ")})
                </div>
                <p>
                  Your exception remarks have been automatically written back to Apex
                  MEP’s project register as Change Request{" "}
                  <strong className="font-mono">CR-01</strong> so nothing is lost.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  /* ======================================================================= */
  /* CONTRACTOR WORKSPACE PLANE (DEFAULT DESKTOP & MOBILE SHELL)             */
  /* ======================================================================= */
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A] antialiased font-sans">
      {/* 1. LEFT NAVIGATION RAIL (11-UI-UX-SPECIFICATION.md §2.1) */}
      <aside
        className={`${
          sidebarCollapsed ? "w-16" : "w-60"
        } flex flex-col justify-between border-r border-slate-800 bg-[#0B1120] text-slate-300 transition-all duration-200 shrink-0 select-none`}
      >
        <div>
          <div className="flex h-14 items-center justify-between px-3.5 border-b border-slate-800">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm">
                TC
              </div>
              {!sidebarCollapsed && (
                <div className="truncate">
                  <div className="font-semibold text-sm text-white truncate">
                    TradeCloseout
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Apex MEP Contractors
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4"/>
              ) : (
                <PanelLeftClose className="h-4 w-4"/>
              )}
            </button>
          </div>

          {/* Primary Nav */}
          <div className="px-2.5 py-3 space-y-1">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              {
                id: "checklist",
                label: "Checklist",
                icon: ClipboardCheck,
                badge: requirements.length,
              },
              {
                id: "reviews",
                label: "Reviews",
                icon: Eye,
                badge: requirements.filter((r) => r.status === "IN_REVIEW").length,
              },
              { id: "packages", label: "Packages", icon: PackageCheck },
              {
                id: "warranty_dlp",
                label: "Warranties & Defects",
                icon: Wrench,
                badge: defects.filter((d) => d.status !== "CLOSED").length,
              },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as typeof activeTab)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className="h-4 w-4 shrink-0"/>
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </div>
                  {!sidebarCollapsed && item.badge !== undefined && (
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* External Guest Plane Switchers (To inspect isolated SCR-034 & SCR-031) */}
          {!sidebarCollapsed && (
            <div className="px-3 pt-4 border-t border-slate-800/80 space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Isolated Guest Portals
              </div>
              <button
                onClick={() => setActorPlane("SUPPLIER_GUEST")}
                className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-xs text-emerald-300 hover:border-emerald-500/40"
              >
                <span>Supplier Upload Link</span>
                <ExternalLink className="h-3.5 w-3.5"/>
              </button>
              <button
                onClick={() => setActorPlane("CLIENT_GUEST")}
                className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-xs text-amber-300 hover:border-amber-500/40"
              >
                <span>Client Acceptance Portal</span>
                <ExternalLink className="h-3.5 w-3.5"/>
              </button>
            </div>
          )}
        </div>

        {/* Bottom Plan & Storage Counter */}
        {!sidebarCollapsed && (
          <div className="border-t border-slate-800 p-3 text-[11px] text-slate-400">
            <div className="flex justify-between font-medium text-slate-300">
              <span>Growth Plan</span>
              <span className="font-mono text-emerald-400">₹9,999/mo</span>
            </div>
            <div className="mt-1 font-mono text-[10px]">
              38.4 GB / 100 GB · Mumbai Region
            </div>
          </div>
        )}
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar (11 §2.1: Org switcher | Global search | Help | Notifications | Profile) */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="flex items-center gap-3 text-xs">
            <button className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-900 hover:bg-slate-100">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              <span>Apex MEP Contractors Pvt Ltd</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500"/>
            </button>
            <ChevronRight className="h-4 w-4 text-slate-400"/>
            <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
              PRJ-024
            </span>
            <span className="font-semibold text-slate-900 truncate max-w-md">
              Skyview Commercial Towers (HVAC)
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400"/>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (activeTab !== "checklist") setActiveTab("checklist");
                }}
                placeholder="Search equipment (CHLR-01), document..."
                className="h-8 w-64 rounded-md border border-slate-300 bg-slate-50 pl-8 pr-3 text-xs focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>

            <button
              onClick={handleToggleDemoData}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Toggle between clean empty state and realistic demonstration data"
            >
              {isDemoDataLoaded ? "Clear Sample Data" : "Load Sample Data"}
            </button>

            <button
              onClick={() => setNewReqModalOpen(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add requirement</span>
            </button>

            <button
              onClick={() => {
                if (requirements.length > 0) {
                  setUploadTarget(requirements[0]);
                  setUploadSheetOpen(true);
                } else {
                  setNewReqModalOpen(true);
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0F2942] px-3 text-xs font-semibold text-white hover:bg-[#163A5F]"
            >
              <UploadCloud className="h-3.5 w-3.5"/>
              <span>Upload document</span>
            </button>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                AP
              </div>
              <div className="hidden lg:block text-xs leading-tight">
                <div className="font-semibold text-slate-900">Anil Pillai</div>
                <div className="text-[10px] text-slate-500">Project Manager</div>
              </div>
            </div>
          </div>
        </header>

        {/* Project Handover Mode Banner (11 §4.4) */}
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50/70 px-5 py-2 text-xs text-blue-950">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-blue-700"/>
            <span>
              <strong>Handover in progress</strong> — Target handover date:{" "}
              <strong className="font-mono">18 Nov 2026</strong> (17 days remaining).
            </span>
          </div>
          {changeRequests.length > 0 && (
            <span className="rounded bg-amber-100 border border-amber-300 px-2 py-0.5 font-semibold text-amber-900">
              {changeRequests.length} Client Exception Change Request Pending
            </span>
          )}
        </div>

        {/* =============================================================== */}
        {/* TAB 1: PROJECT OVERVIEW (SCR-013)                               */}
        {/* =============================================================== */}
        {activeTab === "overview" && (
          <main className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Dynamic Segmented Progress Card */}
            {(() => {
              const totalReqs = requirements.length;
              const approvedReqs = requirements.filter((r) => r.status === "APPROVED").length;
              const extApprovedReqs = requirements.filter((r) => r.status === "APPROVED_EXTERNAL").length;
              const waivedReqs = requirements.filter((r) => r.status === "WAIVED").length;
              const inReviewReqs = requirements.filter((r) => r.status === "IN_REVIEW" || r.status === "UPLOADED").length;
              const blockersReqs = requirements.filter((r) => r.status === "MISSING" || r.status === "EXPIRED").length;
              const compliantTotal = approvedReqs + extApprovedReqs + waivedReqs;
              const pct = totalReqs > 0 ? ((compliantTotal / totalReqs) * 100).toFixed(1) : "0.0";
              const pApp = totalReqs > 0 ? (approvedReqs / totalReqs) * 100 : 0;
              const pExt = totalReqs > 0 ? (extApprovedReqs / totalReqs) * 100 : 0;
              const pWai = totalReqs > 0 ? (waivedReqs / totalReqs) * 100 : 0;
              const pRev = totalReqs > 0 ? (inReviewReqs / totalReqs) * 100 : 0;
              const pBlk = totalReqs > 0 ? (blockersReqs / totalReqs) * 100 : 0;
              const equipmentCount = new Set(requirements.filter((r) => r.assetTag).map((r) => r.assetTag)).size;

              return (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Required Documents Progress
                      </span>
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {compliantTotal} of {totalReqs} required documents approved ({pct}%)
                      </span>
                    </div>
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 gap-0.5 border border-slate-200">
                      <div style={{ width: `${pApp}%` }} className="bg-emerald-600 rounded-l-full" />
                      <div style={{ width: `${pExt}%` }} className="bg-teal-600" />
                      <div style={{ width: `${pWai}%` }} className="bg-purple-600" />
                      <div style={{ width: `${pRev}%` }} className="bg-amber-500" />
                      <div style={{ width: `${pBlk}%` }} className="bg-red-600 rounded-r-full" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-600">
                      <span>● {approvedReqs} Approved</span>
                      <span>● {extApprovedReqs} Approved (external)</span>
                      <span>● {waivedReqs} Waived</span>
                      <span className="text-amber-800 font-medium">
                        ● {inReviewReqs} Waiting for review
                      </span>
                      <span className="text-red-700 font-semibold">
                        ● {blockersReqs} Missing / Expired blockers
                      </span>
                    </div>
                  </div>

                  {/* KPI Row */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="text-xs text-slate-500 font-medium">
                        Contract Retention Gated
                      </div>
                      <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900">
                        {totalReqs > 0 ? "₹75,00,000" : "₹0"}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {totalReqs > 0 ? "5% of ₹15,00,00,000 contract value" : "No active contract value"}
                      </div>
                    </div>
                    <div
                      onClick={() => setActiveTab("reviews")}
                      className="cursor-pointer rounded-lg border border-amber-300 bg-white p-4 hover:bg-amber-50/30"
                    >
                      <div className="text-xs text-amber-900 font-medium">
                        Waiting for Review
                      </div>
                      <div className="mt-1.5 font-mono text-2xl font-bold text-amber-800">
                        {inReviewReqs} Documents
                      </div>
                      <div className="mt-1 text-[11px] text-blue-700 font-semibold">
                        Open Review Queue →
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="text-xs text-slate-500 font-medium">
                        Equipment Coverage
                      </div>
                      <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900">
                        {equipmentCount} Units
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {equipmentCount > 0 ? "Mandatory certificates linked" : "No equipment tagged"}
                      </div>
                    </div>
              <div
                onClick={() => setActiveTab("warranty_dlp")}
                className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50"
              >
                <div className="text-xs text-slate-500 font-medium">
                  Open Defects / Snags
                </div>
                <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900">
                  {defects.filter((d) => d.status !== "CLOSED").length} Active
                </div>
                <div className="mt-1 text-[11px] text-blue-700 font-semibold">
                  Manage DLP & Warranties →
                </div>
              </div>
            </div>
                </>
              );
            })()}
          </main>
        )}

        {/* =============================================================== */}
        {/* TAB 2: CHECKLIST GRID (SCR-014) + DETAIL DRAWER (SCR-015)       */}
        {/* =============================================================== */}
        {activeTab === "checklist" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 p-5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border border-slate-200 bg-white px-4 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "ALL", label: "All requirements" },
                    { id: "BLOCKERS", label: "Missing & Expired" },
                    { id: "IN_REVIEW", label: "Waiting for review" },
                    { id: "CHANGES_REQUESTED", label: "Changes requested" },
                    { id: "APPROVED_ALL", label: "Approved" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setStatusFilter(f.id)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium border ${
                        statusFilter === f.id
                          ? "bg-[#0F2942] text-white border-[#0F2942]"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto border-x border-b border-slate-200 bg-white rounded-b-lg">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="py-2.5 pl-4">Requirement</th>
                      <th className="py-2.5 px-3">Equipment</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Owner</th>
                      <th className="py-2.5 px-3">Due Date</th>
                      <th className="py-2.5 pr-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredReqs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-xs text-slate-500">
                          <ClipboardCheck className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                          <div className="font-semibold text-slate-700 text-sm">Checklist is Empty</div>
                          <p className="mt-1 max-w-sm mx-auto text-slate-400">
                            No requirements found matching your criteria. Add a requirement or load demonstration data.
                          </p>
                          <div className="mt-4 flex justify-center gap-2">
                            <button
                              onClick={() => setNewReqModalOpen(true)}
                              className="rounded-md bg-[#0F2942] px-3 py-1.5 font-medium text-white hover:bg-[#163A5F]"
                            >
                              Add Requirement
                            </button>
                            <button
                              onClick={handleToggleDemoData}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {isDemoDataLoaded ? "Clear Demo Data" : "Load Demo Data"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                    filteredReqs.map((req) => (
                      <tr
                        key={req.id}
                        onClick={() => setDetailReq(req)}
                        className="cursor-pointer hover:bg-slate-50"
                      >
                        <td className="py-2.5 pl-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-slate-600">
                              {req.key}
                            </span>
                            {req.mandatory && (
                              <span className="rounded bg-red-50 border border-red-200 px-1.5 py-0.2 text-[10px] font-semibold text-red-700">
                                Mandatory
                              </span>
                            )}
                          </div>
                          <div className="font-medium text-slate-900 mt-0.5">
                            {req.title}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {req.assetTag || "Project-wide"}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusBadge sm status={req.status}/>
                        </td>
                        <td className="py-2.5 px-3">{req.ownerName}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {req.dueDate || "No deadline"}
                        </td>
                        <td
                          className="py-2.5 pr-4 text-right space-x-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {req.status !== "APPROVED" &&
                            req.status !== "APPROVED_EXTERNAL" &&
                            req.status !== "WAIVED" && (
                              <button
                                onClick={() => setWaiverModalReq(req)}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Waive
                              </button>
                            )}
                          <button
                            onClick={() => {
                              setUploadTarget(req);
                              setUploadSheetOpen(true);
                            }}
                            className="rounded bg-[#0F2942] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#163A5F]"
                          >
                            Upload
                          </button>
                        </td>
                      </tr>
                    ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =============================================================== */}
        {/* TAB 3: DOCUMENT VIEWER & REVIEW DECISION (SCR-025 / SCR-027)    */}
        {/* =============================================================== */}
        {activeTab === "reviews" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Dark PDF Stage */}
            <div className="flex-1 bg-[#1E293B] p-6 overflow-auto flex justify-center items-start">
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                  const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                  setPdfPins((prev) => [
                    ...prev,
                    {
                      id: prev.length + 1,
                      page: 12,
                      x,
                      y,
                      text: `Pin #${prev.length + 1} dropped on Page 12`,
                      author: "Anil Pillai",
                    },
                  ]);
                }}
                className="relative w-[640px] rounded-xs bg-white p-8 text-slate-900 shadow-2xl cursor-crosshair select-none"
              >
                <div className="text-[10px] font-mono text-slate-500 flex justify-between border-b border-slate-300 pb-2">
                  <span>CARRIER AIR CONDITIONING INDIA · HYDROSTATIC TEST REPORT</span>
                  <span>PAGE 12 OF 48 (Click anywhere on page to drop comment pin)</span>
                </div>
                <h2 className="mt-3 text-sm font-bold">
                  CHILLED WATER HEADER PRESSURE TEST CERTIFICATE (10.5 BAR)
                </h2>
                <p className="mt-1 text-xs text-slate-600 font-mono">
                  Equipment: CHLR-01 · Gauge: WIKA PG-NABL-409 · Result: ZERO DROP (4 HRS)
                </p>

                {pdfPins.map((pin) => (
                  <div
                    key={pin.id}
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white shadow-md ring-4 ring-orange-500/30"
                  >
                    {pin.id}
                  </div>
                ))}
              </div>
            </div>

            {/* Right Decision Panel (SCR-027) */}
            <div className="w-96 shrink-0 border-l border-slate-200 bg-white flex flex-col justify-between p-4 overflow-y-auto">
              <div className="space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <div className="font-mono text-xs font-bold text-blue-700">
                    REQ-HVAC-033 · Revision R2
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
                    Chilled Water Header Hydrostatic Test Report
                  </h3>
                </div>

                {reviewError && (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                    {reviewError}
                  </div>
                )}
                {reviewSuccess && (
                  <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
                    {reviewSuccess}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    Page Comments ({pdfPins.length})
                  </div>
                  {pdfPins.map((p) => (
                    <div
                      key={p.id}
                      className="rounded border border-orange-200 bg-orange-50/60 p-2.5 text-xs"
                    >
                      <div className="font-semibold text-orange-950">
                        Pin #{p.id} (Page {p.page}) · {p.author}
                      </div>
                      <div className="text-slate-700 mt-0.5">{p.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Decision Controls */}
              <div className="border-t border-slate-200 pt-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 font-semibold">
                  <button
                    onClick={() => setReviewTab("in_app")}
                    className={`rounded py-1.5 ${
                      reviewTab === "in_app" ? "bg-white shadow-2xs" : "text-slate-600"
                    }`}
                  >
                    In-App Review
                  </button>
                  <button
                    onClick={() => setReviewTab("external")}
                    className={`rounded py-1.5 ${
                      reviewTab === "external" ? "bg-white shadow-2xs" : "text-slate-600"
                    }`}
                  >
                    Record External Approval
                  </button>
                </div>

                {reviewTab === "in_app" ? (
                  <>
                    <textarea
                      rows={2}
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Review comment (required for changes/reject, min 10 chars)..."
                      className="w-full rounded border border-slate-300 p-2 text-xs"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleReviewDecision("APPROVE")}
                        className="rounded bg-emerald-700 py-2 font-semibold text-white hover:bg-emerald-800"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReviewDecision("REQUEST_CHANGES")}
                        className="rounded bg-orange-600 py-2 font-semibold text-white hover:bg-orange-700"
                      >
                        Request changes
                      </button>
                      <button
                        onClick={() => handleReviewDecision("REJECT")}
                        className="rounded bg-red-600 py-2 font-semibold text-white hover:bg-red-700"
                      >
                        Reject
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={extApprover}
                      onChange={(e) => setExtApprover(e.target.value)}
                      placeholder="Approver Name & Organisation"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={extMethod}
                        onChange={(e) =>
                          setExtMethod(e.target.value as typeof extMethod)
                        }
                        className="rounded border border-slate-300 px-2 py-1.5"
                      >
                        <option value="STAMPED_PDF">Stamped PDF</option>
                        <option value="EMAIL">Email</option>
                        <option value="PORTAL">Portal transmittal</option>
                        <option value="PHYSICAL">Physical meeting</option>
                      </select>
                      <input
                        type="date"
                        value={extDate}
                        onChange={(e) => setExtDate(e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1.5 font-mono"
                      />
                    </div>
                    <button
                      onClick={() => handleReviewDecision("APPROVE")}
                      className="w-full rounded bg-teal-700 py-2 font-semibold text-white hover:bg-teal-800"
                    >
                      Save External Approval
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =============================================================== */}
        {/* TAB 4: PACKAGE BUILDER & PREVIEW (SCR-028 / SCR-057)            */}
        {/* =============================================================== */}
        {activeTab === "packages" && (
          <main className="flex-1 overflow-y-auto p-5 space-y-4">
            {packageGeneratedBanner && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs font-medium text-emerald-900">
                {packageGeneratedBanner}
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Handover Package Preview & Readiness Check
                </h2>
                <p className="text-xs text-slate-500">
                  Pure Node.js PDF/A compilation (`pdf-lib` + `qpdf`) · Includes cover,
                  approval summary, waivers & bookmarks
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/v1/projects/${activeProject?.id || "default"}/dossier/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Dossier PDF</span>
                </a>
                <button
                  onClick={() => setOverrideModalOpen(true)}
                  className="rounded-md bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163A5F]"
                >
                  Generate Handover Package
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="py-2.5 pl-4">Requirement Item</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Est. Pages</th>
                    <th className="py-2.5 pr-4 text-right">Include / Exclude</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {requirements.map((r) => (
                    <tr key={r.id} className={r.excludedFromPackage ? "opacity-50" : ""}>
                      <td className="py-2.5 pl-4 font-medium text-slate-900">
                        {r.key} · {r.title}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge sm status={r.status}/>
                      </td>
                      <td className="py-2.5 px-3 font-mono">{r.pages || 2} pp</td>
                      <td className="py-2.5 pr-4 text-right">
                        <button
                          onClick={() =>
                            setRequirements((prev) =>
                              prev.map((item) =>
                                item.id === r.id
                                  ? {
                                      ...item,
                                      excludedFromPackage: !item.excludedFromPackage,
                                      exclusionReason: !item.excludedFromPackage
                                        ? "Excluded for partial phase handover"
                                        : undefined,
                                    }
                                  : item
                              )
                            )
                          }
                          className="text-xs font-medium text-blue-700 hover:underline"
                        >
                          {r.excludedFromPackage ? "Include item" : "Exclude with reason"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </main>
        )}

        {/* =============================================================== */}
        {/* TAB 5: WARRANTY & DEFECT / SNAG TRACKER (SCR-058 & SCR-059)     */}
        {/* =============================================================== */}
        {activeTab === "warranty_dlp" && (
          <main className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold text-slate-900">
                Defect Liability Period (DLP) Snag Tracker
              </h2>
              <div className="mt-3 divide-y divide-slate-200 text-xs">
                {defects.map((d) => (
                  <div key={d.id} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-slate-700">
                        {d.code} ({d.assetTag})
                      </span>{" "}
                      — <span className="font-medium text-slate-900">{d.title}</span>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Assigned to: {d.assignee} · Due: {d.dueDate}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        setDefects((prev) =>
                          prev.map((item) =>
                            item.id === d.id ? { ...item, status: "CLOSED" } : item
                          )
                        )
                      }
                      className={`rounded px-2.5 py-1 font-semibold ${
                        d.status === "CLOSED"
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-[#0F2942] text-white"
                      }`}
                    >
                      {d.status === "CLOSED" ? "Closed" : "Upload Evidence & Close"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </main>
        )}
      </div>

      {/* =================================================================== */}
      {/* MODAL 1: TWO-APPROVER MANDATORY WAIVER (FR-CHK-016)                 */}
      {/* =================================================================== */}
      {waiverModalReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Waive Requirement ({waiverModalReq.key})
              </h3>
              <button onClick={() => setWaiverModalReq(null)}>
                <X className="h-4 w-4 text-slate-400"/>
              </button>
            </div>
            {waiverModalReq.mandatory && (
              <div className="rounded bg-purple-50 border border-purple-200 p-2.5 text-purple-900">
                <strong>Mandatory Requirement Guardrail:</strong> Waiving a mandatory
                requirement requires a recorded reason and a second approver
                (Owner/Admin) countersignature.
              </div>
            )}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Waiver Reason (Required)
              </label>
              <textarea
                rows={2}
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="State contractual clause or client instruction waiving this item..."
                className="w-full rounded border border-slate-300 p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Countersigning Second Approver (Owner / Admin)
              </label>
              <input
                type="text"
                value={waiverSecondApprover}
                onChange={(e) => setWaiverSecondApprover(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <button
              onClick={() => {
                if (!waiverReason.trim()) return;
                setRequirements((prev) =>
                  prev.map((r) =>
                    r.id === waiverModalReq.id
                      ? {
                          ...r,
                          status: "WAIVED",
                          waiverSecondApprover,
                          updatedAt: "Waived (2-approver)",
                        }
                      : r
                  )
                );
                setWaiverModalReq(null);
                setWaiverReason("");
              }}
              className="w-full rounded-md bg-purple-700 py-2.5 font-semibold text-white hover:bg-purple-800"
            >
              Confirm Two-Approver Waiver
            </button>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: PACKAGE READINESS OVERRIDE (FR-HND-008)                    */}
      {/* =================================================================== */}
      {overrideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Readiness Gate Warning (2 Blockers)
              </h3>
              <button onClick={() => setOverrideModalOpen(false)}>
                <X className="h-4 w-4 text-slate-400"/>
              </button>
            </div>
            <div className="rounded bg-red-50 border border-red-200 p-3 text-red-900 space-y-1">
              <div className="font-bold">Blocking Items Detected:</div>
              <div>• REQ-HVAC-001: Missing (Fire Officer NOC)</div>
              <div>• REQ-HVAC-002: Expired (CAR Insurance Policy)</div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Override Reason (Required to generate package with missing/expired items)
              </label>
              <textarea
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g., Provisional package for PMC stage review; NOC awaited from Fire Dept."
                className="w-full rounded border border-slate-300 p-2"
              />
            </div>
            <button
              onClick={() => {
                if (!overrideReason.trim()) return;
                setOverrideModalOpen(false);
                setPackageGeneratedBanner(
                  `Handover Package v3 queued with recorded override reason: "${overrideReason}".`
                );
              }}
              className="w-full rounded-md bg-[#0F2942] py-2.5 font-semibold text-white hover:bg-[#163A5F]"
            >
              Record Override & Generate Package
            </button>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 4: NEW REQUIREMENT MODAL                                      */}
      {/* =================================================================== */}
      {newReqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Add Closeout Requirement</h3>
              <button onClick={() => setNewReqModalOpen(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Requirement Title</label>
              <input
                type="text"
                value={newReqTitle}
                onChange={(e) => setNewReqTitle(e.target.value)}
                placeholder="e.g., AHU Static Pressure Test Report"
                className="w-full rounded border border-slate-300 p-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Document Type</label>
                <select
                  value={newReqDocType}
                  onChange={(e) => setNewReqDocType(e.target.value)}
                  className="w-full rounded border border-slate-300 p-2 bg-white"
                >
                  <option value="DT-001">DT-001 As-Built Drawing</option>
                  <option value="DT-022">DT-022 Factory Test Report</option>
                  <option value="DT-033">DT-033 Pressure Test Report</option>
                  <option value="DT-044">DT-044 Operation & Maintenance Manual</option>
                  <option value="DT-086">DT-086 Fire Safety / NOC</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Equipment Tag</label>
                <input
                  type="text"
                  value={newReqAssetTag}
                  onChange={(e) => setNewReqAssetTag(e.target.value)}
                  placeholder="e.g., AHU-FL08"
                  className="w-full rounded border border-slate-300 p-2 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={newReqDueDate}
                  onChange={(e) => setNewReqDueDate(e.target.value)}
                  className="w-full rounded border border-slate-300 p-2"
                />
              </div>
              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newReqMandatory}
                    onChange={(e) => setNewReqMandatory(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span className="font-semibold text-slate-700">Mandatory Closeout Item</span>
                </label>
              </div>
            </div>
            <button
              onClick={async () => {
                if (!newReqTitle.trim()) return;
                const newId = "req-" + Date.now();
                const newKey = "REQ-HVAC-" + String(requirements.length + 1).padStart(3, "0");
                const newReq: RequirementRow = {
                  id: newId,
                  key: newKey,
                  groupKey: "G1",
                  groupName: "01. General Closeout Requirements",
                  title: newReqTitle.trim(),
                  docTypeCode: newReqDocType,
                  docTypeName: "Closeout Document",
                  mandatory: newReqMandatory,
                  assetTag: newReqAssetTag.trim() || null,
                  assetName: newReqAssetTag.trim() ? `Asset ${newReqAssetTag.trim()}` : "Project-wide",
                  status: "NOT_STARTED",
                  ownerName: sessionUser?.full_name || "Assigned Lead",
                  ownerRole: "Lead Engineer",
                  reviewerRole: "Project Director",
                  dueDate: newReqDueDate,
                  revision: null,
                  updatedAt: "Just added",
                };
                setRequirements((prev) => [newReq, ...prev]);
                if (activeProject) {
                  api.checklists.createRequirement(activeProject.id, {
                    title: newReqTitle.trim(),
                    docTypeCode: newReqDocType,
                    mandatory: newReqMandatory,
                    assetTag: newReqAssetTag.trim() || undefined,
                    dueDate: newReqDueDate,
                  }).catch(() => {});
                }
                setNewReqTitle("");
                setNewReqAssetTag("");
                setNewReqModalOpen(false);
              }}
              className="w-full rounded-md bg-[#0F2942] py-2.5 font-semibold text-white hover:bg-[#163A5F]"
            >
              Save Requirement
            </button>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: UPLOAD SHEET WITH LOCALSTORAGE AUTOSAVE (SCR-023)          */}
      {/* =================================================================== */}
      {uploadSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="font-mono font-bold text-blue-700">
                  {uploadTarget?.key} · {uploadTarget?.assetTag || "Project-wide"}
                </div>
                <div className="font-semibold text-slate-900">{uploadTarget?.title}</div>
              </div>
              <button onClick={() => setUploadSheetOpen(false)}>
                <X className="h-4 w-4 text-slate-400"/>
              </button>
            </div>

            {uploadFileError && (
              <div className="rounded border border-red-300 bg-red-50 p-2.5 text-red-900 font-medium">
                {uploadFileError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() =>
                  handleSimulateFileSelect("PRJ-024-HVAC-CERT-R1-20261031.pdf")
                }
                className="rounded-lg border-2 border-dashed border-blue-600 bg-blue-50/40 p-3 font-semibold text-blue-900 hover:bg-blue-50"
              >
                Select Valid PDF
              </button>
              <button
                onClick={() => handleSimulateFileSelect("malicious-diagram.svg")}
                className="rounded-lg border border-slate-300 bg-slate-50 p-3 font-medium text-slate-700 hover:bg-slate-100"
              >
                Test Banned SVG (11 §4.8)
              </button>
            </div>

            {selectedFileName && (
              <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 font-mono text-[11px] text-emerald-900">
                Selected file retained in memory: {selectedFileName}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Revision Code (Required)
                </label>
                <input
                  type="text"
                  value={draftRev}
                  onChange={(e) => setDraftRev(e.target.value)}
                  className="w-full rounded border border-slate-400 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Issue Date (Required)
                </label>
                <input
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="w-full rounded border border-slate-400 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <label className="font-semibold text-slate-700">
                  Remarks (Optional)
                </label>
                <span className="text-[10px] text-emerald-700 font-medium">
                  ✓ Autosaved to localStorage
                </span>
              </div>
              <input
                type="text"
                value={draftRemarks}
                onChange={(e) => updateDraftRemarks(e.target.value)}
                placeholder="Notes for reviewer..."
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>

            <button
              onClick={() => {
                if (uploadTarget) {
                  setRequirements((prev) =>
                    prev.map((r) =>
                      r.id === uploadTarget.id
                        ? {
                            ...r,
                            status: "IN_REVIEW",
                            revision: draftRev,
                            updatedAt: "Just now",
                          }
                        : r
                    )
                  );
                }
                setUploadSheetOpen(false);
              }}
              className="w-full rounded-md bg-[#1D4ED8] py-2.5 font-semibold text-white hover:bg-blue-800"
            >
              Upload & Submit for Review
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
