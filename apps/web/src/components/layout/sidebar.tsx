"use client";

import React from "react";
import clsx from "clsx";
import {
  LayoutDashboard,
  ClipboardCheck,
  Eye,
  PackageCheck,
  Wrench,
  PanelLeftClose,
  PanelLeft,
  Building2,
  HardHat,
  Users,
  ShieldCheck,
} from "lucide-react";

export type NavTab = "overview" | "checklist" | "reviews" | "packages" | "warranty_dlp";
export type WorkspacePlane = "CONTRACTOR" | "SUPPLIER_GUEST" | "CLIENT_GUEST";

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  collapsed: boolean;
  onCollapse: (val: boolean) => void;
  badges: { checklist: number; reviews: number; defects: number };
  activePlane: WorkspacePlane;
  onPlaneChange: (plane: WorkspacePlane) => void;
  orgName?: string;
}

const NAV_ITEMS: {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  badgeKey?: keyof SidebarProps["badges"];
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "checklist", label: "Checklist", icon: ClipboardCheck, badgeKey: "checklist" },
  { id: "reviews", label: "Reviews", icon: Eye, badgeKey: "reviews" },
  { id: "packages", label: "Handover Packages", icon: PackageCheck },
  { id: "warranty_dlp", label: "Warranties & DLP", icon: Wrench, badgeKey: "defects" },
];

