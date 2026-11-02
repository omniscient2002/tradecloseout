"use client";

import React from "react";
import clsx from "clsx";

interface MotionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}

export function MotionCard({
  children,
  className,
  onClick,
  interactive = false,
  ...props
}: MotionCardProps) {
  const isClickable = Boolean(onClick || interactive);

  return (
    <div
      onClick={onClick}
      className={clsx(
        "relative rounded-xl border border-[#E5E7EB] bg-white transition-all duration-200 ease-out",
        isClickable
          ? "cursor-pointer hover:border-[#CBD5E1] hover:-translate-y-1 hover:shadow-sm active:translate-y-0 active:scale-[0.99]"
          : "shadow-2xs",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
