"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminSectionHeader } from "@/components/admin/AdminSectionHeader";
import {
  fetchAdminPrecalPerformance,
  type AdminPrecalPerformanceDetailFilter,
  type AdminPrecalPerformanceResult,
} from "@/domain/admin-precal-performance";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import {
  decisionBadgeClass,
  labelEditorDecision,
} from "@/domain/admin-production";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { formatDateTimeMx } from "@/lib/filters";
import { formatMontoMX } from "@/lib/monto";

const PAGE_SIZE = 50;

type Props = Readonly<{
  fromIso: string;
  toExclusiveIso: string;
  periodoLabel: string;
  asesorId?: string | null;
  search?: string | null;
  onSelectAsesor?: (asesorId: string) => void;
}>;

const FILTERS: readonly {
  value: AdminPrecalPerformanceDetailFilter;
  label: string;
}[] = [
  { value: "todos", label: "Todas" },
  { value: "compartidos", label: "Compartidos entre asesores" },
  { value: "reprecalificaciones", label: "Re-precalificaciones" },
  { value: "topados", label: "Topados $169k" },
  { value: "mesa", label: "Entraron a Mesa" },
  { value: "no_mesa", label: "No entraron a Mesa" },
];

function pct(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"}%`;
}

function originLabel(item: AdminPrecalPerformanceResult["items"][number]): string {
  if (!item.precalificadorOrigenId) return "Asesor";
  return (
    item.precalificadorNombre?.trim() ||
    item.precalificadorEmail?.trim() ||
    "Usuario precalificador"
  );
}

