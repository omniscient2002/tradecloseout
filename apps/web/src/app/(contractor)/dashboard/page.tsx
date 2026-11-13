"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FolderKanban, RefreshCw } from "lucide-react";
import { apiFetch } from "../../../lib/api-client";
import {
  displayDate,
  displayMoney,
  humanLabel,
  roleLabel,
} from "../../../lib/presentation";

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

export default function CompanyHomeDashboardPage() {
  const [data, setData] = useState<OrgDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await apiFetch<OrgDashboardDto>("/api/v1/orgs/current/dashboard"),
      );
    } catch {
      setError("We could not load your overview. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <div role="status" className="p-6 text-sm text-slate-500">
        Loading your projects…
      </div>
    );
  if (error || !data)
    return (
      <div
        role="alert"
        className="m-6 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
      >
        <span>{error || "Your overview is unavailable."}</span>
        <button onClick={load} className="font-semibold underline">
          Try again
        </button>
      </div>
    );
  const metrics = [
    {
      label: "Active projects",
      value: data.kpis.activeProjectsCount,
      description: "Projects in progress or handover",
    },
    {
      label: "Documents needed",
      value: data.kpis.totalMissingOrExpiredCount,
      description: "Requirements awaiting documents or updates",
    },
    {
      label: "Awaiting review",
      value: data.kpis.awaitingMyReviewCount,
      description: "Uploaded documents waiting for a decision",
    },
    {
      label: "Expiring within 30 days",
      value: data.kpis.expiringSoonCount,
      description: "Documents to renew or replace",
    },
  ];
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {roleLabel(data.user.role)}
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            {data.org.displayName || data.org.legalName}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Welcome, {data.user.name}. Keep track of the documents and decisions
            needed for project handover.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh overview"
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <h2 className="text-sm text-slate-600">{metric.label}</h2>
            <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
            <p className="mt-2 text-xs text-slate-500">{metric.description}</p>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Needs attention</h2>
          <p className="mt-1 text-xs text-slate-500">
            Open a project to upload documents, review submissions, or follow up
            with your team.
          </p>
        </div>
        {data.needsAttention.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">
            No outstanding items are listed. Check each project's checklist
            before planning handover.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.needsAttention.map((item) => (
              <li key={item.requirementId}>
                <Link
                  href={`/projects/${item.projectId}`}
                  className="flex items-center justify-between gap-4 p-5 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.projectCode}
                      {item.assetTag ? ` · ${item.assetTag}` : ""} ·{" "}
                      {item.ownerName || "Unassigned"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-amber-800">
                      {humanLabel(item.status)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.dueDate === "ASAP"
                        ? "No due date"
                        : `Due ${item.dueDate}`}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Your projects{" "}
            <span className="text-sm font-normal text-slate-500">
              ({data.projects.length})
            </span>
          </h2>
          <Link
            href="/projects"
            className="text-sm font-semibold text-blue-700"
          >
            View all projects
          </Link>
        </div>
        {data.projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <FolderKanban className="mx-auto h-8 w-8 text-slate-400" />
            <h3 className="mt-3 font-semibold">No projects to show yet</h3>
            <p className="mt-2 text-sm text-slate-500">
              Projects will appear here when you create one or are added to a
              project team.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {data.projects.map((project) => {
              const percent =
                project.applicableCount > 0
                  ? Math.min(
                      100,
                      Math.round(
                        (project.approvedCount / project.applicableCount) * 100,
                      ),
                    )
                  : null;
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-500"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-blue-700">
                      {project.code}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      {humanLabel(project.status)}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold">{project.name}</h3>
                  <p className="mt-2 text-xs text-slate-500">
                    Client: {project.clientName || "Not recorded"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Target handover: {displayDate(project.targetHandoverDate)}
                  </p>
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <div className="flex justify-between text-xs">
                      <span>Approved requirements</span>
                      <span>
                        {percent === null
                          ? "No requirements yet"
                          : `${project.approvedCount} of ${project.applicableCount}`}
                      </span>
                    </div>
                    {percent !== null && (
                      <div
                        role="progressbar"
                        aria-label={`${project.code} approved requirements`}
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                      >
                        <div
                          className="h-full bg-emerald-600"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                    <div className="mt-4 flex items-center justify-between text-xs">
                      {["R-OWNER", "R-ADMIN", "R-PM", "R-BILLING"].includes(
                        data.user.role,
                      ) ? (
                        <span className="text-slate-500">
                          Estimated retention:{" "}
                          {displayMoney(project.retentionAtRiskPaise)}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                        Open project <ArrowUpRight className="h-3 w-3" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
