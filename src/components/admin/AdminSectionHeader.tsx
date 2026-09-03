import type { ReactNode } from "react";

type AdminSectionHeaderProps = {
  title: string;
  /** Ayuda contextual del módulo; se muestra desde el icono de información. */
  description?: ReactNode;
  /** id del h2, para aria-labelledby de la sección. */
  titleId?: string;
  /** Contenido alineado a la derecha (p. ej. un select o botón). */
  trailing?: ReactNode;
};

/**
 * Encabezado estándar del panel Admin:
 * título compacto + ayuda contextual bajo demanda + slot derecho opcional.
 */
export function AdminSectionHeader({
  title,
  description,
  titleId,
  trailing,
}: AdminSectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {description ? (
          <details className="relative shrink-0">
            <summary
              aria-label={`Información sobre ${title}`}
              className="flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true">i</span>
            </summary>
            <div className="absolute left-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal leading-relaxed text-slate-700 shadow-lg">
              {description}
            </div>
          </details>
        ) : null}
      </div>
      {trailing ?? null}
    </div>
  );
}
