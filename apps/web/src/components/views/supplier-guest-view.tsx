"use client";

import React, { useState } from "react";
import clsx from "clsx";
import {
  Users,
  UploadCloud,
  CheckCircle2,
  Clock,
  FileText,
  ShieldCheck,
  AlertCircle,
  Tag,
  Calendar,
} from "lucide-react";

export function SupplierGuestView({ onReturnToContractor }: { onReturnToContractor: () => void }) {
  const [uploadedKeys, setUploadedKeys] = useState<string[]>([]);
  const [activeUpload, setActiveUpload] = useState<string | null>(null);

  const supplierRequirements = [
    {
      key: "REQ-HVAC-01",
      title: "Chiller Commissioning & Factory Test Report",
      docType: "TEST_REPORT",
      assetTag: "CH-01",
      dueDate: "2026-11-20",
      status: uploadedKeys.includes("REQ-HVAC-01") ? "UPLOADED" : "REQUESTED",
    },
    {
      key: "REQ-HVAC-02",
      title: "AHU-04 Air Balancing & Acoustic Test Certificate",
      docType: "CERTIFICATE",
      assetTag: "AHU-04",
      dueDate: "2026-11-25",
      status: uploadedKeys.includes("REQ-HVAC-02") ? "UPLOADED" : "REQUESTED",
    },
    {
      key: "REQ-HVAC-03",
      title: "Chilled Water Pipe Hydrostatic Pressure Log (24-hr)",
      docType: "LOG_SHEET",
      assetTag: "PIPE-CHW-01",
      dueDate: "2026-11-28",
      status: uploadedKeys.includes("REQ-HVAC-03") ? "UPLOADED" : "REQUESTED",
    },
  ];

  const handleSimulateUpload = (key: string) => {
    setActiveUpload(key);
    setTimeout(() => {
      setUploadedKeys((prev) => [...prev, key]);
      setActiveUpload(null);
    }, 1200);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      {/* 1. Supplier Portal Header */}
      <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/60 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-white text-[#159B72] border border-[#A7F3D0]">
                TOKEN-SCOPED UPLOAD LINK
              </span>
              <span className="text-xs text-[#065F46] font-medium">Voltas HVAC Trade Partner</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#064E3B]">
              Subcontractor Closeout Document Portal
            </h1>
            <p className="text-xs text-[#047857]">
              Please upload signed test reports, manufacturer warranty cards, and as-built markups. Files are directly encrypted and delivered to the main contractor review desk.
            </p>
          </div>

          <button
            onClick={onReturnToContractor}
            className="rounded-md border border-[#059669] bg-white px-3 py-1.5 text-xs font-semibold text-[#065F46] hover:bg-[#ECFDF5] transition-all self-start sm:self-auto shrink-0 shadow-2xs"
          >
            ← Back to Contractor Desk
          </button>
        </div>
      </div>

      {/* 2. Assigned Requirements Checklist */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden shadow-2xs space-y-4">
        <div className="p-4 border-b border-[#E5E7EB] bg-[#FAFBFD] flex items-center justify-between">
          <span className="text-xs font-bold text-[#111827]">
            Pending Requirements Assigned to Your Package ({supplierRequirements.length})
          </span>
          <span className="text-xs font-mono text-[#667085]">
            {uploadedKeys.length} of {supplierRequirements.length} Submitted
          </span>
        </div>

        <div className="divide-y divide-[#F3F4F6] p-2">
          {supplierRequirements.map((item) => {
            const isDone = item.status === "UPLOADED";
            const isUploading = activeUpload === item.key;

            return (
              <div
                key={item.key}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F9FAFB] transition-colors rounded-lg"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#374151]">
                      {item.key}
                    </span>
                    <span className="font-semibold text-xs text-[#111827]">{item.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[#667085]">
                    <span>Doc Type: <strong className="font-mono text-[#374151]">{item.docType}</strong></span>
                    <span>Asset Tag: <strong className="font-mono text-[#3157D5]">{item.assetTag}</strong></span>
                    <span>Due: {item.dueDate}</span>
                  </div>
                </div>

                <div>
                  {isDone ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#159B72] bg-[#ECFDF5] px-3 py-1 rounded-md border border-[#A7F3D0]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      SUBMITTED
                    </span>
                  ) : (
                    <button
                      disabled={isUploading}
                      onClick={() => handleSimulateUpload(item.key)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#3157D5] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] transition-all disabled:opacity-50"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      <span>{isUploading ? "Uploading..." : "Upload File"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
