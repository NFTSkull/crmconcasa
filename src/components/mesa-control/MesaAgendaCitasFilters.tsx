"use client";

import Link from "next/link";
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
  { value: "firmas", label: "Firma" },
  { value: "notificacion", label: "Notificación" },
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
  return (
    <Link
      href="/mesa-control"
      className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900"
    >
      ← Volver a Mesa Control
    </Link>
  );
}
