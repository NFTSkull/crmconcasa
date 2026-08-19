"use client";

import { getAsesorInboxEstadoEfectivoPresentation } from "@/domain/expedientes/asesor-inbox-estado-efectivo";
import {
  ASESOR_CORRECCION_PANEL_ID,
  type AsesorExpedienteCorreccionView,
} from "@/domain/expedientes/asesor-expediente-correccion-ui";

type Props = {
  view: AsesorExpedienteCorreccionView;
  onFocusSection?: (focusId: string) => void;
};

export function AsesorExpedienteEstadoActualBanner({
  view,
  onFocusSection,
}: Props) {
  const pres = getAsesorInboxEstadoEfectivoPresentation(view.estadoEfectivo);

  if (view.showCanceladoDominante) return null;
  if (view.showRechazoOperativoBanner) return null;

  if (view.showNecesitaPanel) {
    return (
      <section
        id={ASESOR_CORRECCION_PANEL_ID}
        data-testid="asesor-expediente-estado-actual"
        data-estado-efectivo={view.estadoEfectivo}
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        role="status"
      >
        <p className="text-sm font-semibold text-amber-950">Necesita corrección</p>
        <p className="mt-1 text-xs text-amber-900">Mesa solicita corrección.</p>
        {view.actions.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {view.actions.map((a) => (
              <li
                key={`${a.kind}-${a.focusId}-${a.label}`}
                className="rounded-md border border-amber-200 bg-white/80 px-3 py-2 text-xs text-amber-950"
              >
                <p className="font-medium">{a.label}</p>
                {a.detail ? (
                  <p className="mt-0.5 text-amber-900/90">{a.detail}</p>
                ) : null}
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-amber-900 underline"
                  onClick={() => onFocusSection?.(a.focusId)}
                >
                  {a.ctaLabel}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-amber-900">
            Revisa Datos Generales, documentos o retención según lo que Mesa haya marcado.
          </p>
        )}
      </section>
    );
  }

  if (view.showEnviadaPanel) {
    return (
      <section
        id={ASESOR_CORRECCION_PANEL_ID}
        data-testid="asesor-expediente-estado-actual"
        data-estado-efectivo={view.estadoEfectivo}
        className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3"
        role="status"
      >
        <p className="text-sm font-semibold text-sky-950">Corrección enviada</p>
        <p className="mt-1 text-xs text-sky-900">
          Mesa ya recibió tus cambios y está pendiente de revisarlos.
        </p>
      </section>
    );
  }

  if (view.estadoEfectivo === "en_tramite") {
    return (
      <section
        data-testid="asesor-expediente-estado-actual"
        data-estado-efectivo={view.estadoEfectivo}
        className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3"
        role="status"
      >
        <p className="text-sm font-semibold text-blue-950">{pres.label}</p>
      </section>
    );
  }

  return null;
}
