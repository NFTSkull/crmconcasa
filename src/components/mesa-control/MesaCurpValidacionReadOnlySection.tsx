"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  CLIENTE_CONSTANCIA_CURP_TIPO,
  CURP_VALIDACION_PILOTO_ENABLED,
} from "@/domain/identidad-curp";
import { useExpedienteArchivosRepo } from "@/domain/expediente-archivos";
import { isDataModeSupabase } from "@/lib/dataMode";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type ValidacionItem = {
  tipo: string;
  estado: string;
  metodo?: string;
  documento_id?: string | null;
  documento_version?: number | null;
  resultado_resumido?: Record<string, unknown> | null;
  realizado_at?: string | null;
  realizado_por_rol?: string | null;
};

function pick(
  items: ValidacionItem[],
  tipo: string,
): ValidacionItem | undefined {
  return items.find((i) => i.tipo === tipo);
}

function yesNo(v: boolean | null | undefined): string {
  if (v == null) return "—";
  return v ? "Sí" : "No";
}

/**
 * Vista Mesa read-only del piloto de validación CURP / constancia / RFC estimado.
 * Tras recarga solo muestra flags / coincidencias (sin valores extraídos del PDF).
 */
export function MesaCurpValidacionReadOnlySection({
  expedienteId,
  formatDateTime,
}: {
  expedienteId: string;
  formatDateTime: (iso: string) => string;
}) {
  const archivosRepo = useExpedienteArchivosRepo();
  const dataSupabase = isDataModeSupabase();
  const [items, setItems] = useState<ValidacionItem[]>([]);
  const [docMeta, setDocMeta] = useState<{
    id: string;
    version: number | null;
    nombre: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!CURP_VALIDACION_PILOTO_ENABLED || !dataSupabase || !supabaseBrowser) {
      return;
    }
    setError(null);
    try {
      const { data, error: rpcErr } = await supabaseBrowser.rpc(
        "asesor_list_validaciones_identidad",
        { p_expediente_id: expedienteId },
      );
      if (rpcErr) throw rpcErr;
      const raw = (data as { items?: ValidacionItem[] } | null)?.items ?? [];
      setItems(Array.isArray(raw) ? raw : []);

      const lista = await archivosRepo.listByExpediente(expedienteId);
      const doc = lista.find(
        (d) => d.tipo_documento === CLIENTE_CONSTANCIA_CURP_TIPO && d.id,
      );
      if (doc?.id) {
        setDocMeta({
          id: doc.id,
          version: doc.version ?? null,
          nombre: doc.nombre_original ?? "constancia-curp.pdf",
        });
      } else {
        setDocMeta(null);
      }
    } catch {
      setError("No se pudieron cargar las validaciones de identidad.");
    }
  }, [archivosRepo, dataSupabase, expedienteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVer = async () => {
    if (!docMeta?.id) return;
    setBusy(true);
    try {
      const blob = await archivosRepo.getArchivoBlob(docMeta.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("No se pudo abrir la constancia.");
    } finally {
      setBusy(false);
    }
  };

  const handleDescargar = async () => {
    if (!docMeta?.id) return;
    setBusy(true);
    try {
      const blob = await archivosRepo.getArchivoBlob(docMeta.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docMeta.nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError("No se pudo descargar la constancia.");
    } finally {
      setBusy(false);
    }
  };

  if (!CURP_VALIDACION_PILOTO_ENABLED) return null;

  const curpLocal = pick(items, "curp_local");
  const constancia = pick(items, "curp_constancia");
  const cert = pick(items, "curp_certificacion_registro_civil");
  const coincidencia = pick(items, "curp_coincidencia_datos");
  const rfcEst = pick(items, "rfc_estimado");
  const rfcSat = pick(items, "rfc_validacion_sat");

  const certRes = cert?.resultado_resumido ?? {};
  const certificada =
    typeof certRes.certificada === "boolean"
      ? certRes.certificada
      : cert?.estado === "CURP_CERTIFICADA_REGISTRO_CIVIL";
  const actaVinculada =
    typeof certRes.acta_vinculada === "boolean"
      ? certRes.acta_vinculada
      : certificada;

  const camposDiff =
    (coincidencia?.resultado_resumido?.campos_con_diferencia as string[] | undefined) ??
    [];
  const camposNoDisp =
    (coincidencia?.resultado_resumido?.campos_no_disponibles as string[] | undefined) ??
    [];
  const legacyCampos =
    (coincidencia?.resultado_resumido?.campos as
      | Array<{ campo?: string; resultado?: string; mensaje?: string | null }>
      | undefined) ?? [];
  const discrepancias =
    camposDiff.length > 0
      ? camposDiff.map((c) => ({ campo: c, mensaje: `${c} no coincide` }))
      : legacyCampos.filter((c) => c.resultado === "no_coincide");

  const actorAt =
    constancia?.realizado_at ??
    curpLocal?.realizado_at ??
    rfcEst?.realizado_at ??
    null;
  const actorRol =
    constancia?.realizado_por_rol ??
    curpLocal?.realizado_por_rol ??
    rfcEst?.realizado_por_rol ??
    null;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:col-span-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Validación de CURP (piloto)
      </h3>
      <p className="mt-1 text-xs text-amber-800">
        Validación piloto. El envío a Mesa continúa disponible.
      </p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            CURP válida localmente
          </dt>
          <dd className="text-gray-900">
            {curpLocal?.estado === "VALIDA_LOCALMENTE" ? "Sí" : curpLocal?.estado ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            Constancia analizada
          </dt>
          <dd className="text-gray-900">{constancia?.estado ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            Certificada Registro Civil
          </dt>
          <dd className="text-gray-900">{yesNo(certificada)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            Acta vinculada Registro Civil
          </dt>
          <dd className="text-gray-900">{yesNo(actaVinculada)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            Datos coinciden
          </dt>
          <dd className="text-gray-900">
            {coincidencia
              ? coincidencia.estado === "DATOS_NO_COINCIDEN"
                ? "No"
                : "Sí"
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            RFC estimado
          </dt>
          <dd className="text-gray-900">
            {rfcEst
              ? `${rfcEst.estado} (pendiente SAT)`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            Validación SAT
          </dt>
          <dd className="text-gray-900">
            {rfcSat?.estado ?? "RFC_VALIDACION_SAT_PENDIENTE"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">
            Versión documental
          </dt>
          <dd className="text-gray-900">
            {docMeta?.version ?? constancia?.documento_version ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">Fecha</dt>
          <dd className="text-gray-900">
            {actorAt ? formatDateTime(actorAt) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase text-gray-500">Actor</dt>
          <dd className="text-gray-900">{actorRol ?? "—"}</dd>
        </div>
      </dl>

      {discrepancias.length > 0 ? (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-red-800">
          {discrepancias.map((d) => (
            <li key={`${d.campo}-${d.mensaje}`}>
              {d.mensaje ?? `${d.campo ?? "Campo"} no coincide`}
            </li>
          ))}
        </ul>
      ) : null}
      {camposNoDisp.length > 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          No disponibles: {camposNoDisp.join(", ")}
        </p>
      ) : null}

      {docMeta ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[36px] text-xs"
            disabled={busy}
            onClick={() => void handleVer()}
          >
            Ver constancia CURP
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[36px] text-xs"
            disabled={busy}
            onClick={() => void handleDescargar()}
          >
            Descargar constancia CURP
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">Sin constancia CURP cargada.</p>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
