"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  MESA_CLIENTE_DATOS_RECHAZO_MOTIVOS,
  buildComentarioRechazoClienteDatos,
  isClienteDatosMotivoOtro,
  type ExpedienteClienteDatos,
  type ExpedienteClienteDatosEstado,
} from "@/domain/expediente-cliente-datos";
import { MESA_SOLICITAR_CORRECCION_LABEL } from "@/domain/expedientes/mesa-decision-ux";
import { formatMontoMXN, labelMetodoPago } from "@/lib/clienteDatosCobro";

function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function estadoCapturaLabel(
  estado: ExpedienteClienteDatosEstado,
  submittedToMesa = false,
): string {
  if (estado === "completo") {
    return submittedToMesa ? "Corregido, pendiente de revisión" : "Completo";
  }
  if (estado === "validado") return "Validado";
  if (estado === "rechazado") return "Rechazado";
  return "Pendiente";
}

function estadoBadgeClass(estado: ExpedienteClienteDatosEstado): string {
  if (estado === "validado") return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  if (estado === "rechazado") return "bg-red-50 text-red-900 ring-red-200";
  if (estado === "completo") return "bg-sky-50 text-sky-900 ring-sky-200";
  return "bg-amber-50 text-amber-950 ring-amber-200";
}

function formatDireccionEmpresa(
  direccion: ExpedienteClienteDatos["datos"]["direccionEmpresa"],
): string {
  const parts = [
    direccion.calle,
    direccion.colonia,
    direccion.municipio,
    direccion.cp ? `CP ${direccion.cp}` : "",
  ]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function DataCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

type Props = {
  clienteDatos: ExpedienteClienteDatos;
  direccionOpcional?: string | null;
  submittedToMesa?: boolean;
  formatDateTime: (iso: string) => string;
  puedeRevisar: boolean;
  saving: boolean;
  revisionError: string | null;
  onValidar: () => Promise<boolean>;
  onRechazar: (comentario: string) => Promise<boolean>;
  embedded?: boolean;
};

export function MesaClienteDatosReadOnlySection({
  clienteDatos,
  direccionOpcional,
  submittedToMesa = true,
  formatDateTime,
  puedeRevisar,
  saving,
  revisionError,
  onValidar,
  onRechazar,
  embedded = false,
}: Props) {
  const { datos } = clienteDatos;
  const imagenes = clienteDatos.imagenes ?? [];

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectMotivo, setRejectMotivo] = useState("");
  const [rejectTexto, setRejectTexto] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  const closeRejectModal = useCallback(() => {
    setShowRejectModal(false);
    setRejectMotivo("");
    setRejectTexto("");
    setRejectError(null);
  }, []);

  const openRejectModal = useCallback(() => {
    setRejectMotivo("");
    setRejectTexto(clienteDatos.comentarioRechazo ?? "");
    setRejectError(null);
    setShowRejectModal(true);
  }, [clienteDatos.comentarioRechazo]);

  const comentarioRechazoFinal = buildComentarioRechazoClienteDatos(rejectMotivo, rejectTexto);

  return (
    <>
      <div
        className={
          embedded
            ? "bg-white"
            : "overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50 to-white shadow-sm"
        }
      >
        <div className={embedded ? "px-4 py-3" : "border-b border-gray-200 bg-white px-4 py-4"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {embedded ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900">
                    Datos generales del cliente
                  </h2>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${estadoBadgeClass(clienteDatos.estado)}`}
                  >
                    {estadoCapturaLabel(clienteDatos.estado, submittedToMesa)}
                  </span>
                </div>
              )}
              <p className={`text-xs text-gray-500 ${embedded ? "" : "mt-1"}`}>
                Revisión de captura del asesor · actualizado{" "}
                {formatDateTime(clienteDatos.updatedAt)}
                {clienteDatos.updatedBy ? ` · ${clienteDatos.updatedBy}` : ""}
              </p>
            </div>
            {puedeRevisar ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-emerald-200 px-3 py-1 text-xs text-emerald-900"
                  disabled={saving || clienteDatos.estado === "validado"}
                  onClick={() => void onValidar()}
                >
                  {saving ? "Guardando…" : "Validar datos"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-200 px-3 py-1 text-xs text-red-800"
                  disabled={saving}
                  onClick={openRejectModal}
                >
                  {MESA_SOLICITAR_CORRECCION_LABEL}
                </Button>
              </div>
            ) : null}
          </div>

          {clienteDatos.estado === "rechazado" ? (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-950"
            >
              <p className="font-semibold">Motivo de rechazo</p>
              <p className="mt-1">{displayValue(clienteDatos.comentarioRechazo)}</p>
              <p className="mt-1 text-xs text-red-800/90">
                {clienteDatos.rejectedAt
                  ? `Rechazado: ${formatDateTime(clienteDatos.rejectedAt)}`
                  : null}
                {clienteDatos.rejectedBy ? ` · Por: ${clienteDatos.rejectedBy}` : null}
              </p>
            </div>
          ) : null}

          {clienteDatos.estado === "validado" ? (
            <div
              role="status"
              className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
            >
              Datos validados por Mesa
              {clienteDatos.validatedAt
                ? ` · ${formatDateTime(clienteDatos.validatedAt)}`
                : null}
              {clienteDatos.validatedBy ? ` · ${clienteDatos.validatedBy}` : null}
            </div>
          ) : null}

          {revisionError ? (
            <p role="alert" className="mt-3 text-xs text-red-700">
              {revisionError}
            </p>
          ) : null}
        </div>

        <div className={embedded ? "space-y-3 px-4 pb-4" : "space-y-3 p-4"}>
          <DataCard title="Identificación">
            <DataField label="Nombre completo" value={displayValue(datos.nombreCliente)} />
            <DataField label="NSS" value={displayValue(datos.nss)} />
            <DataField label="CURP" value={displayValue(datos.curp)} />
            <DataField label="RFC (opcional)" value={displayValue(datos.rfc)} />
          </DataCard>

          <DataCard title="Contacto">
            <DataField label="Celular" value={displayValue(datos.celular)} />
            <DataField
              label="Teléfono normalizado"
              value={displayValue(clienteDatos.telefonoNormalizado ?? datos.celular)}
            />
            <DataField label="Correo" value={displayValue(datos.correo)} />
          </DataCard>

          <DataCard title="Información de cobro">
            <DataField
              label="Porcentaje de cobro"
              value={
                clienteDatos.porcentajeCobro != null
                  ? `${clienteDatos.porcentajeCobro}%`
                  : displayValue(datos.porcentajeCobro)
              }
            />
            <DataField
              label="Monto calculado"
              value={formatMontoMXN(clienteDatos.montoCalculado)}
            />
            <DataField
              label="Método de pago"
              value={labelMetodoPago(clienteDatos.metodoPago ?? datos.metodoPago)}
            />
          </DataCard>

          <DataCard title="Empresa / laboral">
            <DataField label="Empresa" value={displayValue(datos.empresa)} />
            <DataField label="Registro patronal" value={displayValue(datos.registroPatronal)} />
            <DataField label="Teléfono empresa" value={displayValue(datos.telefonoEmpresa)} />
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Dirección empresa
              </dt>
              <dd className="mt-0.5 text-sm text-gray-900">
                {formatDireccionEmpresa(datos.direccionEmpresa)}
              </dd>
            </div>
          </DataCard>

          <DataCard title="Domicilio">
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Dirección del expediente
              </dt>
              <dd className="mt-0.5 text-sm text-gray-900">{displayValue(direccionOpcional)}</dd>
            </div>
          </DataCard>

          <DataCard title="Beneficiario">
            <DataField label="Nombre" value={displayValue(datos.beneficiario.nombre)} />
            <DataField label="Parentesco" value={displayValue(datos.beneficiario.parentesco)} />
          </DataCard>

          <DataCard title="Referencias">
            {datos.referencias.map((ref, idx) => (
              <div key={idx} className="sm:col-span-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-gray-600">Referencia {idx + 1}</p>
                <p className="mt-1 text-sm text-gray-900">
                  {displayValue(ref.nombre)}
                  <span className="text-gray-500"> · </span>
                  {displayValue(ref.celular)}
                </p>
              </div>
            ))}
          </DataCard>

          <DataCard title="Evidencias / imágenes">
            {imagenes.length > 0 ? (
              <ul className="sm:col-span-2 divide-y divide-gray-100 rounded-md border border-gray-100">
                {imagenes.map((img, idx) => (
                  <li key={`${img.tipo ?? "ev"}-${idx}`} className="px-3 py-2 text-sm">
                    <p className="font-medium text-gray-900">
                      {displayValue(img.tipo ?? `Evidencia ${idx + 1}`)}
                    </p>
                    <p className="text-xs text-gray-600">
                      {displayValue(img.filename)} · {displayValue(img.mime_type)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sm:col-span-2 text-sm text-gray-600">—</p>
            )}
          </DataCard>

          <DataCard title="Estado de revisión">
            <DataField
              label="Estado captura"
              value={estadoCapturaLabel(clienteDatos.estado, submittedToMesa)}
            />
            <DataField label="Última actualización" value={formatDateTime(clienteDatos.updatedAt)} />
            <DataField
              label="Validado"
              value={
                clienteDatos.validatedAt
                  ? `${formatDateTime(clienteDatos.validatedAt)}${clienteDatos.validatedBy ? ` · ${clienteDatos.validatedBy}` : ""}`
                  : "—"
              }
            />
            <DataField
              label="Rechazado"
              value={
                clienteDatos.rejectedAt
                  ? `${formatDateTime(clienteDatos.rejectedAt)}${clienteDatos.rejectedBy ? ` · ${clienteDatos.rejectedBy}` : ""}`
                  : "—"
              }
            />
          </DataCard>
        </div>
      </div>

      {showRejectModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={closeRejectModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Solicitar corrección de datos generales"
            className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900">Solicitar corrección de datos</h3>
            <p className="mt-1 text-xs text-gray-500">
              El asesor verá este motivo para corregir solo los datos generales.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {MESA_CLIENTE_DATOS_RECHAZO_MOTIVOS.map((motivo) => (
                <button
                  key={motivo}
                  type="button"
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    rejectMotivo === motivo
                      ? "border-red-400 bg-red-50 text-red-900"
                      : "border-gray-200 bg-white text-gray-700"
                  }`}
                  onClick={() => {
                    setRejectMotivo(motivo);
                    if (!isClienteDatosMotivoOtro(motivo)) {
                      setRejectTexto(motivo);
                    } else {
                      setRejectTexto("");
                    }
                    setRejectError(null);
                  }}
                >
                  {motivo}
                </button>
              ))}
            </div>
            {isClienteDatosMotivoOtro(rejectMotivo) || rejectMotivo === "" ? (
              <textarea
                className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                rows={3}
                placeholder="Describe el motivo de rechazo…"
                value={rejectTexto}
                onChange={(e) => {
                  setRejectTexto(e.target.value);
                  setRejectError(null);
                }}
              />
            ) : null}
            {rejectError ? (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {rejectError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" className="text-xs" onClick={closeRejectModal}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                className="text-xs"
                disabled={saving || !comentarioRechazoFinal}
                onClick={() => {
                  if (!comentarioRechazoFinal) {
                    setRejectError("Selecciona un motivo o escribe el detalle.");
                    return;
                  }
                  void onRechazar(comentarioRechazoFinal).then((ok) => {
                    if (ok) closeRejectModal();
                  });
                }}
              >
                {saving ? "Guardando…" : "Confirmar rechazo"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
