"use client";

import type { ComponentProps } from "react";
import { ExpedienteClienteDatosFormSection as ExpedienteClienteDatosFormSectionImpl } from "./ExpedienteClienteDatosFormSection.impl";
import { asesorPuedeEditarClienteDatos } from "@/domain/expediente-archivos/asesor-correccion-post-mesa";

type Props = ComponentProps<typeof ExpedienteClienteDatosFormSectionImpl>;

/**
 * Wrapper de selección de vista.
 *
 * La autoridad de completitud vive en el perfil del DUEÑO. Cuando ese perfil
 * exige teléfono de casa, la captura debe ser la completa aunque el actor siga
 * perteneciendo operativamente a un equipo externo (caso Silvia). Esto permite
 * conservar `origen_mesa=externo` sin esconder los campos de Datos Generales.
 *
 * Anette y otros externos simplificados conservan `showTelefonoCasa=false`, por
 * lo que su vista no cambia.
 *
 * Paquete nuevo Equipo Silvia: `mostrarClabe=true` significa CLABE obligatoria.
 * Se captura en un bloque bancario explícito, se suma a faltantes y no permite
 * guardar Datos Generales hasta tener exactamente 18 dígitos.
 */
export function ExpedienteClienteDatosFormSection(props: Props) {
  const capturaVariant = props.showTelefonoCasa
    ? "completo"
    : props.capturaVariant;

  const clabeObligatoria = Boolean(props.mostrarClabe);
  const clabeDigits = String(props.clienteDatos.clabe ?? "").replace(/\D/g, "");
  const clabeCompleta = /^\d{18}$/.test(clabeDigits);
  const clabeFaltante = clabeObligatoria && !clabeCompleta;
  const camposFaltantes = clabeFaltante
    ? Array.from(new Set([...props.camposFaltantes, "CLABE bancaria"]))
    : props.camposFaltantes;

  const puedeEditar = asesorPuedeEditarClienteDatos(
    props.submittedToMesa ?? false,
    props.clienteDatosMeta?.estado ?? "pendiente",
    {
      puedeIntegrar: props.puedeIntegrar,
      esReingresoActivo: props.esReingresoActivo ?? false,
    },
  );

  const onSave: Props["onSave"] = async () => {
    if (clabeObligatoria && !clabeCompleta) {
      return {
        ok: false,
        message: clabeDigits.length === 0
          ? "La CLABE bancaria es obligatoria para Silvia Reyes y su equipo. Captura los 18 dígitos."
          : "La CLABE bancaria debe tener exactamente 18 dígitos.",
      };
    }
    return props.onSave();
  };

  return (
    <>
      <ExpedienteClienteDatosFormSectionImpl
        {...props}
        capturaVariant={capturaVariant}
        camposFaltantes={camposFaltantes}
        onSave={onSave}
        mostrarClabe={false}
      />

      {clabeObligatoria ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-amber-950">
                Datos bancarios obligatorios
              </p>
              <p className="mt-1 text-xs text-amber-900">
                Para Silvia Reyes y su equipo, la CLABE es obligatoria en Datos Generales.
              </p>
            </div>
            <span className="rounded-full bg-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-950">
              OBLIGATORIO
            </span>
          </div>

          <label className="mt-3 grid gap-1 text-xs text-gray-700" data-field="clabe">
            <span className="font-medium text-gray-900">CLABE bancaria (18 dígitos)</span>
            <input
              value={clabeDigits}
              inputMode="numeric"
              autoComplete="off"
              maxLength={18}
              disabled={!puedeEditar || props.clienteDatosSaving || props.clienteDatosLoading}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 18);
                props.setClienteDatos((prev) => ({ ...prev, clabe: value }));
              }}
              className={
                clabeFaltante && clabeDigits.length > 0
                  ? "rounded-md border border-red-400 bg-red-50/40 px-2 py-2 text-sm ring-1 ring-red-200"
                  : "rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
              }
              placeholder="18 dígitos"
              aria-invalid={clabeFaltante}
            />
            {clabeFaltante ? (
              <span className="text-[11px] font-medium text-red-700" role="alert">
                {clabeDigits.length === 0
                  ? "CLABE obligatoria."
                  : `Faltan ${18 - clabeDigits.length} dígito(s).`}
              </span>
            ) : (
              <span className="text-[11px] text-emerald-700">CLABE completa.</span>
            )}
          </label>
        </div>
      ) : null}
    </>
  );
}
