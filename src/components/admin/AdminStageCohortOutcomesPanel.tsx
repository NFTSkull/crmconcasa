"use client";

import { useCallback, useState } from "react";
import {
  DEFAULT_ADMIN_STAGE_COHORT_PAGE_SIZE,
  fetchAdminStageCohortPage,
  formatAdminStageHistoryTimestamp,
  formatDurationSeconds,
  labelAdminStageCohortSituacion,
  labelAdminStageHistoryResultado,
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
  outcome: AdminStageCohortOutcome;
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

function CohortDetailTable(props: Readonly<{
  outcome: AdminStageCohortOutcome;
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

  if (props.outcome === "advanced") {
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">NSS</th>
              <th className="px-3 py-2">Asesor</th>
              <th className="px-3 py-2">Programa</th>
              <th className="px-3 py-2">Etapa analizada</th>
              <th className="px-3 py-2">Fecha de entrada</th>
              <th className="px-3 py-2">Fecha de avance</th>
              <th className="px-3 py-2">Permanencia</th>
              <th className="px-3 py-2">Etapa siguiente</th>
              <th className="px-3 py-2">Etapa actual</th>
              <th className="px-3 py-2">Ver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.page.items.map((item) => (
              <tr key={item.visita_id} className="text-slate-800">
                <td className="px-3 py-2">{item.cliente_nombre}</td>
                <td className="px-3 py-2 font-mono text-xs">{item.nss}</td>
                <td className="px-3 py-2">{item.asesor_nombre ?? "—"}</td>
                <td className="px-3 py-2">{item.programa ?? "—"}</td>
                <td className="px-3 py-2">
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
                  {item.etapa_siguiente_label ??
                    (item.etapa_siguiente_paso != null
                      ? `Paso ${item.etapa_siguiente_paso}`
                      : "—")}
                </td>
                <td className="px-3 py-2">{etapaActualLabel(item)}</td>
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

  if (props.outcome === "stayed") {
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">NSS</th>
              <th className="px-3 py-2">Asesor</th>
              <th className="px-3 py-2">Programa</th>
              <th className="px-3 py-2">Etapa analizada</th>
              <th className="px-3 py-2">Fecha de entrada</th>
              <th className="px-3 py-2">Días al cierre</th>
              <th className="px-3 py-2">Situación actual</th>
              <th className="px-3 py-2">Etapa actual</th>
              <th className="px-3 py-2">Ver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.page.items.map((item) => (
              <tr key={item.visita_id} className="text-slate-800">
                <td className="px-3 py-2">{item.cliente_nombre}</td>
                <td className="px-3 py-2 font-mono text-xs">{item.nss}</td>
                <td className="px-3 py-2">{item.asesor_nombre ?? "—"}</td>
                <td className="px-3 py-2">{item.programa ?? "—"}</td>
                <td className="px-3 py-2">
                  Paso {item.paso_visual} · {item.etapa_label}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatAdminStageHistoryTimestamp(item.entered_at)}
                </td>
                <td className="px-3 py-2">
                  {formatDurationSeconds(item.duration_seconds)}
                </td>
                <td className="px-3 py-2">
                  {labelAdminStageCohortSituacion(item.situacion_actual)}
                </td>
                <td className="px-3 py-2">{etapaActualLabel(item)}</td>
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

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Asesor</th>
            <th className="px-3 py-2">Fecha de entrada</th>
            <th className="px-3 py-2">Fecha de salida</th>
            <th className="px-3 py-2">Permanencia</th>
            <th className="px-3 py-2">Resultado</th>
            <th className="px-3 py-2">Destino</th>
            <th className="px-3 py-2">Motivo autorizado</th>
            <th className="px-3 py-2">Etapa actual</th>
            <th className="px-3 py-2">Ver</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {props.page.items.map((item) => (
            <tr key={item.visita_id} className="text-slate-800">
              <td className="px-3 py-2">{item.cliente_nombre}</td>
              <td className="px-3 py-2">{item.asesor_nombre ?? "—"}</td>
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
                {labelAdminStageHistoryResultado(item.resultado_label)}
              </td>
              <td className="px-3 py-2">
                {item.etapa_siguiente_label ??
                  (item.etapa_siguiente_paso != null
                    ? `Paso ${item.etapa_siguiente_paso}`
                    : "—")}
              </td>
              <td className="px-3 py-2">{item.motivo ?? "—"}</td>
              <td className="px-3 py-2">{etapaActualLabel(item)}</td>
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
  const activeOutcome = isActivePaso ? props.active!.outcome : null;

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
          active={false}
          interactive={false}
        />
        <OutcomeCard
          label="Avanzaron"
          count={etapa.advanced_count}
          rate={etapa.advance_rate}
          active={activeOutcome === "advanced"}
          interactive
          onClick={() =>
            props.onSelect({ paso: etapa.paso_visual, outcome: "advanced" })
          }
        />
        <OutcomeCard
          label="Se quedaron al cierre"
          count={etapa.stayed_count}
          rate={etapa.stayed_rate}
          active={activeOutcome === "stayed"}
          interactive
          onClick={() =>
            props.onSelect({ paso: etapa.paso_visual, outcome: "stayed" })
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
            props.onSelect({ paso: etapa.paso_visual, outcome: "incident" })
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
        {etapa.undetermined_count > 0 ? (
          <span>
            No determinados:{" "}
            <strong className="tabular-nums">{etapa.undetermined_count}</strong>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-xs font-medium text-slate-800 underline"
          onClick={() =>
            props.onSelect({ paso: etapa.paso_visual, outcome: "advanced" })
          }
        >
          Ver avanzaron
        </button>
        <button
          type="button"
          className="text-xs font-medium text-slate-800 underline"
          onClick={() =>
            props.onSelect({ paso: etapa.paso_visual, outcome: "stayed" })
          }
        >
          Ver se quedaron
        </button>
        <button
          type="button"
          className="text-xs font-medium text-slate-800 underline"
          onClick={() =>
            props.onSelect({ paso: etapa.paso_visual, outcome: "incident" })
          }
        >
          Ver incidencias
        </button>
        {etapa.undetermined_count > 0 ? (
          <button
            type="button"
            className="text-xs font-medium text-slate-800 underline"
            onClick={() =>
              props.onSelect({
                paso: etapa.paso_visual,
                outcome: "undetermined",
              })
            }
          >
            Ver no determinados
          </button>
        ) : null}
      </div>

      {isActivePaso && props.detailPage ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            {props.detailPage.total} expediente
            {props.detailPage.total === 1 ? "" : "s"} · mostrando{" "}
            {props.detailPage.items.length}
          </p>
          {props.detailError ? (
            <p role="alert" className="text-sm text-red-700">
              {props.detailError}
            </p>
          ) : null}
          <CohortDetailTable
            outcome={props.active!.outcome}
            page={props.detailPage}
            loading={props.detailLoading}
          />
        </div>
      ) : null}
      {isActivePaso && props.detailLoading && !props.detailPage ? (
        <p className="text-sm text-slate-600" role="status">
          Cargando detalle…
        </p>
      ) : null}
      {isActivePaso && props.detailError && !props.detailPage ? (
        <p role="alert" className="text-sm text-red-700">
          {props.detailError}
        </p>
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
        const page = await fetchAdminStageCohortPage(
          props.filters,
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
          Resultado de la etapa al cierre del periodo seleccionado.
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
