/**
 * RFC estimado de persona física (algoritmo determinista local).
 * Nunca es oficial ni validado ante el SAT.
 */

const VOCALES = new Set(["A", "E", "I", "O", "U"]);
const PARTICULAS = new Set([
  "DE",
  "DEL",
  "LA",
  "LAS",
  "LOS",
  "Y",
  "MC",
  "MAC",
  "VON",
  "VAN",
]);

const INCONVENIENTES: Readonly<Record<string, string>> = {
  BUEI: "BUEX",
  BUEY: "BUEX",
  CACA: "CACX",
  CACO: "CACX",
  CAGA: "CAGX",
  CAGO: "CAGX",
  CAKA: "CAKX",
  COGE: "COGX",
  COJA: "COJX",
  COJE: "COJX",
  COJI: "COJX",
  COJO: "COJX",
  FETO: "FETX",
  JOTO: "JOTX",
  KACO: "KACX",
  KAGO: "KAGX",
  KOJO: "KOJX",
  KAKA: "KAKX",
  KULO: "KULX",
  MAME: "MAMX",
  MAMO: "MAMX",
  MEAR: "MEAX",
  MEAS: "MEAX",
  MEON: "MEOX",
  MION: "MIOX",
  MOCO: "MOCX",
  MULA: "MULX",
  PEDA: "PEDX",
  PEDO: "PEDX",
  PENE: "PENX",
  PUTA: "PUTX",
  PUTO: "PUTX",
  QULO: "QULX",
  RATA: "RATX",
  RUIN: "RUIX",
};

const NOMBRES_IGNORAR = new Set(["MARIA", "JOSE", "MA", "J", "M"]);

export function normalizePersonToken(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/Ñ/g, "X") // RFC histórico usa X por Ñ en algunos pasos; conservamos N aparte abajo
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza conservando Ñ como N para comparación, X en RFC según reglas. */
export function normalizeForRfc(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/Ñ/g, "X")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensSinParticulas(nombre: string): string[] {
  return normalizeForRfc(nombre)
    .split(" ")
    .filter((t) => t && !PARTICULAS.has(t));
}

function primeraVocalInterna(word: string): string {
  for (let i = 1; i < word.length; i++) {
    const ch = word[i]!;
    if (VOCALES.has(ch)) return ch;
  }
  return "X";
}

function primeraConsonanteInterna(word: string): string {
  for (let i = 1; i < word.length; i++) {
    const ch = word[i]!;
    if (!VOCALES.has(ch) && /[A-Z]/.test(ch)) return ch;
  }
  return "X";
}

function pickGivenName(nombres: string[]): string {
  if (nombres.length === 0) return "X";
  if (nombres.length === 1) return nombres[0]!;
  if (NOMBRES_IGNORAR.has(nombres[0]!) && nombres[1]) return nombres[1]!;
  return nombres[0]!;
}

function padNamePart(word: string): string {
  const w = word || "X";
  return (w[0] ?? "X").padEnd(1, "X");
}

export type RfcEstimadoInput = Readonly<{
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno?: string | null;
  fechaNacimiento: string; // YYYY-MM-DD
}>;

export type RfcEstimadoResult = Readonly<{
  status: "SIN_DATOS" | "RFC_ESTIMADO";
  rfcEstimado: string | null;
  etiqueta: string;
}>;

const RFC_ETIQUETA =
  "RFC estimado. Pendiente de validación en el SAT.";

/** Homoclave estimada (2 chars + dígito) — determinista, no oficial. */
function homoclaveEstimada(
  nombreFull: string,
  fecha: string,
): string {
  // Tabla simplificada de valores (SAT-like)
  const table: Record<string, number> = {};
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ&Ñ";
  for (let i = 0; i < chars.length; i++) table[chars[i]!] = i;

  const key = normalizeForRfc(`${nombreFull}${fecha}`).replace(/\s+/g, "");
  let sum = 0;
  for (let i = 0; i < key.length; i++) {
    const v = table[key[i]!] ?? 0;
    sum += v * (i + 1);
  }
  const a = Math.floor(sum / 34) % 34;
  const b = sum % 34;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const h1 = alphabet[a] ?? "0";
  const h2 = alphabet[b] ?? "0";
  // dígito verificador estimado sobre 12 chars base+homo parcial
  return `${h1}${h2}`;
}

function digitoVerificadorRfc(rfc12: string): string {
  const valores: Record<string, number> = {};
  const seq = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ ";
  for (let i = 0; i < seq.length; i++) valores[seq[i]!] = i;
  // Persona física: 13 posiciones con espacio inicial implícito en algoritmo SAT
  const padded = ` ${rfc12}`.slice(0, 13);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const ch = padded[i] ?? " ";
    sum += (valores[ch] ?? 0) * (13 - i);
  }
  const mod = sum % 11;
  if (mod === 0) return "0";
  if (mod === 10) return "A";
  return String(11 - mod);
}

export function estimarRfcPersonaFisica(
  input: RfcEstimadoInput,
): RfcEstimadoResult {
  const apPatTokens = tokensSinParticulas(input.apellidoPaterno);
  const apMatTokens = tokensSinParticulas(input.apellidoMaterno ?? "");
  const nomTokens = tokensSinParticulas(input.nombre);
  const fecha = (input.fechaNacimiento ?? "").trim().slice(0, 10);

  if (
    apPatTokens.length === 0 ||
    nomTokens.length === 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha)
  ) {
    return { status: "SIN_DATOS", rfcEstimado: null, etiqueta: RFC_ETIQUETA };
  }

  const apPat = apPatTokens[0]!;
  const apMat = apMatTokens[0] ?? "";
  const nombre = pickGivenName(nomTokens);

  let letters = "";
  if (!apMat) {
    // Sin apellido materno: 2 letras del paterno + 2 del nombre
    letters =
      padNamePart(apPat) +
      (apPat[1] ?? "X") +
      padNamePart(nombre) +
      (nombre[1] ?? "X");
  } else {
    letters =
      padNamePart(apPat) +
      primeraVocalInterna(apPat) +
      padNamePart(apMat) +
      padNamePart(nombre);
  }

  letters = letters.slice(0, 4).toUpperCase();
  if (INCONVENIENTES[letters]) letters = INCONVENIENTES[letters]!;

  const yy = fecha.slice(2, 4);
  const mm = fecha.slice(5, 7);
  const dd = fecha.slice(8, 10);
  const datePart = `${yy}${mm}${dd}`;

  const nombreFull = [apPat, apMat, ...nomTokens].filter(Boolean).join(" ");
  const homo2 = homoclaveEstimada(nombreFull, fecha);
  const base12 = `${letters}${datePart}${homo2}`;
  const digito = digitoVerificadorRfc(base12);
  const rfc = `${base12}${digito}`;

  void primeraConsonanteInterna;
  return {
    status: "RFC_ESTIMADO",
    rfcEstimado: rfc,
    etiqueta: RFC_ETIQUETA,
  };
}

/** Compara RFC capturado vs estimado (normalizado). */
export function compareRfcCapturadoVsEstimado(
  capturado: string | null | undefined,
  estimado: string | null | undefined,
): "SIN_DATOS" | "RFC_CAPTURADO_COINCIDE" | "RFC_CAPTURADO_NO_COINCIDE" {
  const a = normalizeForRfc(capturado ?? "").replace(/\s+/g, "");
  const b = normalizeForRfc(estimado ?? "").replace(/\s+/g, "");
  if (!a || !b) return "SIN_DATOS";
  return a === b ? "RFC_CAPTURADO_COINCIDE" : "RFC_CAPTURADO_NO_COINCIDE";
}
