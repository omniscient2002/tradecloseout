"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FolderKanban,
  Search,
  Plus,
  RefreshCw,
  Building2,
  Calendar,
  X,
  ArrowUpRight,
  ShieldAlert,
} from "lucide-react";
import { apiFetch, ApiProblemError } from "../../../lib/api-client";

interface ProjectItem {
  id: string;
  code: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "HANDOVER" | "CLOSED";
  clientName: string;
  mcName: string;
  pmcName: string;
  targetHandoverDate: string;
  contractValuePaise: string;
  retentionAtRiskPaise: string;
  approvedCount: number;
  applicableCount: number;
}

function formatInr(paise: string): string {
  const rupees = Number(BigInt(paise || "0")) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

function ProjectsDirectoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialNew = searchParams.get("new") === "1";

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [createModalOpen, setCreateModalOpen] = useState(initialNew);

  // New Project Form
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [clientPartyId, setClientPartyId] = useState("");
  const [mcPartyId, setMcPartyId] = useState("");
  const [consultantPartyId, setConsultantPartyId] = useState("");
  const [partiesList, setPartiesList] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>("/api/v1/orgs/current/dashboard");
      setProjects(data.projects || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    apiFetch<any[]>("/api/v1/parties")
      .then((data) => setPartiesList(data || []))
      .catch(() => {});
  }, [fetchProjects]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch<{ projectId: string }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          contractValuePaise: BigInt(Math.round(Number(contractValue || "0") * 100)).toString(),
          targetHandoverDate: targetDate || undefined,
          clientPartyId: clientPartyId || undefined,
          mcPartyId: mcPartyId || undefined,
          consultantPartyId: consultantPartyId || undefined,
        }),
      });
      setCreateModalOpen(false);
      router.push(`/projects/${res.projectId}`);
    } catch (err: any) {
      setError(err instanceof ApiProblemError ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  };

  const filtered = projects.filter((p) => {
    const matchSearch =
      p.code.toLowerCase().includes(search.toLowerCase()) ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.clientName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Projects Portfolio</h1>
          <p className="text-xs text-slate-500">
            All commercial HVAC and MEP projects contracted under Deccan EnviroTech MEP Pvt Ltd.
          </p>
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163A5F] transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Project</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by project code, name, or client..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-slate-300 focus:outline-none focus:border-blue-600"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 whitespace-nowrap">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white text-slate-800 focus:outline-none focus:border-blue-600"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="HANDOVER">HANDOVER</option>
            <option value="CLOSED">CLOSED</option>
            <option value="DRAFT">DRAFT</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-white border border-slate-200" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 p-8">
          <FolderKanban className="h-8 w-8 text-slate-400 mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-800">No projects found</div>
          <div className="text-xs text-slate-500 mt-1">Try adjusting your search or filters.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((proj) => {
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
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                        proj.status === "HANDOVER"
                          ? "bg-blue-50 text-blue-900 border-blue-300"
                          : proj.status === "CLOSED"
                          ? "bg-emerald-50 text-emerald-900 border-emerald-300"
                          : proj.status === "ACTIVE"
                          ? "bg-amber-50 text-amber-900 border-amber-300"
                          : "bg-slate-100 text-slate-800 border-slate-300"
                      }`}
                    >
                      {proj.status}
                    </span>
                  </div>

                  <h3 className="mt-2 text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                    {proj.name}
                  </h3>

                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <div>Client: <strong className="text-slate-800">{proj.clientName}</strong></div>
                    <div>General Contractor: <strong className="text-slate-800">{proj.mcName}</strong></div>
                    <div>PMC: <strong className="text-slate-800">{proj.pmcName}</strong></div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Closeout Completion</span>
                    <span className="font-mono font-bold text-slate-800">{pct}% ({proj.approvedCount}/{proj.applicableCount})</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div style={{ width: `${pct}%` }} className="h-full bg-emerald-600 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <span className="font-mono text-slate-600">Retention: <strong>{formatInr(proj.retentionAtRiskPaise)}</strong></span>
                    <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                      <span>Open Workspace</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Project Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">Create Commercial Project</h2>
              <button onClick={() => setCreateModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="mt-3 p-2.5 rounded bg-red-50 border border-red-200 text-red-800 text-[11px]">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateProject} className="mt-4 space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Project Code (e.g. HYD-PHARMA-10)</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="HYD-BIO-09"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Genome Valley Cleanroom Block-B HVAC"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Base Contract Value (₹ INR)</label>
                <input
                  type="number"
                  required
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  placeholder="145000000"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Handover Date</label>
                <input
                  type="date"
                  required
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Project Client / Employer (Optional)</label>
                  <select
                    value={clientPartyId}
                    onChange={(e) => setClientPartyId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="">-- Select Client Organization --</option>
                    {partiesList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.types?.join(", ") || "PARTY"})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Main Contractor / GC (Optional)</label>
                  <select
                    value={mcPartyId}
                    onChange={(e) => setMcPartyId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="">-- Select Main Contractor --</option>
                    {partiesList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">MEP Consultant / PMC (Optional)</label>
                  <select
                    value={consultantPartyId}
                    onChange={(e) => setConsultantPartyId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="">-- Select Consultant / PMC --</option>
                    {partiesList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-1.5 rounded bg-[#0F2942] text-white font-semibold hover:bg-[#163A5F] disabled:opacity-60 cursor-pointer"
                >
                  {creating ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectsDirectoryPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading projects...</div>}>
      <ProjectsDirectoryContent />
    </Suspense>
  );
}
