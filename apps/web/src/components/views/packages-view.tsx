"use client";

import { humanLabel } from "../../lib/presentation";
import React, { useState } from "react";
import clsx from "clsx";
import {
  PackageCheck,
  AlertTriangle,
  Users,
} from "lucide-react";
import { RequirementItem } from "./checklist-view";

export interface PackagesViewProps {
  requirements: RequirementItem[];
  projectCode: string;
  projectName: string;
  projectId?: string;
  onGeneratePackage: () => Promise<{ packageId: string; status: string }>;
}

export function PackagesView({
  requirements,
  onGeneratePackage,
}: PackagesViewProps) {
  const blockers = requirements.filter(
    (r) => r.mandatory && r.status !== "APPROVED" && r.status !== "WAIVED"
  );
  const isReady = blockers.length === 0;

  const [generating, setGenerating] = useState(false);
  const [generatedPackage, setGeneratedPackage] = useState<{
    packageId: string;
    status: string;
  } | null>(null);
  const handleGenerate = async () => {
    if (!isReady) {
      alert("Resolve mandatory readiness blockers before requesting a final package.");
      return;
    }
    setGenerating(true);
    try {
      const res = await onGeneratePackage();
      setGeneratedPackage({
        packageId: res.packageId,
        status: res.status,
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Header Overview */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-[#3157D5]" />
              <h1 className="text-base font-bold text-[#111827]">
                Handover Package Requests
              </h1>
            </div>
            <p className="text-xs text-[#667085] mt-1">
              Request a package after readiness checks pass. A request record is separate from a generated artifact and recipient acceptance.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "font-mono text-xs px-2.5 py-1 rounded-md font-semibold border",
                isReady
                  ? "bg-[#ECFDF5] text-[#159B72] border-[#A7F3D0]"
                  : "bg-[#FEF2F2] text-[#DC5252] border-[#FECACA]"
              )}
            >
              {isReady ? "PRELIMINARY CHECK CLEAR" : `${blockers.length} GATE BLOCKERS`}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Readiness Evaluation / Gate Blocker Resolution */}
      {!isReady && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2]/40 p-5 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-bold text-[#DC5252]">
            <AlertTriangle className="h-4 w-4" />
            <span>Unsatisfied Mandatory Closeout Requirements ({blockers.length})</span>
          </div>
          <p className="text-xs text-[#991B1B]">
            Resolve blockers or record authorised waiver/not-applicable decisions. A text override cannot satisfy a contractual requirement.
          </p>

          <div className="bg-white rounded-lg border border-[#FECACA] divide-y divide-[#FEE2E2] max-h-48 overflow-y-auto">
            {blockers.map((b) => (
              <div key={b.id} className="p-2.5 text-xs flex items-center justify-between">
                <div>
                  <span className="font-mono font-semibold text-[#DC5252] mr-2">
                    {b.requirementKey}
                  </span>
                  <span className="font-medium text-[#111827]">{b.title}</span>
                </div>
                <span className="font-mono text-[10px] text-[#DC5252] bg-[#FEF2F2] px-2 py-0.5 rounded border border-[#FECACA]">
                  {humanLabel(b.status)}
                </span>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* 3. Package Generation Station */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-[#111827]">Handover package actions</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Request a package record. A download is offered only after a verified artifact exists.
            </p>
          </div>

          <button
            disabled={generating || !isReady}
            onClick={handleGenerate}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold text-white shadow-xs hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer",
              "bg-[#3157D5] hover:bg-[#2648B8]"
            )}
          >
            <PackageCheck className="h-3.5 w-3.5" />
            <span>{generating ? "Requesting package..." : "Request handover package"}</span>
          </button>
        </div>

        {/* Generated Package Dossier Card */}
        {generatedPackage && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2 text-xs text-amber-950">
            <div>Package request recorded: <span className="font-mono font-bold">{generatedPackage.packageId}</span></div>
            <div>State: {generatedPackage.status}. No verified artifact or download is available from this view.</div>
          </div>
        )}
      </div>

      {/* 4. Multi-Recipient Client Sign-Off Board */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#3157D5]" />
            <h2 className="text-sm font-bold text-[#111827]">
              Client Multi-Recipient Handover Sign-Off Board
            </h2>
          </div>
          <span className="text-xs text-[#667085] font-semibold">
            Recipient decisions are not loaded in this view.
          </span>
        </div>

        <div className="divide-y divide-[#F3F4F6] border border-[#E5E7EB] rounded-lg overflow-hidden">
          <div className="p-4 text-xs text-slate-600">No submission recipients are connected to this component.</div>
        </div>
      </div>
    </div>
  );
}
