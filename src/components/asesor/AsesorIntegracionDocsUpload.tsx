"use client";

import type { ComponentProps } from "react";
import { AsesorIntegracionDocsUpload as AsesorIntegracionDocsUploadImpl } from "./AsesorIntegracionDocsUpload.impl";

type Props = ComponentProps<typeof AsesorIntegracionDocsUploadImpl>;

const SILVIA_SEMANAS_TIPO = "cliente_semanas_cotizadas";

/**
 * Normaliza el checklist antes de renderizarlo.
 *
 * - Nunca muestra un mismo tipo simultáneamente como obligatorio y opcional.
 * - El slot obligatorio de semanas de Equipo Silvia se comunica como alternativa
 *   válida con Vigencia de derechos; la equivalencia de estatus se resuelve en
 *   el dominio/SQL, no aquí.
 *
 * Para los paquetes existentes no cambia la lista efectiva, porque hoy sus
 * obligatorios y opcionales no se solapan.
 */
export function AsesorIntegracionDocsUpload(props: Props) {
  const obligatorios = props.checklistObligatorios.map((item) =>
    item.tipo_documento === SILVIA_SEMANAS_TIPO
      ? { ...item, label: "Semanas cotizadas o Vigencia de derechos" }
      : item,
  );
  const required = new Set(obligatorios.map((item) => item.tipo_documento));
  const opcionales = props.checklistOpcionales.filter(
    (item) => !required.has(item.tipo_documento),
  );

  return (
    <AsesorIntegracionDocsUploadImpl
      {...props}
      checklistObligatorios={obligatorios}
      checklistOpcionales={opcionales}
    />
  );
}
