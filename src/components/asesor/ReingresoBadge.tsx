"use client";

import { formatReingresoBadgeLabel } from "@/domain/expedientes/reingreso-manual";

export type ReingresoBadgeProps = {
  count?: number;
  at?: string | null;
  formatDateTime?: (iso: string) => string;
  className?: string;
  compact?: boolean;
};

export function ReingresoBadge({
  count = 0,
  at = null,
  formatDateTime,
  className = "",
  compact = false,
}: ReingresoBadgeProps) {
  const label = formatReingresoBadgeLabel(Math.max(1, count || 1));
  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`.trim()}>
      <span className="inline-flex w-fit rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-900">
        {label}
      </span>
      {!compact && at && formatDateTime ? (
        <span className="text-[10px] text-violet-800/80">
          Último envío: {formatDateTime(at)}
        </span>
      ) : null}
    </span>
  );
}
