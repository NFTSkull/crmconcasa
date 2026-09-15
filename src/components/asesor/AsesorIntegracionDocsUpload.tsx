"use client";

import type { ComponentProps } from "react";
import { AsesorIntegracionDocsUpload as AsesorIntegracionDocsUploadImpl } from "./AsesorIntegracionDocsUpload.impl";

type Props = ComponentProps<typeof AsesorIntegracionDocsUploadImpl>;

const SILVIA_SEMANAS_LEGACY_TIPO = "cliente_semanas_cotizadas";
const SILVIA_SEMANAS_O_VIGENCIA_TIPO = "cliente_semanas_o_vigencia_derechos";
const VIGENCIA_TIPO = "cliente_vigencia_derechos";

/**
 * Normaliza el checklist antes de renderizarlo.
 *
 * - Nunca muestra un mismo tipo simultáneamente como obligatorio y opcional.
 * - Si el obligatorio es el tipo combinado Silvia, oculta Semanas/Vigencia
 *   sueltos de opcionales (un solo slot).
 * - Legacy: el slot `cliente_semanas_cotizadas` se etiqueta como alternativa
 *   Semanas|Vigencia; la equivalencia de estatus vive en dominio/SQL.
 */
export function AsesorIntegracionDocsUpload(props: Props) {
  const obligatorios = props.checklistObligatorios.map((item) =>
    item.tipo_documento === SILVIA_SEMANAS_LEGACY_TIPO
      ? { ...item, label: "Semanas Cotizadas o Vigencia de Derechos" }
      : item,
  );
  const required = new Set(obligatorios.map((item) => item.tipo_documento));
  const hideSeparateSemanasVigencia = required.has(SILVIA_SEMANAS_O_VIGENCIA_TIPO);
  const opcionales = props.checklistOpcionales.filter((item) => {
    if (required.has(item.tipo_documento)) return false;
    if (
      hideSeparateSemanasVigencia &&
      (item.tipo_documento === SILVIA_SEMANAS_LEGACY_TIPO ||
        item.tipo_documento === VIGENCIA_TIPO)
    ) {
      return false;
    }
    return true;
  });

  return (
    <AsesorIntegracionDocsUploadImpl
      {...props}
      checklistObligatorios={obligatorios}
      checklistOpcionales={opcionales}
    />
  );
}
