"use client";

import {
  AsesorCurpValidacionSection as AsesorCurpValidacionSectionCore,
  type AsesorCurpValidacionSectionProps,
} from "./AsesorCurpValidacionSectionCore";
import { AsesorTelefonoCasaSection } from "./AsesorTelefonoCasaSection";

export type { AsesorCurpValidacionSectionProps } from "./AsesorCurpValidacionSectionCore";

/**
 * Datos Generales: mantiene la validación CURP existente intacta y agrega la edición
 * explícita del teléfono de casa (`expedientes.telefono_casa`).
 */
export function AsesorCurpValidacionSection(
  props: AsesorCurpValidacionSectionProps,
) {
  return (
    <>
      <AsesorTelefonoCasaSection
        expedienteId={props.expedienteId}
        canEdit={props.canEdit}
      />
      <AsesorCurpValidacionSectionCore {...props} />
    </>
  );
}
