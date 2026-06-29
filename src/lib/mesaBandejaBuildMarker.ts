/** Marcador temporal Fase 0 — validar que Preview sirve el build correcto. */
export function getMesaBandejaBuildMarker(): string {
  const sha = String(process.env.NEXT_PUBLIC_MESA_BANDEJA_BUILD_SHA ?? "local").trim();
  return `Fase 0 orden · commit ${sha || "local"}`;
}
