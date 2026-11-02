"use client";

import React from "react";
import { motion } from "framer-motion";
import clsx from "clsx";

export interface Segment {
  value: number;
  color: string;
  label: string;
}

export function SegmentedProgress({
  segments,
  className,
}: {
  segments: Segment[];
  className?: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return (
      <div className={clsx("h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB]", className)} />
    );
  }

  return (
    <div
      className={clsx(
        "flex h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB] gap-0.5",
        className
      )}
    >
      {segments.map((seg, i) => {
        const pct = (seg.value / total) * 100;
        if (pct === 0) return null;
        return (
          <motion.div
            key={seg.label}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={clsx(
              seg.color,
              i === 0 && "rounded-l-full",
              i === segments.length - 1 && "rounded-r-full"
            )}
            title={`${seg.label}: ${seg.value} (${pct.toFixed(0)}%)`}
          />
        );
      })}
    </div>
  );
}
