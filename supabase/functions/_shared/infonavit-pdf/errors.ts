/**
 * Errores seguros P189 — sin PII en message/meta.
 */

export type InfonavitPdfErrorCode =
  | "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH"
  | "INFONAVIT_TEXT_OVERFLOW"
  | "INFONAVIT_INVALID_DATE"
  | "INFONAVIT_INVALID_AMOUNT"
  | "INFONAVIT_UNSUPPORTED_DOCUMENT";

export type InfonavitPdfErrorMeta = Record<
  string,
  string | number | boolean | null | undefined
>;

export class InfonavitPdfError extends Error {
  readonly code: InfonavitPdfErrorCode;
  readonly meta: InfonavitPdfErrorMeta;

  constructor(
    code: InfonavitPdfErrorCode,
    message: string,
    meta: InfonavitPdfErrorMeta = {},
  ) {
    super(message);
    this.name = "InfonavitPdfError";
    this.code = code;
    this.meta = meta;
  }
}
