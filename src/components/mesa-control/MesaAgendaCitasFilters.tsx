"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MesaAgendaCitasClientFilters } from "@/lib/mesaAgendaCitasUi";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type MesaAgendaCitasFiltersProps = Readonly<{
  filters: MesaAgendaCitasClientFilters;
  advisorOptions: ReadonlyArray<{ value: string; label: string }>;
  locationOptions: ReadonlyArray<{ value: string; label: string }>;
  loading: boolean;
  onFiltersChange: (patch: Partial<MesaAgendaCitasClientFilters>) => void;
}>;

const KIND_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "biometricos", label: "Biométricos" },
  { value: "inscripcion", label: "Inscripción" },
  { value: "notificacion", label: "Notificación extraordinaria" },
  { value: "firmas", label: "Firma" },
] as const;

export function MesaAgendaCitasFilters({
  filters,
  advisorOptions,
  locationOptions,
  loading,
  onFiltersChange,
}: MesaAgendaCitasFiltersProps) {
  return (
    <section className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select
          id="mesa-citas-kind"
          label="Tipo"
          value={filters.kindUi}
          disabled={loading}
          options={[...KIND_OPTIONS]}
          onChange={(e) =>
            onFiltersChange({
              kindUi: e.target.value as MesaAgendaCitasClientFilters["kindUi"],
            })
          }
        />
        <Select
          id="mesa-citas-location"
          label="Sede"
          value={filters.locationId}
          disabled={loading}
          options={[{ value: "", label: "Todas" }, ...locationOptions]}
          onChange={(e) => onFiltersChange({ locationId: e.target.value })}
        />
        <Select
          id="mesa-citas-asesor"
          label="Asesor"
          value={filters.asesorId}
          disabled={loading}
          options={[{ value: "", label: "Todos" }, ...advisorOptions]}
          onChange={(e) => onFiltersChange({ asesorId: e.target.value })}
        />
        <Input
          id="mesa-citas-search"
          label="Buscar"
          placeholder="Cliente, NSS, asesor o quien agendó"
          value={filters.search}
          disabled={loading}
          onChange={(e) => onFiltersChange({ search: e.target.value })}
        />
        <div className="flex items-end sm:col-span-2 xl:col-span-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={filters.includeCancelled}
              disabled={loading}
              onChange={(e) => onFiltersChange({ includeCancelled: e.target.checked })}
              className="rounded border-slate-300"
            />
            Incluir canceladas
          </label>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Los resúmenes y listados reflejan el rango de fechas y los filtros activos.
      </p>
    </section>
  );
}

export function MesaAgendaCitasBackLink() {
  const pathname = usePathname();
  const inAdminAgenda = pathname?.startsWith("/admin/agenda") ?? false;
  const backHref = inAdminAgenda ? "/admin" : "/mesa-control";
  const backLabel = inAdminAgenda ? "← Volver al panel Admin" : "← Volver a Mesa Control";
  const hojaHref = inAdminAgenda ? "/admin/agenda/hoja" : "/mesa-control/citas/hoja";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link
        href={backHref}
        className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        {backLabel}
      </Link>
      <Link
        href={hojaHref}
        className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
      >
        Abrir vista tipo Drive
      </Link>
    </div>
  );
}
