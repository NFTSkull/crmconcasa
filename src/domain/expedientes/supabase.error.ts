export type ExpedientesSupabaseErrorCta = "reintentar_validacion";

export class ExpedientesSupabaseError extends Error {
  readonly code?: string;
  readonly cta?: ExpedientesSupabaseErrorCta;

  constructor(
    message: string,
    opts?: { code?: string; cta?: ExpedientesSupabaseErrorCta },
  ) {
    super(message);
    this.name = "ExpedientesSupabaseError";
    this.code = opts?.code;
    this.cta = opts?.cta;
  }
}
