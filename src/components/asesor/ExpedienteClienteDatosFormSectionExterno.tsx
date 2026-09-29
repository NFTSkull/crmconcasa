"use client";

import type { ComponentProps } from "react";
import { ExpedienteClienteDatosFormSection as BaseExpedienteClienteDatosFormSection } from "./ExpedienteClienteDatosFormSection";
import { asesorPuedeEditarClienteDatos } from "@/domain/expediente-archivos/asesor-correccion-post-mesa";

type BaseProps = ComponentProps<typeof BaseExpedienteClienteDatosFormSection>;
type Props = BaseProps & {
  /**
   * Anette: permite corregir los tres datos provenientes de Infonavit.
   * El guardado usa el mismo cliente_datos; una re-precalificación fresca
   * puede volver a actualizarlos desde editor_decisions.
   */
  allowPrecalInfonavitEdit?: boolean;
};

function displayValue(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized || "—";
}

export function ExpedienteClienteDatosFormSection({
  allowPrecalInfonavitEdit = false,
  ...props
}: Props) {
  const esVistaExterna =
    props.capturaVariant === "simplificado" || props.showTelefonoCasa === false;

  const puedeEditar =
    allowPrecalInfonavitEdit &&
    asesorPuedeEditarClienteDatos(
      props.submittedToMesa ?? false,
      props.clienteDatosMeta?.estado ?? "pendiente",
      {
        puedeIntegrar: props.puedeIntegrar,
        esReingresoActivo: props.esReingresoActivo ?? false,
      },
    ) &&
    !props.clienteDatosLoading;

  const update = (
    field: "rfc" | "registroPatronal" | "empresa",
    value: string,
  ) => {
    props.setClienteDatos((prev) => ({
      ...prev,
      [field]:
        field === "rfc"
          ? value.toUpperCase().replace(/\s+/g, "")
          : value,
    }));
  };

  return (
    <>
      {esVistaExterna ? (
        <section
          className="mb-4 rounded-lg border border-sky-200 bg-sky-50/70 p-4"
          data-testid="asesor-precal-infonavit-externos"
          aria-label="Datos de precalificación Infonavit"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-sky-950">
                Datos de precalificación Infonavit
              </p>
              <p className="mt-1 text-xs text-sky-900/80">
                Información obtenida automáticamente al precalificar.
                {allowPrecalInfonavitEdit
                  ? " Puedes corregirla manualmente; si vuelves a precalificar y Infonavit devuelve valores nuevos, se actualizarán con la información más reciente."
                  : " Si Infonavit no devuelve algún dato, se muestra —."}
              </p>
            </div>
            <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800">
              {allowPrecalInfonavitEdit ? "Editable" : "Solo lectura"}
            </span>
          </div>

          {allowPrecalInfonavitEdit ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  RFC
                </span>
                <input
                  data-testid="asesor-precal-infonavit-rfc-input"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold uppercase text-slate-900 disabled:bg-slate-100"
                  value={props.clienteDatos.rfc}
                  disabled={!puedeEditar || props.clienteDatosSaving}
                  onChange={(e) => update("rfc", e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Registro patronal
                </span>
                <input
                  data-testid="asesor-precal-infonavit-registro-patronal-input"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-900 disabled:bg-slate-100"
                  value={props.clienteDatos.registroPatronal}
                  disabled={!puedeEditar || props.clienteDatosSaving}
                  onChange={(e) => update("registroPatronal", e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Empresa
                </span>
                <input
                  data-testid="asesor-precal-infonavit-empresa-input"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-900 disabled:bg-slate-100"
                  value={props.clienteDatos.empresa}
                  disabled={!puedeEditar || props.clienteDatosSaving}
                  onChange={(e) => update("empresa", e.target.value)}
                  autoComplete="organization"
                />
              </label>
            </div>
          ) : (
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  RFC
                </dt>
                <dd
                  className="mt-1 break-words text-sm font-semibold text-slate-900"
                  data-testid="asesor-precal-infonavit-rfc"
                >
                  {displayValue(props.clienteDatos.rfc)}
                </dd>
              </div>
              <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Registro patronal
                </dt>
                <dd
                  className="mt-1 break-words text-sm font-semibold text-slate-900"
                  data-testid="asesor-precal-infonavit-registro-patronal"
                >
                  {displayValue(props.clienteDatos.registroPatronal)}
                </dd>
              </div>
              <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Empresa
                </dt>
                <dd
                  className="mt-1 break-words text-sm font-semibold text-slate-900"
                  data-testid="asesor-precal-infonavit-empresa"
                >
                  {displayValue(props.clienteDatos.empresa)}
                </dd>
              </div>
            </dl>
          )}
        </section>
      ) : null}

      <BaseExpedienteClienteDatosFormSection {...props} />
    </>
  );
}
