"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  AlertTriangle,
  Clock,
  CalendarX2,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Building2,
  CheckCircle2,
  ShieldCheck,
  HardHat,
  FileCheck,
  UploadCloud,
  FileText,
  CreditCard,
  Stamp,
  Users,
  Eye,
  Camera,
  Wifi,
  WifiOff,
  AlertCircle,
  FileEdit,
  XCircle,
  ExternalLink,
  ChevronRight,
  Award,
} from "lucide-react";
import { apiFetch } from "../../../lib/api-client";
import { enqueueFieldUpload } from "../../../lib/offline-upload-queue";

export interface OrgDashboardDto {
  org: {
    id: string;
    legalName: string;
    displayName: string;
    gstin: string | null;
    state: string;
  };
  user: {
    id: string;
    name: string;
    role: string;
  };
  kpis: {
    activeProjectsCount: number;
    totalMissingOrExpiredCount: number;
    awaitingMyReviewCount: number;
    expiringSoonCount: number;
    totalRetentionAtRiskPaise: string;
  };
  projects: Array<{
    id: string;
    code: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "HANDOVER" | "CLOSED";
    clientName: string;
    mcName: string;
    pmcName: string;
    city: string;
    targetHandoverDate: string;
    contractValuePaise: string;
    retentionAtRiskPaise: string;
    approvedCount: number;
    applicableCount: number;
    missingCount: number;
    inReviewCount: number;
  }>;
  needsAttention: Array<{
    requirementId: string;
    projectId: string;
    projectCode: string;
    requirementKey: string;
    title: string;
    assetTag: string | null;
    status: string;
    dueDate: string;
    ownerName: string;
  }>;
}

