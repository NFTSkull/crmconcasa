"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";
import type { ClienteDatosFieldErrors, ClienteDatosFieldKey } from "@/lib/clienteDatosValidation";
import {
  CLIENTE_METODO_PAGO_OPTIONS,
  isProgramaMejoravitDb,
  parsePorcentajeCobroInput,
} from "@/lib/clienteDatosCobro";
import { CLIENTE_DATOS_NOTA_MESA_MAX_LENGTH } from "@/lib/clienteDatosFormCompleteness";
import {
  asesorEsCorreccionRechazoClienteDatos,
  asesorPuedeEditarClienteDatos,
} from "@/domain/expediente-archivos/asesor-correccion-post-mesa";

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
  direccionOpcional: string;
  setDireccionOpcional: Dispatch<SetStateAction<string>>;
  clienteDatosMeta: ClienteDatosMeta | null;
  clienteDatosSaving: boolean;
  clienteDatosLoading?: boolean;
  clienteDatosSaved?: boolean;
  clienteDatosError: string | null;
  localDraftSaved?: boolean;
  localDraftRestored?: boolean;
  hasUnsavedLocalChanges?: boolean;
  camposFaltantes: string[];
  fieldErrors?: ClienteDatosFieldErrors;
  showFieldErrors?: boolean;
  puedeIntegrar: boolean;
  submittedToMesa?: boolean;
  dataSupabase: boolean;
  formatDateTime: (iso: string) => string;
  onSave: () => Promise<{ ok: boolean; message?: string }>;
  esperaMontoMessage: string;
  montoAprobado?: number | null;
  programaDb?: string | null;
  onMontoMejoravitEdited?: () => void;
  onMontoCalculadoEdited?: () => void;
}

function fieldInputClass(hasError: boolean): string {
  return hasError
    ? "rounded-md border border-red-400 bg-red-50/40 px-2 py-1 text-sm ring-1 ring-red-200"
    : "rounded-md border border-gray-300 px-2 py-1 text-sm";
}

