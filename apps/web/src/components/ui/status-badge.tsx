"use client";

import React from "react";
import {
  Clock, Send, FileUp, FileEdit, XCircle, CheckCircle2,
  Stamp, ShieldOff, MinusCircle, CalendarX2, AlertTriangle, PackageCheck,
} from "lucide-react";
import clsx from "clsx";

export type VisualStatus =
  | "NOT_STARTED"
  | "REQUESTED"
  | "UPLOADED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "APPROVED"
  | "APPROVED_EXTERNAL"
  | "PENDING_WAIVER"
  | "WAIVED"
  | "NOT_APPLICABLE"
  | "EXPIRED"
  | "MISSING"
  | "HANDED_OVER";

export const STATUS_CONFIG: Record<
  VisualStatus,
  {
    label: string;
    bg: string;
    border: string;
    text: string;
    dot: string;
    icon: React.ElementType;
  }
> = {
  NOT_STARTED: {
    label: "Not started",
    bg: "bg-[#F3F4F6]",
    border: "border-[#E5E7EB]",
    text: "text-[#4B5563]",
    dot: "bg-[#9CA3AF]",
    icon: Clock,
  },
  REQUESTED: {
    label: "Requested",
    bg: "bg-[#EEF2FF]",
    border: "border-[#C7D2FE]",
    text: "text-[#3157D5]",
    dot: "bg-[#3157D5]",
    icon: Send,
  },
  UPLOADED: {
    label: "Uploaded",
    bg: "bg-[#F5F3FF]",
    border: "border-[#DDD6FE]",
    text: "text-[#6D28D9]",
    dot: "bg-[#8B5CF6]",
    icon: FileUp,
  },
  IN_REVIEW: {
    label: "In review",
    bg: "bg-[#FFFBEB]",
    border: "border-[#FDE68A]",
    text: "text-[#92400E]",
    dot: "bg-[#D99A28]",
    icon: Clock,
  },
  CHANGES_REQUESTED: {
    label: "Changes needed",
    bg: "bg-[#FFF7ED]",
    border: "border-[#FED7AA]",
    text: "text-[#C2410C]",
    dot: "bg-[#EA580C]",
    icon: FileEdit,
  },
  REJECTED: {
    label: "Rejected",
    bg: "bg-[#FEF2F2]",
    border: "border-[#FECACA]",
    text: "text-[#DC5252]",
    dot: "bg-[#DC5252]",
    icon: XCircle,
  },
  APPROVED: {
    label: "Approved",
    bg: "bg-[#F0FDF4]",
    border: "border-[#BBF7D0]",
    text: "text-[#159B72]",
    dot: "bg-[#159B72]",
    icon: CheckCircle2,
  },
  APPROVED_EXTERNAL: {
    label: "Approved (External)",
    bg: "bg-[#F0FDFA]",
    border: "border-[#99F6E4] border-dashed",
    text: "text-[#0F766E]",
    dot: "bg-[#14B8A6]",
    icon: Stamp,
  },
  PENDING_WAIVER: {
    label: "Pending 2nd Approver",
    bg: "bg-[#FAF5FF]",
    border: "border-[#E9D5FF] border-dashed",
    text: "text-[#7E22CE]",
    dot: "bg-[#A855F7]",
    icon: ShieldOff,
  },
  WAIVED: {
    label: "Waived",
    bg: "bg-[#FAF5FF]",
    border: "border-[#E9D5FF]",
    text: "text-[#7E22CE]",
    dot: "bg-[#A855F7]",
    icon: ShieldOff,
  },
  NOT_APPLICABLE: {
    label: "Not Applicable",
    bg: "bg-[#F3F4F6]",
    border: "border-[#E5E7EB] border-dashed",
    text: "text-[#6B7280]",
    dot: "bg-[#9CA3AF]",
    icon: MinusCircle,
  },
  EXPIRED: {
    label: "Expired",
    bg: "bg-[#FEF2F2]",
    border: "border-[#F87171]",
    text: "text-[#B91C1C] font-semibold",
    dot: "bg-[#DC5252]",
    icon: CalendarX2,
  },
  MISSING: {
    label: "Missing",
    bg: "bg-[#FEF2F2]",
    border: "border-[#FCA5A5]",
    text: "text-[#991B1B] font-semibold",
    dot: "bg-[#DC5252]",
    icon: AlertTriangle,
  },
  HANDED_OVER: {
    label: "Handed over",
    bg: "bg-[#ECFDF5]",
    border: "border-[#A7F3D0]",
    text: "text-[#065F46]",
    dot: "bg-[#159B72]",
    icon: PackageCheck,
  },
};

export function StatusBadge({
  status,
  size = "default",
  showDot = true,
}: {
  status: VisualStatus;
  size?: "sm" | "default";
  showDot?: boolean;
}) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.NOT_STARTED;

  return (
    <span
      role="status"
      aria-label={`Status: ${s.label}`}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border font-medium leading-none select-none tracking-tight transition-colors",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        s.bg,
        s.border,
        s.text,
      )}
    >
      {showDot && (
        <span
          className={clsx(
            "rounded-full shrink-0",
            size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
            s.dot,
          )}
        />
      )}
      <span>{s.label}</span>
    </span>
  );
}
