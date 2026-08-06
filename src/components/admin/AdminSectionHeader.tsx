import type { ReactNode } from "react";

type AdminSectionHeaderProps = {
  title: string;
  /** Descripción corta bajo el título; texto plano o nodos. */
  description?: ReactNode;
  /** id del h2, para aria-labelledby de la sección. */
  titleId?: string;
  /** Contenido alineado a la derecha (p. ej. un select o botón). */
  trailing?: ReactNode;
};

/**
 * Encabezado estándar de módulo del panel Admin (B1):
 * título + descripción breve + slot derecho opcional.
 */
export function AdminSectionHeader({
  title,
  description,
  titleId,
  trailing,
}: AdminSectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        ) : null}
      </div>
      {trailing ?? null}
    </div>
  );
}
