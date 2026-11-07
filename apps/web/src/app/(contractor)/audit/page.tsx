"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Hash, RefreshCw } from "lucide-react";
import { apiFetch } from "../../../lib/api-client";

interface AuditEventDto {
  id: string;
  chain_seq: number;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  actor_type: string;
  prev_hash: string | null;
  hash: string;
  created_at: string;
  request_id?: string;
}

export default function AuditTrailPage() {
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuditEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<any[]>("/api/v1/orgs/current/audit");
      const list = Array.isArray(data) ? data : (data as any)?.data || [];
      setEvents(list);

    } catch (err: any) {
      setError(err?.message || "Failed to load cryptographic audit log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditEvents();
  }, [fetchAuditEvents]);

  const formatDateIst = (isoDate: string) => {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(isoDate)) + " IST";
    } catch {
      return isoDate;
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Audit Trail</h1>
          <p className="text-slate-500 mt-0.5">
            Recent organisation events. This screen does not verify the full hash chain or prove tamper resistance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 font-semibold text-amber-800">
            Hash-chain integrity not verified
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchAuditEvents}
            className="font-semibold text-red-800 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div className="font-bold text-slate-800">
            Latest audit events (up to 100)
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            Latest event hash (unverified): <span className="font-bold text-slate-800">{events[0]?.hash.slice(0, 16) || "none"}...</span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 w-full animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            No audit events recorded yet in this organisation.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((e) => (
              <div key={e.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded text-[11px]">
                      Seq #{e.chain_seq} · {e.action}
                    </span>
                    <span className="text-slate-600 font-medium">on {e.entity_type}</span>
                    {e.entity_id && (
                      <span className="font-mono text-[10px] text-slate-400">({e.entity_id.slice(0, 8)}...)</span>
                    )}
                  </div>
                  <div className="text-slate-600">
                    Actor: <strong className="text-slate-900">{e.actor_name || "System"}</strong> ({e.actor_type})
                  </div>
                </div>

                <div className="text-left md:text-right space-y-0.5 font-mono text-[11px]">
                  <div className="text-slate-500 font-medium">{formatDateIst(e.created_at)}</div>
                  <div className="text-slate-500 flex items-center md:justify-end gap-1">
                    <Hash className="h-3 w-3 text-slate-400" />
                    <span title={`Full Hash: ${e.hash}`}>{e.hash.slice(0, 24)}...</span>
                  </div>
                  {e.prev_hash && (
                    <div className="text-[10px] text-slate-400" title={`Prev Hash: ${e.prev_hash}`}>
                      prev: {e.prev_hash.slice(0, 16)}...
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
