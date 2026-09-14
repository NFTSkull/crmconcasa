"use client";

import type { ComponentProps } from "react";
import { ExpedienteClienteDatosFormSection as ExpedienteClienteDatosFormSectionImpl } from "./ExpedienteClienteDatosFormSection.impl";

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
 */
export function ExpedienteClienteDatosFormSection(props: Props) {
  const capturaVariant = props.showTelefonoCasa
    ? "completo"
    : props.capturaVariant;

  return (
    <ExpedienteClienteDatosFormSectionImpl
      {...props}
      capturaVariant={capturaVariant}
    />
  );
}