export function Sidebar({
  activeTab,
  onTabChange,
  collapsed,
  onCollapse,
  badges,
  activePlane,
  onPlaneChange,
  orgName = "Your organisation",
}: SidebarProps) {
  return (
    <aside
      className={clsx(
        "flex flex-col justify-between border-r border-[#E5E7EB] bg-white text-[#111827] transition-all duration-200 ease-in-out shrink-0 select-none z-20",
        collapsed ? "w-[68px]" : "w-[252px]"
      )}
    >
      <div className="flex flex-col">
        {/* Brand Header */}
        <div
          className={clsx(
            "flex h-[60px] items-center border-b border-[#E5E7EB]",
            collapsed ? "justify-center px-2" : "justify-between px-4"
          )}
        >
          {collapsed ? (
            /* Collapsed: Centered Brand Logo that clicks to expand */
            <button
              onClick={() => onCollapse(false)}
              title="Expand Sidebar"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3157D5] text-white font-bold text-xs shadow-sm hover:bg-[#2648B8] hover:shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              TC
            </button>
          ) : (
            /* Expanded: Brand Logo + Org details + Collapse Button */
            <>
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3157D5] text-white font-semibold text-xs shadow-sm">
                  TC
                </div>
                <div className="overflow-hidden whitespace-nowrap">
                  <div className="text-sm font-semibold tracking-tight text-[#111827]">
                    TradeCloseout
                  </div>
                  <div className="text-[11px] font-medium text-[#667085] truncate max-w-[130px]">
                    {orgName}
                  </div>
                </div>
              </div>
              <button
                onClick={() => onCollapse(true)}
                title="Collapse Sidebar"
                aria-label="Collapse sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#667085] transition-all hover:bg-[#F3F4F6] hover:text-[#111827] hover:scale-105 active:scale-95 cursor-pointer"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* Workspace Plane Switcher */}
        {collapsed ? (
          /* Collapsed Plane Icons */
          <div className="py-2.5 flex flex-col items-center gap-1 border-b border-[#F3F4F6]">
            <button
              onClick={() => onPlaneChange("CONTRACTOR")}
              title="Contractor Workspace"
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-md transition-all cursor-pointer",
                activePlane === "CONTRACTOR"
                  ? "bg-[#EEF2FF] text-[#3157D5] font-semibold"
                  : "text-[#667085] hover:bg-[#F3F4F6] hover:text-[#111827]"
              )}
            >
              <HardHat className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onPlaneChange("SUPPLIER_GUEST")}
              title="Supplier Upload Portal"
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-md transition-all cursor-pointer",
                activePlane === "SUPPLIER_GUEST"
                  ? "bg-[#ECFDF5] text-[#159B72] font-semibold"
                  : "text-[#667085] hover:bg-[#F3F4F6] hover:text-[#111827]"
              )}
            >
              <Users className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onPlaneChange("CLIENT_GUEST")}
              title="Client Handover Portal"
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-md transition-all cursor-pointer",
                activePlane === "CLIENT_GUEST"
                  ? "bg-[#EEF2FF] text-[#3157D5] font-semibold"
                  : "text-[#667085] hover:bg-[#F3F4F6] hover:text-[#111827]"
              )}
            >
              <Building2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          /* Expanded Plane Switcher */
          <div className="p-3 border-b border-[#F3F4F6]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] px-1 mb-1.5">
              Workspace Plane
            </div>
            <div className="grid grid-cols-3 gap-1 bg-[#F3F4F6] p-1 rounded-lg">
              <button
                onClick={() => onPlaneChange("CONTRACTOR")}
                title="Contractor Workspace"
                className={clsx(
                  "flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                  activePlane === "CONTRACTOR"
                    ? "bg-white text-[#111827] shadow-xs font-semibold"
                    : "text-[#667085] hover:text-[#111827]"
                )}
              >
                <HardHat className="h-3 w-3" />
                <span>Contractor</span>
              </button>
              <button
                onClick={() => onPlaneChange("SUPPLIER_GUEST")}
                title="Supplier Upload Portal"
                className={clsx(
                  "flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                  activePlane === "SUPPLIER_GUEST"
                    ? "bg-white text-[#159B72] shadow-xs font-semibold"
                    : "text-[#667085] hover:text-[#111827]"
                )}
              >
                <Users className="h-3 w-3" />
                <span>Supplier</span>
              </button>
              <button
                onClick={() => onPlaneChange("CLIENT_GUEST")}
                title="Client Handover Portal"
                className={clsx(
                  "flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                  activePlane === "CLIENT_GUEST"
                    ? "bg-white text-[#3157D5] shadow-xs font-semibold"
                    : "text-[#667085] hover:text-[#111827]"
                )}
              >
                <Building2 className="h-3 w-3" />
                <span>Client</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Navigation */}
        <nav className={clsx("flex-1 space-y-1", collapsed ? "px-2 py-3" : "px-3 py-3")}>
          {!collapsed && (
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] px-2 mb-1.5">
              Operations
            </div>
          )}
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePlane === "CONTRACTOR" && activeTab === item.id;
            const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;

            return (
              <button
                key={item.id}
                onClick={() => {
                  if (activePlane !== "CONTRACTOR") onPlaneChange("CONTRACTOR");
                  onTabChange(item.id);
                }}
                title={collapsed ? item.label : undefined}
                className={clsx(
                  "group relative flex items-center rounded-lg transition-all duration-150 cursor-pointer",
                  collapsed
                    ? "justify-center h-10 w-10 mx-auto"
                    : "w-full justify-between px-2.5 py-2 text-[13px] font-medium",
                  active
                    ? "bg-[#EEF2FF] text-[#3157D5] font-semibold"
                    : "text-[#4B5563] hover:bg-[#F9FAFB] hover:text-[#111827]"
                )}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={clsx(
                      "h-4 w-4 shrink-0 stroke-[1.8]",
                      active ? "text-[#3157D5]" : "text-[#667085] group-hover:text-[#111827]"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </div>

                {/* Badge */}
                {badgeCount > 0 && (
                  collapsed ? (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#3157D5]" />
                  ) : (
                    <span
                      className={clsx(
                        "flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold tabular-nums",
                        active
                          ? "bg-[#3157D5] text-white"
                          : "bg-[#F3F4F6] text-[#667085] group-hover:bg-[#E5E7EB]"
                      )}
                    >
                      {badgeCount}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="border-t border-[#E5E7EB] p-3 bg-[#FAFBFD]">
        {!collapsed ? (
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#4B5563] flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#159B72]" />
                Audit Hash Sealer
              </span>
              <span className="font-mono text-[10px] text-[#159B72] font-semibold bg-[#ECFDF5] px-1.5 py-0.5 rounded">
                ACTIVE
              </span>
            </div>
            <div className="text-[10px] text-[#9CA3AF]">
              SHA-256 Ledger · ISO 19650
            </div>
          </div>
        ) : (
          <div className="flex justify-center" title="Audit Hash Sealer: ACTIVE (SHA-256)">
            <ShieldCheck className="h-4 w-4 text-[#159B72]" />
          </div>
        )}
      </div>
    </aside>
  );
}
