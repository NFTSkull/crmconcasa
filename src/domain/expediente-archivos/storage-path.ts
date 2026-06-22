import type { IntegrationDocAsesorEnvioTipo } from "./integration-docs-completos";

export type BuildExpedienteDocumentoStoragePathInput = {
  organizationId: string;
  expedienteId: string;
  tipoDocumento: IntegrationDocAsesorEnvioTipo | string;
  originalFileName: string;
};

/** Sanitiza nombre de archivo para segmento final del path Storage. */
export function sanitizeExpedienteDocumentoFileName(originalFileName: string): string {
  const trimmed = String(originalFileName ?? "").trim();
  const noSlashes = trimmed.replace(/[/\\]+/g, "_");
  const noLeadingDots = noSlashes.replace(/^\.+/, "");
  const cleaned = noLeadingDots
    .replace(/[^\w.\-() áéíóúÁÉÍÓÚñÑ]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 120);
  if (!cleaned || /^_+$/.test(cleaned)) {
    return "archivo";
  }
  return cleaned;
}

/**
 * Path Storage: `{organization_id}/{expediente_id}/{tipo_documento}/{uuid}-{safeFileName}`
 * La versión DB se asigna en RPC; UUID evita colisiones sin leer versión en cliente.
 */
export function buildExpedienteDocumentoStoragePath(
  input: BuildExpedienteDocumentoStoragePathInput,
): string {
  const org = String(input.organizationId).trim();
  const exp = String(input.expedienteId).trim();
  const tipo = String(input.tipoDocumento).trim();
  if (!org || !exp || !tipo) {
    throw new Error("buildExpedienteDocumentoStoragePath: faltan organizationId, expedienteId o tipo");
  }
  const safeName = sanitizeExpedienteDocumentoFileName(input.originalFileName);
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tmp-${Date.now()}`;
  return `${org}/${exp}/${tipo}/${uuid}-${safeName}`;
}
