"use client";

import { useCallback, useState } from "react";
import {
  DEFAULT_ADMIN_STAGE_COHORT_PAGE_SIZE,
  fetchAdminStageCohortPage,
  formatAdminStageHistoryTimestamp,
  formatDurationSeconds,
  labelAdminStageCohortOutcome,
  labelAdminStageCohortSituacion,
  type AdminStageCohortAsesor,
  type AdminStageCohortEtapa,
  type AdminStageCohortItem,
  type AdminStageCohortOutcome,
  type AdminStageCohortPage,
  type AdminStageCohortSummary,
  type AdminStageHistoryFilters,
  AdminStageHistoryError,
} from "@/domain/admin-stage-history";

type DetailKey = Readonly<{
  paso: number;
  etapaLabel: string;
  outcome: AdminStageCohortOutcome;
  asesorId: string | null;
  asesorNombre: string;
}>;

function pct(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${rate}%`;
}

function etapaActualLabel(item: AdminStageCohortItem): string {
  if (item.paso_actual != null) return `Paso ${item.paso_actual}`;
  if (item.etapa_actual != null) return `Etapa ${item.etapa_actual}`;
  return "—";
}

function countForOutcome(
  row: Pick<
    AdminStageCohortAsesor,
    | "entered_count"
    | "advanced_count"
    | "stayed_count"
    | "incident_count"
    | "undetermined_count"
  >,
  outcome: AdminStageCohortOutcome,
): number {
  switch (outcome) {
    case "entered":
      return row.entered_count;
    case "advanced":
      return row.advanced_count;
    case "stayed":
      return row.stayed_count;
    case "incident":
      return row.incident_count;
    case "undetermined":
      return row.undetermined_count;
    default:
      return 0;
  }
}

function ClickCount(props: Readonly<{
  value: number;
  active: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`tabular-nums underline-offset-2 hover:underline ${
        props.active
          ? "font-semibold text-slate-900"
          : "font-medium text-slate-800"
      }`}
    >
      {props.value}
    </button>
  );
}

function UnifiedDetailTable(props: Readonly<{
  page: AdminStageCohortPage;
  loading: boolean;
}>) {
  if (props.loading) {
    return (
      <p className="text-sm text-slate-600" role="status">
        Cargando detalle…
      </p>
    );
  }

  if (props.page.items.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
        No hay expedientes en esta categoría.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[1400px] w-full divide-y divide-slate-200 text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="min-w-[12rem] px-3 py-2">Cliente</th>
            <th className="min-w-[9rem] px-3 py-2">NSS</th>
            <th className="min-w-[10rem] px-3 py-2">Asesor</th>
            <th className="min-w-[7rem] px-3 py-2">Programa</th>
            <th className="min-w-[16rem] px-3 py-2">Expediente</th>
            <th className="min-w-[12rem] px-3 py-2">Etapa analizada</th>
            <th className="min-w-[10rem] px-3 py-2">Fecha de entrada</th>
            <th className="min-w-[10rem] px-3 py-2">Fecha de salida</th>
            <th className="min-w-[7rem] px-3 py-2">Permanencia</th>
            <th className="min-w-[9rem] px-3 py-2">Resultado al cierre</th>
            <th className="min-w-[12rem] px-3 py-2">Etapa siguiente</th>
            <th className="min-w-[8rem] px-3 py-2">Etapa actual</th>
            <th className="min-w-[14rem] px-3 py-2">Situación actual</th>
            <th className="min-w-[8rem] px-3 py-2">Ver</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {props.page.items.map((item) => (
            <tr key={item.visita_id} className="align-top text-slate-800">
              <td className="px-3 py-2 whitespace-normal">{item.cliente_nombre}</td>
              <td className="px-3 py-2 font-mono text-xs tracking-wide whitespace-nowrap">
                {item.nss || "—"}
              </td>
              <td className="px-3 py-2 whitespace-normal">
                {item.asesor_nombre ?? "—"}
              </td>
              <td className="px-3 py-2">{item.programa ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs break-all">
                {item.expediente_id}
              </td>
              <td className="px-3 py-2 whitespace-normal">
                Paso {item.paso_visual} · {item.etapa_label}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatAdminStageHistoryTimestamp(item.entered_at)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatAdminStageHistoryTimestamp(item.exited_at)}
              </td>
              <td className="px-3 py-2">
                {formatDurationSeconds(item.duration_seconds)}
              </td>
              <td className="px-3 py-2">
                {labelAdminStageCohortOutcome(item.period_outcome)}
              </td>
              <td className="px-3 py-2 whitespace-normal">
                {item.etapa_siguiente_label ??
                  (item.etapa_siguiente_paso != null
                    ? `Paso ${item.etapa_siguiente_paso}`
                    : "—")}
              </td>
              <td className="px-3 py-2">{etapaActualLabel(item)}</td>
              <td className="px-3 py-2 whitespace-normal">
                {labelAdminStageCohortSituacion(item.situacion_actual)}
              </td>
              <td className="px-3 py-2">
                <a
                  href={`/admin/${item.expediente_id}`}
                  className="text-sm font-medium text-slate-900 underline"
                >
                  Ver expediente
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AsesorBreakdown(props: Readonly<{
  etapa: AdminStageCohortEtapa;
  active: DetailKey | null;
  onSelect: (key: DetailKey) => void;
}>) {
  const rows = props.etapa.por_asesor ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        Sin desglose por asesor para esta etapa.
      </p>
    );
  }

  const outcomes: AdminStageCohortOutcome[] = [
    "entered",
    "advanced",
    "stayed",
    "incident",
    "undetermined",
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Asesor</th>
            <th className="px-3 py-2 text-right">Entraron</th>
            <th className="px-3 py-2 text-right">Avanzaron</th>
            <th className="px-3 py-2 text-right">Se quedaron</th>
            <th className="px-3 py-2 text-right">Incidencias</th>
            <th className="px-3 py-2 text-right">No determinados</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const isRow =
              props.active?.paso === props.etapa.paso_visual &&
              props.active.asesorId === row.asesor_id;
            return (
              <tr key={row.asesor_id ?? row.asesor_nombre} className="text-slate-800">
                <td className="px-3 py-2 font-medium">{row.asesor_nombre}</td>
                {outcomes.map((outcome) => {
                  const value = countForOutcome(row, outcome);
                  const active =
                    isRow === true && props.active?.outcome === outcome;
                  return (
                    <td key={outcome} className="px-3 py-2 text-right">
                      <ClickCount
                        value={value}
                        active={active}
                        onClick={() =>
                          props.onSelect({
                            paso: props.etapa.paso_visual,
                            etapaLabel: props.etapa.etapa_label,
                            outcome,
                            asesorId: row.asesor_id,
                            asesorNombre: row.asesor_nombre,
                          })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeCard(props: Readonly<{
  label: string;
  count: number;
  rate: number | null | undefined;
  active: boolean;
  onClick?: () => void;
  showRate?: boolean;
  interactive?: boolean;
}>) {
  const className = `rounded-lg border px-3 py-3 text-left transition ${
    props.active
      ? "border-slate-800 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-800"
  } ${props.interactive ? "hover:border-slate-400" : ""}`;

  const body = (
    <>
      <p
        className={`text-xs font-medium ${
          props.active ? "text-slate-200" : "text-slate-500"
        }`}
      >
        {props.label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{props.count}</p>
      {props.showRate !== false && props.rate != null ? (
        <p
          className={`mt-0.5 text-xs tabular-nums ${
            props.active ? "text-slate-300" : "text-slate-500"
          }`}
        >
          {pct(props.rate)}
        </p>
      ) : null}
    </>
  );

  if (props.interactive && props.onClick) {
    return (
      <button type="button" onClick={props.onClick} className={className}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}

function EtapaBlock(props: Readonly<{
  etapa: AdminStageCohortEtapa;
  filters: AdminStageHistoryFilters;
  active: DetailKey | null;
  detailPage: AdminStageCohortPage | null;
  detailLoading: boolean;
  detailError: string | null;
  onSelect: (key: DetailKey) => void;
}>) {
  const { etapa } = props;
  const isActivePaso = props.active?.paso === etapa.paso_visual;
  const activeOutcome =
    isActivePaso && !props.active?.asesorId ? props.active!.outcome : null;
  const asesorActive = isActivePaso && props.active?.asesorId != null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">
          Paso {etapa.paso_visual} · {etapa.etapa_label}
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Los resultados se calculan sobre quienes entraron a esta etapa durante
          el periodo seleccionado.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <OutcomeCard
          label="Entraron"
          count={etapa.entered_count}
          rate={null}
          showRate={false}
          active={activeOutcome === "entered"}
          interactive
          onClick={() =>
            props.onSelect({
              paso: etapa.paso_visual,
              etapaLabel: etapa.etapa_label,
              outcome: "entered",
              asesorId: null,
              asesorNombre: "Todos",
            })
          }
        />
        <OutcomeCard
          label="Avanzaron"
          count={etapa.advanced_count}
          rate={etapa.advance_rate}
          active={activeOutcome === "advanced"}
          interactive
          onClick={() =>
            props.onSelect({
              paso: etapa.paso_visual,
              etapaLabel: etapa.etapa_label,
              outcome: "advanced",
              asesorId: null,
              asesorNombre: "Todos",
            })
          }
        />
        <OutcomeCard
          label="Se quedaron al cierre"
          count={etapa.stayed_count}
          rate={etapa.stayed_rate}
          active={activeOutcome === "stayed"}
          interactive
          onClick={() =>
            props.onSelect({
              paso: etapa.paso_visual,
              etapaLabel: etapa.etapa_label,
              outcome: "stayed",
              asesorId: null,
              asesorNombre: "Todos",
            })
          }
        />
        <OutcomeCard
          label="Rechazados o retrocedieron"
          count={etapa.incident_count}
          rate={
            etapa.entered_count === 0
              ? null
              : Math.round(
                  (etapa.incident_count * 1000) / etapa.entered_count,
                ) / 10
          }
          active={activeOutcome === "incident"}
          interactive
          onClick={() =>
            props.onSelect({
              paso: etapa.paso_visual,
              etapaLabel: etapa.etapa_label,
              outcome: "incident",
              asesorId: null,
              asesorNombre: "Todos",
            })
          }
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span>
          Tasa de avance:{" "}
          <strong className="tabular-nums">{pct(etapa.advance_rate)}</strong>
        </span>
        <span>
          Tasa de permanencia:{" "}
          <strong className="tabular-nums">{pct(etapa.stayed_rate)}</strong>
        </span>
        <span>
          Tiempo promedio para avanzar:{" "}
          <strong className="tabular-nums">
            {formatDurationSeconds(etapa.avg_advance_duration_seconds)}
          </strong>
        </span>
        <span>
          Tiempo mediano para avanzar:{" "}
          <strong className="tabular-nums">
            {formatDurationSeconds(etapa.median_advance_duration_seconds)}
          </strong>
        </span>
      </div>

      <div className="space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Desglose por asesor
        </h5>
        <AsesorBreakdown
          etapa={etapa}
          active={props.active}
          onSelect={props.onSelect}
        />
      </div>

      {isActivePaso && (asesorActive || activeOutcome) && props.active ? (
        <div className="space-y-2">
          <h5 className="text-sm font-semibold text-slate-900">
            Expedientes de {props.active.asesorNombre} ·{" "}
            {labelAdminStageCohortOutcome(props.active.outcome)} · Paso{" "}
            {props.active.paso} {props.active.etapaLabel}
          </h5>
          {props.detailPage ? (
            <p className="text-xs text-slate-500">
              {props.detailPage.total} expediente
              {props.detailPage.total === 1 ? "" : "s"} encontrados
            </p>
          ) : null}
          {props.detailError ? (
            <p role="alert" className="text-sm text-red-700">
              {props.detailError}
            </p>
          ) : null}
          {props.detailPage ? (
            <UnifiedDetailTable
              page={props.detailPage}
              loading={props.detailLoading}
            />
          ) : props.detailLoading ? (
            <p className="text-sm text-slate-600" role="status">
              Cargando detalle…
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdminStageCohortOutcomesPanel(props: Readonly<{
  summary: AdminStageCohortSummary;
  filters: AdminStageHistoryFilters;
  loading?: boolean;
  error?: string | null;
}>) {
  const [active, setActive] = useState<DetailKey | null>(null);
  const [detailPage, setDetailPage] = useState<AdminStageCohortPage | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (key: DetailKey) => {
      setActive(key);
      setDetailLoading(true);
      setDetailError(null);
      try {
        const scopedFilters: AdminStageHistoryFilters = {
          ...props.filters,
          asesorIds: key.asesorId
            ? [key.asesorId]
            : props.filters.asesorIds,
        };
        const page = await fetchAdminStageCohortPage(
          scopedFilters,
          key.outcome,
          DEFAULT_ADMIN_STAGE_COHORT_PAGE_SIZE,
          0,
          [key.paso],
        );
        setDetailPage(page);
      } catch (err) {
        setDetailPage(null);
        setDetailError(
          err instanceof AdminStageHistoryError
            ? err.message
            : "No se pudo cargar el detalle de resultados.",
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [props.filters],
  );

  if (props.loading) {
    return (
      <p className="text-sm text-slate-600" role="status">
        Cargando resultado de la etapa…
      </p>
    );
  }

  if (props.error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {props.error}
      </p>
    );
  }

  return (
    <div className="space-y-4 border-t border-slate-200 pt-6">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Resultado de los expedientes que entraron durante el periodo
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Resultado de la etapa al cierre del periodo seleccionado. Pulsa una
          cantidad del desglose por asesor para ver los expedientes.
        </p>
      </div>

      {props.summary.etapas.map((etapa) => (
        <EtapaBlock
          key={etapa.paso_visual}
          etapa={etapa}
          filters={props.filters}
          active={active}
          detailPage={
            active?.paso === etapa.paso_visual ? detailPage : null
          }
          detailLoading={
            active?.paso === etapa.paso_visual ? detailLoading : false
          }
          detailError={
            active?.paso === etapa.paso_visual ? detailError : null
          }
          onSelect={(key) => {
            void loadDetail(key);
          }}
        />
      ))}
    </div>
  );
}
