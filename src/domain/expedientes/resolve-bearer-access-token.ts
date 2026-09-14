/**
 * Access token para Bearer hacia rutas Next (validan con auth.getUser).
 * Prefiere sesión local vigente; solo refreshSession si falta token o está por vencer.
 * Evita Invalid Refresh Token: Already Used al martillar refresh en cada submit
 * (Anette ~20–40s) mientras autoRefreshToken corre en paralelo.
 */

export const BEARER_ACCESS_TOKEN_MIN_TTL_SEC = 120;

export type BearerSessionLike = {
  access_token?: string | null;
  /** Epoch seconds (Supabase session.expires_at). */
  expires_at?: number | null;
};

export type BearerAuthLike = {
  refreshSession: () => Promise<{
    data: { session: BearerSessionLike | null };
    error: { message?: string } | null;
  }>;
  getSession: () => Promise<{
    data: { session: BearerSessionLike | null };
  }>;
};

function tokenFromSession(session: BearerSessionLike | null | undefined): string | null {
  return String(session?.access_token ?? "").trim() || null;
}

/** true si el access_token tiene margen ≥ minTtlSec antes de expires_at. */
export function isBearerAccessTokenFresh(
  session: BearerSessionLike | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
  minTtlSec: number = BEARER_ACCESS_TOKEN_MIN_TTL_SEC,
): boolean {
  const token = tokenFromSession(session);
  if (!token) return false;
  const exp = session?.expires_at;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    // Sin expires_at: confiar en el token local (mejor que forzar refresh).
    return true;
  }
  return exp - nowSec >= minTtlSec;
}

function isRefreshTokenAlreadyUsed(message: string | null | undefined): boolean {
  const m = String(message ?? "").toLowerCase();
  return m.includes("already used");
}

async function readSessionToken(auth: BearerAuthLike): Promise<string | null> {
  const { data } = await auth.getSession();
  return tokenFromSession(data.session);
}

export async function resolveBearerAccessToken(
  auth: BearerAuthLike,
  logContext: string,
  opts?: {
    nowSec?: number;
    minTtlSec?: number;
    /** Delay antes del reintento getSession tras Already Used (tests). */
    alreadyUsedRetryMs?: number;
  },
): Promise<string | null> {
  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const minTtlSec = opts?.minTtlSec ?? BEARER_ACCESS_TOKEN_MIN_TTL_SEC;
  const alreadyUsedRetryMs = opts?.alreadyUsedRetryMs ?? 50;

  const { data: local } = await auth.getSession();
  if (isBearerAccessTokenFresh(local.session, nowSec, minTtlSec)) {
    return tokenFromSession(local.session);
  }

  const { data: refreshed, error: refreshErr } = await auth.refreshSession();
  let token = tokenFromSession(refreshed.session);

  if (!token) {
    token = await readSessionToken(auth);
  }

  if (
    !token &&
    refreshErr &&
    isRefreshTokenAlreadyUsed(refreshErr.message)
  ) {
    await new Promise((r) => setTimeout(r, alreadyUsedRetryMs));
    token = await readSessionToken(auth);
    if (token) {
      console.warn(
        `[${logContext}] refresh Already Used; usando sesión local tras reintento`,
        refreshErr.message,
      );
    }
  }

  if (!token) {
    console.error(
      `[${logContext}] sin access_token vigente para Bearer`,
      refreshErr?.message ?? "refresh_session_sin_token",
    );
    return null;
  }
  return token;
}
