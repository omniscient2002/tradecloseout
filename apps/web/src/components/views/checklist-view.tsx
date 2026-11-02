"use client";

import React, { useState, useMemo } from "react";
import clsx from "clsx";
import {
  Search,
  Plus,
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  ShieldOff,
  Calendar,
  FileText,
  Tag,
} from "lucide-react";
import { StatusBadge, VisualStatus } from "../ui/status-badge";

export interface RequirementItem {
  id: string;
  requirementKey: string;
  groupKey: string;
  title: string;
  docTypeCode: string;
  mandatory: boolean;
  milestoneKey: string;
  assetTag: string | null;
  status: VisualStatus;
  ownerName: string | null;
  reviewerRole: string | null;
  dueDate: string | null;
  revisionCode: string | null;
  rowVersion: number;
}

export interface ChecklistViewProps {
  requirements: RequirementItem[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onUploadClick: (req: RequirementItem) => void;
  onWaiverClick: (req: RequirementItem) => void;
  onExternalApprovalClick: (req: RequirementItem) => void;
  onAddRequirementClick: () => void;
}

const STATUS_TABS = [
  { id: "", label: "All Items" },
  { id: "MISSING", label: "Missing" },
  { id: "EXPIRED", label: "Expired" },
  { id: "IN_REVIEW", label: "In Review" },
  { id: "APPROVED", label: "Approved" },
  { id: "WAIVED", label: "Waived" },
];

function formatDateIst(isoDate: string | null): string {
  if (!isoDate) return "No due date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(isoDate));
}

export function ChecklistView({
  requirements,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onUploadClick,
  onWaiverClick,
  onExternalApprovalClick,
  onAddRequirementClick,
}: ChecklistViewProps) {
  const [milestoneFilter, setMilestoneFilter] = useState<string>("");
  const [mandatoryOnly, setMandatoryOnly] = useState<boolean>(false);

  const filteredItems = useMemo(() => {
    return requirements.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (milestoneFilter && item.milestoneKey !== milestoneFilter) return false;
      if (mandatoryOnly && !item.mandatory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesKey = item.requirementKey.toLowerCase().includes(q);
        const matchesTag = item.assetTag?.toLowerCase().includes(q);
        const matchesType = item.docTypeCode?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesKey && !matchesTag && !matchesType) return false;
      }
      return true;
    });
  }, [requirements, statusFilter, milestoneFilter, mandatoryOnly, searchQuery]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* 1. Header Toolbar & Filters */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((tab) => {
              const count = tab.id
                ? requirements.filter((r) => r.status === tab.id).length
                : requirements.length;
              const isActive = statusFilter === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => onStatusFilterChange(tab.id)}
                  className={clsx(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 cursor-pointer",
                    isActive
                      ? "bg-[#3157D5] text-white shadow-2xs -translate-y-0.5"
                      : "text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111827] hover:-translate-y-0.5 active:translate-y-0"
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={clsx(
                      "px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums",
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-[#F3F4F6] text-[#667085]"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action: Add Requirement */}
          <button
            onClick={onAddRequirementClick}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#3157D5] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 self-start sm:self-auto cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Requirement</span>
          </button>
        </div>

        {/* Secondary Filter Line */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#F3F4F6]">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search checklist..."
                className="h-8 w-full rounded-md border border-[#E5E7EB] bg-[#F9FAFB] pl-8 pr-2.5 text-xs text-[#111827] placeholder:text-[#9CA3AF] focus:bg-white focus:border-[#3157D5] focus:outline-none focus:ring-1 focus:ring-[#3157D5]"
              />
            </div>

            {/* Milestone Dropdown */}
            <select
              value={milestoneFilter}
              onChange={(e) => setMilestoneFilter(e.target.value)}
              className="h-8 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 text-xs text-[#374151] focus:bg-white focus:border-[#3157D5] focus:outline-none"
            >
              <option value="">All Milestones</option>
              <option value="MOBILISATION">Mobilisation</option>
              <option value="SUBSTRUCTURE">Substructure</option>
              <option value="SUPERSTRUCTURE">Superstructure</option>
              <option value="MEP_FIRST_FIX">MEP 1st Fix</option>
              <option value="MEP_SECOND_FIX">MEP 2nd Fix</option>
              <option value="TESTING_COMMISSIONING">Testing & Commissioning</option>
              <option value="HANDOVER">Handover</option>
              <option value="DLP_END">DLP End</option>
            </select>

            {/* Mandatory Toggle */}
            <label className="flex items-center gap-1.5 text-xs text-[#4B5563] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mandatoryOnly}
                onChange={(e) => setMandatoryOnly(e.target.checked)}
                className="rounded border-[#D1D5DB] text-[#3157D5] focus:ring-[#3157D5]"
              />
              <span>Mandatory only</span>
            </label>
          </div>

          <div className="text-xs text-[#667085] font-mono">
            Showing {filteredItems.length} of {requirements.length} requirements
          </div>
        </div>
      </div>

      {/* 2. High-Density Checklist Table */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-2xs overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="text-center py-16 px-4">
            <FileText className="h-10 w-10 text-[#9CA3AF] mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-[#111827]">No requirements found</h3>
            <p className="text-xs text-[#667085] mt-1 max-w-sm mx-auto">
              {searchQuery || statusFilter || milestoneFilter
                ? "No items match your active filters. Try clearing filters or searching for something else."
                : "Get started by adding your first project handover requirement or uploading documents."}
            </p>
            <button
              onClick={onAddRequirementClick}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#3157D5] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add First Requirement</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#FAFBFD] text-[11px] font-semibold text-[#667085] uppercase tracking-wider">
                  <th className="py-3 px-4">Requirement / Doc Type</th>
                  <th className="py-3 px-3">Milestone</th>
                  <th className="py-3 px-3">Asset Tag</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Due Date</th>
                  <th className="py-3 px-3">Reviewer Role</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {filteredItems.map((item) => {
                  const isOverdue =
                    item.dueDate &&
                    new Date(item.dueDate) < new Date() &&
                    item.status !== "APPROVED" &&
                    item.status !== "WAIVED";

                  return (
                    <tr
                      key={item.id}
                      className="group hover:bg-[#F9FAFB] transition-colors duration-150"
                    >
                      {/* Title & Key */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-[#4B5563] bg-[#F3F4F6] px-1.5 py-0.5 rounded">
                            {item.requirementKey}
                          </span>
                          <span className="font-medium text-[#111827] max-w-xs truncate">
                            {item.title}
                          </span>
                          {item.mandatory && (
                            <span
                              className="text-[10px] font-semibold text-[#DC5252] bg-[#FEF2F2] px-1 py-0.2 rounded border border-[#FECACA]"
                              title="Mandatory for handover packaging"
                            >
                              REQ
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#667085]">
                          Type: <span className="font-mono">{item.docTypeCode}</span>
                          {item.revisionCode && (
                            <span className="ml-2 font-mono text-[#3157D5]">Rev {item.revisionCode}</span>
                          )}
                        </div>
                      </td>

                      {/* Milestone */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] text-[#4B5563] bg-[#F3F4F6] px-2 py-0.5 rounded">
                          {item.milestoneKey || "HANDOVER"}
                        </span>
                      </td>

                      {/* Asset Tag */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.assetTag ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#3157D5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                            <Tag className="h-3 w-3" />
                            {item.assetTag}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF]">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <StatusBadge status={item.status} size="sm" />
                      </td>

                      {/* Due Date */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div
                          className={clsx(
                            "flex items-center gap-1 font-mono text-[11px]",
                            isOverdue ? "text-[#DC5252] font-semibold" : "text-[#667085]"
                          )}
                        >
                          <Calendar className="h-3 w-3" />
                          <span>{formatDateIst(item.dueDate)}</span>
                          {isOverdue && (
                            <span title="Overdue submission">
                              <AlertTriangle className="h-3.5 w-3.5 text-[#DC5252]" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Reviewer Role */}
                      <td className="py-3 px-3 whitespace-nowrap text-[#667085] font-mono text-[11px]">
                        {item.reviewerRole || "R-QC"}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onUploadClick(item)}
                            title="Upload Document"
                            className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-[#374151] hover:border-[#3157D5] hover:text-[#3157D5] hover:bg-[#EEF2FF] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                          >
                            <UploadCloud className="h-3 w-3 text-[#3157D5]" />
                            <span>Upload</span>
                          </button>

                          {item.status !== "APPROVED" && item.status !== "WAIVED" && (
                            <>
                              <button
                                onClick={() => onWaiverClick(item)}
                                title="Request Waiver"
                                className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-[#667085] hover:border-[#6366F1] hover:text-[#6366F1] hover:bg-[#FAF5FF] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                              >
                                <ShieldOff className="h-3 w-3 text-[#6366F1]" />
                                <span>Waiver</span>
                              </button>

                              <button
                                onClick={() => onExternalApprovalClick(item)}
                                title="Record External Sign-off"
                                className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-[#0F766E] hover:border-[#0F766E] hover:bg-[#F0FDFA] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 cursor-pointer shadow-2xs"
                              >
                                <FileCheck2 className="h-3 w-3 text-[#0F766E]" />
                                <span>External</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
