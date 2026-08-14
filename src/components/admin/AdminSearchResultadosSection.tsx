"use client";

import { Button } from "@/components/ui/Button";
import { AdminSectionHeader } from "@/components/admin/AdminSectionHeader";
import {
  adminSearchProgramaSolicitadoVisible,
  formatAdminSearchCoincidencias,
  labelAdminSearchCiclo,
  labelAdminSearchEtapa,
  labelAdminSearchMesa,
  labelAdminSearchPrecalDecision,
  labelAdminSearchPrograma,
  type AdminClienteSearchItem,
} from "@/domain/admin-production/admin-cliente-search";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { formatDateTimeMx } from "@/lib/filters";
import { formatMontoMX } from "@/lib/monto";

type AdminSearchResultadosSectionProps = {
  query: string;
  loading: boolean;
  error: string | null;
  items: readonly AdminClienteSearchItem[];
  truncated: boolean;
  limit: number;
  onRetry: () => void;
  onOpen: (item: AdminClienteSearchItem) => void;
  onClear: () => void;
};

function asesorLabel(item: AdminClienteSearchItem): string {
  return formatAsesorExpedienteLabel({
    fullName: item.asesorNombre,
    email: item.asesorEmail,
    fallbackId: item.asesorId,
  });
}

export function AdminSearchResultadosSection({
  query,
  loading,
  error,
  items,
  truncated,
  limit,
  onRetry,
  onOpen,
  onClear,
}: AdminSearchResultadosSectionProps) {
  return (
    <section
      aria-label="Resultados de búsqueda"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <AdminSectionHeader
        title="Resultados de búsqueda"
        description="Localizador por cliente o NSS. Independiente del periodo de los KPIs."
        trailing={
          <Button type="button" variant="secondary" onClick={onClear}>
            Limpiar búsqueda
          </Button>
        }
      />
      {loading ? (
        <p className="mt-3 text-sm text-gray-700">Buscando…</p>
      ) : error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
          <span>{error}</span>
          <Button type="button" variant="secondary" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-700">
          No encontramos coincidencias para «{query}». Busca por nombre o NSS.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-800">
            {formatAdminSearchCoincidencias(items.length)}
          </p>
          {truncated ? (
            <p className="mt-1 text-xs text-slate-600">
              Mostrando los primeros {limit} resultados. Refina la búsqueda.
            </p>
          ) : null}
          <ul className="mt-3 grid gap-3">
            {items.map((item) => {
              const solicitado = adminSearchProgramaSolicitadoVisible(
                item.programa,
                item.programaSolicitado,
              );
              return (
                <li
                  key={item.expedienteId}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Cliente: {item.clienteNombre || "—"}
                      </p>
                      <p className="text-xs text-slate-600">NSS: {item.nss || "—"}</p>
                    </div>
                    <Button type="button" onClick={() => onOpen(item)}>
                      Abrir expediente
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-slate-800">
                    Asesor: {asesorLabel(item)}
                  </p>
                  <p className="text-sm text-slate-800">
                    Programa: {labelAdminSearchPrograma(item.programa)}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Precalificación
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {labelAdminSearchPrecalDecision(item.editorDecision)}
                      </p>
                      {item.editorDecision === "aprobado" && item.montoAprobado != null ? (
                        <p className="mt-1 text-sm tabular-nums text-slate-800">
                          Monto vigente {formatMontoMX(item.montoAprobado)}
                        </p>
                      ) : null}
                      {item.precalPending ? (
                        <p className="mt-1 text-sm text-amber-800">
                          Re-precalificación en revisión
                        </p>
                      ) : null}
                      {solicitado ? (
                        <p className="mt-1 text-xs text-slate-600">
                          Programa solicitado: {labelAdminSearchPrograma(solicitado)}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Expediente
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">Sí</p>
                      <p className="mt-1 text-sm text-slate-800">
                        {labelAdminSearchEtapa(item.etapaActual)}
                      </p>
                      <p className="text-sm text-slate-800">
                        {labelAdminSearchCiclo(item.cicloEstado)}
                        {item.subestado ? ` · ${item.subestado}` : ""}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Mesa
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {labelAdminSearchMesa(item)}
                      </p>
                      {item.submittedToMesa && item.fechaEnvioMesa ? (
                        <p className="mt-1 text-xs text-slate-600">
                          {formatDateTimeMx(item.fechaEnvioMesa)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
