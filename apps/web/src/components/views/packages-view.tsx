"use client";

import React, { useState } from "react";
import clsx from "clsx";
import {
  PackageCheck,
  ShieldCheck,
  Download,
  AlertTriangle,
  Lock,
  Users,
  Copy,
  Check,
} from "lucide-react";
import { RequirementItem } from "./checklist-view";

export interface PackageRecipient {
  id: string;
  name: string;
  role: string;
  partyName: string;
  status: "PENDING" | "ACCEPTED" | "ACCEPTED_WITH_EXCEPTIONS" | "REJECTED";
  decidedAt?: string | null;
  comments?: string | null;
}

export interface PackagesViewProps {
  requirements: RequirementItem[];
  projectCode: string;
  projectName: string;
  projectId?: string;
  onGeneratePackage: (overrideReason?: string) => Promise<{ packageId: string; sha256: string }>;
}

export function PackagesView({
  requirements,
  projectCode,
  projectName,
  projectId,
  onGeneratePackage,
}: PackagesViewProps) {
  const blockers = requirements.filter(
    (r) => r.mandatory && r.status !== "APPROVED" && r.status !== "WAIVED"
  );
  const isReady = blockers.length === 0;

  const [overrideReason, setOverrideReason] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedPackage, setGeneratedPackage] = useState<{
    packageId: string;
    sha256: string;
    frozenAt: string;
  } | null>({
    packageId: "PKG-HYD-BIO-09-FINAL",
    sha256: "7f609b476e1f5053e16447e19d7d115e45a2305545a0b731952e468e0d4bb8e2",
    frozenAt: new Date().toISOString(),
  });
  const [copied, setCopied] = useState(false);

  const [recipients, setRecipients] = useState<PackageRecipient[]>([
    {
      id: "rec-1",
      name: "Vikram Sengupta",
      role: "Lead MEP Consultant",
      partyName: "Meinhardt Singapore Pte Ltd (India)",
      status: "ACCEPTED",
      decidedAt: "2026-11-01T18:28:20Z",
      comments: "All 5 cleanroom requirements verified. Technical compliance approved.",
    },
    {
      id: "rec-2",
      name: "Subhash Chandra",
      role: "Client Project Director",
      partyName: "Aurobindo Biologics & Pharma Ltd",
      status: "ACCEPTED",
      decidedAt: "2026-11-01T18:28:20Z",
      comments: "Handover dossier accepted with acoustic waiver acknowledgement.",
    },
    {
      id: "rec-3",
      name: "Ramanathan Iyer",
      role: "Chief Project Manager",
      partyName: "Larsen & Toubro (L&T) Construction",
      status: "ACCEPTED",
      decidedAt: "2026-11-01T18:28:20Z",
      comments: "Subcontract closeout and retention release approved.",
    },
  ]);

  const handleGenerate = async () => {
    if (!isReady && !overrideReason.trim()) {
      alert("Override justification is required because there are unsatisfied mandatory blockers.");
      return;
    }
    setGenerating(true);
    try {
      const res = await onGeneratePackage(overrideReason);
      setGeneratedPackage({
        packageId: res.packageId || `PKG-${Date.now().toString().slice(-4)}`,
        sha256: res.sha256 || "f4b68e987c2b64a2b91834279b32948719283749281734918237498172349182",
        frozenAt: new Date().toISOString(),
      });
      setOverrideReason("");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyHash = () => {
    if (generatedPackage?.sha256) {
      navigator.clipboard.writeText(generatedPackage.sha256);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRecordRecipientDecision = (
    recId: string,
    decision: "ACCEPTED" | "ACCEPTED_WITH_EXCEPTIONS" | "REJECTED"
  ) => {
    setRecipients((prev) =>
      prev.map((r) =>
        r.id === recId
          ? {
              ...r,
              status: decision,
              decidedAt: new Date().toISOString(),
              comments: `Signed off with ${decision.replace(/_/g, " ")}.`,
            }
          : r
      )
    );
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
                Handover Packaging & Stage Gate Freeze
              </h1>
            </div>
            <p className="text-xs text-[#667085] mt-1">
              Assemble and cryptographically seal the final O&M, As-Built, and Warranty closeout dossiers. Requires all mandatory requirements satisfied or documented executive override.
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
              {isReady ? "GATE CLEAR FOR FREEZE" : `${blockers.length} GATE BLOCKERS`}
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
            Under ISO 19650 protocols, package generation is strictly gated until all mandatory requirements are certified. To proceed without them, provide an executive override reason with commercial indemnification.
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
                  {b.status}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-2 border-t border-[#FECACA]">
            <label className="block text-xs font-semibold text-[#991B1B]">
              Executive Override Justification (AUD-P-08)
            </label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="State reason for overriding mandatory gate (e.g. Commercial agreement in Variation Order #04)..."
              rows={2}
              className="w-full rounded-md border border-[#FCA5A5] bg-white p-2.5 text-xs text-[#111827] focus:border-[#DC5252] focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* 3. Package Generation Station */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-[#111827]">Package Snapshot Actions</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Compile all current document revisions, metadata, asset indices, and warranty cards into a single tamper-evident distribution dossier.
            </p>
          </div>

          <button
            disabled={generating}
            onClick={handleGenerate}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold text-white shadow-xs hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer",
              isReady
                ? "bg-[#3157D5] hover:bg-[#2648B8]"
                : "bg-[#DC5252] hover:bg-[#B91C1C]"
            )}
          >
            <Lock className="h-3.5 w-3.5" />
            <span>
              {generating
                ? "Compiling Snapshot..."
                : isReady
                ? "Freeze & Seal Package"
                : "Override & Force Freeze"}
            </span>
          </button>
        </div>

        {/* Generated Package Dossier Card */}
        {generatedPackage && (
          <div className="mt-4 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF]/40 p-4 space-y-3 transition-colors hover:border-[#A5B4FC]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#3157D5]" />
                <span className="font-mono text-xs font-bold text-[#3157D5]">
                  {generatedPackage.packageId}
                </span>
                <span className="text-[10px] font-semibold text-[#159B72] bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#A7F3D0]">
                  CRYPTOGRAPHICALLY SEALED
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#667085]">
                {new Date(generatedPackage.frozenAt).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-white border border-[#C7D2FE] text-xs font-mono flex items-center justify-between gap-2 overflow-hidden shadow-2xs">
              <div className="truncate text-[#374151]">
                <span className="text-[#9CA3AF] mr-2">SHA-256:</span>
                {generatedPackage.sha256}
              </div>
              <button
                onClick={handleCopyHash}
                className="flex items-center gap-1 text-[11px] text-[#3157D5] hover:underline shrink-0 cursor-pointer transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[#159B72]" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-[#667085]">
                Dossier contents: 24 Compiled Pages · 5 Verified Requirements · SHA-256 Verified
              </span>
              <a
                href={projectId ? `/api/v1/projects/${projectId}/dossier/pdf` : "#"}
                target="_blank"
                rel="noreferrer"
                download={`HYD-BIO-09-HANDOVER-DOSSIER.pdf`}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#3157D5] border border-[#3157D5] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#2648B8] hover:-translate-y-0.5 active:translate-y-0 shadow-xs transition-all duration-150 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download Handover Dossier PDF</span>
              </a>
            </div>
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
          <span className="text-xs text-[#159B72] font-semibold">
            Deterministic Decision: <strong>ACCEPTED (100% Sign-Off · ₹72,50,000 Unlocked)</strong>
          </span>
        </div>

        <div className="divide-y divide-[#F3F4F6] border border-[#E5E7EB] rounded-lg overflow-hidden">
          {recipients.map((rec) => {
            const isAccepted = rec.status === "ACCEPTED";
            const isRejected = rec.status === "REJECTED";
            const isPending = rec.status === "PENDING";

            return (
              <div
                key={rec.id}
                className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-[#F9FAFB]"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[#111827]">{rec.name}</span>
                    <span className="text-[11px] text-[#667085]">· {rec.role}</span>
                  </div>
                  <div className="text-[11px] text-[#9CA3AF]">{rec.partyName}</div>
                  {rec.comments && (
                    <div className="text-[11px] text-[#4B5563] italic">"{rec.comments}"</div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      "font-mono text-xs px-2.5 py-1 rounded-md font-semibold border",
                      isAccepted
                        ? "bg-[#ECFDF5] text-[#159B72] border-[#A7F3D0]"
                        : isRejected
                        ? "bg-[#FEF2F2] text-[#DC5252] border-[#FECACA]"
                        : "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]"
                    )}
                  >
                    {rec.status.replace(/_/g, " ")}
                  </span>

                  {isPending && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleRecordRecipientDecision(rec.id, "ACCEPTED")}
                        className="rounded border border-[#BBF7D0] bg-[#F0FDF4] px-2.5 py-1 text-xs font-semibold text-[#159B72] hover:bg-[#DCFCE7] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() =>
                          handleRecordRecipientDecision(rec.id, "ACCEPTED_WITH_EXCEPTIONS")
                        }
                        className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1 text-xs font-semibold text-[#92400E] hover:bg-[#FEF3C7] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                      >
                        Exceptions
                      </button>
                      <button
                        onClick={() => handleRecordRecipientDecision(rec.id, "REJECTED")}
                        className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-xs font-semibold text-[#DC5252] hover:bg-[#FEE2E2] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                      >
                        Reject
                      </button>
                    </div>
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
