"use client";

import {
  AsesorCurpValidacionSection as AsesorCurpValidacionSectionCore,
  type AsesorCurpValidacionSectionProps,
} from "./AsesorCurpValidacionSectionCore";
import { AsesorTelefonoCasaSection } from "./AsesorTelefonoCasaSection";

export type { AsesorCurpValidacionSectionProps } from "./AsesorCurpValidacionSectionCore";

/**
 * Datos Generales: mantiene la validación CURP existente intacta y agrega la edición
 * explícita del teléfono de casa (`expedientes.telefono_casa`) solo cuando
 * `showTelefonoCasa` (internos resueltos).
 */
export function AsesorCurpValidacionSection(
  props: AsesorCurpValidacionSectionProps,
) {
  const {
    showTelefonoCasa = false,
    telefonoCasaFieldError,
    onTelefonoCasaChange,
    ...curpProps
  } = props;
  return (
    <>
      {showTelefonoCasa ? (
        <AsesorTelefonoCasaSection
          expedienteId={props.expedienteId}
          canEdit={props.canEdit}
          fieldError={telefonoCasaFieldError}
          onTelefonoCasaChange={onTelefonoCasaChange}
        />
      ) : null}
      <AsesorCurpValidacionSectionCore {...curpProps} />
    </>
  );
}
