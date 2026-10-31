'use client';

import React, { useState } from 'react';
import {
  RequirementStatusPill,
  type RequirementVisualStatus,
} from '../components/requirement-status-pill';
import {
  Building2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Package,
  Layers,
  ShieldCheck,
  CreditCard,
  Search,
  Bell,
  ChevronDown,
  ChevronUp,
  UploadCloud,
  FileCheck2,
  Users,
  Settings,
  Camera,
  File as FileIcon,
  Eye,
  Download,
  Maximize2,
  MapPin,
  Lock,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  ShieldAlert,
  CalendarX2,
  Stamp,
  Check,
  Plus,
  X,
  FileSpreadsheet,
  AlertCircle,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';

interface ChecklistItem {
  id: string;
  key: string;
  title: string;
  docType: string;
  group: string;
  assetTag?: string;
  mandatory: boolean;
  status: RequirementVisualStatus;
  owner: string;
  ownerType: 'internal' | 'supplier';
  dueDate: string;
  isOverdue?: boolean;
  revision: string;
}

export default function TradeCloseoutPrecisionBlueprint() {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'checklist' | 'viewer' | 'package' | 'supplier'
  >('overview');
  const [checklistFilter, setChecklistFilter] = useState<string>('ALL');
  const [checklistSearch, setChecklistSearch] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showUploadSheet, setShowUploadSheet] = useState<boolean>(false);
  const [uploadContext, setUploadContext] = useState<{
    projectCode: string;
    assetTag: string;
    reqTitle: string;
    docType: string;
  }>({
    projectCode: 'PRJ-024',
    assetTag: 'CHLR-01',
    reqTitle: 'Chilled Water Piping Hydrostatic Test Certificate (10.5 bar)',
    docType: 'DT-033',
  });

  // Viewer / SCR-025 state
  const [viewerPage, setViewerPage] = useState<number>(12);
  const [viewerZoom, setViewerZoom] = useState<number>(125);
  const [pagePins, setPagePins] = useState<Array<{ id: number; x: number; y: number; text: string }>>([
    { id: 1, x: 45, y: 38, text: 'Verify sensor calibration tolerance per Section 4.2' },
  ]);
  const [activePinDraft, setActivePinDraft] = useState<boolean>(false);
  const [decisionTab, setDecisionTab] = useState<'in_app' | 'external'>('in_app');
  const [decisionComment, setDecisionComment] = useState<string>('');
  const [externalApprover, setExternalApprover] = useState<string>('Vikram Sengupta (Lead PMC Consultant)');
  const [externalMethod, setExternalMethod] = useState<'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL'>('STAMPED_PDF');

  // Upload Sheet State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(42);
  const [isNetworkPaused, setIsNetworkPaused] = useState<boolean>(false);

  // Sample data conforming to Precision Blueprint
  const checklistData: ChecklistItem[] = [
    {
      id: 'item-1',
      key: 'REQ-HVAC-014',
      title: 'Chilled Water Piping Hydrostatic Test Certificate (10.5 bar)',
      docType: 'DT-033',
      group: '8. Commissioning & Performance Testing',
      assetTag: 'CHLR-01',
      mandatory: true,
      status: 'APPROVED',
      owner: 'Anil Pillai',
      ownerType: 'internal',
      dueDate: '25 Oct 2026',
      revision: 'R2',
    },
    {
      id: 'item-2',
      key: 'REQ-HVAC-018',
      title: 'Centrifugal Chiller Factory Test & Performance Run Curve (AHRI 550/590)',
      docType: 'DT-012',
      group: '8. Commissioning & Performance Testing',
      assetTag: 'CHLR-01',
      mandatory: true,
      status: 'APPROVED_EXTERNAL',
      owner: 'Carrier India OEM',
      ownerType: 'supplier',
      dueDate: '20 Oct 2026',
      revision: 'R1',
    },
    {
      id: 'item-3',
      key: 'REQ-HVAC-022',
      title: 'Air Handling Unit Air Balancing (TAB) Complete Register (AHU-01 to AHU-08)',
      docType: 'DT-045',
      group: '8. Commissioning & Performance Testing',
      assetTag: 'AHU-L03-01',
      mandatory: true,
      status: 'IN_REVIEW',
      owner: 'Sunil Rao (QC)',
      ownerType: 'internal',
      dueDate: '02 Nov 2026',
      revision: 'R1',
    },
    {
      id: 'item-4',
      key: 'REQ-HVAC-029',
      title: 'BMS DDC Controller Field Integration Signoff & As-Built Points List',
      docType: 'DT-058',
      group: '10. As-Built Drawings & Controls Integration',
      assetTag: 'BMS-CP-01',
      mandatory: true,
      status: 'CHANGES_REQUESTED',
      owner: 'SmartControls Ltd',
      ownerType: 'supplier',
      dueDate: '28 Oct 2026',
      isOverdue: true,
      revision: 'R1',
    },
    {
      id: 'item-5',
      key: 'REQ-HVAC-031',
      title: 'Water Cooled Screw Chiller (500 TR) Comprehensive 5-Year OEM Warranty',
      docType: 'DT-088',
      group: '12. OEM Warranties & DLP Certificates',
      assetTag: 'CHLR-01',
      mandatory: true,
      status: 'WAIVED',
      owner: 'Carrier India OEM',
      ownerType: 'supplier',
      dueDate: '15 Oct 2026',
      revision: 'R0',
    },
    {
      id: 'item-6',
      key: 'REQ-HVAC-035',
      title: 'Chief Fire Officer Statutory NOC & Smoke Spill Damper Test Certificate',
      docType: 'DT-004',
      group: '8. Commissioning & Performance Testing',
      mandatory: true,
      status: 'MISSING',
      owner: 'Anil Pillai',
      ownerType: 'internal',
      dueDate: '27 Oct 2026',
      isOverdue: true,
      revision: 'R0',
    },
    {
      id: 'item-7',
      key: 'REQ-HVAC-041',
      title: 'Secondary Chilled Water Variable Speed Pump Alignment Certificate',
      docType: 'DT-029',
      group: '8. Commissioning & Performance Testing',
      assetTag: 'PMP-CHW-02',
      mandatory: false,
      status: 'NOT_STARTED',
      owner: 'Amit Sharma',
      ownerType: 'internal',
      dueDate: '08 Nov 2026',
      revision: 'R0',
    },
    {
      id: 'item-8',
      key: 'REQ-HVAC-049',
      title: 'Cooling Tower Induced Draft Noise & Vibration Isolation Certificate',
      docType: 'DT-031',
      group: '8. Commissioning & Performance Testing',
      assetTag: 'CT-01',
      mandatory: false,
      status: 'NOT_APPLICABLE',
      owner: 'Amit Sharma',
      ownerType: 'internal',
      dueDate: '10 Nov 2026',
      revision: 'R0',
    },
  ];

  const filteredChecklist = checklistData.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(checklistSearch.toLowerCase()) ||
      item.key.toLowerCase().includes(checklistSearch.toLowerCase()) ||
      item.docType.toLowerCase().includes(checklistSearch.toLowerCase()) ||
      (item.assetTag && item.assetTag.toLowerCase().includes(checklistSearch.toLowerCase()));

    if (!matchesSearch) return false;

    if (checklistFilter === 'MISSING') return item.status === 'MISSING';
    if (checklistFilter === 'IN_REVIEW') return item.status === 'IN_REVIEW';
    if (checklistFilter === 'CHANGES_REQUESTED') return item.status === 'CHANGES_REQUESTED';
    if (checklistFilter === 'APPROVED')
      return item.status === 'APPROVED' || item.status === 'APPROVED_EXTERNAL';
    if (checklistFilter === 'WAIVED') return item.status === 'WAIVED';

    return true;
  });

  const toggleSelectAll = () => {
    if (selectedItems.length === filteredChecklist.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(filteredChecklist.map((i) => i.id));
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleGroup = (grp: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [grp]: !prev[grp] }));
  };

  // Group items
  const groupedItems = filteredChecklist.reduce(
    (acc, item) => {
      acc[item.group] = acc[item.group] || [];
      acc[item.group].push(item);
      return acc;
    },
    {} as Record<string, ChecklistItem[]>,
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans antialiased">
      {/* 1. Multi-Plane Identity Chrome (Contractor Workspace Plane) */}
      <header className="bg-card text-foreground border-b border-border sticky top-0 z-30 shadow-card-rest">
        {/* Top Edge Accent Bar */}
        <div className="h-1 w-full bg-[var(--tenant-brand)]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          {/* Left: Brand & Org Switcher */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-[var(--tenant-brand)] text-white flex items-center justify-center font-mono font-bold text-sm tracking-wider shadow-sm">
                TC
              </div>
              <div className="hidden sm:block">
                <span className="font-bold text-base tracking-tight text-foreground flex items-center gap-1.5">
                  TradeCloseout
                  <span className="text-[10px] font-mono uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300">
                    Precision Blueprint
                  </span>
                </span>
              </div>
            </div>

            {/* Org Switcher Pill (SCR-005) */}
            <div className="flex items-center gap-2 pl-4 border-l border-border">
              <div className="bg-surface-sunken hover:bg-slate-200/70 transition-colors px-2.5 py-1 rounded-md border border-border flex items-center gap-2 cursor-pointer">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-secondary-foreground truncate max-w-[140px] sm:max-w-[200px]">
                  Apex MEP Contractors Pvt Ltd
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
          </div>

          {/* Right: Quick actions, notifications, user avatar */}
          <div className="flex items-center gap-3">
            {/* Quick Upload Action */}
            <button
              onClick={() => setShowUploadSheet(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-95 text-xs font-medium rounded-md shadow-sm transition-all"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Upload Document</span>
            </button>

            {/* Notification bell */}
            <button className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-surface-sunken transition-colors relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
            </button>

            {/* User Profile */}
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <div className="w-7 h-7 rounded-full bg-slate-800 text-slate-100 flex items-center justify-center font-semibold text-xs">
                AP
              </div>
              <div className="hidden md:block text-left">
                <p className="text-xs font-medium text-foreground leading-tight">Anil Pillai</p>
                <p className="text-[10px] text-muted-foreground font-mono">R-PM (Project Director)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex overflow-x-auto gap-1 border-t border-border no-scrollbar">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 py-2.5 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
              activeTab === 'overview'
                ? 'border-primary text-primary bg-slate-50'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Project Overview (SCR-013)</span>
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`flex items-center gap-2 py-2.5 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
              activeTab === 'checklist'
                ? 'border-primary text-primary bg-slate-50'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Checklist Grid (SCR-014)</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-800 font-bold">
              77
            </span>
          </button>
          <button
            onClick={() => setActiveTab('viewer')}
            className={`flex items-center gap-2 py-2.5 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
              activeTab === 'viewer'
                ? 'border-primary text-primary bg-slate-50'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>PDF Inspection Stage (SCR-025)</span>
          </button>
          <button
            onClick={() => setActiveTab('package')}
            className={`flex items-center gap-2 py-2.5 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
              activeTab === 'package'
                ? 'border-primary text-primary bg-slate-50'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Handover Dossier (SCR-028)</span>
          </button>
          <button
            onClick={() => setActiveTab('supplier')}
            className={`flex items-center gap-2 py-2.5 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
              activeTab === 'supplier'
                ? 'border-primary text-primary bg-slate-50'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span>Supplier Portal Link (SCR-034)</span>
          </button>
        </div>
      </header>

      {/* Main Viewport Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* ==================================================================== */}
        {/* TAB 1: SCR-010 / SCR-013 EXECUTIVE BENTO DASHBOARD & READINESS BAR  */}
        {/* ==================================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Hero Project Readiness Card */}
            <div className="bg-card border border-border rounded-lg p-5 shadow-card-rest space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-300">
                      PRJ-024
                    </span>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">
                      Skyview Commercial Towers (Package A - HVAC)
                    </h1>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300 uppercase">
                      ACTIVE
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Client: DLF CyberCity Developers · PMC: Meinhardt Singapore · Contract Ref: CC-2024-HVAC-08
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-surface-sunken px-3 py-1.5 rounded-md border border-border">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold text-secondary-foreground">
                    18 days to target handover · 18 Nov 2026
                  </span>
                </div>
              </div>

              {/* Segmented Readiness Bar (Precision Blueprint §6.1) */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Contractual Closeout Progress</span>
                  <span className="font-mono text-sm font-bold text-foreground">
                    71 / 77 Requirements Satisfied (92.2%)
                  </span>
                </div>

                {/* Multi-Segment Track (12px height with 1px white separators) */}
                <div className="h-3 w-full bg-slate-100 rounded-full flex overflow-hidden p-0.5 border border-slate-200">
                  <div
                    style={{ width: '74%' }}
                    className="bg-[#16A34A] h-full rounded-l-full border-r border-white"
                    title="Approved (57 items)"
                  />
                  <div
                    style={{ width: '12%' }}
                    className="bg-[#059669] h-full border-r border-white"
                    title="Approved external (9 items)"
                  />
                  <div
                    style={{ width: '6%' }}
                    className="bg-[#9333EA] h-full border-r border-white"
                    title="Waived (5 items)"
                  />
                  <div
                    style={{ width: '5%' }}
                    className="bg-[#F59E0B] h-full border-r border-white"
                    title="Waiting for review (4 items)"
                  />
                  <div
                    style={{ width: '3%' }}
                    className="bg-[#DC2626] h-full rounded-r-full"
                    title="Missing / Overdue (2 items)"
                  />
                </div>

                {/* Legend & 1-Click Filters */}
                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-secondary-foreground">
                  <button
                    onClick={() => {
                      setActiveTab('checklist');
                      setChecklistFilter('APPROVED');
                    }}
                    className="flex items-center gap-1.5 hover:underline"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" />
                    <span>Approved (57)</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('checklist');
                      setChecklistFilter('APPROVED');
                    }}
                    className="flex items-center gap-1.5 hover:underline"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#059669]" />
                    <span>Approved External (9)</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('checklist');
                      setChecklistFilter('WAIVED');
                    }}
                    className="flex items-center gap-1.5 hover:underline"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#9333EA]" />
                    <span>Waived (5)</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('checklist');
                      setChecklistFilter('IN_REVIEW');
                    }}
                    className="flex items-center gap-1.5 hover:underline text-amber-700 font-semibold"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />
                    <span>Waiting for review (4)</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('checklist');
                      setChecklistFilter('MISSING');
                    }}
                    className="flex items-center gap-1.5 hover:underline text-red-700 font-semibold"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" />
                    <span>Missing / Blocking (2)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 4 Executive Bento KPI Cards (Precision Blueprint §6.1) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card border border-border rounded-lg p-4 shadow-card-rest space-y-2">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Statutory Retention Money</span>
                  <CreditCard className="w-4 h-4 text-primary" />
                </div>
                <div className="text-2xl font-bold font-mono text-foreground">₹75,00,000</div>
                <p className="text-[11px] text-muted-foreground">
                  5.0% contract retention gated on client handover dossier acceptance.
                </p>
              </div>

              <div className="bg-card border border-border rounded-lg p-4 shadow-card-rest space-y-2">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Review Turnaround SLA</span>
                  <Clock className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold font-mono text-foreground">3.2 hrs</div>
                <p className="text-[11px] text-muted-foreground">
                  Internal QC average response time vs. 24.0 hr contractual target.
                </p>
              </div>

              <div className="bg-card border border-border rounded-lg p-4 shadow-card-rest space-y-2 border-l-4 border-l-amber-500">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Actionable Review Queue</span>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-2xl font-bold font-mono text-amber-700">4 Pending</div>
                <p className="text-[11px] text-muted-foreground">
                  Includes 2 supplier submissions from Carrier and SmartControls.
                </p>
              </div>

              <div className="bg-card border border-border rounded-lg p-4 shadow-card-rest space-y-2">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">DLP Warranty Coverage</span>
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-2xl font-bold font-mono text-foreground">12 Months</div>
                <p className="text-[11px] text-muted-foreground">
                  42 assets registered with OEM warranty certificates verified.
                </p>
              </div>
            </div>

            {/* Handover Dossier Action CTA Banner */}
            <div className="bg-surface-sunken border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />
                  Client-Ready Handover Package Preview Available
                </h3>
                <p className="text-xs text-muted-foreground">
                  71 verified engineering documents compiled into 13 statutory sections with Bates numbering.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('package')}
                  className="px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md shadow-sm hover:opacity-95"
                >
                  Inspect Package Assembly (SCR-028)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 2: SCR-014 1,000-ROW CHECKLIST GRID (TACTILE STRUCTURALISM)      */}
        {/* ==================================================================== */}
        {activeTab === 'checklist' && (
          <div className="space-y-4">
            {/* Sticky Filter & Facet Bar */}
            <div className="bg-card border border-border rounded-lg p-3 shadow-card-rest flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setChecklistFilter('ALL')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                    checklistFilter === 'ALL'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-sunken text-secondary-foreground hover:bg-slate-200'
                  }`}
                >
                  All (77)
                </button>
                <button
                  onClick={() => setChecklistFilter('MISSING')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                    checklistFilter === 'MISSING'
                      ? 'bg-red-50 text-red-700 border-red-300'
                      : 'border-red-200 text-red-700 bg-white hover:bg-red-50'
                  }`}
                >
                  Missing (2)
                </button>
                <button
                  onClick={() => setChecklistFilter('IN_REVIEW')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                    checklistFilter === 'IN_REVIEW'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-surface-sunken text-secondary-foreground hover:bg-slate-200'
                  }`}
                >
                  Waiting for review (4)
                </button>
                <button
                  onClick={() => setChecklistFilter('CHANGES_REQUESTED')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                    checklistFilter === 'CHANGES_REQUESTED'
                      ? 'bg-orange-100 text-orange-800'
                      : 'bg-surface-sunken text-secondary-foreground hover:bg-slate-200'
                  }`}
                >
                  Changes requested (1)
                </button>
                <button
                  onClick={() => setChecklistFilter('APPROVED')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                    checklistFilter === 'APPROVED'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-surface-sunken text-secondary-foreground hover:bg-slate-200'
                  }`}
                >
                  Approved (66)
                </button>
                <button
                  onClick={() => setChecklistFilter('WAIVED')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                    checklistFilter === 'WAIVED'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-surface-sunken text-secondary-foreground hover:bg-slate-200'
                  }`}
                >
                  Waived (5)
                </button>
              </div>

              {/* Search Box */}
              <div className="relative min-w-[240px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter by title, tag (CHLR-01), key..."
                  value={checklistSearch}
                  onChange={(e) => setChecklistSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-sunken border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                />
              </div>
            </div>

            {/* Checklist Table Grid */}
            <div className="bg-card border border-border rounded-lg shadow-card-rest overflow-hidden">
              {/* Sticky Table Header */}
              <div className="bg-surface-sunken border-b border-border px-4 py-2 flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={
                      selectedItems.length > 0 &&
                      selectedItems.length === filteredChecklist.length
                    }
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/20"
                  />
                  <span>Requirement Key & Title</span>
                </div>
                <div className="hidden sm:flex items-center gap-8 pr-2">
                  <span className="w-24 text-center">Asset Scope</span>
                  <span className="w-36 text-center">Status</span>
                  <span className="w-28 text-left">Owner</span>
                  <span className="w-28 text-left">Due Date</span>
                  <span className="w-24 text-right">Quick Action</span>
                </div>
              </div>

              {/* Grouped Rows */}
              <div className="divide-y divide-border">
                {Object.entries(groupedItems).map(([groupTitle, items]) => {
                  const isCollapsed = collapsedGroups[groupTitle];
                  const approvedCount = items.filter(
                    (i) => i.status === 'APPROVED' || i.status === 'APPROVED_EXTERNAL',
                  ).length;

                  return (
                    <div key={groupTitle} className="space-y-0">
                      {/* Accordion Group Header */}
                      <button
                        onClick={() => toggleGroup(groupTitle)}
                        className="w-full bg-slate-50 hover:bg-slate-100/80 px-4 py-2 flex items-center justify-between text-left border-y border-slate-200/60 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className="text-xs font-bold text-foreground">{groupTitle}</span>
                        </div>
                        <div className="text-[11px] font-mono font-semibold text-muted-foreground">
                          {approvedCount} / {items.length} Satisfied
                        </div>
                      </button>

                      {/* Items in Group */}
                      {!isCollapsed && (
                        <div className="divide-y divide-border">
                          {items.map((item) => {
                            const isSelected = selectedItems.includes(item.id);

                            return (
                              <div
                                key={item.id}
                                className={`px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors hover:bg-accent/40 ${
                                  isSelected ? 'bg-surface-selected' : ''
                                }`}
                              >
                                {/* Left: Checkbox + Key + Title */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelectItem(item.id)}
                                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/20 shrink-0"
                                  />
                                  <div className="space-y-0.5 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                                        {item.key}
                                      </span>
                                      {item.mandatory && (
                                        <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 rounded border border-red-200">
                                          REQ*
                                        </span>
                                      )}
                                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 rounded border border-slate-200">
                                        {item.docType}
                                      </span>
                                    </div>
                                    <p className="font-medium text-foreground truncate pr-2">
                                      {item.title}
                                    </p>
                                  </div>
                                </div>

                                {/* Right columns: Asset, Status Pill, Owner, Due Date, Action */}
                                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 shrink-0 pl-7 sm:pl-0">
                                  {/* Asset Scope */}
                                  <div className="w-24 text-center">
                                    {item.assetTag ? (
                                      <span className="inline-flex items-center font-mono text-[11px] font-medium bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-300">
                                        {item.assetTag}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-muted-foreground">
                                        Project-wide
                                      </span>
                                    )}
                                  </div>

                                  {/* Status Pill (Precision Blueprint §2.3) */}
                                  <div className="w-36 flex justify-center">
                                    <RequirementStatusPill status={item.status} size="sm" />
                                  </div>

                                  {/* Owner */}
                                  <div className="w-28 text-left truncate text-[11px] text-secondary-foreground">
                                    {item.owner}
                                  </div>

                                  {/* Due Date */}
                                  <div className="w-28 text-left font-mono text-[11px]">
                                    {item.isOverdue ? (
                                      <span className="text-red-700 font-semibold flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        {item.dueDate}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">{item.dueDate}</span>
                                    )}
                                  </div>

                                  {/* Quick Action Button */}
                                  <div className="w-24 text-right">
                                    {item.status === 'IN_REVIEW' ? (
                                      <button
                                        onClick={() => setActiveTab('viewer')}
                                        className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded font-semibold text-[11px] inline-flex items-center gap-1 shadow-sm"
                                      >
                                        <Eye className="w-3 h-3" />
                                        <span>Review</span>
                                      </button>
                                    ) : item.status === 'APPROVED' ||
                                      item.status === 'APPROVED_EXTERNAL' ? (
                                      <button
                                        onClick={() => setActiveTab('viewer')}
                                        className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-border rounded font-medium text-[11px] inline-flex items-center gap-1"
                                      >
                                        <FileCheck2 className="w-3 h-3 text-emerald-600" />
                                        <span>{item.revision}</span>
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setUploadContext({
                                            projectCode: 'PRJ-024',
                                            assetTag: item.assetTag || 'PROJECT',
                                            reqTitle: item.title,
                                            docType: item.docType,
                                          });
                                          setShowUploadSheet(true);
                                        }}
                                        className="px-2.5 py-1 bg-primary text-primary-foreground hover:opacity-90 rounded font-medium text-[11px] inline-flex items-center gap-1 shadow-sm"
                                      >
                                        <UploadCloud className="w-3 h-3" />
                                        <span>Upload</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Floating Bulk Action Dock (Precision Blueprint §6.2) */}
            {selectedItems.length > 0 && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-slate-100 px-4 py-2.5 rounded-lg shadow-float border border-slate-700 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
                <span className="text-xs font-semibold text-slate-300">
                  {selectedItems.length} Requirements Selected
                </span>
                <div className="h-4 w-px bg-slate-700" />
                <div className="flex items-center gap-2">
                  <button className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-600">
                    Assign Owner
                  </button>
                  <button className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-600">
                    Request via WhatsApp Link
                  </button>
                  <button className="px-2.5 py-1 bg-purple-900/60 hover:bg-purple-900 text-purple-200 text-xs font-medium rounded border border-purple-700">
                    Request Dual Waiver
                  </button>
                  <button
                    onClick={() => setSelectedItems([])}
                    className="p-1 text-slate-400 hover:text-white ml-2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 3: SCR-025 / SCR-027 SPLIT-PANE ENGINEERING PDF VIEWER & REVIEW */}
        {/* ==================================================================== */}
        {activeTab === 'viewer' && (
          <div className="h-[760px] border border-border rounded-lg overflow-hidden flex flex-col md:flex-row shadow-card-rest bg-card">
            {/* Left Pane: 70% width Dark Inspection Stage (--pdf-stage #1E293B) */}
            <div className="flex-1 bg-[var(--pdf-stage)] relative flex flex-col items-center justify-between p-4 overflow-hidden">
              {/* Floating Toolbar */}
              <div className="z-10 bg-slate-900/90 text-white backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-3 text-xs shadow-md">
                <div className="flex items-center gap-1 font-mono">
                  <button
                    onClick={() => setViewerPage(Math.max(1, viewerPage - 1))}
                    className="p-1 hover:bg-slate-800 rounded"
                  >
                    ‹
                  </button>
                  <span>
                    Page {viewerPage} / 48
                  </span>
                  <button
                    onClick={() => setViewerPage(Math.min(48, viewerPage + 1))}
                    className="p-1 hover:bg-slate-800 rounded"
                  >
                    ›
                  </button>
                </div>
                <div className="h-3 w-px bg-slate-700" />
                <div className="flex items-center gap-1 font-mono">
                  <button
                    onClick={() => setViewerZoom(Math.max(50, viewerZoom - 25))}
                    className="px-1.5 py-0.5 hover:bg-slate-800 rounded"
                  >
                    -
                  </button>
                  <span>{viewerZoom}%</span>
                  <button
                    onClick={() => setViewerZoom(Math.min(200, viewerZoom + 25))}
                    className="px-1.5 py-0.5 hover:bg-slate-800 rounded"
                  >
                    +
                  </button>
                </div>
                <div className="h-3 w-px bg-slate-700" />
                <button
                  onClick={() => setActivePinDraft(!activePinDraft)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
                    activePinDraft
                      ? 'bg-orange-600 text-white'
                      : 'hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <MapPin className="w-3 h-3 text-orange-400" />
                  <span>Drop Page Pin</span>
                </button>
                <button className="p-1 hover:bg-slate-800 rounded text-slate-300">
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* PDF Document Canvas Simulation */}
              <div className="my-auto w-full max-w-[540px] aspect-[1/1.414] bg-white rounded shadow-2xl p-8 relative select-none text-slate-900 border border-slate-400/40">
                {/* Watermark / Header */}
                <div className="border-b border-slate-300 pb-3 flex justify-between items-center text-[10px] font-mono text-slate-600">
                  <span>CARRIER AIR CONDITIONING INDIA PVT LTD</span>
                  <span>CERT-2026-CHLR-4401</span>
                </div>

                <div className="mt-6 space-y-3">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
                    Hydrostatic Piping Pressure Test Report (10.5 Bar)
                  </h2>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-slate-50 p-2.5 rounded border border-slate-200">
                    <div>Tag: CHLR-01 (Basement Plant)</div>
                    <div>Test Pressure: 10.5 bar</div>
                    <div>Hold Duration: 4.0 Hours</div>
                    <div>Acceptance: 0.0 bar drop</div>
                  </div>

                  {/* Synthetic engineering curve drawing */}
                  <div className="h-28 border border-dashed border-slate-300 rounded p-2 flex items-center justify-center text-[11px] text-slate-600 font-mono">
                    [Pressure vs Time Log Curve: 10.5 Bar Continuous Hold Satisfied]
                  </div>

                  {/* Physical Stamp Simulation */}
                  <div className="pt-4 flex justify-end">
                    <div className="border-2 border-emerald-700 text-emerald-800 px-3 py-1 rounded text-center rotate-[-3deg] font-mono text-[10px] font-bold">
                      MEP CONSULTANT APPROVED<br />
                      Vikram Sengupta · 25-Oct-2026
                    </div>
                  </div>
                </div>

                {/* Dropped Page Pin Annotation */}
                {pagePins.map((pin) => (
                  <div
                    key={pin.id}
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
                  >
                    <div className="w-6 h-6 rounded-full bg-orange-600 text-white flex items-center justify-center font-bold text-xs shadow-md border-2 border-white">
                      {pin.id}
                    </div>
                    <div className="hidden group-hover:block absolute left-7 top-0 bg-slate-900 text-white text-[11px] p-2 rounded shadow-lg w-48 z-20">
                      {pin.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom Stage Footnote */}
              <div className="text-[10px] font-mono text-slate-400">
                PDF/A-1b Verified · Pure-Node Render Engine · Hash: 9f2c...8a1b
              </div>
            </div>

            {/* Right Pane: 30% width (min 380px) Context, Lineage & Decision Dock */}
            <div className="w-full md:w-[380px] bg-card border-l border-border flex flex-col justify-between">
              {/* Top Context & Automated Checks */}
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                {/* Version Switcher */}
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-foreground">
                      Revision R2
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 font-medium">
                      In Review
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Uploaded 2h ago
                  </span>
                </div>

                {/* Automated Security & Structure Checks (WF-11) */}
                <div className="bg-surface-sunken p-3 rounded-md border border-border space-y-1.5">
                  <div className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                    Automated Inspection Checks
                  </div>
                  <div className="space-y-1 text-xs text-secondary-foreground">
                    <div className="flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-3.5 h-3.5" />
                      <span>Valid PDF (48 pages, 0 JS actions)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-3.5 h-3.5" />
                      <span>ClamAV Malware Scan Clean</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-3.5 h-3.5" />
                      <span>SHA-256 Unique in Organisation</span>
                    </div>
                  </div>
                </div>

                {/* Annotation Stream */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">Page Pins & Comments</div>
                  <div className="p-2.5 rounded bg-orange-50 border border-orange-200 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-orange-900">
                      <span>Pin 1 (Page 12)</span>
                      <span className="text-[10px] font-mono">Sunil Rao (QC)</span>
                    </div>
                    <p className="text-orange-800 text-[11px]">
                      Verify sensor calibration tolerance per Section 4.2 before final approval.
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Sticky Decision Dock (SCR-027) */}
              <div className="p-4 bg-surface-sunken border-t border-border space-y-3">
                {/* Decision Mode Toggle */}
                <div className="flex rounded-md border border-border p-0.5 bg-card text-xs">
                  <button
                    onClick={() => setDecisionTab('in_app')}
                    className={`flex-1 py-1 font-semibold rounded text-center transition-colors ${
                      decisionTab === 'in_app'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    In-App Decision
                  </button>
                  <button
                    onClick={() => setDecisionTab('external')}
                    className={`flex-1 py-1 font-semibold rounded text-center transition-colors ${
                      decisionTab === 'external'
                        ? 'bg-emerald-700 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    External Approval (WF-23)
                  </button>
                </div>

                {decisionTab === 'in_app' ? (
                  <div className="space-y-2">
                    <textarea
                      placeholder="Review remarks (min. 10 chars required for rejection/changes)..."
                      value={decisionComment}
                      onChange={(e) => setDecisionComment(e.target.value)}
                      rows={2}
                      className="w-full p-2 text-xs bg-card border border-input rounded text-foreground resize-none"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <button className="py-2 px-2 bg-[var(--action-approve)] hover:opacity-90 text-white text-xs font-semibold rounded shadow-sm">
                        Approve
                      </button>
                      <button className="py-2 px-2 bg-[var(--action-changes)] hover:opacity-90 text-white text-xs font-semibold rounded shadow-sm">
                        Request Changes
                      </button>
                      <button className="py-2 px-2 bg-[var(--destructive)] hover:opacity-90 text-white text-xs font-semibold rounded shadow-sm">
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  /* External Approval Recording (FR-REV-016, WF-23) */
                  <div className="space-y-2 text-xs">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground block">
                        Approver Name & Role
                      </label>
                      <input
                        type="text"
                        value={externalApprover}
                        onChange={(e) => setExternalApprover(e.target.value)}
                        className="w-full px-2 py-1 bg-card border border-input rounded text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground block">
                          Method
                        </label>
                        <select
                          value={externalMethod}
                          onChange={(e: any) => setExternalMethod(e.target.value)}
                          className="w-full px-2 py-1 bg-card border border-input rounded text-xs"
                        >
                          <option value="STAMPED_PDF">Stamped PDF</option>
                          <option value="EMAIL">Email Signoff</option>
                          <option value="PORTAL">Client Portal / Aconex</option>
                          <option value="PHYSICAL">Physical Hardcopy</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground block">
                          Transmittal Ref
                        </label>
                        <input
                          type="text"
                          defaultValue="TR-DLF-HVAC-992"
                          className="w-full px-2 py-1 bg-card border border-input rounded text-xs font-mono"
                        />
                      </div>
                    </div>
                    <button className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 shadow-sm">
                      <Stamp className="w-3.5 h-3.5" />
                      <span>Record & Issue "Approved (external)" Badge</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 4: SCR-028 / SCR-057 HANDOVER PACKAGE BUILDER & PAGE PREVIEW     */}
        {/* ==================================================================== */}
        {activeTab === 'package' && (
          <div className="space-y-6">
            {/* 4-Step Stepper */}
            <div className="bg-card border border-border rounded-lg p-4 shadow-card-rest flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <span className="text-xs font-bold text-foreground">Scope & Preview</span>
              </div>
              <div className="h-px w-12 bg-border hidden sm:block" />
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-6 h-6 rounded-full bg-surface-sunken border border-border flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <span className="text-xs font-medium">Readiness Gate</span>
              </div>
              <div className="h-px w-12 bg-border hidden sm:block" />
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-6 h-6 rounded-full bg-surface-sunken border border-border flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <span className="text-xs font-medium">Layout & Sections</span>
              </div>
              <div className="h-px w-12 bg-border hidden sm:block" />
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-6 h-6 rounded-full bg-surface-sunken border border-border flex items-center justify-center font-bold text-xs">
                  4
                </div>
                <span className="text-xs font-medium">Generate Dossier</span>
              </div>
            </div>

            {/* Live Assembly HUD */}
            <div className="bg-surface-sunken border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-mono text-sm font-bold text-foreground">
                  71 Documents · Est. 482 Pages · ~184 MB Merged PDF
                </div>
                <p className="text-xs text-muted-foreground">
                  Includes pure-Node generated Table of Contents with exact page ranges and Bates stamps.
                </p>
              </div>
              <button className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-md shadow-sm hover:opacity-95 flex items-center gap-1.5">
                <Download className="w-4 h-4" />
                <span>Export Handover Package (PDF/ZIP)</span>
              </button>
            </div>

            {/* Resolved Document Tree Preview (13 Default Sections) */}
            <div className="bg-card border border-border rounded-lg shadow-card-rest divide-y divide-border text-xs">
              <div className="p-3 bg-surface-sunken font-bold text-foreground">
                Handover Section Breakdown (13 Contractual Sections)
              </div>
              <div className="p-3 flex items-center justify-between hover:bg-accent/40">
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">1. Executive Summary & Compliance Index</div>
                  <p className="text-[11px] text-muted-foreground">Cover page, signature blocks, contract reference table</p>
                </div>
                <div className="font-mono text-muted-foreground">pp. 001–008 · 8 Pages</div>
              </div>
              <div className="p-3 flex items-center justify-between hover:bg-accent/40">
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">8. Commissioning & Performance Testing (TAB)</div>
                  <p className="text-[11px] text-muted-foreground">Hydrostatic tests, chiller performance, air balancing registers</p>
                </div>
                <div className="font-mono text-muted-foreground">pp. 009–142 · 134 Pages</div>
              </div>
              <div className="p-3 flex items-center justify-between hover:bg-accent/40">
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">10. As-Built Drawings & Controls Architecture</div>
                  <p className="text-[11px] text-muted-foreground">BMS points list, damper schedules, sensor layouts</p>
                </div>
                <div className="font-mono text-muted-foreground">pp. 143–288 · 146 Pages</div>
              </div>
              <div className="p-3 flex items-center justify-between hover:bg-accent/40">
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">12. Manufacturer Warranties & DLP Undertakings</div>
                  <p className="text-[11px] text-muted-foreground">5-year chiller certificates, pump warranties, emergency contact matrix</p>
                </div>
                <div className="font-mono text-muted-foreground">pp. 289–482 · 194 Pages</div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 5: SCR-034 ZERO-FRICTION SUPPLIER UPLOAD PORTAL                  */}
        {/* ==================================================================== */}
        {activeTab === 'supplier' && (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Scoped View Banner */}
            <div className="bg-amber-50 border border-amber-300 rounded-md p-3 flex items-center gap-3 text-xs text-amber-900">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold">External Access · Scoped View</span> — This is the exact screen
                seen by external distributors or suppliers opening a WhatsApp upload link. No account required.
              </div>
            </div>

            {/* Trust Header */}
            <div className="bg-card border border-border rounded-lg p-5 shadow-card-rest space-y-2 text-center">
              <div className="w-10 h-10 rounded-md bg-[var(--tenant-brand)] text-white flex items-center justify-center font-mono font-bold text-base mx-auto">
                TC
              </div>
              <h2 className="text-base font-bold text-foreground">
                Apex MEP Contractors Pvt Ltd
              </h2>
              <p className="text-xs text-muted-foreground">
                Document Submission Request for Project <span className="font-semibold text-foreground">PRJ-024 (Skyview Towers)</span>
              </p>
              <div className="pt-2">
                <a
                  href="#"
                  className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 font-medium"
                >
                  Need assistance? WhatsApp Meera (PM) (+91 98200 XXXXX)
                </a>
              </div>
            </div>

            {/* Scoped Task Card */}
            <div className="bg-card border border-border rounded-lg p-5 shadow-card-rest space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-primary bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    REQ-HVAC-018
                  </span>
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Needed by 05 Nov 2026
                  </span>
                </div>
                <h3 className="text-sm font-bold text-foreground">
                  Centrifugal Chiller Factory Test & Performance Run Curve (AHRI 550/590)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Equipment Tag: <span className="font-mono font-semibold">CHLR-01 (Basement 2 Plant)</span>
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => setShowUploadSheet(true)}
                className="border-2 border-dashed border-primary/40 hover:border-primary bg-surface-sunken p-6 rounded-lg text-center cursor-pointer space-y-2 transition-colors"
              >
                <UploadCloud className="w-8 h-8 text-primary mx-auto" />
                <div className="text-xs font-bold text-foreground">
                  Tap to Select PDF or Take Photo of Certificate
                </div>
                <p className="text-[11px] text-muted-foreground">
                  PDF, JPG, PNG, WebP up to 100 MB · SVG strictly banned
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Revision Code
                  </label>
                  <input
                    type="text"
                    defaultValue="R0"
                    className="w-full px-2.5 py-1.5 bg-card border border-input rounded font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Issue Date
                  </label>
                  <input
                    type="text"
                    defaultValue="31 Oct 2026"
                    className="w-full px-2.5 py-1.5 bg-card border border-input rounded font-mono"
                  />
                </div>
              </div>

              <button
                onClick={() => setShowUploadSheet(true)}
                className="w-full py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-md shadow-sm hover:opacity-95"
              >
                Submit Document for Verification
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ==================================================================== */}
      {/* 6.3 SCR-023 / SCR-024: 3-TAP MOBILE UPLOAD SHEET & RESUMABLE HUD    */}
      {/* ==================================================================== */}
      {showUploadSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-card border border-border rounded-t-xl sm:rounded-xl shadow-sheet overflow-hidden space-y-4 p-5 max-h-[90vh] overflow-y-auto">
            {/* Header + Autosave pill */}
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Upload Document (SCR-023)</h3>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
                  <Check className="w-3 h-3 text-emerald-600" /> Draft saved
                </span>
              </div>
              <button
                onClick={() => setShowUploadSheet(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tap 1: Pre-filled Context Chips */}
            <div className="flex flex-wrap items-center gap-2 bg-surface-sunken p-2.5 rounded-md border border-border text-xs">
              <span className="font-mono font-semibold text-primary">{uploadContext.projectCode}</span>
              <span>·</span>
              <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-border text-slate-700">
                {uploadContext.assetTag}
              </span>
              <span>·</span>
              <span className="font-mono text-muted-foreground">{uploadContext.docType}</span>
            </div>

            {/* Tap 2: Two Oversized Field-Ready Buttons (64px tall) */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setUploadProgress(85)}
                className="h-16 bg-[var(--action-upload)] hover:bg-blue-800 text-white rounded-lg font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-md transition-all active:scale-[0.98]"
              >
                <Camera className="w-5 h-5" />
                <span>Take Photo / Scan</span>
              </button>

              <button
                onClick={() => setUploadProgress(85)}
                className="h-16 bg-card hover:bg-slate-50 text-foreground border-2 border-[var(--primary)] rounded-lg font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all active:scale-[0.98]"
              >
                <FileIcon className="w-5 h-5 text-primary" />
                <span>Choose PDF / File</span>
              </button>
            </div>

            {/* Progressive Disclosure Metadata */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-muted-foreground block mb-1">
                  Document Title (Auto-suggested)
                </label>
                <input
                  type="text"
                  defaultValue={uploadContext.reqTitle}
                  className="w-full px-3 py-2 bg-card border border-input rounded text-xs text-foreground"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-muted-foreground block mb-1">
                    Revision Code
                  </label>
                  <input
                    type="text"
                    defaultValue="R2"
                    className="w-full px-3 py-2 bg-card border border-input rounded font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-muted-foreground block mb-1">
                    Issue Date
                  </label>
                  <input
                    type="text"
                    defaultValue="31 Oct 2026"
                    className="w-full px-3 py-2 bg-card border border-input rounded font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* SCR-024 Resumable Progress HUD */}
            <div className="bg-surface-sunken p-3 rounded-lg border border-border space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  {isNetworkPaused
                    ? 'Network Paused (File Kept Safe on Device)'
                    : 'Chunked Multipart Upload · Part 3 of 5'}
                </span>
                <span className="font-mono text-xs font-bold text-primary">
                  {uploadProgress}%
                </span>
              </div>

              <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                <div
                  style={{ width: `${uploadProgress}%` }}
                  className={`h-full transition-all duration-300 ${
                    isNetworkPaused ? 'bg-amber-500 animate-pulse' : 'bg-[var(--action-upload)]'
                  }`}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Checking file safety (ClamAV + PDF sanitise)...</span>
                <button
                  onClick={() => setIsNetworkPaused(!isNetworkPaused)}
                  className="text-primary hover:underline font-medium"
                >
                  {isNetworkPaused ? 'Simulate 4G Resume' : 'Simulate 4G Drop'}
                </button>
              </div>
            </div>

            {/* Tap 3: Submit Button */}
            <button
              onClick={() => {
                setShowUploadSheet(false);
                alert('Document successfully uploaded & submitted to internal QC queue!');
              }}
              className="w-full py-3 bg-primary hover:opacity-95 text-primary-foreground font-bold rounded-lg text-xs shadow-md transition-all flex items-center justify-center gap-2"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload & Submit for Review (4.2 MB · ~6s on 4G)</span>
            </button>
          </div>
        </div>
      )}

      {/* Persistent Mobile Bottom Navigation Bar (Precision Blueprint §4.1) */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border h-16 flex items-center justify-around px-2 shadow-float pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex flex-col items-center gap-1 text-[10px] font-medium ${
            activeTab === 'overview' ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Home</span>
        </button>
        <button
          onClick={() => setActiveTab('checklist')}
          className={`flex flex-col items-center gap-1 text-[10px] font-medium ${
            activeTab === 'checklist' ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Checklist</span>
        </button>

        {/* Center Floating Action Button [+] */}
        <button
          onClick={() => setShowUploadSheet(true)}
          className="w-12 h-12 -mt-5 rounded-full bg-[var(--action-upload)] text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform border-2 border-white"
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
        </button>

        <button
          onClick={() => setActiveTab('viewer')}
          className={`flex flex-col items-center gap-1 text-[10px] font-medium ${
            activeTab === 'viewer' ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>Review</span>
        </button>
        <button
          onClick={() => setActiveTab('package')}
          className={`flex flex-col items-center gap-1 text-[10px] font-medium ${
            activeTab === 'package' ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Dossier</span>
        </button>
      </div>
    </div>
  );
}
