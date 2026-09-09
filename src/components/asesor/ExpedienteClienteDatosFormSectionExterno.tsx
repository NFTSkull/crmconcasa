"use client";

import type { ComponentProps } from "react";
import { ExpedienteClienteDatosFormSection as BaseExpedienteClienteDatosFormSection } from "./ExpedienteClienteDatosFormSection";

type Props = ComponentProps<typeof BaseExpedienteClienteDatosFormSection>;

function displayValue(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized || "—";
}

/**
 * Adaptador de presentación para el detalle del asesor.
 *
 * Los datos RFC / Registro patronal / Empresa ya llegan desde la
 * auto-precalificación Infonavit a `clienteDatos` mediante
 * `applyClienteDatosInfonavitAutofill`. Para asesores externos los hacemos
 * visibles en solo lectura sin convertirlos en requisitos ni cambiar la
 * validación del perfil simplificado.
 */
export function ExpedienteClienteDatosFormSection(props: Props) {
  const esVistaExterna =
    props.capturaVariant === "simplificado" || props.showTelefonoCasa === false;

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
                Información obtenida automáticamente al precalificar. Si Infonavit no
                devuelve algún dato, se muestra —.
              </p>
            </div>
            <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800">
              Solo lectura
            </span>
          </div>

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
        </section>
      ) : null}

      <BaseExpedienteClienteDatosFormSection {...props} />
    </>
  );
}
