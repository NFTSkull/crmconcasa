"use client";

export type AsesorAgendaCitaCanceladaNoticeProps = Readonly<{
  motivo: string | null;
}>;

/** Aviso al asesor cuando Mesa canceló una cita y puede reagendar. */
export function AsesorAgendaCitaCanceladaNotice({
  motivo,
}: AsesorAgendaCitaCanceladaNoticeProps) {
  return (
    <div
      role="status"
      className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm"
    >
      <p className="text-sm font-semibold text-amber-950">Cita cancelada por Mesa</p>
      {motivo ? (
        <p className="mt-2 text-xs text-amber-900">
          <span className="font-medium">Motivo:</span> {motivo}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-amber-900">Puedes reagendar una nueva cita.</p>
    </div>
  );
}
