/**
 * Fire-and-forget del ack 202 de auto-precalificar (cliente).
 * No dispara fetch sin Bearer (evita 401 silencioso).
 */
export async function fireAutoPrecalificarAck(input: {
  expedienteId: string;
  accessToken?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logPrefix?: string;
}): Promise<{ ok: boolean; status?: number }> {
  const expedienteId = String(input.expedienteId ?? "").trim();
  const logPrefix = input.logPrefix ?? "auto-precal";
  if (!expedienteId) return { ok: false };

  const accessToken = String(input.accessToken ?? "").trim();
  if (!accessToken) {
    console.error(
      `[${logPrefix}] omitiendo fetch: sin Bearer vigente`,
      expedienteId,
    );
    return { ok: false };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;

  try {
    console.log(`[${logPrefix}] disparando auto-precalificar para`, expedienteId);
    const res = await fetchFn(
      `/api/precalificaciones/${encodeURIComponent(expedienteId)}/auto-precalificar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        keepalive: true,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    console.log(`[${logPrefix}] auto-precalificar ack`, expedienteId, res.status);
    if (res.status === 401) {
      console.error(
        `[${logPrefix}] auto-precalificar 401 (Bearer rechazado)`,
        expedienteId,
      );
    }
    return { ok: res.ok || res.status === 202, status: res.status };
  } catch (err) {
    console.error(
      `[${logPrefix}] auto-precalificar ack falló`,
      expedienteId,
      err,
    );
    return { ok: false };
  }
}
