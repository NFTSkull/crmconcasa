"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";

type ClienteDatosFormState = ExpedienteClienteDatos["datos"];

type ClienteDatosMeta = {
  estado: ExpedienteClienteDatos["estado"];
  comentarioRechazo?: string;
  validatedAt?: string;
  validatedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  updatedAt: string;
  updatedBy: string;
};

interface ExpedienteClienteDatosFormSectionProps {
  clienteDatos: ClienteDatosFormState;
  setClienteDatos: Dispatch<SetStateAction<ClienteDatosFormState>>;
  clienteDatosMeta: ClienteDatosMeta | null;
  clienteDatosSaving: boolean;
  clienteDatosLoading?: boolean;
  clienteDatosSaved?: boolean;
  clienteDatosError: string | null;
  camposFaltantes: string[];
  puedeIntegrar: boolean;
  submittedToMesa?: boolean;
  dataSupabase: boolean;
  formatDateTime: (iso: string) => string;
  onSave: () => Promise<{ ok: boolean; message?: string }>;
  esperaMontoMessage: string;
}

export function ExpedienteClienteDatosFormSection({
  clienteDatos,
  setClienteDatos,
  clienteDatosMeta,
  clienteDatosSaving,
  clienteDatosLoading = false,
  clienteDatosSaved = false,
  clienteDatosError,
  camposFaltantes,
  puedeIntegrar,
  submittedToMesa = false,
  dataSupabase,
  formatDateTime,
  onSave,
  esperaMontoMessage,
}: ExpedienteClienteDatosFormSectionProps) {
  const esCorreccionDatos =
    submittedToMesa && clienteDatosMeta?.estado === "rechazado";
  const puedeEditar =
    puedeIntegrar &&
    (!submittedToMesa || clienteDatosMeta?.estado === "rechazado");
  const saveLabel = esCorreccionDatos
    ? "Guardar corrección"
    : dataSupabase
      ? "Guardar datos"
      : "Guardar borrador";

  const statusLine = (() => {
    if (dataSupabase && clienteDatosLoading) return "Cargando datos del cliente…";
    if (clienteDatosSaving) return "Guardando datos del cliente…";
    if (dataSupabase && clienteDatosSaved) return "Datos guardados en Supabase.";
    if (clienteDatosMeta) {
      return `Estado: ${clienteDatosMeta.estado} · Actualizado: ${formatDateTime(
        clienteDatosMeta.updatedAt,
      )} · Por: ${clienteDatosMeta.updatedBy}`;
    }
    return dataSupabase
      ? "Aún no guardado en Supabase."
      : "Aún no guardado en expediente.";
  })();

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <fieldset
        disabled={!puedeEditar || clienteDatosLoading}
        className="min-w-0 border-0 p-0 disabled:opacity-70"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Datos Generales del Cliente
            </p>
            <p className="mt-1 text-xs text-gray-500">{statusLine}</p>
            {dataSupabase && camposFaltantes.length > 0 ? (
              <p className="mt-1 text-xs text-amber-800" role="status">
                Incompleto: faltan {camposFaltantes.length} campo(s) obligatorio(s).
              </p>
            ) : null}
            {!dataSupabase ? (
              <p className="mt-1 text-xs text-gray-400">
                Al enviar a mesa se guardan automáticamente si el formulario está
                completo.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            disabled={!puedeEditar || clienteDatosSaving || clienteDatosLoading}
            onClick={async () => {
              const r = await onSave();
              if (!r.ok && r.message && r.message !== esperaMontoMessage) {
                window.alert(r.message);
              }
            }}
          >
            {clienteDatosSaving ? "Guardando..." : saveLabel}
          </Button>
        </div>

        {clienteDatosError ? (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            {clienteDatosError}
          </p>
        ) : null}

        {clienteDatosMeta?.estado === "rechazado" ? (
          <p
            className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900"
            role="alert"
          >
            Los datos fueron rechazados por Mesa. Corrige la información y guarda la corrección.{" "}
            {clienteDatosMeta.comentarioRechazo?.trim() ? (
              <span className="block pt-1 font-medium text-red-950">
                Motivo: {clienteDatosMeta.comentarioRechazo}
              </span>
            ) : null}
            <span className="text-red-800/90">
              (Actualizado: {formatDateTime(clienteDatosMeta.updatedAt)} · Por:{" "}
              {clienteDatosMeta.updatedBy})
            </span>
          </p>
        ) : null}
        {submittedToMesa && clienteDatosMeta?.estado === "completo" ? (
          <p className="mt-2 rounded-md border border-sky-100 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
            Datos guardados — pendiente de revisión por Mesa de control.
          </p>
        ) : null}
        {clienteDatosMeta?.estado === "validado" ? (
          <p
            className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-900"
            role="status"
          >
            Mesa-control validó tus datos generales.{" "}
            <span className="text-green-800/90">
              {clienteDatosMeta.validatedAt
                ? `(Validado: ${formatDateTime(clienteDatosMeta.validatedAt)}`
                : "(Validado"}
              {clienteDatosMeta.validatedBy
                ? ` · Por: ${clienteDatosMeta.validatedBy})`
                : ")"}
            </span>
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">Nombre del cliente</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.nombreCliente}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, nombreCliente: e.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">NSS</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.nss}
              onChange={(e) => setClienteDatos((p) => ({ ...p, nss: e.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">CURP</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.curp}
              onChange={(e) => setClienteDatos((p) => ({ ...p, curp: e.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">RFC</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm uppercase"
              value={clienteDatos.rfc}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, rfc: e.target.value.toUpperCase() }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">Celular</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.celular}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, celular: e.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">Correo</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.correo}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, correo: e.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">Empresa</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.empresa}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, empresa: e.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">Registro patronal</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.registroPatronal}
              onChange={(e) =>
                setClienteDatos((p) => ({
                  ...p,
                  registroPatronal: e.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-gray-600">
            <span className="font-medium text-gray-800">Teléfono empresa</span>
            <input
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={clienteDatos.telefonoEmpresa}
              onChange={(e) =>
                setClienteDatos((p) => ({
                  ...p,
                  telefonoEmpresa: e.target.value,
                }))
              }
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-900">Referencias</p>
            {[0, 1].map((idx) => (
              <div key={idx} className="mt-2 grid grid-cols-1 gap-2">
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Nombre (ref {idx + 1})</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.referencias[idx]?.nombre ?? ""}
                    onChange={(e) =>
                      setClienteDatos((p) => {
                        const nextRefs = [...p.referencias];
                        nextRefs[idx] = { ...nextRefs[idx], nombre: e.target.value };
                        return { ...p, referencias: nextRefs };
                      })
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Celular (ref {idx + 1})</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.referencias[idx]?.celular ?? ""}
                    onChange={(e) =>
                      setClienteDatos((p) => {
                        const nextRefs = [...p.referencias];
                        nextRefs[idx] = { ...nextRefs[idx], celular: e.target.value };
                        return { ...p, referencias: nextRefs };
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-900">Beneficiario</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <label className="grid gap-1 text-xs text-gray-600">
                <span className="font-medium text-gray-800">Nombre</span>
                <input
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  value={clienteDatos.beneficiario.nombre}
                  onChange={(e) =>
                    setClienteDatos((p) => ({
                      ...p,
                      beneficiario: { ...p.beneficiario, nombre: e.target.value },
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-gray-600">
                <span className="font-medium text-gray-800">Parentesco</span>
                <input
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  value={clienteDatos.beneficiario.parentesco}
                  onChange={(e) =>
                    setClienteDatos((p) => ({
                      ...p,
                      beneficiario: { ...p.beneficiario, parentesco: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-900">Dirección de la empresa</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-gray-600 sm:col-span-2">
              <span className="font-medium text-gray-800">Calle</span>
              <input
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={clienteDatos.direccionEmpresa.calle}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, calle: e.target.value },
                  }))
                }
              />
            </label>
            <label className="grid gap-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">Colonia</span>
              <input
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={clienteDatos.direccionEmpresa.colonia}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, colonia: e.target.value },
                  }))
                }
              />
            </label>
            <label className="grid gap-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">Municipio</span>
              <input
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={clienteDatos.direccionEmpresa.municipio}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, municipio: e.target.value },
                  }))
                }
              />
            </label>
            <label className="grid gap-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">CP</span>
              <input
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={clienteDatos.direccionEmpresa.cp}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, cp: e.target.value },
                  }))
                }
              />
            </label>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
