"use client";

import { useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  MESA_AVANZAR_11_12_CONFIRM,
  MESA_SIGUIENTE_ETAPA_CONFIRM_PREFIX,
  MESA_TIENE_DATOS_BADGE_LABEL,
  canMesaToggleMarcadorRole,
  resolveMesaSiguienteEtapaAccion,
  resolveMesaTomarExpedienteAccion,
  type MesaSiguienteEtapaContext,
} from "@/lib/mesaBandejaAccionesRapidas";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";

export type MesaBandejaAccionesRapidasProps = Readonly<{
  expedienteId: string;
  clienteNombre: string;
  role: string | null | undefined;
  currentUserId: string | null | undefined;
  ops: MesaExpedienteOpsRow | null | undefined;
  tieneDatos: boolean;
  siguienteCtx: MesaSiguienteEtapaContext;
  onSiguienteEtapa: (expedienteId: string) => Promise<void>;
  onToggleTieneDatos: (expedienteId: string, active: boolean) => Promise<void>;
  onTomarExpediente: (expedienteId: string) => Promise<void>;
}>;

export function MesaTieneDatosBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      className="ml-1.5 inline-flex shrink-0 items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-950 ring-1 ring-violet-300/80"
      data-testid="mesa-bandeja-tiene-datos-badge"
      title={MESA_TIENE_DATOS_BADGE_LABEL}
    >
      {MESA_TIENE_DATOS_BADGE_LABEL}
    </span>
  );
}

export function MesaBandejaAccionesRapidas({
  expedienteId,
  clienteNombre,
  role,
  currentUserId,
  ops,
  tieneDatos,
  siguienteCtx,
  onSiguienteEtapa,
  onToggleTieneDatos,
  onTomarExpediente,
}: MesaBandejaAccionesRapidasProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"siguiente" | "marcador" | "tomar" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const siguiente = resolveMesaSiguienteEtapaAccion({
    ...siguienteCtx,
    role,
    expedienteId,
  });
  const tomar = resolveMesaTomarExpedienteAccion({
    ops,
    currentUserId,
    role,
    cicloEstado: siguienteCtx.cicloEstado,
    submittedToMesa: siguienteCtx.submittedToMesa,
    assignedDisplayName: ops?.assignedToName ?? null,
  });
  const canMarcador = canMesaToggleMarcadorRole(role);

  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const run = async (
    kind: "siguiente" | "marcador" | "tomar",
    fn: () => Promise<void>,
  ) => {
    if (inFlightRef.current || busy) return;
    inFlightRef.current = true;
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  };

  const handlePrimaria = (e: MouseEvent) => {
    stop(e);
    if (!siguiente.visible || busy) return;

    if (siguiente.kind === "etapa_final") return;

    if (
      siguiente.kind === "navegar_biometricos" ||
      siguiente.kind === "navegar_firma" ||
      siguiente.kind === "navegar_acuse"
    ) {
      if (!siguiente.enabled || !siguiente.href) return;
      router.push(siguiente.href);
      return;
    }

    if (siguiente.kind !== "avanzar" || !siguiente.enabled || !siguiente.usesAvanzarRpc) {
      return;
    }
    const confirmMsg =
      siguiente.fromEtapa === 11 && siguiente.toEtapa === 12
        ? `${MESA_AVANZAR_11_12_CONFIRM}\n\nCliente: ${clienteNombre}`
        : `${MESA_SIGUIENTE_ETAPA_CONFIRM_PREFIX} ${siguiente.fromLabel} a ${siguiente.toLabel}.\n\nCliente: ${clienteNombre}`;
    const ok = window.confirm(confirmMsg);
    if (!ok) return;
    void run("siguiente", () => onSiguienteEtapa(expedienteId));
  };

  const handleMarcador = (e: MouseEvent) => {
    stop(e);
    if (!canMarcador || busy) return;
    void run("marcador", () => onToggleTieneDatos(expedienteId, !tieneDatos));
  };

  const handleTomar = (e: MouseEvent) => {
    stop(e);
    if (!tomar.visible || busy) return;
    void run("tomar", () => onTomarExpediente(expedienteId));
  };

  const showPrimaria =
    siguiente.visible &&
    (siguiente.kind === "etapa_final" ||
      siguiente.kind === "avanzar" ||
      siguiente.kind === "navegar_biometricos" ||
      siguiente.kind === "navegar_firma" ||
      siguiente.kind === "navegar_acuse");

  if (!showPrimaria && !canMarcador && !tomar.visible && !tomar.assignedToMe) {
    return null;
  }

  const primariaIsNav =
    siguiente.kind === "navegar_biometricos" ||
    siguiente.kind === "navegar_firma" ||
    siguiente.kind === "navegar_acuse";

  const primariaBusyLabel =
    busy === "siguiente"
      ? "Avanzando…"
      : siguiente.label;

  return (
    <div
      className="mt-3 border-t border-slate-100/80 pt-2"
      data-testid="mesa-bandeja-acciones-rapidas"
      onClick={stop}
      onKeyDown={stop}
    >
      <div className="flex flex-wrap items-center gap-2">
        {siguiente.kind === "etapa_final" ? (
          <span
            className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200"
            data-testid="mesa-bandeja-etapa-final"
          >
            Etapa final
          </span>
        ) : null}

        {showPrimaria && siguiente.kind !== "etapa_final" ? (
          <Button
            type="button"
            className="h-7 max-w-full px-2 text-[11px]"
            disabled={
              !siguiente.enabled ||
              busy !== null ||
              (primariaIsNav && !siguiente.href)
            }
            title={siguiente.reasonShort ?? undefined}
            aria-label={
              siguiente.enabled
                ? siguiente.label
                : siguiente.reasonShort ?? `${siguiente.label} no disponible`
            }
            onClick={handlePrimaria}
            data-testid={
              primariaIsNav
                ? "mesa-bandeja-accion-agenda"
                : "mesa-bandeja-siguiente-etapa"
            }
            data-accion-kind={siguiente.kind}
          >
            {primariaBusyLabel}
          </Button>
        ) : null}

        {siguiente.visible &&
        !siguiente.enabled &&
        siguiente.reasonShort &&
        siguiente.kind !== "etapa_final" ? (
          <span
            className="max-w-[14rem] text-[10px] leading-tight text-slate-500"
            data-testid="mesa-bandeja-siguiente-etapa-motivo"
          >
            {siguiente.reasonShort}
          </span>
        ) : null}

        {canMarcador ? (
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={busy !== null}
            onClick={handleMarcador}
            data-testid="mesa-bandeja-tiene-datos-toggle"
          >
            {busy === "marcador"
              ? "Guardando…"
              : tieneDatos
                ? "Quitar marca"
                : "Tiene datos"}
          </Button>
        ) : null}

        {tomar.visible ? (
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={busy !== null}
            onClick={handleTomar}
            data-testid="mesa-bandeja-tomar-expediente"
          >
            {busy === "tomar" ? "Tomando…" : "Tomar expediente"}
          </Button>
        ) : null}

        {tomar.assignedToMe ? (
          <span
            className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-900 ring-1 ring-sky-200/80"
            data-testid="mesa-bandeja-asignado-a-mi"
          >
            Asignado a mí
          </span>
        ) : null}
        {tomar.assignedToOther && tomar.assignedLabel ? (
          <span
            className="truncate text-[10px] text-slate-500"
            data-testid="mesa-bandeja-asignado-otro"
            title={tomar.assignedLabel}
          >
            {tomar.assignedLabel}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 text-[10px] text-red-600" data-testid="mesa-bandeja-accion-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
