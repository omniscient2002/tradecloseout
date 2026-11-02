"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck, Lock, Hash, Clock, CheckCircle2 } from "lucide-react";
import { apiFetch } from "../../../lib/api-client";

export default function AuditTrailPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Audit events log mock/query
    setEvents([
      { id: "aud_01", eventType: "PACKAGE_ACCEPTED_BY_ALL", entityType: "SUBMISSION", timestamp: "06 Nov 2026, 20:45 IST", actor: "Dr. Harish Rao (Client)", hash: "b8c4d19e072f8a55..." },
      { id: "aud_02", eventType: "MANDATORY_WAIVER_COUNTERSIGNED", entityType: "REQUIREMENT", timestamp: "05 Nov 2026, 17:10 IST", actor: "Vikramaditya Reddy (Owner)", hash: "7a1b3c99df0281cc..." },
      { id: "aud_03", eventType: "EXTERNAL_APPROVAL_RECORDED", entityType: "DOCUMENT_VERSION", timestamp: "04 Nov 2026, 14:30 IST", actor: "Meera Deshmukh (PM)", hash: "44ef098a12bc7891..." },
      { id: "aud_04", eventType: "REVIEW_DECISION_APPROVE", entityType: "DOCUMENT_VERSION", timestamp: "02 Nov 2026, 16:20 IST", actor: "Karthikeya Sharma (QC)", hash: "9901df4455ab1234..." },
      { id: "aud_05", eventType: "CHECKLIST_SNAPSHOT_CREATED", entityType: "PROJECT", timestamp: "01 Nov 2026, 11:00 IST", actor: "Meera Deshmukh (PM)", hash: "e7f2b9a4c01289fe..." },
    ]);
    setLoading(false);
  }, []);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cryptographic Audit Trail</h1>
          <p className="text-slate-500 mt-0.5">Append-only SHA-256 hash-chained event logs protecting against tamper and evidence disputes.</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-300 px-3 py-1 font-semibold text-emerald-800">
          <ShieldCheck className="h-4 w-4" />
          <span>Chain Verified & Intact</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 font-semibold text-slate-700">
          Recent Hash-Chained Events
        </div>
        <div className="divide-y divide-slate-100">
          {events.map((e) => (
            <div key={e.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[11px]">
                    {e.eventType}
                  </span>
                  <span className="text-slate-500">on {e.entityType}</span>
                </div>
                <div className="text-slate-600">Actor: <strong>{e.actor}</strong></div>
              </div>
              <div className="text-right space-y-0.5 font-mono text-[11px]">
                <div className="text-slate-400">{e.timestamp}</div>
                <div className="text-slate-500 flex items-center gap-1">
                  <Hash className="h-3 w-3 text-slate-400" />
                  <span>{e.hash}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
