/**
 * Texto compacto de etapas en Producción por asesor (Admin).
 * Solo presentación: no altera conteos ni RPCs.
 */
export function compactEtapasProduccion(
  etapas: Readonly<Record<string, number>>,
): string {
  const groups: Array<{ label: string; n: number }> = [
    { label: "Integración", n: (etapas["1"] ?? 0) + (etapas["2"] ?? 0) },
    {
      label: "Biométricos",
      n: (etapas["3"] ?? 0) + (etapas["4"] ?? 0) + (etapas["5"] ?? 0),
    },
    { label: "Notificación", n: etapas["7"] ?? 0 },
    { label: "Pendiente Acuse", n: etapas["8"] ?? 0 },
    { label: "Firma", n: (etapas["9"] ?? 0) + (etapas["10"] ?? 0) },
    { label: "Finalizados", n: (etapas["11"] ?? 0) + (etapas["12"] ?? 0) },
  ];
  return (
    groups
      .filter((g) => g.n > 0)
      .map((g) => `${g.label} ${g.n}`)
      .join(" · ") || "—"
  );
}