function formatInr(paise: string): string {
  const rupees = Number(BigInt(paise || "0")) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

export default function CompanyHomeDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<OrgDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Site Engineer Interactive Upload Form State
  const [siteAsset, setSiteAsset] = useState("CH-01");
  const [siteDocType, setSiteDocType] = useState("DT-018");
  const [siteUploadSuccess, setSiteUploadSuccess] = useState<string | null>(null);
  const [siteUploading, setSiteUploading] = useState(false);
  const [siteUploadError, setSiteUploadError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Owner 2nd Waiver Sign-off State (TC2-029)
  const [waiverSigned, setWaiverSigned] = useState(false);
  const [signingWaiver, setSigningWaiver] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);

  const handleSiteFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSiteUploading(true);
    setSiteUploadError(null);
    setSiteUploadSuccess(null);
    try {
      const activeProject = data?.projects?.[0];
      if (!activeProject) {
        throw new Error("No active project available for site upload.");
      }
      await enqueueFieldUpload({
        projectId: activeProject.id,
        requirementId: siteAsset,
        file,
        title: `${siteAsset} - ${siteDocType}`,
        revisionCode: "R0",
        issueDate: new Date().toISOString().slice(0, 10),
      });
      setSiteUploadSuccess(`✓ Evidence file "${file.name}" queued into offline upload pipeline for ${siteAsset} (${siteDocType}).`);
      setTimeout(() => setSiteUploadSuccess(null), 6000);
    } catch (err: any) {
      setSiteUploadError(err.message || "Failed to queue site upload.");
    } finally {
      setSiteUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCountersignWaiver = async () => {
    setSigningWaiver(true);
    setWaiverError(null);
    try {
      await apiFetch(`/api/v1/requirements/HYD-BIO-09-DT028/waivers/countersign`, {
        method: "POST",
        body: JSON.stringify({ justification: "MD 2nd approver countersignature executed." }),
      });
      setWaiverSigned(true);
    } catch (err: any) {
      if (err?.status === 404) {
        setWaiverError("No pending waiver found for this requirement in active database.");
      } else {
        setWaiverError(err?.message || "Waiver countersignature failed.");
      }
    } finally {
      setSigningWaiver(false);
    }
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<OrgDashboardDto>("/api/v1/orgs/current/dashboard");
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load company dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="h-8 w-80 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-white border border-slate-200" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-lg bg-white border border-slate-200" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto">
        <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 p-4 text-xs text-red-900">
          <span>{error || "Unable to load dashboard"}</span>
          <button
            onClick={loadDashboard}
            className="inline-flex items-center gap-1.5 rounded border border-red-400 bg-white px-3 py-1.5 font-semibold cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  const role = data.user.role;
  const primaryProject = data.projects[0];
  const primaryProjectId = primaryProject?.id || "01a1985e-9c74-7693-b54a-2bfd50365d53";

  /* ========================================================================== */
  /* 1. ROLE VIEW: R-SITE (Amit Verma - Field Execution Station)                */
  /* ========================================================================== */
  if (role === "R-SITE") {
    return (
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Site Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-600 text-white font-bold text-xs">
                <HardHat className="h-4 w-4" />
              </span>
              <h1 className="text-lg font-bold text-slate-900">
                Field Site Execution Station — {primaryProject?.code || "HYD-BIO-09"}
              </h1>
              <span className="rounded bg-amber-50 border border-amber-300 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-800">
                ROLE: R-SITE (Site Execution Engineer)
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Welcome back, <strong>{data.user.name}</strong>. Capture physical test certificates, tag MEP equipment, and sync Basement-2 evidence back to the cloud.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <Wifi className="h-3.5 w-3.5" />
              <span>4G Network Active (IndexedDB Synced)</span>
            </span>
          </div>
        </div>

        {/* Security / Separation of Duties Notice */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Field Execution Boundary (05 §3.2 & AUD-S-24):</span> Commercial contract pricing, retention sums, billing invoices, and technical approval decisions are restricted to Project Managers (Meera) and QA/QC (Karthik). As Site Engineer, your authority is focused on accurate evidence capture and physical asset verification.
          </div>
        </div>

        {/* 4 Site Execution KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-blue-900 font-semibold">
              <span>My Pending Site Uploads</span>
              <UploadCloud className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-blue-900">5</div>
            <div className="mt-1 text-[11px] text-slate-500">Hydrostatic, duct leakage & installation records</div>
          </div>

          <div className="rounded-lg border border-orange-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-orange-900 font-semibold">
              <span>Changes Requested by QC (Snags)</span>
              <FileEdit className="h-4 w-4 text-orange-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-orange-800">2</div>
            <div className="mt-1 text-[11px] text-slate-500">Returned by Karthik for gauge re-calibration</div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-emerald-900 font-semibold">
              <span>Basement Offline Outbox</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-800">0 Pending</div>
            <div className="mt-1 text-[11px] text-slate-500">All offline captures uploaded via Service Worker</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
              <span>Assigned Equipment Units</span>
              <HardHat className="h-4 w-4 text-slate-500" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">18 Units</div>
            <div className="mt-1 text-[11px] text-slate-500">Chillers, Pumps, AHUs, FCUs in Plant Rooms</div>
          </div>
        </div>

        {/* Quick Mobile / Tablet Field Evidence Upload Dock */}
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-blue-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Quick Mobile / Tablet Evidence Capture (Field Upload Dock)
              </h2>
            </div>
            <span className="text-[11px] text-blue-700 font-semibold">Resumable S3 Multipart + IndexedDB</span>
          </div>

          {siteUploadSuccess && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>{siteUploadSuccess}</span>
            </div>
          )}

          {siteUploadError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span>{siteUploadError}</span>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.zip"
            onChange={handleSiteFileSelect}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target MEP Equipment Tag</label>
              <select
                value={siteAsset}
                onChange={(e) => setSiteAsset(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-slate-50 p-2 text-xs font-mono font-semibold"
              >
                <option value="CH-01">CH-01 — Trane 450 TR Centrifugal Chiller (Basement-2)</option>
                <option value="AHU-04">AHU-04 — Zeco 12,000 CFM Cleanroom AHU (Terrace)</option>
                <option value="P-02">P-02 — Armstrong 150 kW Secondary Chilled Water Pump</option>
                <option value="FD-12">FD-12 — Ruskin 2-Hour Motorized Fire Damper</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Document / Inspection Type</label>
              <select
                value={siteDocType}
                onChange={(e) => setSiteDocType(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-slate-50 p-2 text-xs font-semibold"
              >
                <option value="DT-018">DT-018: Hydrostatic Pressure Test Report (1.5x working)</option>
                <option value="DT-022">DT-022: Low-Leakage Duct Air Leakage Test Report</option>
                <option value="DT-035">DT-035: Installation Inspection & Vibration Isolator Photos</option>
                <option value="DT-041">DT-041: NABL Calibrated Pressure Gauge Certificate</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                disabled={siteUploading}
                onClick={() => fileInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 py-2 px-4 font-semibold text-white hover:bg-blue-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <UploadCloud className="h-4 w-4" />
                <span>{siteUploading ? "Enqueuing Upload…" : "Select & Upload Test File"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* QC Feedback & Snags Returned by Karthik */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-orange-600" />
              <span>QC Inspection Feedback & Snags Requiring Site Re-Testing</span>
            </h2>
            <span className="text-[11px] text-slate-500">Returned by Lead QC Karthikeya Sharma</span>
          </div>
          <div className="divide-y divide-slate-200 text-xs">
            <div className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-700">HYD-BIO-09-DT018</span>
                  <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 font-mono text-[10px] text-blue-800">P-02 Riser</span>
                  <span className="rounded bg-orange-100 text-orange-900 border border-orange-300 px-2 py-0.2 font-semibold text-[10px]">CHANGES REQUESTED</span>
                </div>
                <div className="font-medium text-slate-900">Secondary Chilled Water Piping Hydrostatic Test</div>
                <div className="text-slate-600 text-[11px] italic">
                  &ldquo;QC Note: The Ashcroft pressure gauge in photo #2 shows calibration expired on 14-Oct. Re-test riser with the NABL-certified Wika 0-16 bar gauge.&rdquo;
                </div>
              </div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
              >
                <span>Re-upload</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-700">HYD-BIO-09-DT022</span>
                  <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 font-mono text-[10px] text-blue-800">AHU-04 Supply</span>
                  <span className="rounded bg-orange-100 text-orange-900 border border-orange-300 px-2 py-0.2 font-semibold text-[10px]">CHANGES REQUESTED</span>
                </div>
                <div className="font-medium text-slate-900">Duct Air Leakage Test (Class C Cleanroom)</div>
                <div className="text-slate-600 text-[11px] italic">
                  &ldquo;QC Note: Test orifice plate D2 differential pressure calculation missing from sheet. Attach orific calibration curve.&rdquo;
                </div>
              </div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
              >
                <span>Re-upload</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Assigned Physical Equipment Tags Matrix */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              My Assigned Physical MEP Equipment Units ({primaryProject?.name})
            </h2>
            <span className="text-[11px] text-slate-500">Equipment Register</span>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-blue-800">CH-01</span>
                <span className="rounded bg-emerald-100 text-emerald-800 font-semibold px-1.5 text-[10px]">Installed</span>
              </div>
              <div className="font-bold text-slate-900">Trane Centrifugal 450 TR</div>
              <div className="text-slate-500 text-[11px]">Location: Basement-2 Chiller Plant</div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="w-full text-center py-1 rounded bg-white border border-slate-300 font-semibold text-blue-700 hover:bg-blue-50"
              >
                Upload Test Report
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-blue-800">AHU-04</span>
                <span className="rounded bg-emerald-100 text-emerald-800 font-semibold px-1.5 text-[10px]">Installed</span>
              </div>
              <div className="font-bold text-slate-900">Zeco 12,000 CFM Cleanroom</div>
              <div className="text-slate-500 text-[11px]">Location: Level-4 AHU Room</div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="w-full text-center py-1 rounded bg-white border border-slate-300 font-semibold text-blue-700 hover:bg-blue-50"
              >
                Upload Test Report
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-blue-800">P-02</span>
                <span className="rounded bg-emerald-100 text-emerald-800 font-semibold px-1.5 text-[10px]">Hydro-Tested</span>
              </div>
              <div className="font-bold text-slate-900">Armstrong 150 kW Pump</div>
              <div className="text-slate-500 text-[11px]">Location: Basement-2 Plant</div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="w-full text-center py-1 rounded bg-white border border-slate-300 font-semibold text-blue-700 hover:bg-blue-50"
              >
                Upload Test Report
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-blue-800">FD-12</span>
                <span className="rounded bg-amber-100 text-amber-800 font-semibold px-1.5 text-[10px]">Testing Due</span>
              </div>
              <div className="font-bold text-slate-900">Ruskin 2hr Motorized Damper</div>
              <div className="text-slate-500 text-[11px]">Location: Cleanroom Shaft Wall</div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="w-full text-center py-1 rounded bg-white border border-slate-300 font-semibold text-blue-700 hover:bg-blue-50"
              >
                Upload Test Report
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========================================================================== */
  /* 2. ROLE VIEW: R-QC (Karthikeya Sharma - QA/QC Compliance Workbench)        */
  /* ========================================================================== */
  if (role === "R-QC") {
    return (
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* QC Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-700 text-white font-bold text-xs">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <h1 className="text-lg font-bold text-slate-900">
                QA/QC Inspection & Technical Compliance Station
              </h1>
              <span className="rounded bg-sky-50 border border-sky-300 px-2 py-0.5 font-mono text-[11px] font-bold text-sky-900">
                ROLE: R-QC (Lead QA/QC Engineer)
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Signed in as <strong>{data.user.name}</strong>. Inspect hydrostatic tests, approve duct leakage reports, verify NABL calibration, and seal with Class 3 DSC.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900">
              <Stamp className="h-3.5 w-3.5 text-sky-700" />
              <span>eMudhra Class 3 DSC Available</span>
            </span>
          </div>
        </div>

        {/* 4 QC KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-amber-900 font-semibold">
              <span>Awaiting My QC Decision</span>
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-amber-900">4</div>
            <div className="mt-1 text-[11px] text-slate-500">Hydrostatic & duct leakage reports awaiting review</div>
          </div>

          <div className="rounded-lg border border-sky-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-sky-900 font-semibold">
              <span>Class 3 DSC Seals Applied</span>
              <Award className="h-4 w-4 text-sky-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-sky-900">8 Sealed</div>
            <div className="mt-1 text-[11px] text-slate-500">ISO 32000-2 cryptographic CMS signatures</div>
          </div>

          <div className="rounded-lg border border-red-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-red-900 font-semibold">
              <span>Active Non-Conformances (NCRs)</span>
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-red-700">2 Open</div>
            <div className="mt-1 text-[11px] text-slate-500">Returned to Amit Verma for site re-testing</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
              <span>NABL Calibration Expiring</span>
              <CalendarX2 className="h-4 w-4 text-slate-500" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">1 Gauge</div>
            <div className="mt-1 text-[11px] text-slate-500">Ashcroft 0-16 bar gauge expiring in 12 days</div>
          </div>
        </div>

        {/* Live QC Review Workbench Queue (Direct Action Table) */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Technical Review Queue — Reports Awaiting QC Approval (SCR-025 / SCR-027)
              </h2>
              <span className="text-[11px] text-slate-500">Review original PDF evidence, annotate, and approve or reject</span>
            </div>
            <span className="font-mono text-xs font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
              4 PENDING DECISIONS
            </span>
          </div>

          <div className="divide-y divide-slate-200 text-xs">
            <div className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-900">HYD-BIO-09-DT018</span>
                  <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 font-mono text-[10px] text-blue-800">Tag: P-02</span>
                  <span className="rounded bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.2 font-semibold text-[10px]">AWAITING QC DECISION</span>
                </div>
                <div className="font-bold text-slate-900">Chilled Water Piping Hydrostatic Test Report (10.5 bar / 4 hrs)</div>
                <div className="text-slate-500 text-[11px]">Uploaded by: Amit Verma (Site Engineer) · Size: 1.8 MB PDF · ClamAV Clean</div>
              </div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-700 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-800 transition-colors cursor-pointer"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Open in PDF Reviewer & Decide</span>
              </button>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-900">HYD-BIO-09-DT022</span>
                  <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 font-mono text-[10px] text-blue-800">Tag: AHU-04</span>
                  <span className="rounded bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.2 font-semibold text-[10px]">AWAITING QC DECISION</span>
                </div>
                <div className="font-bold text-slate-900">Duct Air Leakage Test Report (SMACNA Class C Cleanroom Standard)</div>
                <div className="text-slate-500 text-[11px]">Uploaded by: Amit Verma (Site Engineer) · Size: 2.4 MB PDF · ClamAV Clean</div>
              </div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-700 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-800 transition-colors cursor-pointer"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Open in PDF Reviewer & Decide</span>
              </button>
            </div>

            <div className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-900">HYD-BIO-09-DT026</span>
                  <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.2 font-mono text-[10px] text-blue-800">Tag: CH-01</span>
                  <span className="rounded bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.2 font-semibold text-[10px]">AWAITING QC DECISION</span>
                </div>
                <div className="font-bold text-slate-900">Centrifugal Chiller Factory Acceptance Test (FAT) & AHRI Certificate</div>
                <div className="text-slate-500 text-[11px]">Uploaded by: Voltas OEM (Guest Link) · Size: 4.1 MB PDF · Signed by Trane Lab</div>
              </div>
              <button
                onClick={() => router.push(`/projects/${primaryProjectId}`)}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-700 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-800 transition-colors cursor-pointer"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Open in PDF Reviewer & Decide</span>
              </button>
            </div>
          </div>
        </div>

        {/* Cryptographic Digital Signature & Tamper Verification Center */}
        <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-sky-700" />
              <h3 className="text-sm font-bold text-sky-950">
                PAdES ISO 32000-2 Cryptographic DSC & Tamper-Evident Verification
              </h3>
            </div>
            <span className="font-mono text-[11px] font-bold text-sky-800">ACTIVE CERTIFICATE: TC-SIG-49847A9348FB</span>
          </div>
          <p className="text-xs text-sky-900">
            When you approve compliance records in TradeCloseout, your Class 3 DSC certificate digests the file bytes via SHA-256 and seals an immutable PKCS#7 block into the PDF with an Indian IT Act 2000 compliant verification QR code.
          </p>
        </div>
      </div>
    );
  }

  /* ========================================================================== */
  /* 3. ROLE VIEW: R-OWNER (Vikramaditya Reddy - Executive Owner Workspace)     */
  /* ========================================================================== */
  if (role === "R-OWNER" || role === "R-ADMIN") {
    return (
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Executive Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-700 text-white font-bold text-xs">
                <Building2 className="h-4 w-4" />
              </span>
              <h1 className="text-lg font-bold text-slate-900">
                Executive Owner Workspace — Financial Retention & Statutory Risk Center
              </h1>
              <span className="rounded bg-indigo-50 border border-indigo-300 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-900">
                ROLE: R-OWNER (Managing Director)
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Welcome, <strong>{data.user.name}</strong>. Monitor cash-flow release, sign mandatory requirement waivers, and enforce GST e-invoicing compliance across company projects.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/billing")}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 transition-colors cursor-pointer"
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>Billing & GST Tax Center</span>
            </button>
          </div>
        </div>

        {/* 4 Executive KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-indigo-300 bg-indigo-50/50 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-indigo-900 font-semibold">
              <span>Total Retention At Risk (Gated)</span>
              <CreditCard className="h-4 w-4 text-indigo-700" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-indigo-950">
              {formatInr(data.kpis.totalRetentionAtRiskPaise)}
            </div>
            <div className="mt-1 text-[11px] text-slate-600">Across 3 active commercial MEP projects</div>
          </div>

          <div className="rounded-lg border border-purple-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-purple-900 font-semibold">
              <span>Mandatory Waivers (2nd Sign-Off)</span>
              <ShieldCheck className="h-4 w-4 text-purple-700" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-purple-900">
              {waiverSigned ? "0 Pending" : "1 Pending"}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">FR-CHK-016 Owner countersignature required</div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-emerald-900 font-semibold">
              <span>GST Rule 46 e-Invoicing</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-800">100% Validated</div>
            <div className="mt-1 text-[11px] text-slate-500">Intra (36) & Inter-State GST Compliant</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
              <span>Expiring Statutory Instruments</span>
              <CalendarX2 className="h-4 w-4 text-slate-500" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">3 Policies</div>
            <div className="mt-1 text-[11px] text-slate-500">CAR Insurance & Bank Guarantees</div>
          </div>
        </div>

        {/* Mandatory Waiver 2nd Approver Sign-off Queue (FR-CHK-016) */}
        <div className="rounded-xl border border-purple-200 bg-white overflow-hidden shadow-2xs">
          <div className="border-b border-purple-200 bg-purple-50 px-5 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-purple-900">
                Mandatory Requirement Waivers Pending 2nd Approver Countersign (FR-CHK-016)
              </h2>
              <span className="text-[11px] text-purple-700">
                Requires Owner / MD sign-off to protect Deccan against client milestone deductions
              </span>
            </div>
            <span className="font-mono text-xs font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded border border-purple-300">
              {waiverSigned ? "ALL WAIVERS SIGNED" : "1 ACTION REQUIRED"}
            </span>
          </div>

          {waiverError && (
            <div className="mx-5 mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{waiverError}</span>
            </div>
          )}

          {!waiverSigned ? (
            <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-purple-900">HYD-BIO-09-DT028</span>
                  <span className="rounded bg-purple-100 text-purple-900 px-1.5 py-0.2 font-mono text-[10px] font-bold">MANDATORY</span>
                  <span className="text-slate-600 font-medium">Factory Vibration Isolator Test Certificate</span>
                </div>
                <div className="text-xs text-slate-600">
                  Initiated by: <strong>Meera Deshmukh (PM)</strong> · Reason: <em>OEM provided monolithic pre-installed spring mounts; separate lab test report waived by client letter dated 22-Oct.</em>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={signingWaiver}
                  onClick={handleCountersignWaiver}
                  className="inline-flex items-center gap-1.5 rounded-md bg-purple-700 px-4 py-2 text-xs font-bold text-white hover:bg-purple-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Stamp className="h-3.5 w-3.5" />
                  <span>{signingWaiver ? "Countersigning…" : "Countersign & Seal Waiver"}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 text-xs text-emerald-800 flex items-center gap-2 bg-emerald-50/50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>✓ Waiver countersigned by Vikramaditya Reddy (MD). Audit hash recorded in PostgreSQL immutable ledger.</span>
            </div>
          )}
        </div>

        {/* Commercial Financial Risk Breakdown By Project */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Commercial Portfolio Retention Breakdown ({data.projects.length} Projects)
            </h2>
            <span className="text-[11px] text-slate-500">Gated until 100% dossier approval</span>
          </div>

          <div className="divide-y divide-slate-200 text-xs">
            {data.projects.map((p) => (
              <div key={p.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded text-[11px]">
                      {p.code}
                    </span>
                    <span className="font-bold text-slate-900">{p.name}</span>
                    <span className="text-slate-500">· Client: {p.clientName}</span>
                  </div>
                  <div className="text-slate-600 text-[11px]">
                    Target Handover: <strong className="font-mono text-slate-800">{p.targetHandoverDate || "30 Nov 2026"}</strong> · Approved Docs: <strong className="font-mono text-emerald-700">{p.approvedCount}</strong> / {p.applicableCount}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-sm text-indigo-950">
                    {formatInr(p.retentionAtRiskPaise)}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    Retention At Risk
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ========================================================================== */
  /* 4. ROLE VIEW: R-PM (Meera Deshmukh - Project Manager Command Center)       */
  /* ========================================================================== */
  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* PM Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold text-xs">
              <FolderKanban className="h-4 w-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">
              Senior Project Manager Command Center — Milestone Closeout
            </h1>
            <span className="rounded bg-emerald-50 border border-emerald-300 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-900">
              ROLE: R-PM (Senior Project Manager)
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Welcome, <strong>{data.user.name}</strong>. Coordinate milestone requirements, issue external supplier upload links, and compile handover packages.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => router.push(`/projects/${primaryProjectId}`)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163A5F] transition-colors cursor-pointer"
          >
            <FolderKanban className="h-3.5 w-3.5" />
            <span>Open {primaryProject?.code || "HYD-BIO-09"} Workspace</span>
          </button>
        </div>
      </div>

      {/* 4 PM KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Overall Handover Readiness</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900">64%</div>
          <div className="mt-1 text-[11px] text-slate-500">Target closeout: 30 Nov 2026</div>
        </div>

        <div className="rounded-lg border border-red-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-red-800 font-medium">
            <span>Critical Path Blockers</span>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-red-700">4 Items</div>
          <div className="mt-1 text-[11px] text-slate-500">Blocking milestone sign-off & dossier compile</div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-blue-900 font-medium">
            <span>Active Supplier Guest Links</span>
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-blue-900">3 Active</div>
          <div className="mt-1 text-[11px] text-slate-500">Voltas, Blue Star & Armstrong (SCR-034)</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Handover Dossier Compiler</span>
            <FileText className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900">Ready</div>
          <div className="mt-1 text-[11px] text-slate-500">C++ qpdf streaming merger configured</div>
        </div>
      </div>

      {/* External Supplier Guest Grant Center (SCR-034) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Active External Supplier Links (SCR-034 Supplier Guest Portal)
            </h2>
            <span className="text-[11px] text-slate-500">Isolated 128-bit bearer links with OTP verification</span>
          </div>
          <button
            onClick={() => router.push(`/projects/${primaryProjectId}`)}
            className="rounded bg-blue-50 border border-blue-300 text-blue-800 px-2.5 py-1 text-xs font-semibold hover:bg-blue-100"
          >
            + Issue New Supplier Link
          </button>
        </div>

        <div className="divide-y divide-slate-200 text-xs">
          <div className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">Voltas Ltd (Chiller OEM)</span>
                <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.2 font-mono text-[10px] font-semibold">Active · 28 Days Left</span>
              </div>
              <div className="text-slate-600 text-[11px]">Requested: Chiller AHRI Certificate, Factory Test Sheet & Warranty Deed</div>
            </div>
            <button
              onClick={() => router.push("/guest/test_supplier_token_hyd_09")}
              className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
            >
              <span>Inspect Supplier View</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          <div className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">Blue Star Cleanroom Systems</span>
                <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.2 font-mono text-[10px] font-semibold">Active · 24 Days Left</span>
              </div>
              <div className="text-slate-600 text-[11px]">Requested: AHU-04 Fan Characteristic Curves & HEPA Certificate</div>
            </div>
            <button
              onClick={() => router.push("/guest/test_supplier_token_hyd_09")}
              className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
            >
              <span>Inspect Supplier View</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Projects Portfolio */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Active Projects Portfolio ({data.projects.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {data.projects.map((proj) => {
            const pct =
              proj.applicableCount > 0
                ? Math.round((proj.approvedCount / proj.applicableCount) * 100)
                : 0;

            return (
              <div
                key={proj.id}
                onClick={() => router.push(`/projects/${proj.id}`)}
                className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-2xs hover:border-blue-600 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-blue-50 border border-blue-200 px-2 py-0.5 font-mono text-xs font-bold text-blue-800">
                      {proj.code}
                    </span>
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-blue-50 text-blue-900 border-blue-300">
                      {proj.status}
                    </span>
                  </div>

                  <h3 className="mt-2.5 text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                    {proj.name}
                  </h3>

                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <div>Client: <strong className="text-slate-800">{proj.clientName}</strong></div>
                    <div>Target Handover: <strong className="text-slate-800">{proj.targetHandoverDate || "30 Nov 2026"}</strong></div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-600">Closeout Progress</span>
                    <span className="font-mono font-bold text-slate-900">
                      {proj.approvedCount} / {proj.applicableCount} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div style={{ width: `${pct}%` }} className="h-full bg-emerald-600 rounded-full transition-all" />
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <span className="font-mono text-slate-600">
                      Retention: <strong>{formatInr(proj.retentionAtRiskPaise)}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                      <span>Open Workspace</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
