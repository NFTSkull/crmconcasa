"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  canDeclareAgendaContingencia,
  formatContingenciaKindLabel,
  formatContingenciaSedeLabel,
  type ContingenciaPreviewResult,
  previewContingencia,
  declararContingencia,
  AgendaContingenciaError,
} from "@/domain/agenda-contingencia";

export type MesaAgendaContingenciaDialogProps = Readonly<{
  open: boolean;
  dayYmd: string;
  role: string | null | undefined;
  onClose: () => void;
  onDeclared: () => void;
}>;

type KindKey = "biometricos" | "firmas";

export function MesaAgendaContingenciaDialog({
  open,
  dayYmd,
  role,
  onClose,
  onDeclared,
}: MesaAgendaContingenciaDialogProps) {
  const [bio, setBio] = useState(true);
  const [firmas, setFirmas] = useState(false);
  const [sede, setSede] = useState<"todas" | "monterrey" | "apodaca">("todas");
  const [motivo, setMotivo] = useState("");
  const [previewBio, setPreviewBio] = useState<ContingenciaPreviewResult | null>(null);
  const [previewFirmas, setPreviewFirmas] = useState<ContingenciaPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const authorized = canDeclareAgendaContingencia(role);
  const locationId = sede === "todas" ? null : sede;
  const motivoOk = motivo.trim().length >= 1 && motivo.trim().length <= 500;

  const selectedKinds = useMemo(() => {
    const ks: KindKey[] = [];
    if (bio) ks.push("biometricos");
    if (firmas) ks.push("firmas");
    return ks;
  }, [bio, firmas]);

  const loadPreview = useCallback(async () => {
    if (!open || !authorized || !dayYmd) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const [b, f] = await Promise.all([
        previewContingencia({
          affected_date: dayYmd,
          kind: "biometricos",
          location_id: locationId,
        }),
        previewContingencia({
          affected_date: dayYmd,
          kind: "firmas",
          location_id: locationId,
        }),
      ]);
      setPreviewBio(b);
      setPreviewFirmas(f);
    } catch (e) {
      setPreviewError(
        e instanceof AgendaContingenciaError
          ? e.message
          : "No se pudo cargar el preview de contingencia.",
      );
      setPreviewBio(null);
      setPreviewFirmas(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [open, authorized, dayYmd, locationId]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

  useEffect(() => {
    if (!open) {
      setBio(true);
      setFirmas(false);
      setSede("todas");
      setMotivo("");
      setResultMsg(null);
      setError(null);
      busyRef.current = false;
      setSaving(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  const kindsToDeclare = useMemo(() => {
    return selectedKinds.filter((k) => {
      const p = k === "biometricos" ? previewBio : previewFirmas;
      return (p?.affected_count ?? 0) > 0;
    });
  }, [selectedKinds, previewBio, previewFirmas]);

  const canConfirm =
    authorized &&
    motivoOk &&
    selectedKinds.length > 0 &&
    kindsToDeclare.length > 0 &&
    !previewLoading &&
    !saving;

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setResultMsg(null);
    const lines: string[] = [];
    try {
      for (const kind of kindsToDeclare) {
        try {
          const res = await declararContingencia({
            affected_date: dayYmd,
            kind,
            location_id: locationId,
            reason: motivo.trim(),
          });
          lines.push(
            `${formatContingenciaKindLabel(kind)}: ${res.affected_count} solicitudes creadas`,
          );
        } catch (e) {
          const msg =
            e instanceof AgendaContingenciaError
              ? e.message
              : "No se pudo crear";
          lines.push(`${formatContingenciaKindLabel(kind)}: ${msg}`);
        }
      }
      setResultMsg(lines.join("\n"));
      onDeclared();
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }, [
    canConfirm,
    kindsToDeclare,
    dayYmd,
    locationId,
    motivo,
    onDeclared,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={handleClose}
      data-testid="mesa-contingencia-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesa-contingencia-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-amber-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="mesa-contingencia-title"
          className="text-base font-semibold text-slate-900"
        >
          Solicitar reagenda extraordinaria
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Fecha: <span className="font-medium text-slate-900">{dayYmd}</span>
        </p>
        <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Las citas originales no se cancelarán ni se moverán. Se enviará una
          solicitud extraordinaria de reagenda a los asesores.
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="text-xs font-semibold text-slate-800">
            Tipos afectados
          </legend>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={bio}
              onChange={(e) => setBio(e.target.checked)}
              disabled={saving}
            />
            Biométricos
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={firmas}
              onChange={(e) => setFirmas(e.target.checked)}
              disabled={saving}
            />
            Firmas
          </label>
        </fieldset>

        <label className="mt-4 block text-xs font-semibold text-slate-800">
          Sede
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={sede}
            disabled={saving}
            onChange={(e) =>
              setSede(e.target.value as "todas" | "monterrey" | "apodaca")
            }
          >
            <option value="todas">Todas</option>
            <option value="monterrey">Monterrey</option>
            <option value="apodaca">Apodaca</option>
          </select>
        </label>

        <label className="mt-4 block text-xs font-semibold text-slate-800">
          Motivo
          <textarea
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            rows={3}
            disabled={saving}
            value={motivo}
            placeholder="Ej. Falla general del sistema, cierre de CESI, contingencia externa…"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">Preview</p>
          <p className="mt-0.5">
            Sede: {formatContingenciaSedeLabel(locationId)}
          </p>
          {previewLoading ? (
            <p className="mt-1">Calculando afectados…</p>
          ) : previewError ? (
            <p className="mt-1 text-amber-800" role="alert">
              {previewError}
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {bio ? (
                <li>
                  Biométricos —{" "}
                  {(previewBio?.affected_count ?? 0) > 0
                    ? `${previewBio?.affected_count} citas · ${previewBio?.advisor_count} asesores`
                    : "Sin citas afectadas"}
                </li>
              ) : null}
              {firmas ? (
                <li>
                  Firmas —{" "}
                  {(previewFirmas?.affected_count ?? 0) > 0
                    ? `${previewFirmas?.affected_count} citas · ${previewFirmas?.advisor_count} asesores`
                    : "Sin citas afectadas"}
                </li>
              ) : null}
            </ul>
          )}
          <p className="mt-2 font-medium text-amber-950">
            Esta acción NO cancela ni modifica las citas originales.
          </p>
        </div>

        {error ? (
          <p className="mt-3 text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {resultMsg ? (
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
            {resultMsg}
          </pre>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={handleClose}
          >
            {resultMsg ? "Cerrar" : "Cancelar"}
          </Button>
          {!resultMsg ? (
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={!canConfirm}
              onClick={() => void handleConfirm()}
              data-testid="mesa-contingencia-confirm"
            >
              {saving
                ? "Generando solicitudes…"
                : "Solicitar reagenda extraordinaria"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
