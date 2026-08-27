/**
 * Live-sync Firmas book_gate helpers (P212 OFF-safe).
 * Mirror: supabase/functions/_shared/agenda-sheets/firmas-live-sync-contract.ts
 */

export type FirmasLiveSyncContract = Readonly<{
  enabled: boolean;
  effectiveFrom?: string | null;
}>;

/** Aplica effective_from sobre enabled. */
export function resolveFirmasContractForDate(
  contract: FirmasLiveSyncContract,
  bookingDate: string,
): FirmasLiveSyncContract {
  if (!contract.enabled) return { enabled: false, effectiveFrom: contract.effectiveFrom ?? null };
  const from = contract.effectiveFrom?.trim().slice(0, 10) || null;
  if (from && bookingDate < from) {
    return { enabled: false, effectiveFrom: from };
  }
  return { enabled: true, effectiveFrom: from };
}

/**
 * Con contract OFF, 08:00 físico NO autoriza booking (config legacy no lo lista).
 * 09:00/10:00 sí pueden existir en legacy — no bloquear aquí.
 */
export function firmasBookGateBlockedByInactiveContract(input: {
  kind: string;
  contractEnabled: boolean;
  slotTime: string;
}): { block: boolean; message: string | null } {
  if (input.kind !== "firmas") return { block: false, message: null };
  if (input.contractEnabled) return { block: false, message: null };
  const t = String(input.slotTime ?? "").trim().slice(0, 5);
  if (t === "08:00") {
    return {
      block: true,
      message: "Horario no activo para firmas hasta activación del contrato P212.",
    };
  }
  return { block: false, message: null };
}
