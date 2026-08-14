"use client";

import { Button } from "@/components/ui/Button";
import {
  adminSearchProgramaSolicitadoVisible,
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

type AdminSearchExpedientePanelProps = {
  item: AdminClienteSearchItem | null;
  onClose: () => void;
};

/**
 * Detalle visual del localizador P182.
 * No reutiliza AdminExpedienteDrawer (exige fila Mesa con fechaEnvioMesa).
 */
export function AdminSearchExpedientePanel({
  item,
  onClose,
}: AdminSearchExpedientePanelProps) {
  if (!item) return null;
  const solicitado = adminSearchProgramaSolicitadoVisible(
    item.programa,
    item.programaSolicitado,
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-search-exp-title"
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="admin-search-exp-title" className="text-base font-semibold text-slate-900">
            {item.clienteNombre || "Expediente"}
          </h2>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">NSS</dt>
            <dd className="font-medium text-slate-900">{item.nss || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Asesor</dt>
            <dd className="font-medium text-slate-900">
              {formatAsesorExpedienteLabel({
                fullName: item.asesorNombre,
                email: item.asesorEmail,
                fallbackId: item.asesorId,
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Programa vigente</dt>
            <dd className="font-medium text-slate-900">
              {labelAdminSearchPrograma(item.programa)}
            </dd>
          </div>
          {solicitado ? (
            <div>
              <dt className="text-xs text-slate-500">Programa solicitado</dt>
              <dd className="font-medium text-slate-900">
                {labelAdminSearchPrograma(solicitado)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-slate-500">Precalificación</dt>
            <dd className="font-medium text-slate-900">
              {labelAdminSearchPrecalDecision(item.editorDecision)}
            </dd>
          </div>
          {item.editorDecision === "aprobado" && item.montoAprobado != null ? (
            <div>
              <dt className="text-xs text-slate-500">Monto vigente</dt>
              <dd className="font-medium tabular-nums text-slate-900">
                {formatMontoMX(item.montoAprobado)}
              </dd>
            </div>
          ) : null}
          {item.precalPending ? (
            <div>
              <dt className="text-xs text-slate-500">Re-precalificación</dt>
              <dd className="font-medium text-amber-800">En revisión</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-slate-500">Expediente</dt>
            <dd className="font-medium text-slate-900">
              {labelAdminSearchEtapa(item.etapaActual)} · {labelAdminSearchCiclo(item.cicloEstado)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Mesa</dt>
            <dd className="font-medium text-slate-900">
              {labelAdminSearchMesa(item)}
              {item.submittedToMesa && item.fechaEnvioMesa
                ? ` · ${formatDateTimeMx(item.fechaEnvioMesa)}`
                : ""}
            </dd>
          </div>
          {item.createdAt ? (
            <div>
              <dt className="text-xs text-slate-500">Creado</dt>
              <dd className="text-slate-800">{formatDateTimeMx(item.createdAt)}</dd>
            </div>
          ) : null}
          {item.updatedAt ? (
            <div>
              <dt className="text-xs text-slate-500">Actualizado</dt>
              <dd className="text-slate-800">{formatDateTimeMx(item.updatedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </aside>
    </div>
  );
}
