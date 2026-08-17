/**
 * Detecta RPC PostgREST ausente (schema cache).
 * Solo PGRST202 / "could not find the function".
 * NO trata 401/403/42501/red como missing.
 */
export function isPostgrestFunctionMissing(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "").toUpperCase();
  if (code === "401" || code === "403" || code === "42501") return false;
  if (code === "PGRST202") return true;
  const msg = String(error.message ?? "").toLowerCase();
  if (!msg) return false;
  if (code === "PGRST205" && msg.includes("function")) return true;
  return (
    msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("not found") && code.startsWith("PGRST"))
  );
}
