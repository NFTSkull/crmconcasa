"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MesaAccordionSection } from "@/components/mesa-control/MesaAccordionSection";
import {
  fetchMesaAsesorCambioLote,
  marcarMesaAsesorCambiosRevisados,
} from "@/domain/expedientes/mesa-asesor-cambios";
import {
  formatMesaAsesorCambioStatusLabel,
  formatMesaAsesorCambioTipoLabel,
  formatMesaAsesorCambioValor,
  formatMesaAsesorReenviadoAt,
  groupMesaAsesorCambio,
  mesaAsesorCambioAnchor,
  MESA_ASESOR_CAMBIO_GRUPO_LABELS,
  MESA_ASESOR_CAMBIOS_FOCUS,
  MESA_ASESOR_CAMBIOS_PANEL_ID,
  type MesaAsesorCambio,
  type MesaAsesorCambioGrupo,
  type MesaAsesorCambioLote,
} from "@/lib/mesaAsesorCambiosUi";

const GRUPO_ORDER: readonly MesaAsesorCambioGrupo[] = [
  "documentos",
  "datos_cliente",
  "datos_operativos",
  "notas",
  "otros",
];

const HIGHLIGHT_CLASS = "mesa-asesor-cambio-highlight";
const HIGHLIGHT_MS = 2800;

