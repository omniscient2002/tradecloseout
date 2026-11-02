"use client";

import React, { useState } from "react";
import clsx from "clsx";
import {
  Building2,
  PackageCheck,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldCheck,
  Download,
  AlertTriangle,
} from "lucide-react";

export function ClientGuestView({ onReturnToContractor }: { onReturnToContractor: () => void }) {
  const [decision, setDecision] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSignOff = (choice: string) => {
    setSubmitting(true);
    setTimeout(() => {
      setDecision(choice);
      setSubmitting(false);
    }, 800);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      {/* 1. Client Portal Header */}
      <div className="rounded-xl border border-[#C7D2FE] bg-[#EEF2FF]/60 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-white text-[#3157D5] border border-[#C7D2FE]">
                EXECUTIVE HANDOVER SIGN-OFF
              </span>
              <span className="text-xs text-[#3157D5] font-medium">Skyline Commercial Towers</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#1E3A8A]">
              Client Handover Dossier & Sign-Off Portal
            </h1>
            <p className="text-xs text-[#3B82F6]">
              Authorized review interface for Project Director, Facilities Lead, and Commercial Owner. Review compiled documentation and execute contractual acceptance.
            </p>
          </div>

          <button
            onClick={onReturnToContractor}
            className="rounded-md border border-[#3157D5] bg-white px-3 py-1.5 text-xs font-semibold text-[#3157D5] hover:bg-[#EEF2FF] transition-all self-start sm:self-auto shrink-0 shadow-2xs"
          >
            ← Back to Contractor Desk
          </button>
        </div>
      </div>

      {/* 2. Package Dossier Inspection Card */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-[#3157D5]" />
            <h2 className="text-sm font-bold text-[#111827]">
              Frozen Handover Dossier (PKG-2026-001-REL)
            </h2>
          </div>
          <span className="font-mono text-[11px] text-[#159B72] bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#A7F3D0] font-semibold">
            SHA-256 VERIFIED
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-[#F9FAFB] p-3 rounded-lg border border-[#E5E7EB]">
          <div>
            <span className="text-[10px] text-[#667085] uppercase tracking-wider block">Total Artifacts</span>
            <span className="font-mono font-bold text-[#111827] text-sm">48 Documents</span>
          </div>
          <div>
            <span className="text-[10px] text-[#667085] uppercase tracking-wider block">OEM Warranties</span>
            <span className="font-mono font-bold text-[#111827] text-sm">12 Active Assets</span>
          </div>
          <div>
            <span className="text-[10px] text-[#667085] uppercase tracking-wider block">Gated Retention</span>
            <span className="font-mono font-bold text-[#3157D5] text-sm">₹45,00,000</span>
          </div>
        </div>

        {/* 3. Decision Terminal */}
        {decision ? (
          <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-[#159B72] mx-auto" />
            <div className="font-bold text-sm text-[#065F46]">
              Handover Acceptance Recorded: {decision.replace(/_/g, " ")}
            </div>
            <p className="text-xs text-[#047857]">
              Your decision has been logged into the immutable audit ledger with cryptographic signature timestamp.
            </p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <label className="block text-xs font-semibold text-[#374151]">
              Formal Remarks / Acceptance Notes
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter contractual observations or acceptance exceptions..."
              rows={3}
              className="w-full rounded-md border border-[#E5E7EB] p-2.5 text-xs text-[#111827] focus:border-[#3157D5] focus:outline-none"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
              <button
                disabled={submitting}
                onClick={() => handleSignOff("ACCEPTED")}
                className="flex items-center justify-center gap-1.5 rounded-md bg-[#159B72] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#0F766E] transition-all disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Accept Handover</span>
              </button>

              <button
                disabled={submitting}
                onClick={() => handleSignOff("ACCEPTED_WITH_EXCEPTIONS")}
                className="flex items-center justify-center gap-1.5 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2 text-xs font-semibold text-[#92400E] hover:bg-[#FEF3C7] transition-all disabled:opacity-50"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Accept w/ Exceptions</span>
              </button>

              <button
                disabled={submitting}
                onClick={() => handleSignOff("REJECTED")}
                className="flex items-center justify-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-semibold text-[#DC5252] hover:bg-[#FEE2E2] transition-all disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Reject Package</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