function DatosField({
  label,
  fieldKey,
  error,
  showError,
  children,
}: {
  label: string;
  fieldKey: ClienteDatosFieldKey;
  error?: string;
  showError?: boolean;
  children: ReactNode;
}) {
  const visible = showError && Boolean(error);
  return (
    <label className="grid gap-1 text-xs text-gray-600" data-field={fieldKey}>
      <span className="font-medium text-gray-800">{label}</span>
      {children}
      {visible ? (
        <span className="text-[11px] text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function ExpedienteClienteDatosFormSection({
  clienteDatos,
  setClienteDatos,
  direccionOpcional,
  setDireccionOpcional,
  clienteDatosMeta,
  clienteDatosSaving,
  clienteDatosLoading = false,
  clienteDatosSaved = false,
  clienteDatosError,
  localDraftSaved = false,
  localDraftRestored = false,
  hasUnsavedLocalChanges = false,
  camposFaltantes,
  fieldErrors = {},
  showFieldErrors = false,
  puedeIntegrar,
  submittedToMesa = false,
  dataSupabase,
  formatDateTime,
  onSave,
  esperaMontoMessage,
  montoAprobado = null,
  programaDb = null,
  onMontoMejoravitEdited,
  onMontoCalculadoEdited,
}: ExpedienteClienteDatosFormSectionProps) {
  const esMejoravit = isProgramaMejoravitDb(programaDb);
  const esCorreccionRechazo = asesorEsCorreccionRechazoClienteDatos(
    submittedToMesa,
    clienteDatosMeta?.estado ?? "pendiente",
  );
  const puedeEditar =
    puedeIntegrar &&
    asesorPuedeEditarClienteDatos(
      submittedToMesa,
      clienteDatosMeta?.estado ?? "pendiente",
    );
  const saveLabel = esCorreccionRechazo
    ? "Guardar corrección"
    : submittedToMesa && clienteDatosMeta
      ? "Guardar cambios"
      : dataSupabase
        ? "Guardar datos"
        : "Guardar borrador";

  const err = (key: ClienteDatosFieldKey) =>
    showFieldErrors ? fieldErrors[key] : undefined;

  const validationPreview =
    showFieldErrors && Object.keys(fieldErrors).length > 0
      ? Object.values(fieldErrors).slice(0, 5)
      : [];

  const porcentajeNum = parsePorcentajeCobroInput(clienteDatos.porcentajeCobro);
  const montoCalculadoError = err("montoCalculado");

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
            {localDraftRestored ? (
              <p
                className="mt-1 text-xs text-sky-800"
                role="status"
              >
                Se recuperó un borrador local. Recuerda presionar Guardar para
                enviarlo al sistema.
              </p>
            ) : null}
            {localDraftSaved || hasUnsavedLocalChanges ? (
              <p className="mt-1 text-xs text-gray-500" role="status">
                {localDraftSaved ? "Borrador local guardado" : null}
                {localDraftSaved && hasUnsavedLocalChanges ? " · " : null}
                {hasUnsavedLocalChanges ? "Tienes cambios sin guardar" : null}
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

        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          <p>
            Captura información real y verificable. No repitas números telefónicos entre
            cliente, empresa y referencias. Los datos incompletos, falsos o repetidos pueden
            causar rechazo del expediente.
          </p>
          <p className="mt-2 font-medium text-slate-700">Antes de guardar verifica:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>NSS y CURP deben corresponder al cliente. RFC es opcional.</li>
            <li>Los teléfonos deben ser únicos y de 10 dígitos.</li>
            <li>Las referencias deben tener números diferentes al celular del cliente.</li>
            <li>La dirección de empresa debe ser real y completa.</li>
          </ul>
        </div>

        {validationPreview.length > 0 ? (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
            role="status"
          >
            <p className="font-medium">Revisa los siguientes campos:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {validationPreview.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        ) : null}

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
        {submittedToMesa && puedeIntegrar ? (
          <p
            className="mt-2 rounded-md border border-sky-100 bg-sky-50 px-2 py-1.5 text-xs text-sky-900"
            role="status"
          >
            Este expediente ya fue enviado a Mesa. Si haces cambios, Mesa Control verá la
            información actualizada.
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
          <DatosField label="Nombre del cliente" fieldKey="nombreCliente" error={err("nombreCliente")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("nombreCliente")))}
              value={clienteDatos.nombreCliente}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, nombreCliente: e.target.value }))
              }
            />
          </DatosField>
          <DatosField label="NSS" fieldKey="nss" error={err("nss")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("nss")))}
              value={clienteDatos.nss}
              onChange={(e) => setClienteDatos((p) => ({ ...p, nss: e.target.value }))}
            />
          </DatosField>
          <DatosField label="CURP" fieldKey="curp" error={err("curp")} showError={showFieldErrors}>
            <input
              className={`${fieldInputClass(Boolean(err("curp")))} uppercase`}
              value={clienteDatos.curp}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, curp: e.target.value.toUpperCase() }))
              }
            />
          </DatosField>
          <DatosField label="RFC (opcional)" fieldKey="rfc" error={err("rfc")} showError={showFieldErrors}>
            <input
              className={`${fieldInputClass(Boolean(err("rfc")))} uppercase`}
              value={clienteDatos.rfc}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, rfc: e.target.value.toUpperCase() }))
              }
            />
          </DatosField>
          <DatosField label="Celular" fieldKey="celular" error={err("celular")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("celular")))}
              value={clienteDatos.celular}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, celular: e.target.value }))
              }
            />
          </DatosField>
          <DatosField label="Correo" fieldKey="correo" error={err("correo")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("correo")))}
              value={clienteDatos.correo}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, correo: e.target.value }))
              }
            />
          </DatosField>
          <DatosField label="Empresa" fieldKey="empresa" error={err("empresa")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("empresa")))}
              value={clienteDatos.empresa}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, empresa: e.target.value }))
              }
            />
          </DatosField>
          <DatosField label="Registro patronal" fieldKey="registroPatronal" error={err("registroPatronal")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("registroPatronal")))}
              value={clienteDatos.registroPatronal}
              onChange={(e) =>
                setClienteDatos((p) => ({
                  ...p,
                  registroPatronal: e.target.value,
                }))
              }
            />
          </DatosField>
          <DatosField label="Teléfono empresa" fieldKey="telefonoEmpresa" error={err("telefonoEmpresa")} showError={showFieldErrors}>
            <input
              className={fieldInputClass(Boolean(err("telefonoEmpresa")))}
              value={clienteDatos.telefonoEmpresa}
              onChange={(e) =>
                setClienteDatos((p) => ({
                  ...p,
                  telefonoEmpresa: e.target.value,
                }))
              }
            />
          </DatosField>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-900">Referencias</p>
            {[0, 1].map((idx) => (
              <div key={idx} className="mt-2 grid grid-cols-1 gap-2">
                <DatosField
                  label={`Nombre (ref ${idx + 1})`}
                  fieldKey={idx === 0 ? "referencia1Nombre" : "referencia2Nombre"}
                  error={err(idx === 0 ? "referencia1Nombre" : "referencia2Nombre")}
                  showError={showFieldErrors}
                >
                  <input
                    className={fieldInputClass(
                      Boolean(err(idx === 0 ? "referencia1Nombre" : "referencia2Nombre")),
                    )}
                    value={clienteDatos.referencias[idx]?.nombre ?? ""}
                    onChange={(e) =>
                      setClienteDatos((p) => {
                        const nextRefs = [...p.referencias];
                        nextRefs[idx] = { ...nextRefs[idx], nombre: e.target.value };
                        return { ...p, referencias: nextRefs };
                      })
                    }
                  />
                </DatosField>
                <DatosField
                  label={`Celular (ref ${idx + 1})`}
                  fieldKey={idx === 0 ? "referencia1Celular" : "referencia2Celular"}
                  error={err(idx === 0 ? "referencia1Celular" : "referencia2Celular")}
                  showError={showFieldErrors}
                >
                  <input
                    className={fieldInputClass(
                      Boolean(err(idx === 0 ? "referencia1Celular" : "referencia2Celular")),
                    )}
                    value={clienteDatos.referencias[idx]?.celular ?? ""}
                    onChange={(e) =>
                      setClienteDatos((p) => {
                        const nextRefs = [...p.referencias];
                        nextRefs[idx] = { ...nextRefs[idx], celular: e.target.value };
                        return { ...p, referencias: nextRefs };
                      })
                    }
                  />
                </DatosField>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-900">Beneficiario</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <DatosField
                label="Nombre"
                fieldKey="beneficiarioNombre"
                error={err("beneficiarioNombre")}
                showError={showFieldErrors}
              >
                <input
                  className={fieldInputClass(Boolean(err("beneficiarioNombre")))}
                  value={clienteDatos.beneficiario.nombre}
                  onChange={(e) =>
                    setClienteDatos((p) => ({
                      ...p,
                      beneficiario: { ...p.beneficiario, nombre: e.target.value },
                    }))
                  }
                />
              </DatosField>
              <DatosField
                label="Parentesco"
                fieldKey="beneficiarioParentesco"
                error={err("beneficiarioParentesco")}
                showError={showFieldErrors}
              >
                <input
                  className={fieldInputClass(Boolean(err("beneficiarioParentesco")))}
                  value={clienteDatos.beneficiario.parentesco}
                  onChange={(e) =>
                    setClienteDatos((p) => ({
                      ...p,
                      beneficiario: { ...p.beneficiario, parentesco: e.target.value },
                    }))
                  }
                />
              </DatosField>
            </div>
          </div>
        </div>

        {esMejoravit ? (
        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-900">Crédito Mejoravit</p>
          <p className="mt-1 text-[11px] text-gray-600">
            Se sugiere desde la subcuenta de vivienda (−11%, tope $169,000). Puedes ajustarlo.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DatosField
              label="Monto Mejoravit"
              fieldKey="montoMejoravit"
              error={err("montoMejoravit")}
              showError={showFieldErrors}
            >
              <input
                type="text"
                inputMode="decimal"
                className={fieldInputClass(Boolean(err("montoMejoravit")))}
                value={clienteDatos.montoMejoravit}
                onChange={(e) => {
                  onMontoMejoravitEdited?.();
                  setClienteDatos((p) => ({ ...p, montoMejoravit: e.target.value }));
                }}
                placeholder="Ej. 169000"
              />
            </DatosField>
            <DatosField
              label="Plazo"
              fieldKey="plazo"
              error={err("plazo")}
              showError={showFieldErrors}
            >
              <input
                className={fieldInputClass(Boolean(err("plazo")))}
                value={clienteDatos.plazo}
                onChange={(e) => setClienteDatos((p) => ({ ...p, plazo: e.target.value }))}
                placeholder="Ej. 12 meses"
              />
            </DatosField>
          </div>
        </div>
        ) : null}

        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-900">Domicilio del cliente</p>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <DatosField
              label="Domicilio real del cliente (opcional)"
              fieldKey="direccionOpcional"
              error={err("direccionOpcional")}
              showError={showFieldErrors}
            >
              <input
                className={fieldInputClass(Boolean(err("direccionOpcional")))}
                value={direccionOpcional}
                onChange={(e) => setDireccionOpcional(e.target.value)}
                placeholder="Calle, número, colonia, municipio"
              />
            </DatosField>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-900">Dirección de la empresa</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DatosField
              label="Calle"
              fieldKey="direccionCalle"
              error={err("direccionCalle")}
              showError={showFieldErrors}
              >
              <input
                className={fieldInputClass(Boolean(err("direccionCalle")))}
                value={clienteDatos.direccionEmpresa.calle}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, calle: e.target.value },
                  }))
                }
              />
            </DatosField>
            <DatosField
              label="Colonia"
              fieldKey="direccionColonia"
              error={err("direccionColonia")}
              showError={showFieldErrors}
            >
              <input
                className={fieldInputClass(Boolean(err("direccionColonia")))}
                value={clienteDatos.direccionEmpresa.colonia}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, colonia: e.target.value },
                  }))
                }
              />
            </DatosField>
            <DatosField
              label="Municipio"
              fieldKey="direccionMunicipio"
              error={err("direccionMunicipio")}
              showError={showFieldErrors}
            >
              <input
                className={fieldInputClass(Boolean(err("direccionMunicipio")))}
                value={clienteDatos.direccionEmpresa.municipio}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, municipio: e.target.value },
                  }))
                }
              />
            </DatosField>
            <DatosField
              label="CP"
              fieldKey="direccionCp"
              error={err("direccionCp")}
              showError={showFieldErrors}
            >
              <input
                className={fieldInputClass(Boolean(err("direccionCp")))}
                value={clienteDatos.direccionEmpresa.cp}
                onChange={(e) =>
                  setClienteDatos((p) => ({
                    ...p,
                    direccionEmpresa: { ...p.direccionEmpresa, cp: e.target.value },
                  }))
                }
              />
            </DatosField>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-900">Información de cobro</p>
          <p className="mt-1 text-[11px] text-gray-600">
            Se calcula automáticamente con el porcentaje + $3,000, pero puedes ajustarlo si es
            necesario.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DatosField
              label="Porcentaje de cobro"
              fieldKey="porcentajeCobro"
              error={err("porcentajeCobro")}
              showError={showFieldErrors}
            >
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className={`${fieldInputClass(Boolean(err("porcentajeCobro")))} w-full`}
                  value={clienteDatos.porcentajeCobro}
                  onChange={(e) =>
                    setClienteDatos((p) => ({ ...p, porcentajeCobro: e.target.value }))
                  }
                />
                <span className="text-sm text-gray-600">%</span>
              </div>
            </DatosField>
            <DatosField
              label="Monto calculado"
              fieldKey="montoCalculado"
              error={montoCalculadoError}
              showError={showFieldErrors}
            >
              <input
                type="text"
                inputMode="decimal"
                className={fieldInputClass(Boolean(montoCalculadoError))}
                value={clienteDatos.montoCalculado}
                onChange={(e) => {
                  onMontoCalculadoEdited?.();
                  setClienteDatos((p) => ({ ...p, montoCalculado: e.target.value }));
                }}
                placeholder={
                  porcentajeNum != null && porcentajeNum > 0 ? "Ej. 18000" : "Captura porcentaje primero"
                }
              />
            </DatosField>
            <DatosField
              label="Método de pago"
              fieldKey="metodoPago"
              error={err("metodoPago")}
              showError={showFieldErrors}
            >
              <select
                className={fieldInputClass(Boolean(err("metodoPago")))}
                value={clienteDatos.metodoPago}
                onChange={(e) =>
                  setClienteDatos((p) => ({ ...p, metodoPago: e.target.value }))
                }
              >
                <option value="">Selecciona…</option>
                {CLIENTE_METODO_PAGO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </DatosField>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-900">Notas para Mesa Control</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Opcional · visible para Mesa al revisar el expediente</p>
          <label className="mt-2 grid gap-1 text-xs text-gray-600">
            <textarea
              className="min-h-[88px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              rows={4}
              maxLength={CLIENTE_DATOS_NOTA_MESA_MAX_LENGTH}
              placeholder="Escribe aquí cualquier observación importante para Mesa Control…"
              value={clienteDatos.notaMesa ?? ""}
              onChange={(e) =>
                setClienteDatos((p) => ({ ...p, notaMesa: e.target.value }))
              }
            />
            <span className="text-[11px] text-gray-400">
              {(clienteDatos.notaMesa ?? "").length}/{CLIENTE_DATOS_NOTA_MESA_MAX_LENGTH}
            </span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}
