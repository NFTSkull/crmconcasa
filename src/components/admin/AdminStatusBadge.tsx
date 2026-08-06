"use client";

import {
  adminStatusToneClass,
  resolveAdminStatusTone,
  type AdminStatusBadgeInput,
} from "@/lib/adminStatusBadge";

type AdminStatusBadgeProps = AdminStatusBadgeInput & {
  className?: string;
};

/**
 * Badge visual de situación Admin (B2). Texto = situacionLabel existente.
 */
export function AdminStatusBadge({
  className = "",
  ...input
}: AdminStatusBadgeProps) {
  const tone = resolveAdminStatusTone(input);
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-xs font-medium ${adminStatusToneClass(tone)} ${className}`}
    >
      <span className="truncate">{input.situacionLabel}</span>
    </span>
  );
}
