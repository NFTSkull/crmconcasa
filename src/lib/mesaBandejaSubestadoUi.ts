/**
 * Presentación del subestado en tarjeta Mesa.
 * El episodio P198 (cambioRevisionEstado) gobierna el badge; el raw
 * `subestado=rechazado` no se pinta como estado vigente si Mesa ya tiene
 * una respuesta que revisar o espera al asesor.
 * No altera membresía de colas.
 */

export function mesaRevisionEpisodioActivo(
  revisionEstado: string | null | undefined,
): boolean {
  return (
    revisionEstado === "CORRECTION_PENDING_REVIEW" ||
    revisionEstado === "ADVISOR_UPDATE_PENDING_REVIEW" ||
    revisionEstado === "WAITING_ADVISOR"
  );
}

export type MesaBandejaSubestadoBadgeKind = "none" | "rechazado" | "operativo";

export type MesaBandejaSubestadoBadge = Readonly<{
  kind: MesaBandejaSubestadoBadgeKind;
  /** Texto del badge operativo cuando kind = operativo. */
  subestado: string | null;
}>;

export function resolveMesaBandejaSubestadoBadge(
  subestado: string | null | undefined,
  revisionEstado?: string | null,
): MesaBandejaSubestadoBadge {
  const raw = String(subestado ?? "").trim();
  if (raw === "rechazado" && mesaRevisionEpisodioActivo(revisionEstado)) {
    return { kind: "none", subestado: null };
  }
  if (raw === "rechazado") {
    return { kind: "rechazado", subestado: "rechazado" };
  }
  return { kind: "operativo", subestado: raw || "pendiente" };
}

export function mesaBandejaMuestraBadgeRechazado(
  subestado: string | null | undefined,
  revisionEstado?: string | null,
): boolean {
  return resolveMesaBandejaSubestadoBadge(subestado, revisionEstado).kind === "rechazado";
}