function readFocusParam(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("focus")?.trim() ||
    (window.location.hash ? window.location.hash.replace(/^#/, "").trim() : "")
  );
}

function isAsesorCambiosFocus(focus: string): boolean {
  return (
    focus === MESA_ASESOR_CAMBIOS_FOCUS ||
    focus === MESA_ASESOR_CAMBIOS_PANEL_ID
  );
}

export type MesaAsesorCambiosPanelProps = Readonly<{
  expedienteId: string;
  loadReady: boolean;
  puedeMarcarRevisados: boolean;
  onPreviewDocumento: (documentoId: string) => Promise<void>;
}>;

export function MesaAsesorCambiosPanel({
  expedienteId,
  loadReady,
  puedeMarcarRevisados,
  onPreviewDocumento,
}: MesaAsesorCambiosPanelProps) {
  const [lote, setLote] = useState<MesaAsesorCambioLote | null>(null);
  const [changes, setChanges] = useState<readonly MesaAsesorCambio[]>([]);
  const [loading, setLoading] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const focusHandledRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!expedienteId) return;
    setLoading(true);
    try {
      const detalle = await fetchMesaAsesorCambioLote(expedienteId);
      setLote(detalle.lote);
      setChanges(detalle.changes);
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    if (!loadReady || !expedienteId) return;
    void refresh();
  }, [loadReady, expedienteId, refresh]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<MesaAsesorCambioGrupo, MesaAsesorCambio[]>();
    for (const g of GRUPO_ORDER) map.set(g, []);
    for (const c of changes) {
      const g = groupMesaAsesorCambio(c);
      const list = map.get(g) ?? [];
      list.push(c);
      map.set(g, list);
    }
    return map;
  }, [changes]);

  const highlightTarget = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.classList.add(HIGHLIGHT_CLASS);
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      el.classList.remove(HIGHLIGHT_CLASS);
      highlightTimerRef.current = null;
    }, HIGHLIGHT_MS);
  }, []);

  const goToCambio = useCallback(
    (change: MesaAsesorCambio) => {
      const anchor = mesaAsesorCambioAnchor(change);
      const sectionId = anchor?.sectionId;
      const fieldId = anchor?.fieldId;
      const target =
        (fieldId ? document.getElementById(fieldId) : null) ??
        (sectionId ? document.getElementById(sectionId) : null) ??
        document.getElementById(`mesa-asesor-cambio-${change.id}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      highlightTarget(target);
    },
    [highlightTarget],
  );

  useEffect(() => {
    if (!loadReady || loading || focusHandledRef.current) return;
    if (!lote) return;
    if (!isAsesorCambiosFocus(readFocusParam())) return;
    focusHandledRef.current = true;
    const panel = document.getElementById(MESA_ASESOR_CAMBIOS_PANEL_ID);
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    const first = changes[0];
    if (first) {
      window.setTimeout(() => {
        const row = document.getElementById(`mesa-asesor-cambio-${first.id}`);
        row?.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightTarget(row);
      }, 350);
    }
  }, [loadReady, loading, lote, changes, highlightTarget]);

  const handleMarcarRevisados = useCallback(async () => {
    if (!lote?.id || markBusy) return;
    setMarkBusy(true);
    setMarkError(null);
    try {
      const ok = await marcarMesaAsesorCambiosRevisados(lote.id);
      if (!ok) {
        setMarkError("No se pudo marcar como revisados. Intenta de nuevo.");
        return;
      }
      await refresh();
    } finally {
      setMarkBusy(false);
    }
  }, [lote?.id, markBusy, refresh]);

  const handlePreview = useCallback(
    async (documentoId: string | null) => {
      if (!documentoId) return;
      setDocError(null);
      try {
        await onPreviewDocumento(documentoId);
      } catch (err) {
        setDocError(
          err instanceof Error
            ? err.message
            : "No se pudo abrir el archivo. Intenta de nuevo.",
        );
      }
    },
    [onPreviewDocumento],
  );

  // Sin lote: no montar panel vacío ni deep-link de cambios.
  if (!loading && !lote) {
    return null;
  }

  const focusOpen = Boolean(lote) && isAsesorCambiosFocus(readFocusParam());
  const submittedLabel = formatMesaAsesorReenviadoAt(lote?.submittedAt);
  const statusLabel = formatMesaAsesorCambioStatusLabel(lote?.status);
  const summaryParts = [
    lote?.asesorNombre?.trim() || null,
    submittedLabel ? `Reenviado: ${submittedLabel}` : null,
    lote ? `${lote.changesCount} cambio${lote.changesCount === 1 ? "" : "s"}` : null,
    lote ? statusLabel : null,
  ].filter(Boolean);

  return (
    <>
      <style>{`
        .${HIGHLIGHT_CLASS} {
          outline: 2px solid rgb(14 165 233);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.25);
          transition: box-shadow 0.2s ease, outline-color 0.2s ease;
        }
      `}</style>
      <MesaAccordionSection
        id={MESA_ASESOR_CAMBIOS_PANEL_ID}
        title="Cambios realizados por el asesor"
        summary={
          loading
            ? "Cargando…"
            : lote
              ? summaryParts.join(" · ")
              : "Sin lote de cambios registrado"
        }
        defaultOpen={focusOpen || Boolean(lote && lote.status === "pendiente_revision")}
      >
        <div className="space-y-4 px-4 py-3" data-testid="mesa-asesor-cambios-panel">
          {lote ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-800">
                {statusLabel}
              </span>
              {lote.asesorNombre ? (
                <span>
                  Asesor: <span className="font-medium text-gray-900">{lote.asesorNombre}</span>
                </span>
              ) : null}
              {submittedLabel ? (
                <span>Reenviado: {submittedLabel}</span>
              ) : null}
              <span>
                {lote.changesCount} cambio{lote.changesCount === 1 ? "" : "s"}
              </span>
            </div>
          ) : null}

          {GRUPO_ORDER.map((grupo) => {
            const rows = grouped.get(grupo) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={grupo} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {MESA_ASESOR_CAMBIO_GRUPO_LABELS[grupo]}
                </h3>
                <ul className="space-y-2">
                  {rows.map((change) => {
                    const isDoc =
                      groupMesaAsesorCambio(change) === "documentos" ||
                      Boolean(change.documentKind) ||
                      String(change.tipo).startsWith("documento_");
                    return (
                      <li
                        key={change.id}
                        id={`mesa-asesor-cambio-${change.id}`}
                        className="scroll-mt-24 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {change.label}
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-500">
                              {formatMesaAsesorCambioTipoLabel(change.tipo)}
                              {change.createdAt
                                ? ` · ${formatMesaAsesorReenviadoAt(change.createdAt) ?? ""}`
                                : ""}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="shrink-0 text-xs"
                            onClick={() => goToCambio(change)}
                          >
                            Ir al cambio
                          </Button>
                        </div>

                        {isDoc ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {change.documentoNuevoId ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="text-xs"
                                onClick={() => void handlePreview(change.documentoNuevoId)}
                              >
                                Ver archivo nuevo
                              </Button>
                            ) : null}
                            {change.documentoAnteriorId ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="text-xs"
                                onClick={() =>
                                  void handlePreview(change.documentoAnteriorId)
                                }
                              >
                                Ver versión anterior
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
                              <p className="text-[10px] font-semibold uppercase text-gray-400">
                                Anterior
                              </p>
                              <p className="mt-0.5 break-words text-xs text-gray-800">
                                {formatMesaAsesorCambioValor(change.valorAnterior)}
                              </p>
                            </div>
                            <div className="rounded-md border border-sky-200 bg-sky-50/50 px-2 py-1.5">
                              <p className="text-[10px] font-semibold uppercase text-sky-700/80">
                                Nuevo
                              </p>
                              <p className="mt-0.5 break-words text-xs text-gray-900">
                                {formatMesaAsesorCambioValor(change.valorNuevo)}
                              </p>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {docError ? (
            <p className="text-xs text-red-700" role="alert">
              {docError}
            </p>
          ) : null}
          {markError ? (
            <p className="text-xs text-red-700" role="alert">
              {markError}
            </p>
          ) : null}

          {puedeMarcarRevisados && lote && lote.status === "pendiente_revision" ? (
            <div className="border-t border-gray-100 pt-3">
              <Button
                type="button"
                className="text-sm"
                disabled={markBusy}
                onClick={() => void handleMarcarRevisados()}
                data-testid="mesa-marcar-cambios-revisados"
              >
                {markBusy ? "Marcando…" : "Marcar cambios como revisados"}
              </Button>
              <p className="mt-1 text-[11px] text-gray-500">
                No avanza etapa ni valida documentos; solo registra la revisión del lote.
              </p>
            </div>
          ) : null}
        </div>
      </MesaAccordionSection>
    </>
  );
}
