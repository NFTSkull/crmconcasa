/**
 * Separación conservadora de nombre mexicano legacy → nombres/apellidos.
 * Misma política que `infonavit_parse_nombre_persona_mx` (P189):
 * confidence=high solo con 3+ tokens y paterno sin partícula inicial ambigua.
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

export type LegacyReferenciaNombreParsed = {
  /** Siempre el nombre original (nunca se borra). */
  nombre: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  /** true solo si la separación es de confianza alta. */
  parsed: boolean;
};

function normalizeFull(raw: string | null | undefined): string {
  return String(raw ?? "")
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

function unparsed(full: string): LegacyReferenciaNombreParsed {
  return {
    nombre: full,
    nombres: "",
    apellidoPaterno: "",
    apellidoMaterno: "",
    parsed: false,
  };
}

/**
 * Parsea `nombre` legacy de referencia.
 * Si no hay confianza: conserva `nombre` y deja partes vacías (UI no inventa apellidos).
 */
export function parseLegacyReferenciaNombre(
  fullName: string | null | undefined,
): LegacyReferenciaNombreParsed {
  const full = normalizeFull(fullName);
  if (!full) {
    return {
      nombre: "",
      nombres: "",
      apellidoPaterno: "",
      apellidoMaterno: "",
      parsed: false,
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

  // 4 tokens con paterno-partícula (MARIA DEL CARMEN LOPEZ) → no separar.
  if (originalCount <= 4 && paternoStartsWithParticle(apellidoPaterno)) {
    return unparsed(full);
  }

  return {
    nombre: full,
    nombres,
    apellidoPaterno,
    apellidoMaterno,
    parsed: true,
  };
}
