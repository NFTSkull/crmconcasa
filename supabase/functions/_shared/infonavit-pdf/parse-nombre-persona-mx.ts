/**
 * Parser de impresión P189 — no muta JSON canónico del CRM.
 * Conserva acentos/Ñ; uppercase es-MX para PDF.
 *
 * confidence=high → apellidos usables en Solicitud.
 * confidence=none → NOMBRE(S)=completo; paterno/materno vacíos.
 * 4 tokens cuyo paterno empieza con partícula (MARIA DEL CARMEN LOPEZ)
 * se tratan como none: preferible incompleto que incorrecto.
 */

const MULTI_PARTICLES = ["DE LAS", "DE LOS", "DE LA"] as const;
const SINGLE_PARTICLES = [
  "DEL",
  "DE",
  "SANTA",
  "SAN",
  "LAS",
  "LOS",
  "LA",
] as const;

export type NombreParseConfidence = "high" | "none";

export interface NombrePersonaMxParsed {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  parsed: boolean;
  confidence: NombreParseConfidence;
}

export function normalizeNombrePrintMx(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("es-MX");
}

function isParticleToken(token: string): boolean {
  return (SINGLE_PARTICLES as readonly string[]).includes(token);
}

function paternoStartsWithParticle(apellido: string): boolean {
  const upper = apellido.trim();
  for (const multi of MULTI_PARTICLES) {
    if (upper === multi || upper.startsWith(`${multi} `)) return true;
  }
  const first = upper.split(" ")[0] ?? "";
  return isParticleToken(first);
}

function isParticleOnly(apellido: string): boolean {
  const parts = apellido.split(" ").filter((p) => p.length > 0);
  if (parts.length === 0) return true;
  for (let i = 0; i < parts.length; ) {
    if (i + 1 < parts.length) {
      const pair = `${parts[i]} ${parts[i + 1]}`;
      if ((MULTI_PARTICLES as readonly string[]).includes(pair)) {
        i += 2;
        continue;
      }
    }
    if (!isParticleToken(parts[i]!)) return false;
    i += 1;
  }
  return true;
}

function popApellido(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  let apellido = tokens.pop()!;
  while (tokens.length > 0) {
    if (tokens.length >= 2) {
      const pair = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`;
      if ((MULTI_PARTICLES as readonly string[]).includes(pair)) {
        tokens.pop();
        tokens.pop();
        apellido = `${pair} ${apellido}`;
        continue;
      }
    }
    const one = tokens[tokens.length - 1]!;
    if ((SINGLE_PARTICLES as readonly string[]).includes(one)) {
      tokens.pop();
      apellido = `${one} ${apellido}`;
      continue;
    }
    break;
  }
  if (!apellido || isParticleOnly(apellido)) return null;
  return apellido;
}

function unparsed(full: string): NombrePersonaMxParsed {
  return {
    nombres: full,
    apellidoPaterno: "",
    apellidoMaterno: "",
    parsed: false,
    confidence: "none",
  };
}

/**
 * Separa nombre mexicano para AcroForm de Solicitud.
 * 3 tokens clásicos y 4+ sin partícula inicial en paterno → high.
 */
export function parseNombrePersonaMx(
  fullName: string | null | undefined,
): NombrePersonaMxParsed {
  const full = normalizeNombrePrintMx(fullName);
  if (!full) {
    return {
      nombres: "",
      apellidoPaterno: "",
      apellidoMaterno: "",
      parsed: false,
      confidence: "none",
    };
  }

  const tokens = full.split(" ");
  const originalCount = tokens.length;
  if (originalCount < 3) return unparsed(full);

  const working = [...tokens];
  const apellidoMaterno = popApellido(working);
  if (!apellidoMaterno || working.length < 2) return unparsed(full);

  const apellidoPaterno = popApellido(working);
  if (!apellidoPaterno || working.length < 1) return unparsed(full);

  const nombres = working.join(" ").trim();
  if (!nombres) return unparsed(full);

  if (originalCount <= 4 && paternoStartsWithParticle(apellidoPaterno)) {
    return unparsed(full);
  }

  return {
    nombres,
    apellidoPaterno,
    apellidoMaterno,
    parsed: true,
    confidence: "high",
  };
}
