"use client";

type Props = {
  motivo: string | null | undefined;
  comentario: string | null | undefined;
};

/** Banner RO de rechazo operativo en detalle Asesor (P099). */
export function AsesorExpedienteRechazadoBanner({
  motivo,
  comentario,
}: Props) {
  const motivoTxt = motivo?.trim() || null;
  const notaTxt = comentario?.trim() || null;

  return (
    <section
      data-testid="asesor-expediente-rechazado-banner"
      className="rounded-xl border border-red-300 bg-red-50 px-4 py-3"
      role="status"
    >
      <p className="text-sm font-semibold text-red-950">
        Expediente rechazado por Mesa
      </p>
      <p className="mt-1 text-xs text-red-900">
        El expediente sigue activo. Puedes continuar o reingresar cuando
        corresponda. No es una cancelación terminal.
      </p>
      <dl className="mt-3 grid gap-1 text-xs text-red-950 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="font-medium text-red-800">Motivo</dt>
          <dd data-testid="asesor-rechazo-motivo">
            {motivoTxt ?? "Sin motivo registrado"}
          </dd>
        </div>
        {notaTxt ? (
          <div className="sm:col-span-2">
            <dt className="font-medium text-red-800">Nota para el asesor</dt>
            <dd data-testid="asesor-rechazo-nota">{notaTxt}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
