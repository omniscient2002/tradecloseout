"use client";

import React, { useState } from "react";
import clsx from "clsx";
import {
  Wrench,
  ShieldAlert,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  FileCheck2,
} from "lucide-react";

export interface AssetWarrantyItem {
  id: string;
  assetTag: string;
  name: string;
  manufacturer: string;
  serialNumber: string;
  oemWarrantyStart: string;
  oemWarrantyEnd: string;
  contractHandoverDate: string;
  status: "ACTIVE" | "EXPIRING_SOON" | "DISPUTED" | "EXPIRED";
  basisGapDays: number;
}

export interface DefectSnagItem {
  id: string;
  assetTag: string;
  description: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  status: "OPEN" | "RESOLVED" | "CLOSED";
  loggedDate: string;
  evidenceUploaded: boolean;
}

export function WarrantiesView() {
  const [activeTab, setActiveTab] = useState<"assets" | "snags">("assets");

  const [assets] = useState<AssetWarrantyItem[]>([
    {
      id: "ast-1",
      assetTag: "CH-01",
      name: "Water-Cooled Centrifugal Chiller (600 TR)",
      manufacturer: "Daikin McQuay",
      serialNumber: "DK-2025-99481",
      oemWarrantyStart: "2025-10-15",
      oemWarrantyEnd: "2027-10-15",
      contractHandoverDate: "2026-12-31",
      status: "DISPUTED",
      basisGapDays: 442,
    },
    {
      id: "ast-2",
      assetTag: "AHU-04",
      name: "Double Skin Air Handling Unit",
      manufacturer: "Voltas Commercial",
      serialNumber: "VOL-AHU-4402",
      oemWarrantyStart: "2026-06-01",
      oemWarrantyEnd: "2028-06-01",
      contractHandoverDate: "2026-12-31",
      status: "ACTIVE",
      basisGapDays: 0,
    },
    {
      id: "ast-3",
      assetTag: "DG-01",
      name: "Emergency Diesel Generator (1500 kVA)",
      manufacturer: "Cummins Power",
      serialNumber: "CUM-DG-1500-X",
      oemWarrantyStart: "2026-03-10",
      oemWarrantyEnd: "2028-03-10",
      contractHandoverDate: "2026-12-31",
      status: "DISPUTED",
      basisGapDays: 296,
    },
    {
      id: "ast-4",
      assetTag: "PUMP-FP-01",
      name: "Main Fire Hydrant Booster Pump",
      manufacturer: "Grundfos Pumps",
      serialNumber: "GF-FP-9901",
      oemWarrantyStart: "2026-08-01",
      oemWarrantyEnd: "2028-08-01",
      contractHandoverDate: "2026-12-31",
      status: "ACTIVE",
      basisGapDays: 0,
    },
  ]);

  const [snags, setSnags] = useState<DefectSnagItem[]>([
    {
      id: "sng-1",
      assetTag: "CH-01",
      description: "Chilled water outlet temperature sensor drifting +2.4°C during full load testing.",
      severity: "CRITICAL",
      status: "OPEN",
      loggedDate: "2026-10-28",
      evidenceUploaded: false,
    },
    {
      id: "sng-2",
      assetTag: "AHU-04",
      description: "Static pressure damper actuator linkage loose on supply side.",
      severity: "MAJOR",
      status: "RESOLVED",
      loggedDate: "2026-10-25",
      evidenceUploaded: true,
    },
  ]);

  const handleResolveSnag = (snagId: string) => {
    setSnags((prev) =>
      prev.map((s) =>
        s.id === snagId
          ? { ...s, status: "CLOSED", evidenceUploaded: true }
          : s
      )
    );
  };

  const disputedAssets = assets.filter((a) => a.status === "DISPUTED");

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Header Overview */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[#3157D5]" />
              <h1 className="text-base font-bold text-[#111827]">
                Warranties & Defects Liability Period (DLP)
              </h1>
            </div>
            <p className="text-xs text-[#667085] mt-1">
              Tracks OEM manufacturer warranty start/end dates, detects warranty basis discrepancies vs. project handover dates, and manages defect rectification snags.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("assets")}
              className={clsx(
                "px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 cursor-pointer",
                activeTab === "assets"
                  ? "bg-[#3157D5] text-white shadow-2xs -translate-y-0.5"
                  : "text-[#4B5563] hover:bg-[#F3F4F6] hover:-translate-y-0.5"
              )}
            >
              Equipment Assets ({assets.length})
            </button>
            <button
              onClick={() => setActiveTab("snags")}
              className={clsx(
                "px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 cursor-pointer",
                activeTab === "snags"
                  ? "bg-[#3157D5] text-white shadow-2xs -translate-y-0.5"
                  : "text-[#4B5563] hover:bg-[#F3F4F6] hover:-translate-y-0.5"
              )}
            >
              Defects / Snags ({snags.length})
            </button>
          </div>
        </div>
      </div>

      {/* 2. OEM Warranty Basis Discrepancy Banner */}
      {disputedAssets.length > 0 && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 flex items-start gap-3 shadow-2xs">
          <ShieldAlert className="h-5 w-5 text-[#D99A28] shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <span className="font-bold text-[#92400E]">
              {disputedAssets.length} Equipment Assets Have OEM Warranty Basis Gaps
            </span>
            <p className="text-[#B45309]">
              The manufacturer warranty began upon factory dispatch, but your main contract mandates DLP to commence on Project Handover (31 Dec 2026). Ensure extended warranty insurance or supplier back-to-back indemnity is executed before commercial closeout.
            </p>
          </div>
        </div>
      )}

      {/* 3. Main Data Content */}
      {activeTab === "assets" ? (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#FAFBFD] text-[11px] font-semibold text-[#667085] uppercase tracking-wider">
                  <th className="py-3 px-4">Asset Tag / Equipment</th>
                  <th className="py-3 px-3">Manufacturer</th>
                  <th className="py-3 px-3">Serial Number</th>
                  <th className="py-3 px-3">OEM Warranty Period</th>
                  <th className="py-3 px-3">Warranty Basis Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {assets.map((asset) => {
                  const isDisputed = asset.status === "DISPUTED";
                  return (
                    <tr
                      key={asset.id}
                      className="hover:bg-[#F9FAFB] transition-colors duration-150"
                    >
                      {/* Asset Tag & Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-[#3157D5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                            {asset.assetTag}
                          </span>
                          <span className="font-semibold text-[#111827]">{asset.name}</span>
                        </div>
                      </td>

                      {/* Manufacturer */}
                      <td className="py-3 px-3 whitespace-nowrap text-[#374151]">
                        {asset.manufacturer}
                      </td>

                      {/* Serial Number */}
                      <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-[#667085]">
                        {asset.serialNumber}
                      </td>

                      {/* Period */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1 font-mono text-[11px] text-[#667085]">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {asset.oemWarrantyStart} → {asset.oemWarrantyEnd}
                          </span>
                        </div>
                      </td>

                      {/* Basis Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {isDisputed ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#DC5252] bg-[#FEF2F2] px-2 py-0.5 rounded border border-[#FECACA]">
                            <AlertTriangle className="h-3 w-3" />
                            DISPUTED ({asset.basisGapDays}d GAP)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-[#159B72] bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#A7F3D0]">
                            <CheckCircle2 className="h-3 w-3" />
                            ALIGNED WITH HANDOVER
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => alert(`Warranty certificate for ${asset.assetTag} opened.`)}
                          className="rounded border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-medium text-[#374151] hover:bg-[#F9FAFB] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                        >
                          Certificate
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Snags & Defects View */
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden shadow-2xs space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#FAFBFD] text-[11px] font-semibold text-[#667085] uppercase tracking-wider">
                  <th className="py-3 px-4">Snag Description</th>
                  <th className="py-3 px-3">Asset Tag</th>
                  <th className="py-3 px-3">Severity</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Logged Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {snags.map((snag) => (
                  <tr
                    key={snag.id}
                    className="hover:bg-[#F9FAFB] transition-colors duration-150"
                  >
                    <td className="py-3 px-4">
                      <span className="font-medium text-[#111827]">{snag.description}</span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="font-mono text-[11px] text-[#3157D5] bg-[#EEF2FF] px-2 py-0.5 rounded">
                        {snag.assetTag}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={clsx(
                          "font-mono text-[10px] font-bold px-2 py-0.5 rounded",
                          snag.severity === "CRITICAL"
                            ? "bg-[#FEF2F2] text-[#DC5252] border border-[#FECACA]"
                            : "bg-[#FFFBEB] text-[#D99A28] border border-[#FDE68A]"
                        )}
                      >
                        {snag.severity}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={clsx(
                          "font-mono text-[10px] font-semibold px-2 py-0.5 rounded",
                          snag.status === "CLOSED"
                            ? "bg-[#ECFDF5] text-[#159B72]"
                            : "bg-[#FFF7ED] text-[#C2410C]"
                        )}
                      >
                        {snag.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-[#667085]">
                      {snag.loggedDate}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {snag.status !== "CLOSED" ? (
                        <button
                          onClick={() => handleResolveSnag(snag.id)}
                          className="inline-flex items-center gap-1 rounded bg-[#159B72] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0F766E] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                        >
                          <FileCheck2 className="h-3 w-3" />
                          <span>Close Snag</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#159B72] font-semibold">
                          Evidence Attached
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
