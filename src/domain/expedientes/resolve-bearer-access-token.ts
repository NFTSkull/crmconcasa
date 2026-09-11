/**
 * Access token para Bearer hacia rutas Next (validan con auth.getUser).
 * Fuerza refreshSession; getSession solo como fallback local.
 */
export type BearerAuthLike = {
  refreshSession: () => Promise<{
    data: { session: { access_token?: string | null } | null };
    error: { message?: string } | null;
  }>;
  getSession: () => Promise<{
    data: { session: { access_token?: string | null } | null };
  }>;
};

export async function resolveBearerAccessToken(
  auth: BearerAuthLike,
  logContext: string,
): Promise<string | null> {
  const { data: refreshed, error: refreshErr } = await auth.refreshSession();
  let token = String(refreshed.session?.access_token ?? "").trim() || null;

  if (!token) {
    const { data } = await auth.getSession();
    token = String(data.session?.access_token ?? "").trim() || null;
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
