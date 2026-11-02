"use client";

import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import clsx from "clsx";

interface MotionButtonProps extends HTMLMotionProps<"button"> {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const variantMap = {
  primary:
    "bg-[#3157D5] text-white shadow-xs hover:bg-[#2648B8] hover:shadow-md border border-transparent",
  secondary:
    "bg-[#F3F4F6] text-[#111827] hover:bg-[#E5E7EB] border border-[#E5E7EB]",
  outline:
    "bg-white text-[#374151] border border-[#E5E7EB] shadow-2xs hover:border-[#D1D5DB] hover:bg-[#F9FAFB] hover:shadow-xs",
  ghost:
    "bg-transparent text-[#667085] hover:bg-[#F3F4F6] hover:text-[#111827]",
  danger:
    "bg-[#DC5252] text-white shadow-xs hover:bg-[#B91C1C] hover:shadow-md border border-transparent",
  success:
    "bg-[#159B72] text-white shadow-xs hover:bg-[#0F766E] hover:shadow-md border border-transparent",
};

const sizeMap = {
  sm: "px-2.5 py-1 text-xs rounded-md gap-1.5",
  md: "px-3.5 py-1.5 text-xs rounded-md gap-2 font-semibold",
  lg: "px-4 py-2 text-sm rounded-lg gap-2 font-semibold",
};

export function MotionButton({
  children,
  variant = "outline",
  size = "md",
  className,
  disabled,
  ...props
}: MotionButtonProps) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -2, scale: 1.025 }}
      whileTap={disabled ? undefined : { y: 1, scale: 0.97 }}
      transition={{
        type: "spring",
        stiffness: 450,
        damping: 22,
      }}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-colors select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        variantMap[variant],
        sizeMap[size],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
