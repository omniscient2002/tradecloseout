"use client";

import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api-client";
import { humanLabel } from "../../../lib/presentation";

interface Activity {
  id: string;
  action: string;
  entity_type: string;
  actor_name: string | null;
  created_at: string;
}
export default function AuditTrailPage() {
  const [events, setEvents] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await apiFetch<Activity[]>("/api/v1/orgs/current/audit"));
    } catch {
      setError(
        "We could not load your organisation’s activity. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const when = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }).format(date)
      : "Time not recorded";
  };
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="mt-2 text-sm text-slate-500">
          See recent changes and decisions across your organisation. Times are
          shown in Indian Standard Time.
        </p>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}{" "}
          <button onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 p-5 font-semibold">
            Recent activity
          </h2>
          {loading ? (
            <p role="status" className="p-5 text-sm text-slate-500">
              Loading activity…
            </p>
          ) : events.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              No activity has been recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col justify-between gap-2 p-5 sm:flex-row"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {humanLabel(event.action)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {humanLabel(event.entity_type)} ·{" "}
                      {event.actor_name || "Automated activity"}
                    </p>
                  </div>
                  <time
                    dateTime={event.created_at}
                    className="text-xs text-slate-500"
                  >
                    {when(event.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
