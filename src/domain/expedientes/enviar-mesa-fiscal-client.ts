import { ExpedientesSupabaseError } from "./supabase.error";
import { mapEnviarAMesaRpcError } from "./enviar-mesa-rpc-error";

export type EnviarMesaFiscalHttpBody = Readonly<{
  ok?: boolean;
  status?: string;
  code?: string | null;
  message?: string | null;
  details?: string | null;
  submitted_to_mesa?: boolean;
  fiscal?: string;
  cta?: string | null;
}>;

export function mapEnviarMesaFiscalHttpError(
  body: EnviarMesaFiscalHttpBody | null | undefined,
): ExpedientesSupabaseError {
  const code = String(body?.code ?? "").trim().toUpperCase();
  const status = String(body?.status ?? "").trim().toLowerCase();

  if (body?.status === "send_failed_after_fiscal_pass") {
    return mapEnviarAMesaRpcError({
      code: body.code ?? undefined,
      message: body.message ?? undefined,
      details: body.details ?? undefined,
    });
  }

  if (
    status === "revision_manual" ||
    code === "RFC_VALIDACION_SAT_REVISION_MANUAL" ||
    body?.cta === "reintentar_validacion"
  ) {
    return new ExpedientesSupabaseError(
      "Este expediente necesita validación fiscal del SAT antes de enviarse a Mesa",
      { code: code || "FISCAL_REVISION_MANUAL", cta: "reintentar_validacion" },
    );
  }

  if (code === "RFC_INVALIDO_SAT") {
    return new ExpedientesSupabaseError(
      "El RFC no fue validado por el SAT. El expediente no se envió a Mesa.",
    );
  }
  if (code === "CURP_INVALIDA_SAT" || code === "CURP_LOCAL_INVALIDA") {
    return new ExpedientesSupabaseError(
      "La CURP no fue validada. El expediente no se envió a Mesa.",
    );
  }
  if (code === "ESTADO_CUENTA_FALTANTE") {
    return new ExpedientesSupabaseError(
      "Falta el Estado de Cuenta requerido para validar el RFC antes de enviar a Mesa.",
    );
  }
  if (
    code === "PDF_NO_LEGIBLE" ||
    code === "ERROR_ANALISIS" ||
    code === "ESTADO_CUENTA_DOWNLOAD_FAILED"
  ) {
    return new ExpedientesSupabaseError(
      "No se pudo leer el Estado de Cuenta para validar el RFC. Revisa el PDF e intenta nuevamente.",
    );
  }
  if (code.startsWith("RFC_NO_RESUELTO_")) {
    return new ExpedientesSupabaseError(
      "No se pudo determinar con seguridad el RFC fiscal del cliente. El expediente no se envió a Mesa.",
    );
  }
  if (code === "FISCAL_INPUT_CHANGED" || code === "FISCAL_INPUT_RECHECK_FAILED") {
    return new ExpedientesSupabaseError(
      "Los datos fiscales o el Estado de Cuenta cambiaron durante la validación. No se envió a Mesa; intenta nuevamente.",
    );
  }
  if (
    code.startsWith("SAT_") ||
    code === "TECHNICAL_FAILURE" ||
    code === "UNEXPECTED_EXCEPTION" ||
    code === "FISCAL_REVISION_REGISTER_FAILED"
  ) {
    return new ExpedientesSupabaseError(
      "No se pudo completar la validación con SAT. El expediente no se envió a Mesa; intenta nuevamente.",
      { code, cta: "reintentar_validacion" },
    );
  }
  if (code === "CLIENTE_DATOS_READ_FAILED" || code === "EDITOR_DECISION_READ_FAILED") {
    return new ExpedientesSupabaseError(
      "No se pudieron preparar los datos para la validación fiscal. El expediente no se envió a Mesa.",
    );
  }
  if (code === "UNAUTHORIZED") {
    return new ExpedientesSupabaseError(
      "Tu sesión venció. Inicia sesión nuevamente antes de enviar a Mesa.",
    );
  }

  return new ExpedientesSupabaseError(
    "No se pudo completar la validación fiscal. El expediente no se envió a Mesa.",
  );
}