export function AdminPrecalPerformanceSection({
  fromIso,
  toExclusiveIso,
  periodoLabel,
  asesorId,
  search,
  onSelectAsesor,
}: Props) {
  const [detailFilter, setDetailFilter] =
    useState<AdminPrecalPerformanceDetailFilter>("todos");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminPrecalPerformanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [fromIso, toExclusiveIso, asesorId, search, detailFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchAdminPrecalPerformance({
      fromIso,
      toExclusiveIso,
      asesorId: asesorId || null,
      search: search || null,
      page,
      pageSize: PAGE_SIZE,
      detailFilter,
    })
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar el rendimiento de precalificaciones.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fromIso, toExclusiveIso, asesorId, search, page, detailFilter]);

  const summary = data?.summary;
  const totalPages = Math.max(
    1,
    Math.ceil((data?.totalCount ?? 0) / (data?.pageSize ?? PAGE_SIZE)),
  );

  const advisorRows = useMemo(() => data?.asesores ?? [], [data?.asesores]);

  if (loading && !data) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          Cargando rendimiento de precalificaciones…
        </p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">{error}</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <AdminSectionHeader
          title="Rendimiento de precalificaciones"
          description={`Cohorte de precalificaciones del periodo ${periodoLabel}. Separa re-precalificaciones del mismo asesor de NSS compartidos entre asesores distintos, y mide monto, aprobación y conversión a Mesa.`}
        />
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">
          <strong>Cómo leerlo:</strong> una re-precalificación del mismo asesor
          <strong> no cuenta como NSS compartido</strong>. “NSS compartido” significa
          que el mismo NSS fue precalificado por dos o más asesores distintos dentro
          del periodo. “Entró a Mesa” usa el estado actual del expediente. Para
          Mejoravit, promedio y monto operativo respetan el tope de{" "}
          <strong>$169,000</strong>.
        </div>
      </section>

      {summary ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[
              {
                label: "Precalificaciones",
                value: summary.totalPrecalificaciones.toLocaleString("es-MX"),
                hint: `${summary.nssUnicos.toLocaleString("es-MX")} NSS únicos`,
              },
              {
                label: "Re-precalificaciones",
                value: summary.reprecalificaciones.toLocaleString("es-MX"),
                hint: "Mismo expediente vuelve a consultarse; no cuenta como NSS compartido",
              },
              {
                label: "NSS compartidos entre asesores",
                value: summary.nssCompartidos.toLocaleString("es-MX"),
                hint: "Mismo NSS precalificado por 2+ asesores distintos en el periodo",
              },
              {
                label: "Aprobadas",
                value: summary.aprobadas.toLocaleString("es-MX"),
                hint: `${pct(summary.tasaAprobacionPct)} de las resueltas`,
              },
              {
                label: "No cumple",
                value: summary.noCumple.toLocaleString("es-MX"),
                hint: `${summary.pendientes.toLocaleString("es-MX")} pendientes actuales`,
              },
              {
                label: "Monto promedio aprobado",
                value: formatMontoMX(summary.montoPromedio),
                hint: "Promedio con tope Mejoravit aplicado",
              },
              {
                label: "Monto aprobado operativo",
                value: formatMontoMX(summary.montoTotalAdmin),
                hint: "Suma de aprobaciones del periodo",
              },
              {
                label: "Expedientes enviados a Mesa",
                value: summary.expedientesEnMesa.toLocaleString("es-MX"),
                hint: `${pct(summary.conversionMesaPct)} de ${summary.expedientesGenerados.toLocaleString("es-MX")} casos precalificados distintos`,
              },
              {
                label: "Topados $169k",
                value: summary.topadosNss.toLocaleString("es-MX"),
                hint: `${summary.topadosNssEnMesa.toLocaleString("es-MX")} entraron a Mesa · ${pct(summary.topadosConversionPct)}`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                  {card.label}
                </p>
                <p className="mt-2 break-words text-2xl font-semibold tabular-nums text-slate-950">
                  {card.value}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {card.hint}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <AdminSectionHeader
              title="Rendimiento por asesor"
              description="Compara volumen, re-precalificación, NSS compartidos con otros asesores, aprobación, monto y conversión a trámite. Aquí «Expedientes a Mesa» significa casos que sí fueron enviados a Mesa; no se usa «expediente» para los simples registros de precalificación."
            />
            {advisorRows.length === 0 ? (
              <AdminEmptyState
                title="No hay asesores con precalificaciones en este periodo."
                description="Cambia el periodo o limpia los filtros."
              />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[1240px] text-left text-sm text-slate-900">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="py-2 pr-3">Asesor</th>
                      <th className="py-2 pr-3 text-right">Precals</th>
                      <th className="py-2 pr-3 text-right">NSS únicos</th>
                      <th className="py-2 pr-3 text-right">Re-precals</th>
                      <th className="py-2 pr-3 text-right">NSS compartidos</th>
                      <th className="py-2 pr-3 text-right">Aprobadas</th>
                      <th className="py-2 pr-3 text-right">% aprobación</th>
                      <th className="py-2 pr-3 text-right">Monto prom.</th>
                      <th className="py-2 pr-3 text-right">Topados 169k</th>
                      <th className="py-2 pr-3 text-right">Expedientes a Mesa</th>
                      <th className="py-2 pr-3 text-right">% conversión</th>
                      <th className="py-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advisorRows.map((row) => {
                      const advisorLabel = formatAsesorExpedienteLabel({
                        fullName: row.asesorNombre,
                        email: row.asesorEmail,
                        fallbackId: row.asesorId,
                      });
                      return (
                        <tr
                          key={row.asesorId}
                          className="border-b border-slate-100 align-middle hover:bg-slate-50"
                        >
                          <td className="py-2.5 pr-3 font-medium">{advisorLabel}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.totalPrecalificaciones}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.nssUnicos}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.reprecalificaciones}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.nssCompartidos}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.aprobadas}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {pct(row.tasaAprobacionPct)}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {formatMontoMX(row.montoPromedio)}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.topadosNss}
                            {row.topadosNss > 0 ? (
                              <span className="ml-1 text-xs text-slate-500">
                                ({row.topadosNssEnMesa} Mesa)
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {row.expedientesEnMesa}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {pct(row.conversionMesaPct)}
                          </td>
                          <td className="py-2.5">
                            {onSelectAsesor ? (
                              <button
                                type="button"
                                className="text-blue-700 underline"
                                onClick={() => onSelectAsesor(row.asesorId)}
                              >
                                Ver solo
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <AdminSectionHeader
          title="Detalle de precalificaciones"
          description="Cada fila representa una precalificación real. Las re-precalificaciones se muestran aparte y NO hacen que un NSS se marque como compartido. Para cruzar dos asesores: usa «Ver solo» en el primero, activa «Compartidos entre asesores» y escribe el nombre del segundo en Buscar."
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={detailFilter === filter.value}
              onClick={() => setDetailFilter(filter.value)}
              className={
                detailFilter === filter.value
                  ? "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700">{error}</p>
        ) : null}

        {loading ? (
          <p className="mt-3 text-sm text-slate-600">Actualizando detalle…</p>
        ) : data && data.items.length === 0 ? (
          <AdminEmptyState
            title="No hay precalificaciones con este filtro."
            description="Prueba otro filtro o periodo."
          />
        ) : data ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[1640px] text-left text-sm text-slate-900">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">NSS</th>
                    <th className="py-2 pr-3">Cliente</th>
                    <th className="py-2 pr-3">Asesor</th>
                    <th className="py-2 pr-3">Origen</th>
                    <th className="py-2 pr-3">Resultado</th>
                    <th className="py-2 pr-3 text-right">Monto</th>
                    <th className="py-2 pr-3">Control NSS</th>
                    <th className="py-2 pr-3">Trámite</th>
                    <th className="py-2 pr-3">Etapa actual</th>
                    <th className="py-2">Expediente</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.attemptKey}
                      className="border-b border-slate-100 align-top hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap py-2.5 pr-3">
                        {item.fecha ? formatDateTimeMx(item.fecha) : "—"}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 font-mono">
                        {item.nss || "—"}
                      </td>
                      <td className="max-w-[15rem] py-2.5 pr-3 font-medium">
                        {item.clienteNombre || "POR CAPTURAR"}
                      </td>
                      <td className="max-w-[13rem] py-2.5 pr-3">
                        {formatAsesorExpedienteLabel({
                          fullName: item.asesorNombre,
                          email: item.asesorEmail,
                          fallbackId: item.asesorId,
                        })}
                      </td>
                      <td className="max-w-[12rem] py-2.5 pr-3">
                        {originLabel(item)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={decisionBadgeClass(item.decision)}>
                          {labelEditorDecision(item.decision)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">
                        {item.montoAprobado != null
                          ? formatMontoMX(
                              item.programa.toLowerCase() === "mejoravit"
                                ? Math.min(item.montoAprobado, 169000)
                                : item.montoAprobado,
                            )
                          : "—"}
                        {item.topado169k ? (
                          <span className="ml-2 inline-flex rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">
                            Topado
                          </span>
                        ) : null}
                      </td>
                      <td className="min-w-[20rem] py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {item.compartidoEntreAsesores ? (
                            <span className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                              Compartido · {item.asesoresNssCount} asesores
                            </span>
                          ) : (
                            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                              1 asesor
                            </span>
                          )}
                          {item.isReprecalificacion ? (
                            <span className="inline-flex rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">
                              Re-precalificación
                            </span>
                          ) : null}
                        </div>
                        {item.compartidoEntreAsesores ? (
                          <div className="mt-1.5 space-y-1 text-xs text-slate-600">
                            {item.asesoresNss.map((advisor) => (
                              <div key={advisor.asesorId}>
                                <strong className="font-medium text-slate-800">
                                  {formatAsesorExpedienteLabel({
                                    fullName: advisor.asesorNombre,
                                    email: advisor.asesorEmail,
                                    fallbackId: advisor.asesorId,
                                  })}
                                </strong>
                                {" · "}
                                {advisor.precalificaciones} precal
                                {advisor.precalificaciones === 1 ? "" : "s"}
                                {" · "}
                                {advisor.montoPromedio > 0
                                  ? `${formatMontoMX(advisor.montoPromedio)} prom.`
                                  : "sin monto prom."}
                                {" · "}
                                {advisor.expedientesEnMesa} Mesa
                              </div>
                            ))}
                          </div>
                        ) : item.isReprecalificacion ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Mismo asesor; no se considera NSS compartido.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">
                            Sin cruce con otro asesor en el periodo.
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.submittedToMesa ? (
                          <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                            Sí, entró a Mesa
                          </span>
                        ) : (
                          <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            No
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {getAdminEtapaDisplayNombre(item.etapaActual || 1)}
                      </td>
                      <td className="py-2.5">
                        <Link
                          href={`/admin/expedientes/${item.expedienteId}`}
                          className="text-blue-700 underline"
                        >
                          Ver detalle
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
              <span>
                {data.totalCount.toLocaleString("es-MX")} resultado
                {data.totalCount === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </Button>
                <span className="tabular-nums">
                  Página {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
