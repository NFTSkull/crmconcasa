"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  isValidClabeMexico,
  normalizeClabeMexico,
} from "@/domain/expediente-cliente-datos/clabe-mexico";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export const MESA_CLABE_DERECHOHABIENTE_INVALID_MSG =
  "La CLABE del derechohabiente no es válida. Verifica los 18 dígitos.";

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
}>;

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  maxLength,
}: FieldProps) {
  return (
    <label className="block text-xs font-medium text-gray-700">
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
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
}>;

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label className="block text-xs font-medium text-gray-700">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
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

function SectionTitle({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h4 className="border-b border-gray-200 pb-1 text-sm font-semibold text-gray-900">
      {children}
    </h4>
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
  const hydratedExpedienteRef = useRef<string | null>(null);

  const loadDraft = useCallback(async (options?: { forceServer?: boolean }) => {
    const forceServer = options?.forceServer === true;
    hydratedExpedienteRef.current = null;
    setLoading(true);
    setLoadError(null);
    setSuccess(null);
    setGenerateError(null);
    setLocalSaveState("idle");

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
    if (!draft.credito.montoSolicitado || draft.credito.montoSolicitado <= 0) {
      missing.push("monto solicitado");
    }
    if (!draft.beneficiario.parentesco.trim()) missing.push("parentesco beneficiario");
    if (!draft.beneficiario.nombres.trim()) missing.push("nombre beneficiario");
    return missing;
  }, [draft]);

  const updateCliente = <K extends keyof ClienteDraft>(key: K, value: ClienteDraft[K]) => {
    setDraft((prev) =>
      prev ? { ...prev, cliente: { ...prev.cliente, [key]: value } } : prev,
    );
  };
  const updateIdentificacion = <K extends keyof IdentificacionDraft>(
    key: K,
    value: IdentificacionDraft[K],
  ) => {
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
    <div className="space-y-5">
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

      <div className="space-y-3">
        <SectionTitle>1. Identificación de la persona derechohabiente</SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="NSS *" value={draft.cliente.nss} onChange={(v) => updateCliente("nss", v)} required />
          <Field label="CURP" value={draft.cliente.curp} onChange={(v) => updateCliente("curp", v.toUpperCase())} />
          <Field label="RFC" value={draft.cliente.rfc} onChange={(v) => updateCliente("rfc", v.toUpperCase())} />
          <Field label="Apellido paterno *" value={draft.cliente.apellidoPaterno} onChange={(v) => updateCliente("apellidoPaterno", v.toUpperCase())} required />
          <Field label="Apellido materno" value={draft.cliente.apellidoMaterno} onChange={(v) => updateCliente("apellidoMaterno", v.toUpperCase())} />
          <Field label="Nombre(s) *" value={draft.cliente.nombres} onChange={(v) => updateCliente("nombres", v.toUpperCase())} required />
          <Field label="Tipo identificación" value={draft.cliente.identificacion.tipo} onChange={(v) => updateIdentificacion("tipo", v)} />
          <Field label="Número identificación" value={draft.cliente.identificacion.numero} onChange={(v) => updateIdentificacion("numero", v)} />
          <Field label="Vigencia identificación" value={draft.cliente.identificacion.vigencia} onChange={(v) => updateIdentificacion("vigencia", v)} placeholder="dd/mm/aaaa" />
          <Field label="LADA" value={draft.cliente.ladaTelefono} onChange={(v) => updateCliente("ladaTelefono", v)} />
          <Field label="Teléfono" value={draft.cliente.telefono} onChange={(v) => updateCliente("telefono", v)} />
          <Field label="Celular" value={draft.cliente.celular} onChange={(v) => updateCliente("celular", v)} />
          <Field label="Correo" type="email" value={draft.cliente.correo} onChange={(v) => updateCliente("correo", v)} />
          <SelectField label="Género" value={draft.cliente.genero} onChange={(v) => updateCliente("genero", v)} options={[{ value: "M", label: "Masculino" }, { value: "F", label: "Femenino" }]} />
          <SelectField label="Estado civil" value={draft.cliente.estadoCivil} onChange={(v) => updateCliente("estadoCivil", v)} options={[{ value: "soltero", label: "Soltero(a)" }, { value: "casado", label: "Casado(a)" }]} />
          <SelectField label="Régimen matrimonial" value={draft.cliente.regimenMatrimonial} onChange={(v) => updateCliente("regimenMatrimonial", v)} options={[{ value: "separacion_bienes", label: "Separación de bienes" }, { value: "sociedad_conyugal", label: "Sociedad conyugal" }]} />
        </div>
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

      <div className="space-y-3">
        <SectionTitle>3. Vivienda a mejorar</SectionTitle>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2"><Field label="Calle" value={draft.vivienda.calle} onChange={(v) => updateVivienda("calle", v.toUpperCase())} /></div>
          <Field label="No. ext." value={draft.vivienda.noExt} onChange={(v) => updateVivienda("noExt", v)} />
          <Field label="No. int." value={draft.vivienda.noInt} onChange={(v) => updateVivienda("noInt", v)} />
          <Field label="Lote" value={draft.vivienda.lote} onChange={(v) => updateVivienda("lote", v)} />
          <Field label="Manzana" value={draft.vivienda.manzana} onChange={(v) => updateVivienda("manzana", v)} />
          <Field label="Colonia" value={draft.vivienda.colonia} onChange={(v) => updateVivienda("colonia", v.toUpperCase())} />
          <Field label="Código postal" value={draft.vivienda.cp} onChange={(v) => updateVivienda("cp", v)} />
          <Field label="Entidad" value={draft.vivienda.entidad} onChange={(v) => updateVivienda("entidad", v.toUpperCase())} />
          <Field label="Municipio / alcaldía" value={draft.vivienda.municipio} onChange={(v) => updateVivienda("municipio", v.toUpperCase())} />
          <SelectField label="La vivienda es" value={draft.vivienda.tipoPropiedad} onChange={(v) => updateVivienda("tipoPropiedad", v)} options={[{ value: "propia", label: "Propia" }, { value: "conyuge_concubino", label: "Cónyuge o concubino(a)" }, { value: "familiar", label: "Familiar" }]} />
        </div>
      </div>

      <div className="space-y-3">
        <SectionTitle>4. Crédito y destino de recursos</SectionTitle>
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
            onChange={(v) =>
              updateDestinoClabeDerechohabiente(
                // Digitos / espacios / guiones; letras y basura se rechazan (no se “arreglan”).
                v.replace(/[^\d\s-]/g, "").slice(0, 27),
              )
            }
            maxLength={27}
          />
        </div>
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
