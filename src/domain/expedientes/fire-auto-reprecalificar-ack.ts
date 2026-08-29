/**
 * Fire-and-forget del ack 202 de auto-reprecalificar (cliente).
 * Espera solo el ack (timeout corto); el trabajo largo sigue en after() del server.
 */
export async function fireAutoReprecalificarAck(input: {
  intentoId: string;
  accessToken?: string | null;
  /** Override para tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status?: number }> {
  const intentoId = String(input.intentoId ?? "").trim();
  if (!intentoId) return { ok: false };

  const headers: HeadersInit = {};
  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const fetchFn = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;

  try {
    console.log("[reprecal] disparando auto-reprecalificar para", intentoId);
    const res = await fetchFn(
      `/api/precalificaciones/reprecalificacion/${encodeURIComponent(intentoId)}/auto-precalificar`,
      {
        method: "POST",
        headers,
        keepalive: true,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    console.log("[reprecal] auto-reprecalificar ack", intentoId, res.status);
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[reprecal] auto-reprecalificar ack falló", intentoId, err);
    return { ok: false };
  }
}
