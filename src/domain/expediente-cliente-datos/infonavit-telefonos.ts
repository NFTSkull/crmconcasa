/**
 * P189 B2 — LADA + teléfono → 10 dígitos MX; unicidad intra-expediente.
 */

export type TelefonoUnicidadSlot =
  | "cliente.celular"
  | "cliente.telefonoCasa"
  | "empresa.telefono"
  | "ref1.telefonoCompleto"
  | "ref1.celular"
  | "ref2.telefonoCompleto"
  | "ref2.celular";

export type TelefonoUnicidadEntry = {
  slot: TelefonoUnicidadSlot;
  raw: string;
};

/** Misma semántica que `normalizeTelefonoMexico` (evita import circular). */
export function normalizeTelefonoMexicoLocal(input: string): string {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

/** LADA: 2–3 dígitos (sin código país). */
export function isLadaMexicoValida(lada: string): boolean {
  const d = String(lada ?? "").replace(/\D/g, "");
  return d.length === 2 || d.length === 3;
}

/**
 * Combina LADA + teléfono local → 10 dígitos canónicos.
 * Rechaza LADA "52" como código país.
 */
export function combineLadaTelefonoMexico(
  lada: string,
  telefono: string,
): { ok: true; phone: string } | { ok: false; reason: "empty" | "invalid" } {
  const ladaDigits = String(lada ?? "").replace(/\D/g, "");
  const telDigits = String(telefono ?? "").replace(/\D/g, "");
  if (!ladaDigits && !telDigits) return { ok: false, reason: "empty" };
  if (ladaDigits === "52" || ladaDigits === "521") {
    return { ok: false, reason: "invalid" };
  }
  if (!isLadaMexicoValida(ladaDigits)) return { ok: false, reason: "invalid" };
  if (!telDigits || !/^\d+$/.test(telDigits)) {
    return { ok: false, reason: "invalid" };
  }
  const combined = `${ladaDigits}${telDigits}`;
  const norm = normalizeTelefonoMexicoLocal(combined);
  if (!/^\d{10}$/.test(norm)) return { ok: false, reason: "invalid" };
  return { ok: true, phone: norm };
}

export function findDuplicateTelefonosIntraExpediente(
  entries: readonly TelefonoUnicidadEntry[],
): Array<{
  slot: TelefonoUnicidadSlot;
  phone: string;
  conflictsWith: TelefonoUnicidadSlot;
}> {
  const normalized: Array<{ slot: TelefonoUnicidadSlot; phone: string }> = [];
  for (const e of entries) {
    const raw = String(e.raw ?? "").trim();
    if (!raw) continue;
    const phone = normalizeTelefonoMexicoLocal(raw);
    if (!/^\d{10}$/.test(phone)) continue;
    normalized.push({ slot: e.slot, phone });
  }

  const out: Array<{
    slot: TelefonoUnicidadSlot;
    phone: string;
    conflictsWith: TelefonoUnicidadSlot;
  }> = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = 0; j < i; j++) {
      if (normalized[i]!.phone === normalized[j]!.phone) {
        out.push({
          slot: normalized[i]!.slot,
          phone: normalized[i]!.phone,
          conflictsWith: normalized[j]!.slot,
        });
      }
    }
  }
  return out;
}
