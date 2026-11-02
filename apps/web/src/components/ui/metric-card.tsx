"use client";

import React from "react";
import clsx from "clsx";

interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  accent?: "default" | "warning" | "danger" | "success" | "brand";
  onClick?: () => void;
  actionLabel?: string;
  icon?: React.ReactNode;
}

const iconBgMap = {
  default: "bg-[#F3F4F6] text-[#667085]",
  brand: "bg-[#EEF2FF] text-[#3157D5]",
  warning: "bg-[#FFFBEB] text-[#D99A28]",
  danger: "bg-[#FEF2F2] text-[#DC5252]",
  success: "bg-[#ECFDF5] text-[#159B72]",
};

const dotMap = {
  default: null,
  brand: "bg-[#3157D5]",
  warning: "bg-[#D99A28]",
  danger: "bg-[#DC5252]",
  success: "bg-[#159B72]",
};

export function MetricCard({
  label,
  value,
  subtitle,
  accent = "default",
  onClick,
  actionLabel,
  icon,
}: MetricCardProps) {
  const dotColor = dotMap[accent];

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group relative rounded-xl border border-[#E5E7EB] bg-white p-4.5 transition-all duration-200 ease-out shadow-2xs",
        onClick
          ? "cursor-pointer hover:border-[#CBD5E1] hover:-translate-y-1 hover:shadow-sm active:translate-y-0 active:scale-[0.99]"
          : "hover:border-[#D1D5DB]"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
          {dotColor && <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />}
          <span>{label}</span>
        </span>
        {icon && (
          <div
            className={clsx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200 group-hover:scale-105",
              iconBgMap[accent]
            )}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="mt-2.5 font-mono text-2xl font-bold tracking-tight text-[#111827] tabular-nums">
        {value}
      </div>

      {subtitle && <div className="mt-1 text-[11px] text-[#667085] truncate">{subtitle}</div>}

      {actionLabel && (
        <div className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-[#3157D5] group-hover:text-[#2648B8] transition-colors">
          <span>{actionLabel}</span>
          <span className="inline-block transition-transform duration-200 ease-out group-hover:translate-x-1.5">→</span>
        </div>
      )}
    </div>
  );
}
