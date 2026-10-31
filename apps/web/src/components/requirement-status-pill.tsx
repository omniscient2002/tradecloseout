import React from 'react';
import {
  CircleDashed,
  Send,
  FileUp,
  Clock,
  FileEdit,
  XCircle,
  CheckCircle2,
  Stamp,
  ShieldOff,
  MinusCircle,
  CalendarX2,
  AlertTriangle,
  PackageCheck,
  type LucideIcon,
} from 'lucide-react';

export type RequirementVisualStatus =
  | 'NOT_STARTED'
  | 'REQUESTED'
  | 'UPLOADED'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'APPROVED'
  | 'APPROVED_EXTERNAL'
  | 'WAIVED'
  | 'NOT_APPLICABLE'
  | 'EXPIRED'
  | 'MISSING'
  | 'HANDED_OVER';

interface StatusConfig {
  label: string;
  icon: LucideIcon;
  className: string;
}

const STATUS_MAP: Record<RequirementVisualStatus, StatusConfig> = {
  NOT_STARTED: {
    label: 'Not started',
    icon: CircleDashed,
    className:
      'bg-[var(--status-not-started-bg)] border-[var(--status-not-started-border)] text-[var(--status-not-started-fg)] border',
  },
  REQUESTED: {
    label: 'Requested',
    icon: Send,
    className:
      'bg-[var(--status-requested-bg)] border-[var(--status-requested-border)] text-[var(--status-requested-fg)] border',
  },
  UPLOADED: {
    label: 'Uploaded',
    icon: FileUp,
    className:
      'bg-[var(--status-uploaded-bg)] border-[var(--status-uploaded-border)] text-[var(--status-uploaded-fg)] border',
  },
  IN_REVIEW: {
    label: 'Waiting for review',
    icon: Clock,
    className:
      'bg-[var(--status-in-review-bg)] border-[var(--status-in-review-border)] text-[var(--status-in-review-fg)] border',
  },
  CHANGES_REQUESTED: {
    label: 'Changes requested',
    icon: FileEdit,
    className:
      'bg-[var(--status-changes-bg)] border-[var(--status-changes-border)] text-[var(--status-changes-fg)] border',
  },
  REJECTED: {
    label: 'Rejected',
    icon: XCircle,
    className:
      'bg-[var(--status-rejected-bg)] border-[var(--status-rejected-border)] text-[var(--status-rejected-fg)] border',
  },
  APPROVED: {
    label: 'Approved',
    icon: CheckCircle2,
    className:
      'bg-[var(--status-approved-bg)] border-[var(--status-approved-border)] text-[var(--status-approved-fg)] border',
  },
  APPROVED_EXTERNAL: {
    label: 'Approved (external)',
    icon: Stamp,
    className:
      'bg-[var(--status-external-bg)] border-[var(--status-external-border)] text-[var(--status-external-fg)] border border-dashed font-semibold',
  },
  WAIVED: {
    label: 'Waived',
    icon: ShieldOff,
    className:
      'bg-[var(--status-waived-bg)] border-[var(--status-waived-border)] text-[var(--status-waived-fg)] border',
  },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    icon: MinusCircle,
    className:
      'bg-[var(--status-na-bg)] border-[var(--status-na-border)] text-[var(--status-na-fg)] border border-dashed',
  },
  EXPIRED: {
    label: 'Expired',
    icon: CalendarX2,
    className:
      'bg-[var(--status-expired-bg)] border-[var(--status-expired-border)] text-[var(--status-expired-fg)] border-[1.5px] font-semibold',
  },
  MISSING: {
    label: 'Missing',
    icon: AlertTriangle,
    className:
      'bg-[var(--status-missing-bg)] border-[var(--status-missing-border)] text-[var(--status-missing-fg)] border font-semibold',
  },
  HANDED_OVER: {
    label: 'Handed over',
    icon: PackageCheck,
    className: 'bg-teal-50 border-teal-300 text-teal-900 border font-semibold',
  },
};

export function RequirementStatusPill({
  status,
  size = 'md',
}: {
  status: RequirementVisualStatus;
  size?: 'sm' | 'md';
}) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.NOT_STARTED;
  const Icon = cfg.icon;

  return (
    <span
      role="status"
      aria-label={`Requirement status: ${cfg.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium leading-none tracking-tight select-none transition-colors duration-200 ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]'
      } ${cfg.className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" aria-hidden="true" />
      <span>{cfg.label}</span>
    </span>
  );
}
