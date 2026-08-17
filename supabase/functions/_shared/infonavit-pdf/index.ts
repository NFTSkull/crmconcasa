/**
 * Barrel P189 B1 — motor local fill/flatten Infonavit.
 */

export { InfonavitPdfError } from "./errors.ts";
export type { InfonavitPdfErrorCode, InfonavitPdfErrorMeta } from "./errors.ts";
export {
  blankable,
  formatBajoProtestaDateParts,
  formatMoneyMx,
  formatNombreCompleto,
  formatPresupuestoFecha,
  formatSolicitudCierreDateParts,
  parseYmd,
} from "./formatters.ts";
export { generateInfonavitPdf, generateInfonavitPdfAudited } from "./generate-infonavit-pdf.ts";
export type { FormFieldAudit } from "./generate-infonavit-pdf.ts";
export {
  FIXTURE_LONG_FIELDS,
  FIXTURE_NORMAL,
  FIXTURE_SPANISH,
} from "./fixtures.ts";
export { SOLICITUD_MUST_STAY_BLANK } from "./fill-solicitud.ts";
export { sha256Hex } from "./sha256.ts";
export {
  BAJO_FIELD,
  BAJO_PROTESTA_CONTRACT,
  CONTRACTS_BY_TYPE,
  PRESUPUESTO_CONTRACT,
  PRESUPUESTO_FIELD,
  SOLICITUD_CONTRACT,
  SOLICITUD_FIELD,
  TEMPLATE_VERSION,
  assertTemplateContract,
  getContract,
} from "./template-contract.ts";
export { splitNombrePresupuesto, splitTextToLines } from "./text-layout.ts";
export {
  INFONAVIT_B1_TEMPLATE_FILE,
  INFONAVIT_DB_TO_B1,
  mapDbDocumentTypeToB1,
} from "./document-type-map.ts";
export {
  adaptB3SnapshotToB1,
  InfonavitSnapshotAdapterError,
} from "./snapshot-adapter.ts";
export {
  validateGeneratedInfonavitPdf,
  INFONAVIT_PDF_MAX_BYTES,
} from "./pdf-output-validation.ts";
export {
  workerSecretIsValid,
  INFONAVIT_PDF_WORKER_SECRET_ENV,
  INFONAVIT_PDF_WORKER_SECRET_HEADER,
} from "./worker-auth.ts";
export type {
  GenerateInfonavitPdfArgs,
  InfonavitDocumentType,
  InfonavitPdfSnapshotInput,
} from "./types.ts";
