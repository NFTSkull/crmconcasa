import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

type AdminEmptyStateProps = {
  title: string;
  description?: string;
  onClearFilters?: () => void;
  clearLabel?: string;
  children?: ReactNode;
};

/**
 * Empty state amigable del panel Admin (B2). Sin textos técnicos.
 */
export function AdminEmptyState({
  title,
  description,
  onClearFilters,
  clearLabel = "Limpiar filtros",
  children,
}: AdminEmptyStateProps) {
  return (
    <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      ) : null}
      {children}
      {onClearFilters ? (
        <div className="mt-3">
          <Button type="button" variant="secondary" onClick={onClearFilters}>
            {clearLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
