/**
 * Parser de impresión P189 — no muta `expedientes.direccion_opcional`.
 * Cada componente tiene confidence independiente.
 * Sin evidencia (COL/CP/N.L./número) el componente queda vacío.
 * direccionCompleta siempre = raw.
 */

export type DireccionFieldConfidence = "high" | "none";

export interface DireccionMxConfidence {
  calle: DireccionFieldConfidence;
  numeroExterior: DireccionFieldConfidence;
  numeroInterior: DireccionFieldConfidence;
  lote: DireccionFieldConfidence;
  manzana: DireccionFieldConfidence;
  colonia: DireccionFieldConfidence;
  municipio: DireccionFieldConfidence;
  entidad: DireccionFieldConfidence;
  codigoPostal: DireccionFieldConfidence;
}

export interface DireccionMxParsed {
  direccionCompleta: string;
  calle: string;
  numeroExterior: string;
  numeroInterior: string;
  lote: string;
  manzana: string;
  colonia: string;
  municipio: string;
  entidad: string;
  codigoPostal: string;
  confidence: DireccionMxConfidence;
}

const NONE: DireccionFieldConfidence = "none";
const HIGH: DireccionFieldConfidence = "high";

function emptyConfidence(): DireccionMxConfidence {
  return {
    calle: NONE,
    numeroExterior: NONE,
    numeroInterior: NONE,
    lote: NONE,
    manzana: NONE,
    colonia: NONE,
    municipio: NONE,
    entidad: NONE,
    codigoPostal: NONE,
  };
}

function emptyParsed(direccionCompleta: string): DireccionMxParsed {
  return {
    direccionCompleta,
    calle: "",
    numeroExterior: "",
    numeroInterior: "",
    lote: "",
    manzana: "",
    colonia: "",
    municipio: "",
    entidad: "",
    codigoPostal: "",
    confidence: emptyConfidence(),
  };
}

function collapseUpper(raw: string): string {
  return raw
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-MX");
}

function setHigh<K extends keyof DireccionMxParsed>(
  out: DireccionMxParsed,
  key: K,
  value: string,
  confKey: keyof DireccionMxConfidence,
): void {
  if (!value) return;
  (out[key] as string) = value;
  out.confidence[confKey] = HIGH;
}

/**
 * Extrae componentes solo con evidencia.
 * Entidad N.L. / NL / NUEVO LEON → NUEVO LEÓN.
 * noInt / lote / manzana solo si vienen etiquetados.
 */
export function parseDireccionMxParaSolicitud(
  raw: string | null | undefined,
): DireccionMxParsed {
  const direccionCompleta = (raw ?? "").trim();
  if (!direccionCompleta) return emptyParsed("");

  const out = emptyParsed(direccionCompleta);
  let work = collapseUpper(direccionCompleta);

  const loteMatch = work.match(/\b(?:LOTE|LT)\.?\s+(\S+)/);
  if (loteMatch) {
    setHigh(out, "lote", loteMatch[1]!, "lote");
    work = work.replace(loteMatch[0], " ");
  }
  const mzMatch = work.match(/\b(?:MANZANA|MZ)\.?\s+(\S+)/);
  if (mzMatch) {
    setHigh(out, "manzana", mzMatch[1]!, "manzana");
    work = work.replace(mzMatch[0], " ");
  }

  const cpMatch = work.match(/(?<!\d)(\d{5})(?!\d)/);
  if (cpMatch) setHigh(out, "codigoPostal", cpMatch[1]!, "codigoPostal");

  const intMatch = work.match(/\b(?:INT(?:ERIOR)?\.?)\s+(\S+)/);
  if (intMatch) {
    setHigh(out, "numeroInterior", intMatch[1]!, "numeroInterior");
    work = work.replace(intMatch[0], " ");
  }

  const colBeforeCp = work.match(/\b(?:COL(?:ONIA)?\.?)\s+(.+?)(?=\s+\d{5}\b)/);
  if (colBeforeCp) {
    setHigh(out, "colonia", colBeforeCp[1]!.trim(), "colonia");
    work = work.replace(colBeforeCp[0], " ");
  } else {
    const colBeforeEnt = work.match(
      /\b(?:COL(?:ONIA)?\.?)\s+(.+?)(?=\s+N\.L\.?|\s+\bNL\b|\s+NUEVO LE[OÓ]N\b)/,
    );
    if (colBeforeEnt) {
      setHigh(out, "colonia", colBeforeEnt[1]!.trim(), "colonia");
      work = work.replace(colBeforeEnt[0], " ");
    }
  }

  const hasNuevoLeon =
    /\bNUEVO LE[OÓ]N\b/.test(work) ||
    /N\.L\.?/.test(work) ||
    /\bNL\b/.test(work);
  if (hasNuevoLeon) {
    setHigh(out, "entidad", "NUEVO LEÓN", "entidad");
    work = work.replace(/\bNUEVO LE[OÓ]N\b/g, " ");
    work = work.replace(/N\.L\.?/g, " ");
    work = work.replace(/\bNL\b/g, " ");
  }

  if (out.codigoPostal) {
    work = work.replace(new RegExp(`\\b${out.codigoPostal}\\b`), " ");
  }
  work = work.replace(/\bC\.?P\.?\b/g, " ");
  work = work.replace(/\s+/g, " ").trim();

  const streetMatch = work.match(/^(.+?)\s+(\d+[A-Z]{0,3})(?:\s+(.+))?$/);
  if (streetMatch) {
    setHigh(out, "calle", streetMatch[1]!.trim(), "calle");
    setHigh(out, "numeroExterior", streetMatch[2]!.trim(), "numeroExterior");
    const rest = (streetMatch[3] ?? "").trim();
    if (
      rest &&
      (out.confidence.codigoPostal === HIGH || out.confidence.entidad === HIGH)
    ) {
      const restTokens = rest.split(" ").filter((t) => t.length > 0);
      const last = restTokens[restTokens.length - 1] ?? "";
      if (last && !/^\d/.test(last)) {
        setHigh(out, "municipio", last, "municipio");
      }
    }
  } else if (work) {
    setHigh(out, "calle", work, "calle");
  }

  if (!out.calle) {
    setHigh(out, "calle", collapseUpper(direccionCompleta), "calle");
  }

  return out;
}
