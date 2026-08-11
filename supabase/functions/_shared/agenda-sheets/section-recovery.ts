/**
 * Recuperación de sección Sheet cuando falta el encabezado textual
 * (p.ej. A1 vacío en APODACA FIRMAS). El encabezado sigue siendo la fuente
 * preferida; esto solo rehidrata bloques físicos conocidos sin inventar sedes.
 */

export type SheetSectionRef = Readonly<{
  sede: "monterrey" | "apodaca";
  kind: "biometricos" | "firmas";
}>;

export type SectionHintByRow = ReadonlyMap<number, SheetSectionRef>;

/** Firmas Apodaca: histórico 10:00 y vigente 10:30 (filas 3–5 típicas). */
export function isPlausibleFirmasApodacaTime(hhmm: string): boolean {
  return hhmm === "10:00" || hhmm === "10:30";
}

/** Firmas Monterrey: franja matutina canónica del Sheet CITAS 2026. */
export function isPlausibleFirmasMonterreyTime(hhmm: string): boolean {
  return (
    hhmm === "08:30" ||
    hhmm === "09:00" ||
    hhmm === "09:30" ||
    hhmm === "10:00"
  );
}

export function isPlausibleTimeForSection(
  section: SheetSectionRef,
  hhmm: string,
): boolean {
  if (section.kind === "firmas" && section.sede === "apodaca") {
    return isPlausibleFirmasApodacaTime(hhmm);
  }
  if (section.kind === "firmas" && section.sede === "monterrey") {
    return isPlausibleFirmasMonterreyTime(hhmm);
  }
  // Biométricos: horarios variables — no forzar alien-time.
  return true;
}

function unanimousHint(
  rows: readonly number[],
  hints: SectionHintByRow | undefined,
): SheetSectionRef | null {
  if (!hints || rows.length === 0) return null;
  let first: SheetSectionRef | null = null;
  for (const r of rows) {
    const h = hints.get(r);
    if (!h) return null;
    if (!first) {
      first = h;
      continue;
    }
    if (first.sede !== h.sede || first.kind !== h.kind) return null;
  }
  return first;
}

function allMatch(
  times: readonly string[],
  pred: (t: string) => boolean,
): boolean {
  return times.length > 0 && times.every(pred);
}

/**
 * Resuelve sección para filas-hora huérfanas (sin encabezado activo).
 * Nunca asigna Apodaca a un 08:30 Monterrey ni Monterrey a un bloque 10:30 solo.
 */
export function resolveOrphanSection(params: {
  orphanTimes: readonly string[];
  orphanSheetRows: readonly number[];
  nextSection: SheetSectionRef | null;
  prevSection: SheetSectionRef | null;
  hints?: SectionHintByRow;
}): SheetSectionRef | null {
  const times = params.orphanTimes;
  const rows = params.orphanSheetRows;
  if (times.length === 0) return null;

  const hinted = unanimousHint(rows, params.hints);
  if (hinted) return hinted;

  const next = params.nextSection;
  if (next?.sede === "monterrey" && next.kind === "firmas") {
    // Bloque Apodaca Firmas suele ir ANTES de Monterrey Firmas (A1 + filas 3–5).
    if (allMatch(times, isPlausibleFirmasApodacaTime)) {
      return { sede: "apodaca", kind: "firmas" };
    }
  }
  if (next?.sede === "monterrey" && next.kind === "biometricos") {
    if (allMatch(times, isPlausibleFirmasMonterreyTime)) {
      return { sede: "monterrey", kind: "firmas" };
    }
    // 10:30 huérfano entre Monterrey Firmas (sticky) y Monterrey Bio → Apodaca Firmas.
    if (allMatch(times, isPlausibleFirmasApodacaTime)) {
      return { sede: "apodaca", kind: "firmas" };
    }
  }
  if (next?.sede === "apodaca" && next.kind === "biometricos") {
    if (allMatch(times, isPlausibleFirmasApodacaTime)) {
      return { sede: "apodaca", kind: "firmas" };
    }
  }
  // Prev Monterrey Firmas + huérfanos 10:00/10:30 sin next aún → Apodaca.
  if (
    params.prevSection?.sede === "monterrey" &&
    params.prevSection.kind === "firmas" &&
    allMatch(times, isPlausibleFirmasApodacaTime)
  ) {
    return { sede: "apodaca", kind: "firmas" };
  }

  // Solo bloque (sin headers posteriores): 10:00/10:30 → Apodaca Firmas.
  if (
    !next &&
    !params.prevSection &&
    allMatch(times, isPlausibleFirmasApodacaTime)
  ) {
    return { sede: "apodaca", kind: "firmas" };
  }

  return null;
}

/** Peek next section header after index `fromExclusive` in column A cells. */
export function peekNextSectionHeader(
  columnA: readonly string[],
  fromExclusive: number,
  parseSection: (raw: string) => SheetSectionRef | null,
): SheetSectionRef | null {
  for (let j = fromExclusive + 1; j < columnA.length; j++) {
    const s = parseSection(String(columnA[j] ?? "").trim());
    if (s) return s;
  }
  return null;
}
