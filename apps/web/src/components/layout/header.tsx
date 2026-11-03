"use client";

import React, { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Search,
  ChevronRight,
  Plus,
  UploadCloud,
  Bell,
  Users,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { apiFetch } from "../../lib/api-client";

interface HeaderProps {
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  onAddRequirement?: () => void;
  onUpload?: () => void;
  onCreateProject?: () => void;
  onOpenUserModal?: () => void;
  projectCode?: string;
  projectName?: string;
  orgName?: string;
  projects?: any[];
  onSelectProject?: (p: any) => void;
  sessionUser?: { full_name?: string; email?: string; org_role?: string; name?: string; orgRole?: string } | null;
}

export function Header({
  searchQuery = "",
  onSearchChange,
  onAddRequirement,
  onUpload,
  onCreateProject,
  onOpenUserModal,
  projectCode = "HYD-BIO-09",
  projectName = "Genome Valley Cleanroom HVAC",
  orgName = "Deccan EnviroTech MEP Pvt Ltd",
  projects = [],
  onSelectProject,
  sessionUser,
}: HeaderProps) {
  const [currentUser, setCurrentUser] = useState<{
    id?: string;
    name?: string;
    full_name?: string;
    email?: string;
    orgRole?: string;
    org_role?: string;
  } | null>(sessionUser || null);

  useEffect(() => {
    if (!sessionUser) {
      apiFetch<any>("/api/v1/auth/me")
        .then((data) => {
          if (data) {
            setCurrentUser(data);
          }
        })
        .catch(() => {});
    }
  }, [sessionUser]);

  const handleLogout = async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    }
    document.cookie = "tc_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    window.sessionStorage.removeItem("tc_csrf_token");
    localStorage.removeItem("tc_csrf_token");
    window.location.href = "/login";
  };

  const displayName = currentUser?.full_name || currentUser?.name || "Meera Deshmukh";
  const displayRole = currentUser?.org_role || currentUser?.orgRole || "R-PM";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-white px-5 select-none z-10">
      {/* Left: Organization & Project Breadcrumb */}
      <div className="flex items-center gap-2 text-xs">
        <div
          onClick={onOpenUserModal}
          className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-[#374151] font-medium transition-colors hover:border-[#D1D5DB] cursor-pointer"
          title="Click to Switch Organization / Persona"
        >
          <span className="h-2 w-2 rounded-full bg-[#159B72]" />
          <span className="max-w-[180px] truncate font-semibold">{orgName}</span>
        </div>

        <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF]" />

        {/* Project Selector */}
        {projects.length > 1 ? (
          <div className="relative group">
            <button className="flex items-center gap-1.5 rounded-md border border-[#C7D2FE] bg-[#EEF2FF] px-2 py-1 text-xs text-[#3157D5] font-semibold hover:bg-[#E0E7FF] transition-colors cursor-pointer">
              <span className="font-mono text-[11px] font-bold">{projectCode}</span>
              <span className="max-w-[200px] truncate text-[#111827]">{projectName}</span>
              <ChevronDown className="h-3 w-3 text-[#3157D5]" />
            </button>
            <div className="absolute top-full left-0 mt-1 hidden group-hover:block w-72 rounded-lg border border-gray-200 bg-white shadow-xl z-50 p-1">
              <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Select Active Project
              </div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectProject?.(p)}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between hover:bg-gray-50 transition-colors ${
                    p.code === projectCode ? "font-bold text-indigo-700 bg-indigo-50/50" : "text-gray-800"
                  }`}
                >
                  <span className="truncate">{p.code} — {p.name}</span>
                  <span className="text-[10px] font-mono text-gray-500 uppercase">{p.status}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[#EEF2FF] border border-[#C7D2FE] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#3157D5] tabular-nums">
              {projectCode}
            </span>
            <span className="font-semibold text-[#111827] truncate max-w-[240px] hidden sm:inline">
              {projectName}
            </span>
          </div>
        )}

        {onCreateProject && (
          <button
            onClick={onCreateProject}
            title="Create New Project"
            className="hidden md:flex items-center justify-center h-6 w-6 rounded border border-dashed border-[#D1D5DB] text-[#667085] hover:text-[#3157D5] hover:border-[#3157D5] transition-colors ml-1 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Right: Actions & Profile */}
      <div className="flex items-center gap-2.5">
        {/* Search with ⌘K badge */}
        {onSearchChange && (
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search requirements, assets..."
              className="h-8 w-44 lg:w-56 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] pl-8 pr-9 text-xs text-[#111827] placeholder:text-[#9CA3AF] transition-all focus:w-64 focus:border-[#3157D5] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#3157D5]"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[9px] font-mono text-[#9CA3AF] pointer-events-none">
              ⌘K
            </kbd>
          </div>
        )}

        {/* Add Requirement */}
        {onAddRequirement && (
          <button
            onClick={onAddRequirement}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 text-xs font-semibold text-[#374151] shadow-2xs hover:bg-[#F9FAFB] hover:border-[#D1D5DB] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-[#667085]" />
            <span className="hidden sm:inline">Requirement</span>
          </button>
        )}

        {/* Upload CTA */}
        {onUpload && (
          <button
            onClick={onUpload}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#3157D5] px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Upload</span>
          </button>
        )}

        <div className="h-5 w-px bg-[#E5E7EB] mx-1" />

        {/* Persona Switcher / User Avatar */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenUserModal}
            title="Switch User / Role Persona"
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-all cursor-pointer"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-900 text-white font-bold text-[11px] shadow-xs">
              {initials}
            </div>
            <div className="text-left text-xs leading-none">
              <div className="font-bold text-[#111827] flex items-center gap-1">
                <span>{displayName}</span>
                <span className="rounded bg-indigo-100 text-indigo-700 px-1 py-0.2 text-[9px] font-mono font-bold">
                  {displayRole}
                </span>
              </div>
              <div className="text-[10px] text-indigo-600 font-medium mt-0.5 flex items-center gap-0.5">
                <Users className="h-2.5 w-2.5" />
                <span>Switch User</span>
              </div>
            </div>
          </button>

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-1.5 rounded-md text-gray-500 hover:text-red-700 hover:bg-red-50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
