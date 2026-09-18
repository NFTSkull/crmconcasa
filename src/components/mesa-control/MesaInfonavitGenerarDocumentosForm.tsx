"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  isValidClabeMexico,
  normalizeClabeMexico,
} from "@/domain/expediente-cliente-datos/clabe-mexico";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { MesaInfonavitSourceDocumentPreview } from "@/components/mesa-control/MesaInfonavitSourceDocumentPreview";
import {
  resolveInfonavitSourcePreviewContext,
  type InfonavitSourceFieldKey,
  type InfonavitSourcePreviewContext,
} from "@/domain/document-extractions/infonavit-source-preview";
import {
  rowMasRecientePorTipoDocumento,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoListItem,
} from "@/domain/expediente-archivos";
import {
  extractDocumentTextViaOcr,
  type OcrDocumentType,
} from "@/domain/document-extractions/document-ocr-client";
import {
  getMesaInfonavitOcrCache,
  type MesaInfonavitOcrCache,
} from "@/domain/document-extractions/document-ocr-precompute-client";
import {
  buildInfonavitDocumentAutofillPatch,
  comparableAutofillValue,
  isIneValidityExpired,
  type InfonavitDocumentTexts,
} from "@/domain/document-extractions/infonavit-document-autofill";
import { parseLegacyReferenciaNombre } from "@/domain/expediente-cliente-datos/parse-legacy-referencia-nombre";
import {
  mergeInfonavitDocumentAutofill,
  type InfonavitAutofillConflict,
} from "@/domain/document-extractions/infonavit-autofill-merge";

export const MESA_CLABE_DERECHOHABIENTE_INVALID_MSG =
  "La CLABE del derechohabiente no es válida. Verifica los 18 dígitos.";

export const MESA_INFONAVIT_DIRECCION_REQUERIDA_MSG =
  "La dirección de la vivienda es obligatoria para generar la propuesta. Verifica los datos de Vivienda a mejorar.";

/**
 * Validación previa a generar: vacío OK; si hay valor, exige CLABE normalizable + checksum.
 * No muta drafts — solo decide si se puede generar.
 */
export function validateClabeDerechohabienteForGenerate(
  raw: string,
): { ok: true; normalized: string } | { ok: false; message: string } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: true, normalized: "" };
  const normalized = normalizeClabeMexico(trimmed);
  if (!normalized || !isValidClabeMexico(normalized)) {
    return { ok: false, message: MESA_CLABE_DERECHOHABIENTE_INVALID_MSG };
  }
  return { ok: true, normalized };
}

type IdentificacionDraft = {
  tipo: string;
  numero: string;
  vigencia: string;
};

type ClienteDraft = {
  nombreCompleto: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nss: string;
  curp: string;
  rfc: string;
  celular: string;
  telefono: string;
  ladaTelefono: string;
  correo: string;
  genero: string;
  estadoCivil: string;
  regimenMatrimonial: string;
  identificacion: IdentificacionDraft;
};

