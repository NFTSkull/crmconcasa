import { z } from "zod";

export const FISCAL_REVISION_MANUAL_ESTADO = "RFC_VALIDACION_SAT_REVISION_MANUAL" as const;

export const AdminFiscalAprobarBodySchema = z.object({
  expedienteId: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "El motivo debe tener al menos 10 caracteres")
    .max(500, "El motivo es demasiado largo"),
});

export type AdminFiscalAprobarBody = z.infer<typeof AdminFiscalAprobarBodySchema>;

export type AdminFiscalRevisionManualItem = {
  expedienteId: string;
  clienteNombre: string;
  nssMasked: string;
  asesorNombre: string;
  motivoResumen: string;
  realizadoAt: string | null;
  submittedToMesa: boolean;
};

/** Motivo operativo sin PII (code/semantic del worker). */
export function extractMotivoResumen(resultado: unknown): string {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) {
    return "Revisión manual requerida";
  }
  const r = resultado as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code.trim() : "";
  const semantic = typeof r.semantic === "string" ? r.semantic.trim() : "";
  const source = typeof r.source === "string" ? r.source.trim() : "";
  if (code) return code.slice(0, 120);
  if (semantic) return `semantic:${semantic}`.slice(0, 120);
  if (source) return `source:${source}`.slice(0, 120);
  return "Revisión manual requerida";
}

export function maskNss(nss: unknown): string {
  const s = String(nss ?? "").replace(/\D/g, "");
  if (s.length < 4) return "***";
  return `***${s.slice(-4)}`;
}

/** Nunca devolver RFC/CURP completos en listados admin. */
export function assertNoPiiInItem(item: AdminFiscalRevisionManualItem): void {
  const blob = JSON.stringify(item);
  if (/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/.test(blob)) {
    throw new Error("pii_rfc_leaked");
  }
  if (/\b[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]{2}\b/.test(blob)) {
    throw new Error("pii_curp_leaked");
  }
}

export function authorizeSuperAdmin(appRole: string | null, active: boolean): boolean {
  return active === true && appRole === "super_admin";
}

export function mapAprobarRpcError(message: string, code?: string): {
  status: number;
  code: string;
  message: string;
} {
  const msg = message || "";
  const c = code || "";
  if (c === "42501" || /solo super_admin|no autenticado/i.test(msg)) {
    return { status: 403, code: "FORBIDDEN", message: "No autorizado." };
  }
  if (c === "22023" || /motivo obligatorio/i.test(msg)) {
    return {
      status: 400,
      code: "MOTIVO_INVALIDO",
      message: "El motivo debe tener al menos 10 caracteres.",
    };
  }
  if (/requiere revision_manual/i.test(msg)) {
    return {
      status: 409,
      code: "NOT_REVISION_MANUAL",
      message: "El expediente no está en revisión manual fiscal vigente.",
    };
  }
  if (/binding incompleto/i.test(msg)) {
    return {
      status: 409,
      code: "BINDING_INCOMPLETO",
      message: "Falta binding EDC/CURP para aprobar el envío.",
    };
  }
  if (c === "P0002" || /expediente no encontrado/i.test(msg)) {
    return { status: 404, code: "NOT_FOUND", message: "Expediente no encontrado." };
  }
  return {
    status: 503,
    code: "APROBAR_FAILED",
    message: "No se pudo aprobar el envío. Intenta de nuevo.",
  };
}