export function repairMesaInfonavitClienteNameFromCanonical(
  cliente: ClienteDraft,
): ClienteDraft {
  const canonical = parseLegacyReferenciaNombre(cliente.nombreCompleto);
  if (!canonical.parsed) return cliente;

  const currentParts = [
    cliente.nombres,
    cliente.apellidoPaterno,
    cliente.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(" ");

  if (
    comparableAutofillValue(currentParts) ===
    comparableAutofillValue(cliente.nombreCompleto)
  ) {
    return cliente;
  }

  return {
    ...cliente,
    nombres: canonical.nombres,
    apellidoPaterno: canonical.apellidoPaterno,
    apellidoMaterno: canonical.apellidoMaterno,
  };
}

type EmpresaDraft = {
  nombre: string;
  registroPatronal: string;
  lada: string;
  telefono: string;
  extension: string;
};

type ViviendaDraft = {
  direccionCompleta: string;
  calle: string;
  noExt: string;
  noInt: string;
  lote: string;
  manzana: string;
  colonia: string;
  entidad: string;
  municipio: string;
  cp: string;
  tipoPropiedad: string;
};

type CreditoDraft = {
  montoSolicitado: number | null;
  plazoAnios: number | null;
};

type DestinoRecursosDraft = {
  /** Compatibilidad snapshot/PDF T31 — siempre "" en captura Mesa (P0). */
  porcentajeTitulacion: string;
  /** Compatibilidad snapshot/PDF T32 — siempre "" en captura Mesa (P0). */
  clabeNotaria: string;
  /** T33 — editable; se conserva. */
  clabeDerechohabiente: string;
};

type ReferenciaDraft = {
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombres: string;
  lada: string;
  telefono: string;
  celular: string;
};

type BeneficiarioDraft = {
  parentesco: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombres: string;
};

type MejoraDraft = {
  descripcion: string;
  presupuestoEstimado: null;
};

export type MesaInfonavitDocumentDraft = {
  schemaVersion: number;
  mappingVersion: number;
  fechaDocumento: string;
  localidad: string;
  ciudadCierre: string;
  cliente: ClienteDraft;
  empresa: EmpresaDraft;
  vivienda: ViviendaDraft;
  credito: CreditoDraft;
  destinoRecursos: DestinoRecursosDraft;
  referencias: ReferenciaDraft[];
  beneficiario: BeneficiarioDraft;
  mejora: MejoraDraft;
};

export type MesaInfonavitGenerarDocumentosFormProps = Readonly<{
  expedienteId: string;
  onGenerated?: (submissionVersion: number) => void;
}>;

type UnknownRecord = Record<string, unknown>;

type StoredMesaInfonavitDraft = Readonly<{
  version: 1;
  expedienteId: string;
  savedAt: string;
  draft: MesaInfonavitDocumentDraft;
}>;

type LocalSaveState = "idle" | "restored" | "saved";

type DocumentAutofillStatus = "idle" | "reading" | "done" | "partial" | "error";

type DocumentAutofillState = Readonly<{
  status: DocumentAutofillStatus;
  applied: number;
  confirmed: number;
  conflicts: number;
  errors: string[];
  warnings: string[];
}>;

const EMPTY_AUTOFILL_STATE: DocumentAutofillState = {
  status: "idle",
  applied: 0,
  confirmed: 0,
  conflicts: 0,
  errors: [],
  warnings: [],
};

const AUTOFILL_FIELD_LABELS: Readonly<Record<string, string>> = {
  "cliente.nombres": "Nombre(s)",
  "cliente.apellidoPaterno": "Apellido paterno",
  "cliente.apellidoMaterno": "Apellido materno",
  "cliente.curp": "CURP",
  "cliente.genero": "Género",
  "cliente.identificacion.tipo": "Tipo de identificación",
  "cliente.identificacion.numero": "Número de identificación",
  "cliente.identificacion.vigencia": "Vigencia de identificación",
  "vivienda.calle": "Calle",
  "vivienda.noExt": "No. exterior",
  "vivienda.noInt": "No. interior",
  "vivienda.lote": "Lote",
  "vivienda.manzana": "Manzana",
  "vivienda.colonia": "Colonia",
  "vivienda.entidad": "Entidad",
  "vivienda.municipio": "Municipio",
  "vivienda.cp": "Código postal",
  "destinoRecursos.clabeDerechohabiente": "CLABE",
};

function autofillFieldLabel(field: string): string {
  return AUTOFILL_FIELD_LABELS[field] ?? field;
}

const MESA_INFONAVIT_LOCAL_DRAFT_VERSION = 1 as const;
const MESA_INFONAVIT_LOCAL_DRAFT_PREFIX = "concasa:mesa-infonavit-draft:v1:";

function localDraftKey(expedienteId: string): string {
  return `${MESA_INFONAVIT_LOCAL_DRAFT_PREFIX}${expedienteId}`;
}

function recordOf(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * P0: % titulación y CLABE notaría ya no se capturan.
 * Se conservan en el contrato pero siempre vacíos (anula drafts/localStorage viejos).
 * `clabeDerechohabiente` se preserva intacta.
 */
export function normalizeDestinoRecursosForCapture(
  destino: Partial<DestinoRecursosDraft> | null | undefined,
): DestinoRecursosDraft {
  const raw =
    destino && typeof destino === "object"
      ? (destino as DestinoRecursosDraft).clabeDerechohabiente
      : "";
  return {
    porcentajeTitulacion: "",
    clabeNotaria: "",
    clabeDerechohabiente: str(raw),
  };
}

function compactAddressPart(value: string): string {
  return str(value).trim().replace(/\s+/g, " ");
}

/**
 * La vivienda se captura/editan en campos estructurados. Antes de congelar el
 * snapshot reconstruimos direccionCompleta para que PDF/DOCX no reutilicen una
 * dirección legacy distinta a lo que Mesa ve en pantalla.
 */
export function composeMesaInfonavitDireccionCompleta(
  vivienda: ViviendaDraft,
): string {
  const calle = compactAddressPart(vivienda.calle);
  const noExt = compactAddressPart(vivienda.noExt);
  const noInt = compactAddressPart(vivienda.noInt);
  const lote = compactAddressPart(vivienda.lote);
  const manzana = compactAddressPart(vivienda.manzana);
  const colonia = compactAddressPart(vivienda.colonia);
  const municipio = compactAddressPart(vivienda.municipio);
  const entidad = compactAddressPart(vivienda.entidad);
  const cp = compactAddressPart(vivienda.cp);

  const parts = [
    calle,
    noExt ? `No. ${noExt}` : "",
    noInt ? `Int. ${noInt}` : "",
    lote ? `Lote ${lote}` : "",
    manzana ? `Mz. ${manzana}` : "",
    colonia ? `Col. ${colonia}` : "",
    municipio,
    entidad,
    cp ? `CP ${cp}` : "",
  ].filter((part) => part.length > 0);

  return parts.length > 0
    ? parts.join(", ")
    : compactAddressPart(vivienda.direccionCompleta);
}

export function hasMesaInfonavitDireccionForGenerate(
  vivienda: ViviendaDraft,
): boolean {
  return composeMesaInfonavitDireccionCompleta(vivienda).length > 0;
}

/** Payload de generación: fuerza T31/T32 vacíos; normaliza T33 si es CLABE válida. */
export function buildMesaInfonavitGeneratePayload(
  draft: MesaInfonavitDocumentDraft,
): MesaInfonavitDocumentDraft {
  const destino = normalizeDestinoRecursosForCapture(draft.destinoRecursos);
  const rawClabe = destino.clabeDerechohabiente.trim();
  let clabeDerechohabiente = rawClabe;
  if (rawClabe) {
    const normalized = normalizeClabeMexico(rawClabe);
    if (normalized && isValidClabeMexico(normalized)) {
      clabeDerechohabiente = normalized;
    }
  }
  return {
    ...draft,
    vivienda: {
      ...draft.vivienda,
      direccionCompleta: composeMesaInfonavitDireccionCompleta(draft.vivienda),
    },
    credito: {
      montoSolicitado: draft.credito.montoSolicitado,
      plazoAnios: draft.credito.plazoAnios,
    },
    destinoRecursos: {
      porcentajeTitulacion: "",
      clabeNotaria: "",
      clabeDerechohabiente,
    },
    mejora: {
      ...draft.mejora,
      presupuestoEstimado: null,
    },
  };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = str(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReference(value: unknown): ReferenciaDraft {
  const r = recordOf(value);
  return {
    apellidoPaterno: str(r.apellidoPaterno),
    apellidoMaterno: str(r.apellidoMaterno),
    nombres: str(r.nombres),
    lada: str(r.lada),
    telefono: str(r.telefono),
    celular: str(r.celular),
  };
}

export function parseMesaInfonavitDocumentDraft(
  value: unknown,
): MesaInfonavitDocumentDraft {
  const root = recordOf(value);
  const c = recordOf(root.cliente);
  const id = recordOf(c.identificacion);
  const empresa = recordOf(root.empresa);
  const vivienda = recordOf(root.vivienda);
  const credito = recordOf(root.credito);
  const destino = recordOf(root.destinoRecursos);
  const ben = recordOf(root.beneficiario);
  const mejora = recordOf(root.mejora);
  const refsRaw = Array.isArray(root.referencias) ? root.referencias : [];

  const referencias = [parseReference(refsRaw[0]), parseReference(refsRaw[1])];

  return {
    schemaVersion: 1,
    mappingVersion: 3,
    fechaDocumento: str(root.fechaDocumento),
    localidad: str(root.localidad) || "NUEVO LEÓN",
    ciudadCierre: str(root.ciudadCierre) || "NUEVO LEÓN",
    cliente: {
      nombreCompleto: str(c.nombreCompleto),
      nombres: str(c.nombres),
      apellidoPaterno: str(c.apellidoPaterno),
      apellidoMaterno: str(c.apellidoMaterno),
      nss: str(c.nss),
      curp: str(c.curp),
      rfc: str(c.rfc),
      celular: str(c.celular),
      telefono: str(c.telefono),
      ladaTelefono: str(c.ladaTelefono),
      correo: str(c.correo),
      genero: str(c.genero),
      estadoCivil: str(c.estadoCivil),
      regimenMatrimonial: str(c.regimenMatrimonial),
      identificacion: {
        tipo: str(id.tipo),
        numero: str(id.numero),
        vigencia: str(id.vigencia),
      },
    },
    empresa: {
      nombre: str(empresa.nombre),
      registroPatronal: str(empresa.registroPatronal),
      lada: str(empresa.lada),
      telefono: str(empresa.telefono),
      extension: str(empresa.extension),
    },
    vivienda: {
      direccionCompleta: str(vivienda.direccionCompleta),
      calle: str(vivienda.calle),
      noExt: str(vivienda.noExt),
      noInt: str(vivienda.noInt),
      lote: str(vivienda.lote),
      manzana: str(vivienda.manzana),
      colonia: str(vivienda.colonia),
      entidad: str(vivienda.entidad),
      municipio: str(vivienda.municipio),
      cp: str(vivienda.cp),
      tipoPropiedad: str(vivienda.tipoPropiedad),
    },
    credito: {
      montoSolicitado: num(credito.montoSolicitado),
      plazoAnios: num(credito.plazoAnios),
    },
    destinoRecursos: normalizeDestinoRecursosForCapture({
      porcentajeTitulacion: str(destino.porcentajeTitulacion),
      clabeNotaria: str(destino.clabeNotaria),
      clabeDerechohabiente: str(destino.clabeDerechohabiente),
    }),
    referencias,
    beneficiario: {
      parentesco: str(ben.parentesco),
      apellidoPaterno: str(ben.apellidoPaterno),
      apellidoMaterno: str(ben.apellidoMaterno),
      nombres: str(ben.nombres),
    },
    mejora: {
      descripcion: str(mejora.descripcion),
      presupuestoEstimado: null,
    },
  };
}

function parseDraft(value: unknown): MesaInfonavitDocumentDraft {
  return parseMesaInfonavitDocumentDraft(value);
}

function readLocalDraft(expedienteId: string): MesaInfonavitDocumentDraft | null {
  if (typeof window === "undefined" || !expedienteId) return null;
  try {
    const raw = window.localStorage.getItem(localDraftKey(expedienteId));
    if (!raw) return null;
    const envelope = recordOf(JSON.parse(raw));
    if (
      envelope.version !== MESA_INFONAVIT_LOCAL_DRAFT_VERSION ||
      envelope.expedienteId !== expedienteId ||
      !envelope.draft
    ) {
      return null;
    }
    return parseDraft(envelope.draft);
  } catch {
    return null;
  }
}

function writeLocalDraft(expedienteId: string, draft: MesaInfonavitDocumentDraft): boolean {
  if (typeof window === "undefined" || !expedienteId) return false;
  try {
    const normalized: MesaInfonavitDocumentDraft = {
      ...draft,
      destinoRecursos: normalizeDestinoRecursosForCapture(draft.destinoRecursos),
    };
    const envelope: StoredMesaInfonavitDraft = {
      version: MESA_INFONAVIT_LOCAL_DRAFT_VERSION,
      expedienteId,
      savedAt: new Date().toISOString(),
      draft: normalized,
    };
    window.localStorage.setItem(localDraftKey(expedienteId), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

type FieldProps = Readonly<{
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date" | "email";
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  onFocusField?: () => void;
  sourceLabel?: string;
}>;

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  maxLength,
  onFocusField,
  sourceLabel,
}: FieldProps) {
  return (
    <label className="block text-xs font-medium text-gray-700">
      <span className="flex items-center gap-1.5">
        <span>{label}</span>
        {sourceLabel ? (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            {sourceLabel}
          </span>
        ) : null}
      </span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onFocusField?.()}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
      />
    </label>
  );
}

type SelectFieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  onFocusField?: () => void;
  sourceLabel?: string;
}>;

function SelectField({
  label,
  value,
  onChange,
  options,
  onFocusField,
  sourceLabel,
}: SelectFieldProps) {
  return (
    <label className="block text-xs font-medium text-gray-700">
      <span className="flex items-center gap-1.5">
        <span>{label}</span>
        {sourceLabel ? (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            {sourceLabel}
          </span>
        ) : null}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onFocusField?.()}
        className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
      >
        <option value="">Sin seleccionar</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionTitle({
  children,
  actions,
}: Readonly<{ children: React.ReactNode; actions?: React.ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-1">
      <h4 className="text-sm font-semibold text-gray-900">{children}</h4>
      {actions ? <div className="flex flex-wrap items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function MesaInfonavitGenerarDocumentosForm({
  expedienteId,
  onGenerated,
}: MesaInfonavitGenerarDocumentosFormProps) {
  const [draft, setDraft] = useState<MesaInfonavitDocumentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localSaveState, setLocalSaveState] = useState<LocalSaveState>("idle");
  const [sourceContext, setSourceContext] =
    useState<InfonavitSourcePreviewContext>("identidad");
  const [requestedIneSide, setRequestedIneSide] =
    useState<"frente" | "reverso" | null>("frente");
  const [autofillState, setAutofillState] =
    useState<DocumentAutofillState>(EMPTY_AUTOFILL_STATE);
  const [autofillSources, setAutofillSources] =
    useState<Record<string, string>>({});
  const [autofillConflicts, setAutofillConflicts] =
    useState<InfonavitAutofillConflict[]>([]);
  const [autofillRetryNonce, setAutofillRetryNonce] = useState(0);
  const archivosRepo = useExpedienteArchivosRepo();
  const hydratedExpedienteRef = useRef<string | null>(null);
  const draftRef = useRef<MesaInfonavitDocumentDraft | null>(null);
  const autofillRunKeyRef = useRef<string | null>(null);
  const autofillInFlightKeyRef = useRef<string | null>(null);

  const focusSource = useCallback((field: InfonavitSourceFieldKey) => {
    setSourceContext(resolveInfonavitSourcePreviewContext(field));
  }, []);

  const openSourceDocument = useCallback(
    (
      context: InfonavitSourcePreviewContext,
      ineSide?: "frente" | "reverso",
    ) => {
      setSourceContext(context);
      setRequestedIneSide(ineSide ?? null);
    },
    [],
  );

  const clearAutofillSource = useCallback((field: string) => {
    setAutofillSources((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const loadDraft = useCallback(async (options?: { forceServer?: boolean }) => {
    const forceServer = options?.forceServer === true;
    hydratedExpedienteRef.current = null;
    setLoading(true);
    setLoadError(null);
    setSuccess(null);
    setGenerateError(null);
    setLocalSaveState("idle");
    setAutofillSources({});
    setAutofillConflicts([]);
    setAutofillState(EMPTY_AUTOFILL_STATE);

    if (!forceServer) {
      const local = readLocalDraft(expedienteId);
      if (local) {
        setDraft(local);
        hydratedExpedienteRef.current = expedienteId;
        setLocalSaveState("restored");
        setLoading(false);
        return;
      }
    }

    try {
      if (!isSupabaseConfigured() || !supabaseBrowser) {
        throw new Error("Supabase no está configurado.");
      }
      const { data, error } = await supabaseBrowser.rpc(
        "mesa_get_infonavit_document_draft",
        { p_expediente_id: expedienteId },
      );
      if (error) throw error;
      const nextDraft = parseDraft(data);
      setDraft(nextDraft);
      hydratedExpedienteRef.current = expedienteId;
      if (writeLocalDraft(expedienteId, nextDraft)) {
        setLocalSaveState("saved");
      }
    } catch (error) {
      setDraft(null);
      setLoadError(
        errorMessage(error, "No se pudo preparar la información de los documentos."),
      );
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const draftReady =
    draft != null && hydratedExpedienteRef.current === expedienteId;

  useEffect(() => {
    if (!draftReady) return;

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const list = await archivosRepo.listByExpediente(expedienteId);
        if (cancelled) return;

        const pick = (
          type: OcrDocumentType,
        ): ExpedienteArchivoListItem | null =>
          rowMasRecientePorTipoDocumento(list, type) ?? null;

        const docs = {
          cliente_ine_frente: pick("cliente_ine_frente"),
          cliente_ine_reverso: pick("cliente_ine_reverso"),
          cliente_comprobante_domicilio: pick(
            "cliente_comprobante_domicilio",
          ),
          cliente_estado_cuenta: pick("cliente_estado_cuenta"),
        } satisfies Record<OcrDocumentType, ExpedienteArchivoListItem | null>;

        const runKey = Object.entries(docs)
          .map(([type, doc]) => `${type}:${doc?.id ?? "none"}`)
          .join("|");

        if (
          autofillRunKeyRef.current === runKey ||
          autofillInFlightKeyRef.current === runKey
        ) {
          return;
        }
        autofillInFlightKeyRef.current = runKey;

        setAutofillState({
          status: "reading",
          applied: 0,
          confirmed: 0,
          conflicts: 0,
          errors: [],
          warnings: [],
        });

        const jobs: Array<{
          type: OcrDocumentType;
          target: keyof InfonavitDocumentTexts;
          doc: ExpedienteArchivoListItem | null;
        }> = [
          // INE es autoridad de identidad en esta captura; se lee siempre el frente
          // aunque Datos Generales ya tengan nombre/CURP.
          {
            type: "cliente_ine_frente",
            target: "ineFrente",
            doc: docs.cliente_ine_frente,
          },
          {
            type: "cliente_ine_reverso",
            target: "ineReverso",
            doc: docs.cliente_ine_reverso,
          },
          {
            type: "cliente_comprobante_domicilio",
            target: "comprobanteDomicilio",
            doc: docs.cliente_comprobante_domicilio,
          },
          {
            type: "cliente_estado_cuenta",
            target: "estadoCuenta",
            doc: docs.cliente_estado_cuenta,
          },
        ];

        const cachedOcr: MesaInfonavitOcrCache =
          autofillRetryNonce === 0
            ? await getMesaInfonavitOcrCache(expedienteId)
            : {};

        const results = await Promise.all(
          jobs.map(async (job) => {
            if (!job.doc) return null;

            const cached = cachedOcr[job.type];
            if (
              cached?.status === "done" &&
              cached.documentoId === job.doc.id &&
              cached.text.trim()
            ) {
              return {
                target: job.target,
                text: cached.text,
                error: null as string | null,
              };
            }

            try {
              const blob = await archivosRepo.getArchivoBlob(job.doc.id);
              if (cancelled) return null;
              const extracted = await extractDocumentTextViaOcr({
                blob,
                documentType: job.type,
                filename: job.doc.nombre_original,
                signal: controller.signal,
                cacheKey: `${job.doc.id}:${job.type}:retry-${autofillRetryNonce}`,
              });
              return {
                target: job.target,
                text: extracted.text,
                error: null as string | null,
              };
            } catch (error) {
              if (controller.signal.aborted) return null;
              return {
                target: job.target,
                text: "",
                error: errorMessage(
                  error,
                  `No se pudo leer ${job.type.replaceAll("_", " ")}.`,
                ),
              };
            }
          }),
        );

        if (cancelled) return;

        const texts: {
          ineFrente?: string;
          ineReverso?: string;
          comprobanteDomicilio?: string;
          estadoCuenta?: string;
        } = {};
        const errors: string[] = [];

        for (const result of results) {
          if (!result) continue;
          if (result.error) errors.push(result.error);
          else texts[result.target] = result.text;
        }

        const current = draftRef.current;
        if (!current) return;
        const expectedClienteNombre =
          current.cliente.nombreCompleto.trim() ||
          [
            current.cliente.nombres,
            current.cliente.apellidoPaterno,
            current.cliente.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(" ");

        const patch = buildInfonavitDocumentAutofillPatch(texts, {
          expectedClienteNombre,
        });

        const autoReviewWarnings: string[] = [];
        const detectedValidity = patch.cliente.identificacionVigencia;
        const expired =
          detectedValidity != null
            ? isIneValidityExpired(detectedValidity.value)
            : null;

        if (expired === true) {
          const pendingIneDocs = [
            docs.cliente_ine_frente,
            docs.cliente_ine_reverso,
          ].filter(
            (
              doc,
            ): doc is ExpedienteArchivoListItem =>
              Boolean(doc) &&
              (doc!.estatus_revision === "subido" ||
                doc!.estatus_revision === "resubido"),
          );

          for (const doc of pendingIneDocs) {
            try {
              await archivosRepo.updateRevision(doc.id, {
                estatus_revision: "rechazado",
                comentario_mesa: `Documento vencido — INE con vigencia ${detectedValidity.value}.`,
              });
            } catch (error) {
              errors.push(
                errorMessage(
                  error,
                  "Se detectó una INE vencida, pero no se pudo registrar automáticamente el rechazo documental.",
                ),
              );
            }
          }

          if (pendingIneDocs.length > 0) {
            autoReviewWarnings.push(
              `INE vencida: vigencia ${detectedValidity.value}. Se rechazó automáticamente para corrección del asesor.`,
            );
          }
        }

        let mergeBase = current;
        const ineNameRejected = (patch.issues ?? []).some(
          (issue) =>
            issue.source === "cliente_ine_frente" &&
            issue.code === "low_confidence",
        );
        if (ineNameRejected && current.cliente.nombreCompleto.trim()) {
          const repairedCliente =
            repairMesaInfonavitClienteNameFromCanonical(current.cliente);
          if (repairedCliente !== current.cliente) {
            mergeBase = structuredClone(current);
            mergeBase.cliente = repairedCliente;
          }
        }

        const merged = mergeInfonavitDocumentAutofill(mergeBase, patch);
        if (cancelled) return;

        const warnings = [
          ...(patch.issues ?? []).map((issue) => issue.message),
          ...autoReviewWarnings,
        ];
        setDraft(merged.draft);
        setAutofillSources({ ...merged.sourceByField });
        setAutofillConflicts(merged.conflicts);
        setAutofillState({
          status:
            errors.length > 0 || warnings.length > 0 ? "partial" : "done",
          applied: merged.applied.length,
          confirmed: merged.confirmed.length,
          conflicts: merged.conflicts.length,
          errors,
          warnings,
        });
        autofillRunKeyRef.current = runKey;
        autofillInFlightKeyRef.current = null;
      } catch (error) {
        autofillInFlightKeyRef.current = null;
        if (cancelled || controller.signal.aborted) return;
        setAutofillState({
          status: "error",
          applied: 0,
          confirmed: 0,
          conflicts: 0,
          warnings: [],
          errors: [
            errorMessage(
              error,
              "No se pudo iniciar la lectura automática de documentos.",
            ),
          ],
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    archivosRepo,
    autofillRetryNonce,
    draftReady,
    expedienteId,
  ]);

  useEffect(() => {
    if (!draft || hydratedExpedienteRef.current !== expedienteId) return;
    const timer = window.setTimeout(() => {
      if (writeLocalDraft(expedienteId, draft)) {
        setLocalSaveState("saved");
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draft, expedienteId]);

  const missingCore = useMemo(() => {
    if (!draft) return [] as string[];
    const missing: string[] = [];
    if (!draft.cliente.nss.trim()) missing.push("NSS");
    if (!draft.cliente.nombres.trim()) missing.push("nombre(s)");
    if (!draft.cliente.apellidoPaterno.trim()) missing.push("apellido paterno");
    if (!draft.empresa.nombre.trim()) missing.push("empresa/patrón");
    if (!draft.empresa.registroPatronal.trim()) missing.push("registro patronal");
    if (!hasMesaInfonavitDireccionForGenerate(draft.vivienda)) {
      missing.push("dirección de la vivienda");
    }
    if (!draft.credito.montoSolicitado || draft.credito.montoSolicitado <= 0) {
      missing.push("monto solicitado");
    }
    if (!draft.beneficiario.parentesco.trim()) missing.push("parentesco beneficiario");
    if (!draft.beneficiario.nombres.trim()) missing.push("nombre beneficiario");
    return missing;
  }, [draft]);

  const updateCliente = <K extends keyof ClienteDraft>(key: K, value: ClienteDraft[K]) => {
    clearAutofillSource(`cliente.${String(key)}`);
    setDraft((prev) =>
      prev ? { ...prev, cliente: { ...prev.cliente, [key]: value } } : prev,
    );
  };
  const updateIdentificacion = <K extends keyof IdentificacionDraft>(
    key: K,
    value: IdentificacionDraft[K],
  ) => {
    clearAutofillSource(`cliente.identificacion.${String(key)}`);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            cliente: {
              ...prev.cliente,
              identificacion: { ...prev.cliente.identificacion, [key]: value },
            },
          }
        : prev,
    );
  };
  const updateEmpresa = <K extends keyof EmpresaDraft>(key: K, value: EmpresaDraft[K]) => {
    setDraft((prev) =>
      prev ? { ...prev, empresa: { ...prev.empresa, [key]: value } } : prev,
    );
  };
  const updateVivienda = <K extends keyof ViviendaDraft>(key: K, value: ViviendaDraft[K]) => {
    clearAutofillSource(`vivienda.${String(key)}`);
    setDraft((prev) =>
      prev ? { ...prev, vivienda: { ...prev.vivienda, [key]: value } } : prev,
    );
  };
  const updateCredito = <K extends keyof CreditoDraft>(key: K, value: CreditoDraft[K]) => {
    setDraft((prev) =>
      prev ? { ...prev, credito: { ...prev.credito, [key]: value } } : prev,
    );
  };
  const updateDestinoClabeDerechohabiente = (value: string) => {
    clearAutofillSource("destinoRecursos.clabeDerechohabiente");
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            destinoRecursos: normalizeDestinoRecursosForCapture({
              ...prev.destinoRecursos,
              clabeDerechohabiente: value,
            }),
          }
        : prev,
    );
  };
  const updateBeneficiario = <K extends keyof BeneficiarioDraft>(
    key: K,
    value: BeneficiarioDraft[K],
  ) => {
    setDraft((prev) =>
      prev
        ? { ...prev, beneficiario: { ...prev.beneficiario, [key]: value } }
        : prev,
    );
  };
  const updateReferencia = <K extends keyof ReferenciaDraft>(
    index: number,
    key: K,
    value: ReferenciaDraft[K],
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const referencias = [...prev.referencias];
      const current = referencias[index] ?? parseReference(null);
      referencias[index] = { ...current, [key]: value };
      return { ...prev, referencias };
    });
  };

  const handleGenerate = async () => {
    if (!draft || generating) return;
    setGenerateError(null);
    setSuccess(null);

    if (missingCore.length > 0) {
      setGenerateError(`Completa antes de generar: ${missingCore.join(", ")}.`);
      return;
    }

    const plazo = draft.credito.plazoAnios;
    if (plazo !== null && (!Number.isInteger(plazo) || plazo < 1 || plazo > 10)) {
      setGenerateError("El plazo debe ser un número entero entre 1 y 10 años.");
      return;
    }

    const clabeCheck = validateClabeDerechohabienteForGenerate(
      draft.destinoRecursos.clabeDerechohabiente,
    );
    if (!clabeCheck.ok) {
      setGenerateError(clabeCheck.message);
      return;
    }

    setGenerating(true);
    try {
      if (!supabaseBrowser) throw new Error("Supabase no está configurado.");
      const payload = buildMesaInfonavitGeneratePayload({
        ...draft,
        destinoRecursos: {
          ...draft.destinoRecursos,
          clabeDerechohabiente: clabeCheck.normalized,
        },
      });

      const { data, error } = await supabaseBrowser.rpc(
        "mesa_generar_infonavit_documentos",
        { p_expediente_id: expedienteId, p_payload: payload },
      );
      if (error) throw error;
      const response = recordOf(data);
      const version = num(response.submission_version);
      const versionInt = version === null ? 0 : Math.trunc(version);
      writeLocalDraft(expedienteId, payload);
      setDraft(payload);
      setLocalSaveState("saved");
      setSuccess(
        `Generación iniciada correctamente${version !== null ? ` · versión ${versionInt}` : ""}.`,
      );
      onGenerated?.(versionInt);
    } catch (error) {
      setGenerateError(errorMessage(error, "No se pudieron generar los documentos."));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-600">Preparando información desde Datos Generales…</p>;
  }

  if (loadError || !draft) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-800">{loadError ?? "No se pudo cargar el formulario."}</p>
        <Button type="button" variant="outline" className="mt-2" onClick={() => void loadDraft()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div
      className="space-y-5"
      data-testid="mesa-infonavit-generar-layout"
    >
      <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
        <p>
          Los campos parten de Datos Generales. Los cambios de esta pestaña solo afectan la nueva
          versión de los 3 documentos INFONAVIT; no modifican Datos Generales, etapas ni citas.
        </p>
        <p className="mt-1 font-medium text-violet-800">
          {localSaveState === "restored"
            ? "Cambios locales restaurados para este expediente."
            : "Cambios guardados automáticamente en este navegador por expediente."}
        </p>
      </div>

      {autofillState.status !== "idle" ? (
        <div
          className={[
            "rounded-md border px-3 py-2 text-xs",
            autofillState.status === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : autofillState.status === "partial" || autofillState.conflicts > 0
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50 text-emerald-950",
          ].join(" ")}
          data-testid="infonavit-document-autofill-status"
        >
          {autofillState.status === "reading" ? (
            <p className="font-medium">
              Leyendo INE, comprobante de domicilio y estado de cuenta…
            </p>
          ) : (
            <>
              <p className="font-medium">
                Automatización documental: {autofillState.applied} campos llenados ·{" "}
                {autofillState.confirmed} confirmados con documento.
              </p>
              {autofillConflicts.length > 0 ? (
                <div className="mt-1 space-y-1">
                  <p>
                    {autofillConflicts.length} diferencias detectadas: se aplicó el
                    valor del documento fuente. Revisa antes de generar si hace falta.
                  </p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {autofillConflicts.slice(0, 8).map((conflict) => (
                      <li key={conflict.field}>
                        <span className="font-medium">
                          {autofillFieldLabel(conflict.field)}
                        </span>
                        : Datos Generales “{conflict.current}” · {conflict.sourceLabel}
                        aplicó “{conflict.detected}”.
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {autofillState.errors.length > 0 ? (
                <p className="mt-1">
                  {autofillState.errors.length} documento(s) no pudieron leerse
                  automáticamente. Puedes seguir manualmente o reintentar.
                </p>
              ) : null}
              {autofillState.warnings.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {autofillState.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="mt-2 px-2 py-1 text-[11px]"
                onClick={() => {
                  autofillRunKeyRef.current = null;
                  autofillInFlightKeyRef.current = null;
                  setAutofillRetryNonce((value) => value + 1);
                }}
              >
                Volver a leer documentos
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div
        className={
          sourceContext === "identidad" || sourceContext === "rfc"
            ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start"
            : undefined
        }
        data-testid="infonavit-source-section-identidad"
      >
        <div className="min-w-0 space-y-3">
          <SectionTitle
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="px-2 py-1 text-[11px]"
                  onClick={() => openSourceDocument("identidad", "frente")}
                >
                  Ver INE frente
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="px-2 py-1 text-[11px]"
                  onClick={() => openSourceDocument("identidad", "reverso")}
                >
                  Ver INE reverso
                </Button>
              </>
            }
          >
            1. Identificación de la persona derechohabiente
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="NSS *" value={draft.cliente.nss} onChange={(v) => updateCliente("nss", v)} required />
            <Field label="CURP" value={draft.cliente.curp} onChange={(v) => updateCliente("curp", v.toUpperCase())} onFocusField={() => focusSource("curp")} sourceLabel={autofillSources["cliente.curp"]} />
            <Field label="RFC" value={draft.cliente.rfc} onChange={(v) => updateCliente("rfc", v.toUpperCase())} onFocusField={() => focusSource("rfc")} />
            <Field label="Apellido paterno *" value={draft.cliente.apellidoPaterno} onChange={(v) => updateCliente("apellidoPaterno", v.toUpperCase())} onFocusField={() => focusSource("apellidoPaterno")} sourceLabel={autofillSources["cliente.apellidoPaterno"]} required />
            <Field label="Apellido materno" value={draft.cliente.apellidoMaterno} onChange={(v) => updateCliente("apellidoMaterno", v.toUpperCase())} onFocusField={() => focusSource("apellidoMaterno")} sourceLabel={autofillSources["cliente.apellidoMaterno"]} />
            <Field label="Nombre(s) *" value={draft.cliente.nombres} onChange={(v) => updateCliente("nombres", v.toUpperCase())} onFocusField={() => focusSource("nombres")} sourceLabel={autofillSources["cliente.nombres"]} required />
            <Field label="Tipo identificación" value={draft.cliente.identificacion.tipo} onChange={(v) => updateIdentificacion("tipo", v)} onFocusField={() => focusSource("identificacionTipo")} sourceLabel={autofillSources["cliente.identificacion.tipo"]} />
            <Field label="Número identificación" value={draft.cliente.identificacion.numero} onChange={(v) => updateIdentificacion("numero", v)} onFocusField={() => focusSource("identificacionNumero")} sourceLabel={autofillSources["cliente.identificacion.numero"]} />
            <Field label="Vigencia identificación" value={draft.cliente.identificacion.vigencia} onChange={(v) => updateIdentificacion("vigencia", v)} onFocusField={() => focusSource("identificacionVigencia")} sourceLabel={autofillSources["cliente.identificacion.vigencia"]} placeholder="dd/mm/aaaa" />
            <Field label="LADA" value={draft.cliente.ladaTelefono} onChange={(v) => updateCliente("ladaTelefono", v)} />
            <Field label="Teléfono" value={draft.cliente.telefono} onChange={(v) => updateCliente("telefono", v)} />
            <Field label="Celular" value={draft.cliente.celular} onChange={(v) => updateCliente("celular", v)} />
            <Field label="Correo" type="email" value={draft.cliente.correo} onChange={(v) => updateCliente("correo", v)} />
            <SelectField label="Género" value={draft.cliente.genero} onChange={(v) => updateCliente("genero", v)} sourceLabel={autofillSources["cliente.genero"]} options={[{ value: "M", label: "Masculino" }, { value: "F", label: "Femenino" }]} />
            <SelectField label="Estado civil" value={draft.cliente.estadoCivil} onChange={(v) => updateCliente("estadoCivil", v)} options={[{ value: "soltero", label: "Soltero(a)" }, { value: "casado", label: "Casado(a)" }]} />
            <SelectField label="Régimen matrimonial" value={draft.cliente.regimenMatrimonial} onChange={(v) => updateCliente("regimenMatrimonial", v)} options={[{ value: "separacion_bienes", label: "Separación de bienes" }, { value: "sociedad_conyugal", label: "Sociedad conyugal" }]} />
          </div>
        </div>

        {sourceContext === "identidad" || sourceContext === "rfc" ? (
          <div className="min-w-0 xl:self-start" data-testid="infonavit-source-preview-identidad">
            <MesaInfonavitSourceDocumentPreview
              expedienteId={expedienteId}
              context={sourceContext}
              requestedIneSide={requestedIneSide}
              className="max-h-[min(70vh,720px)]"
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <SectionTitle>2. Empresa o patrón</SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Field label="Nombre completo de la empresa o patrón *" value={draft.empresa.nombre} onChange={(v) => updateEmpresa("nombre", v.toUpperCase())} required />
          </div>
          <Field label="Número de registro patronal (NRPP) *" value={draft.empresa.registroPatronal} onChange={(v) => updateEmpresa("registroPatronal", v.toUpperCase())} required />
          <Field label="LADA empresa" value={draft.empresa.lada} onChange={(v) => updateEmpresa("lada", v)} />
          <Field label="Teléfono empresa" value={draft.empresa.telefono} onChange={(v) => updateEmpresa("telefono", v)} />
          <Field label="Extensión" value={draft.empresa.extension} onChange={(v) => updateEmpresa("extension", v)} />
        </div>
      </div>

      <div
        className={
          sourceContext === "vivienda"
            ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start"
            : undefined
        }
        data-testid="infonavit-source-section-vivienda"
      >
        <div className="min-w-0 space-y-3">
          <SectionTitle
            actions={
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-[11px]"
                onClick={() => openSourceDocument("vivienda")}
              >
                Ver comprobante
              </Button>
            }
          >
            3. Vivienda a mejorar
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2"><Field label="Calle" value={draft.vivienda.calle} onChange={(v) => updateVivienda("calle", v.toUpperCase())} onFocusField={() => focusSource("viviendaCalle")} sourceLabel={autofillSources["vivienda.calle"]} /></div>
            <Field label="No. ext." value={draft.vivienda.noExt} onChange={(v) => updateVivienda("noExt", v)} onFocusField={() => focusSource("viviendaNoExt")} sourceLabel={autofillSources["vivienda.noExt"]} />
            <Field label="No. int." value={draft.vivienda.noInt} onChange={(v) => updateVivienda("noInt", v)} onFocusField={() => focusSource("viviendaNoInt")} sourceLabel={autofillSources["vivienda.noInt"]} />
            <Field label="Lote" value={draft.vivienda.lote} onChange={(v) => updateVivienda("lote", v)} onFocusField={() => focusSource("viviendaLote")} sourceLabel={autofillSources["vivienda.lote"]} />
            <Field label="Manzana" value={draft.vivienda.manzana} onChange={(v) => updateVivienda("manzana", v)} onFocusField={() => focusSource("viviendaManzana")} sourceLabel={autofillSources["vivienda.manzana"]} />
            <Field label="Colonia" value={draft.vivienda.colonia} onChange={(v) => updateVivienda("colonia", v.toUpperCase())} onFocusField={() => focusSource("viviendaColonia")} sourceLabel={autofillSources["vivienda.colonia"]} />
            <Field label="Código postal" value={draft.vivienda.cp} onChange={(v) => updateVivienda("cp", v)} onFocusField={() => focusSource("viviendaCp")} sourceLabel={autofillSources["vivienda.cp"]} />
            <Field label="Entidad" value={draft.vivienda.entidad} onChange={(v) => updateVivienda("entidad", v.toUpperCase())} onFocusField={() => focusSource("viviendaEntidad")} sourceLabel={autofillSources["vivienda.entidad"]} />
            <Field label="Municipio / alcaldía" value={draft.vivienda.municipio} onChange={(v) => updateVivienda("municipio", v.toUpperCase())} onFocusField={() => focusSource("viviendaMunicipio")} sourceLabel={autofillSources["vivienda.municipio"]} />
            <SelectField label="La vivienda es" value={draft.vivienda.tipoPropiedad} onChange={(v) => updateVivienda("tipoPropiedad", v)} onFocusField={() => focusSource("viviendaTipoPropiedad")} options={[{ value: "propia", label: "Propia" }, { value: "conyuge_concubino", label: "Cónyuge o concubino(a)" }, { value: "familiar", label: "Familiar" }]} />
          </div>
        </div>

        {sourceContext === "vivienda" ? (
          <div className="min-w-0 xl:self-start" data-testid="infonavit-source-preview-vivienda">
            <MesaInfonavitSourceDocumentPreview
              expedienteId={expedienteId}
              context={sourceContext}
              requestedIneSide={requestedIneSide}
              className="max-h-[min(70vh,720px)]"
            />
          </div>
        ) : null}
      </div>

      <div
        className={
          sourceContext === "clabe"
            ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start"
            : undefined
        }
        data-testid="infonavit-source-section-clabe"
      >
        <div className="min-w-0 space-y-3">
          <SectionTitle
            actions={
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-[11px]"
                onClick={() => openSourceDocument("clabe")}
              >
                Ver estado de cuenta
              </Button>
            }
          >
            4. Crédito y destino de recursos
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Field
              label="Monto de crédito solicitado *"
              type="number"
              value={draft.credito.montoSolicitado}
              onChange={(v) =>
                updateCredito("montoSolicitado", v.trim() ? Number(v) : null)
              }
              required
            />
            <Field
              label="Plazo solicitado (años)"
              type="number"
              value={draft.credito.plazoAnios}
              onChange={(v) =>
                updateCredito("plazoAnios", v.trim() ? Number(v) : null)
              }
            />
            <Field
              label="CLABE del derechohabiente"
              value={draft.destinoRecursos.clabeDerechohabiente}
              onChange={(v) => updateDestinoClabeDerechohabiente(v)}
              onFocusField={() => focusSource("clabeDerechohabiente")}
              sourceLabel={autofillSources["destinoRecursos.clabeDerechohabiente"]}
              maxLength={40}
            />
          </div>
        </div>

        {sourceContext === "clabe" ? (
          <div className="min-w-0 xl:self-start" data-testid="infonavit-source-preview-clabe">
            <MesaInfonavitSourceDocumentPreview
              expedienteId={expedienteId}
              context={sourceContext}
              requestedIneSide={requestedIneSide}
              clabeAppliedValue={
                autofillSources["destinoRecursos.clabeDerechohabiente"]
                  ? draft.destinoRecursos.clabeDerechohabiente
                  : null
              }
              className="max-h-[min(70vh,720px)]"
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <SectionTitle>5. Referencias familiares</SectionTitle>
        {draft.referencias.slice(0, 2).map((ref, index) => (
          <div key={index} className="rounded-md border border-gray-200 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-700">Referencia {index + 1}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Apellido paterno" value={ref.apellidoPaterno} onChange={(v) => updateReferencia(index, "apellidoPaterno", v.toUpperCase())} />
              <Field label="Apellido materno" value={ref.apellidoMaterno} onChange={(v) => updateReferencia(index, "apellidoMaterno", v.toUpperCase())} />
              <Field label="Nombre(s)" value={ref.nombres} onChange={(v) => updateReferencia(index, "nombres", v.toUpperCase())} />
              <Field label="LADA" value={ref.lada} onChange={(v) => updateReferencia(index, "lada", v)} />
              <Field label="Teléfono" value={ref.telefono} onChange={(v) => updateReferencia(index, "telefono", v)} />
              <Field label="Celular" value={ref.celular} onChange={(v) => updateReferencia(index, "celular", v)} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <SectionTitle>6. Beneficiario</SectionTitle>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Parentesco *" value={draft.beneficiario.parentesco} onChange={(v) => updateBeneficiario("parentesco", v.toUpperCase())} required />
          <Field label="Apellido paterno" value={draft.beneficiario.apellidoPaterno} onChange={(v) => updateBeneficiario("apellidoPaterno", v.toUpperCase())} />
          <Field label="Apellido materno" value={draft.beneficiario.apellidoMaterno} onChange={(v) => updateBeneficiario("apellidoMaterno", v.toUpperCase())} />
          <Field label="Nombre(s) *" value={draft.beneficiario.nombres} onChange={(v) => updateBeneficiario("nombres", v.toUpperCase())} required />
        </div>
      </div>

      <div className="space-y-3">
        <SectionTitle>7. Cierre y mejora</SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Localidad / ciudad" value={draft.localidad} onChange={(v) => setDraft((prev) => prev ? { ...prev, localidad: v.toUpperCase(), ciudadCierre: v.toUpperCase() } : prev)} />
          <Field label="Fecha del documento" type="date" value={draft.fechaDocumento} onChange={(v) => setDraft((prev) => prev ? { ...prev, fechaDocumento: v } : prev)} />
        </div>
        <label className="block text-xs font-medium text-gray-700">
          <span>Mejora / remodelación a realizar</span>
          <textarea
            value={draft.mejora.descripcion}
            onChange={(event) => setDraft((prev) => prev ? { ...prev, mejora: { ...prev.mejora, descripcion: event.target.value } } : prev)}
            rows={5}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </label>
        <p className="text-xs text-gray-500">
          Si dejas la descripción vacía al generar, el sistema creará una combinación distinta y coherente con el monto. En Presupuesto de Mejoramiento el monto estimado y la fecha inferior quedarán en blanco.
        </p>
      </div>

      {missingCore.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Antes de generar completa: {missingCore.join(", ")}.
        </div>
      ) : null}
      {generateError ? <p role="alert" className="text-sm text-red-700">{generateError}</p> : null}
      {success ? <p className="text-sm font-medium text-emerald-700">{success}</p> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
        <Button type="button" onClick={() => void handleGenerate()} disabled={generating}>
          {generating ? "Generando…" : "Generar los 3 documentos"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadDraft({ forceServer: true })}
          disabled={generating}
          title="Descarta los cambios locales de esta pestaña y vuelve a copiar los Datos Generales actuales."
        >
          Recargar desde Datos Generales
        </Button>
      </div>
    </div>
  );
}
