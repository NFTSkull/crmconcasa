"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  CLIENTE_CONSTANCIA_CURP_CONTRACT,
  CLIENTE_CONSTANCIA_CURP_TIPO,
  CURP_VALIDACION_PILOTO_ENABLED,
  buildConstanciaResultadoResumido,
  compareConstanciaVsDatosGenerales,
  compareRfcCapturadoVsEstimado,
  estimarRfcPersonaFisica,
  extractPdfEmbeddedText,
  fingerprintIdentidad,
  hasDiscrepancia,
  parseConstanciaCurpText,
  tiposInvalidacionPorCambio,
  validateCurpLocal,
  type CampoComparacion,
  type ConstanciaStatus,
  type RfcEstimadoStatus,
} from "@/domain/identidad-curp";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";
import { isDataModeSupabase } from "@/lib/dataMode";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type AsesorCurpValidacionSectionProps = Readonly<{
  expedienteId: string;
  curp: string;
  nombreCliente: string;
  rfc: string;
  canEdit: boolean;
  onApplyRfcEstimado: (rfc: string) => void | Promise<void>;
  onApplyNombreFromConstancia?: (nombre: string) => void | Promise<void>;
}>;

type RowStatus = "pendiente" | "ok" | "warn" | "error";

function StatusDot({ status }: { status: RowStatus }) {
  const color =
    status === "ok"
      ? "bg-green-500"
      : status === "warn"
        ? "bg-amber-500"
        : status === "error"
          ? "bg-red-500"
          : "bg-gray-300";
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
  );
}

/**
 * Validación piloto CURP: local + constancia PDF + RFC estimado.
 * No bloquea envío a Mesa. Sin OCR / sin TaxDown / sin SAT oficial.
 */
export function AsesorCurpValidacionSection({
  expedienteId,
  curp,
  nombreCliente,
  rfc,
  canEdit,
  onApplyRfcEstimado,
  onApplyNombreFromConstancia,
}: AsesorCurpValidacionSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const dataSupabase = isDataModeSupabase();
  const busyRef = useRef(false);

  const local = useMemo(
    () => validateCurpLocal({ curp }),
    [curp],
  );

  const [constanciaStatus, setConstanciaStatus] =
    useState<ConstanciaStatus>("CONSTANCIA_NO_ANALIZADA");
  const [certMsg, setCertMsg] = useState<string | null>(null);
  const [comparacion, setComparacion] = useState<CampoComparacion[]>([]);
  const [docVersion, setDocVersion] = useState<number | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rfcEstimado, setRfcEstimado] = useState<string | null>(null);
  const [rfcStatus, setRfcStatus] = useState<RfcEstimadoStatus>("SIN_DATOS");
  const [needsRevalidate, setNeedsRevalidate] = useState(false);
  const lastPartsRef = useRef<{ curp: string; nombre: string; rfc: string }>({
    curp: "",
    nombre: "",
    rfc: "",
  });

  const invalidateTipos = async (tipos: string[], motivo: string) => {
    if (!dataSupabase || !supabaseBrowser || tipos.length === 0) return;
    await supabaseBrowser
      .rpc("asesor_invalidar_validaciones_identidad", {
        p_expediente_id: expedienteId,
        p_motivo: motivo,
        p_tipos: tipos,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };

  useEffect(() => {
    if (!CURP_VALIDACION_PILOTO_ENABLED) return;
    const next = {
      curp: local.normalized,
      nombre: nombreCliente,
      rfc: rfc.trim().toUpperCase(),
    };
    const prev = lastPartsRef.current;
    const hadPrev = Boolean(prev.curp || prev.nombre || prev.rfc);
    if (hadPrev) {
      const change = {
        curp: prev.curp !== next.curp,
        nombreApellidosFecha: prev.nombre !== next.nombre,
        rfc: prev.rfc !== next.rfc,
      };
      const tipos = tiposInvalidacionPorCambio(change);
      if (tipos.length > 0) {
        setNeedsRevalidate(true);
        setInfo("Los datos o la constancia cambiaron. Debes validar nuevamente.");
        if (change.curp) {
          setConstanciaStatus("CONSTANCIA_NO_ANALIZADA");
          setComparacion([]);
          setCertMsg(null);
        }
        void invalidateTipos(
          tipos,
          change.curp
            ? "curp_cambio"
            : change.rfc
              ? "rfc_cambio"
              : "datos_cambiaron",
        );
      }
    }
    lastPartsRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.normalized, nombreCliente, rfc, dataSupabase, expedienteId]);

  useEffect(() => {
    if (local.status !== "VALIDA_LOCALMENTE" || !local.derived.fechaNacimiento) {
      setRfcEstimado(null);
      setRfcStatus("SIN_DATOS");
      return;
    }
    // Heurística: nombreCliente "AP1 AP2 NOMBRE..." o "NOMBRE APELLIDOS"
    const parts = nombreCliente.trim().split(/\s+/).filter(Boolean);
    const apellidoPaterno = parts[0] ?? "";
    const apellidoMaterno = parts.length > 2 ? parts[1] : "";
    const nombre =
      parts.length > 2 ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    const est = estimarRfcPersonaFisica({
      nombre: nombre || nombreCliente,
      apellidoPaterno: apellidoPaterno || "X",
      apellidoMaterno,
      fechaNacimiento: local.derived.fechaNacimiento,
    });
    if (est.status !== "RFC_ESTIMADO" || !est.rfcEstimado) {
      setRfcEstimado(null);
      setRfcStatus("ESTIMACION_PENDIENTE");
      return;
    }
    setRfcEstimado(est.rfcEstimado);
    const cmp = compareRfcCapturadoVsEstimado(rfc, est.rfcEstimado);
    if (!rfc.trim()) setRfcStatus("RFC_ESTIMADO");
    else if (cmp === "RFC_CAPTURADO_COINCIDE") setRfcStatus("RFC_CAPTURADO_COINCIDE");
    else setRfcStatus("RFC_CAPTURADO_NO_COINCIDE");
  }, [local, nombreCliente, rfc]);

  const persistValidacion = async (args: {
    tipo: string;
    estado: string;
    metodo: string;
    resultado: Record<string, unknown>;
    documentoId?: string | null;
    documentoVersion?: number | null;
  }) => {
    if (!dataSupabase || !supabaseBrowser) return;
    await supabaseBrowser.rpc("asesor_registrar_validacion_identidad", {
      p_expediente_id: expedienteId,
      p_tipo: args.tipo,
      p_estado: args.estado,
      p_metodo: args.metodo,
      p_resultado_resumido: args.resultado,
      p_documento_id: args.documentoId ?? null,
      p_documento_version: args.documentoVersion ?? null,
      p_input_fingerprint: fingerprintIdentidad({
        curp: local.normalized,
        nombre: nombreCliente,
      }),
      p_proveedor: "local",
    });
  };

  useEffect(() => {
    if (!CURP_VALIDACION_PILOTO_ENABLED || !dataSupabase) return;
    if (local.status === "SIN_CURP") return;
    void persistValidacion({
      tipo: "curp_local",
      estado: local.status,
      metodo: "local",
      resultado: {
        status: local.status,
        message: local.message,
        fecha_presente: Boolean(local.derived.fechaNacimiento),
        sexo_presente: Boolean(local.derived.sexo),
        entidad_presente: Boolean(local.derived.entidadNacimiento),
      },
    }).catch(() => {
      /* piloto: no bloquear UI si RPC aún no está en Cloud */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.status, local.normalized, expedienteId, dataSupabase]);

  const handleAnalyzeFile = async (file: File) => {
    if (busyRef.current || !canEdit) return;
    busyRef.current = true;
    setUploading(true);
    setError(null);
    setInfo(null);
    setConstanciaStatus("CONSTANCIA_ANALIZANDO");
    try {
      if (file.type !== "application/pdf") {
        throw new Error("Solo se acepta PDF.");
      }
      if (file.size > CLIENTE_CONSTANCIA_CURP_CONTRACT.maxBytes) {
        throw new Error("El archivo supera 15 MB.");
      }

      const buf = await file.arrayBuffer();
      const extracted = await extractPdfEmbeddedText(buf);
      if (!extracted.ok) {
        setConstanciaStatus(extracted.reason);
        setCertMsg(null);
        setComparacion([]);
        return;
      }

      const parsed = parseConstanciaCurpText(extracted.text);
      // No conservar texto
      setConstanciaStatus(parsed.status);
      setCertMsg(
        parsed.extracted.certificadaRegistroCivil
          ? "CURP certificada por el Registro Civil"
          : parsed.message,
      );

      const campos = compareConstanciaVsDatosGenerales(
        { curp: local.normalized, nombreCliente },
        parsed.extracted,
      );
      setComparacion(campos);
      if (hasDiscrepancia(campos) && parsed.status === "CURP_CERTIFICADA_REGISTRO_CIVIL") {
        setConstanciaStatus("DATOS_NO_COINCIDEN");
      }

      // Invalidar análisis previo al reemplazar constancia
      const list = await archivosRepo.listByExpediente(expedienteId);
      const existing = list.find(
        (d) => d.tipo_documento === CLIENTE_CONSTANCIA_CURP_TIPO && d.id,
      );
      if (existing?.id) {
        await invalidateTipos(
          tiposInvalidacionPorCambio({ constanciaReemplazada: true }),
          "constancia_reemplazada",
        );
        await archivosRepo.replaceArchivo({
          expedienteId,
          tipo_documento: CLIENTE_CONSTANCIA_CURP_TIPO,
          file,
          uploaded_by_role: "asesor",
          uploaded_by_email: "",
        });
      } else {
        await archivosRepo.uploadArchivo({
          expedienteId,
          tipo_documento: CLIENTE_CONSTANCIA_CURP_TIPO,
          file,
          uploaded_by_role: "asesor",
          uploaded_by_email: "",
        });
      }
      const refreshed = await archivosRepo.listByExpediente(expedienteId);
      const doc = refreshed.find(
        (d) => d.tipo_documento === CLIENTE_CONSTANCIA_CURP_TIPO && d.id,
      );
      setDocId(doc?.id ?? null);
      setDocVersion(doc?.version ?? null);
      setNeedsRevalidate(false);

      const resumen = buildConstanciaResultadoResumido(parsed, campos);
      await persistValidacion({
        tipo: "curp_constancia",
        estado: hasDiscrepancia(campos)
          ? "DATOS_NO_COINCIDEN"
          : parsed.status,
        metodo: "pdf_constancia",
        resultado: resumen,
        documentoId: doc?.id,
        documentoVersion: doc?.version,
      });
      await persistValidacion({
        tipo: "curp_certificacion_registro_civil",
        estado: parsed.extracted.certificadaRegistroCivil
          ? "CURP_CERTIFICADA_REGISTRO_CIVIL"
          : parsed.status,
        metodo: "pdf_constancia",
        resultado: {
          certificada: parsed.extracted.certificadaRegistroCivil,
          otra_autoridad: parsed.extracted.certificacionOtraAutoridad,
          acta_vinculada: parsed.extracted.certificadaRegistroCivil,
        },
        documentoId: doc?.id,
        documentoVersion: doc?.version,
      });
      await persistValidacion({
        tipo: "curp_coincidencia_datos",
        estado: hasDiscrepancia(campos) ? "DATOS_NO_COINCIDEN" : "CONSTANCIA_LEGIBLE",
        metodo: "pdf_constancia",
        resultado: {
          campos_coinciden: resumen.campos_coinciden,
          campos_con_diferencia: resumen.campos_con_diferencia,
          campos_no_disponibles: resumen.campos_no_disponibles,
        },
        documentoId: doc?.id,
        documentoVersion: doc?.version,
      });

      if (rfcEstimado) {
        await persistValidacion({
          tipo: "rfc_estimado",
          estado: rfcStatus,
          metodo: "local",
          resultado: {
            status: rfcStatus,
            etiqueta:
              "RFC estimado. Pendiente de validación en el SAT.",
            // no guardar el RFC estimado completo si se prefiere fingerprint; se guarda hasheado vía fingerprint
            tiene_estimado: true,
            longitud: rfcEstimado.length,
          },
        });
        await persistValidacion({
          tipo: "rfc_validacion_sat",
          estado: "RFC_VALIDACION_SAT_PENDIENTE",
          metodo: "local",
          resultado: { status: "RFC_VALIDACION_SAT_PENDIENTE" },
        });
      }

      setInfo("Análisis de constancia completado.");
    } catch (err) {
      setConstanciaStatus("ERROR_ANALISIS");
      setError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudo analizar la constancia.",
      );
    } finally {
      setUploading(false);
      busyRef.current = false;
    }
  };

  if (!CURP_VALIDACION_PILOTO_ENABLED) return null;

  const localRow: RowStatus =
    local.status === "VALIDA_LOCALMENTE"
      ? "ok"
      : local.status === "SIN_CURP"
        ? "pendiente"
        : "error";

  const constanciaRow: RowStatus =
    constanciaStatus === "CONSTANCIA_NO_ANALIZADA"
      ? "pendiente"
      : constanciaStatus === "CURP_CERTIFICADA_REGISTRO_CIVIL" ||
          constanciaStatus === "CONSTANCIA_LEGIBLE" ||
          constanciaStatus === "CURP_NO_CERTIFICADA"
        ? "ok"
        : constanciaStatus === "CONSTANCIA_ANALIZANDO"
          ? "warn"
          : "error";

  const certRow: RowStatus =
    constanciaStatus === "CURP_CERTIFICADA_REGISTRO_CIVIL"
      ? "ok"
      : constanciaStatus === "CONSTANCIA_NO_ANALIZADA"
        ? "pendiente"
        : "warn";

  const matchRow: RowStatus =
    comparacion.length === 0
      ? "pendiente"
      : hasDiscrepancia(comparacion)
        ? "error"
        : "ok";

  const rfcRow: RowStatus =
    rfcStatus === "RFC_ESTIMADO" || rfcStatus === "RFC_CAPTURADO_COINCIDE"
      ? "ok"
      : rfcStatus === "RFC_CAPTURADO_NO_COINCIDE"
        ? "warn"
        : "pendiente";

  return (
    <section className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Validación de CURP</h3>
        <span className="text-xs text-gray-500">
          {needsRevalidate ? "Requiere revalidar" : "Sin validar / piloto"}
        </span>
      </div>
      <p className="mb-3 text-xs text-amber-800">
        Validación piloto. El envío a Mesa continúa disponible.
      </p>

      <ul className="space-y-1.5 text-xs text-gray-800">
        <li className="flex items-center gap-2">
          <StatusDot status={localRow} />
          <span>
            Validación local:{" "}
            {local.status === "VALIDA_LOCALMENTE"
              ? "Formato de CURP válido"
              : local.message}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <StatusDot status={constanciaRow} />
          <span>Constancia oficial: {constanciaStatus}</span>
        </li>
        <li className="flex items-center gap-2">
          <StatusDot status={certRow} />
          <span>
            Certificación Registro Civil:{" "}
            {certMsg ?? "pendiente"}
          </span>
        </li>
        {certMsg && constanciaStatus === "CURP_CERTIFICADA_REGISTRO_CIVIL" ? (
          <li className="ml-4 text-gray-600">Acta vinculada al Registro Civil</li>
        ) : null}
        <li className="flex items-center gap-2">
          <StatusDot status={matchRow} />
          <span>
            Coincidencia de Datos Generales:{" "}
            {comparacion.length === 0
              ? "pendiente"
              : hasDiscrepancia(comparacion)
                ? "No coincide"
                : "Coincide"}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <StatusDot status={rfcRow} />
          <span>
            RFC estimado:{" "}
            {rfcEstimado
              ? "calculado (pendiente SAT)"
              : "sin datos suficientes"}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <StatusDot status="pendiente" />
          <span>Validación SAT pendiente</span>
        </li>
      </ul>

      {local.status === "VALIDA_LOCALMENTE" ? (
        <div className="mt-3 space-y-2">
          <a
            href="https://www.gob.mx/curp/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[40px] items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            Abrir consulta oficial de CURP
          </a>
          <p className="text-xs text-gray-600">
            Consulta la CURP, descarga la constancia PDF y súbela aquí.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">
              {docId ? "Reemplazar constancia CURP" : "Subir constancia CURP"}
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={!canEdit || uploading}
              className="block w-full text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleAnalyzeFile(f);
              }}
            />
          </label>
          {docVersion != null ? (
            <p className="text-[11px] text-gray-500">Versión activa: {docVersion}</p>
          ) : null}
        </div>
      ) : null}

      {comparacion.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-1 pr-2">Campo</th>
                <th className="py-1 pr-2">Capturado</th>
                <th className="py-1 pr-2">Constancia</th>
                <th className="py-1">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {comparacion.map((c) => (
                <tr key={c.campo} className="border-b border-gray-100">
                  <td className="py-1 pr-2 font-medium">{c.campo}</td>
                  <td className="py-1 pr-2">{c.capturado ?? "—"}</td>
                  <td className="py-1 pr-2">{c.constancia ?? "—"}</td>
                  <td className="py-1">
                    {c.mensaje ?? c.resultado}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit &&
          onApplyNombreFromConstancia &&
          comparacion.find((c) => c.campo === "Nombre")?.constancia ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-2 min-h-[36px] text-xs"
              onClick={() => {
                const nombre =
                  comparacion.find((c) => c.campo === "Nombre")?.constancia;
                if (!nombre) return;
                if (
                  !window.confirm(
                    "Se actualizará el nombre con los datos de la constancia. ¿Continuar?",
                  )
                ) {
                  return;
                }
                void onApplyNombreFromConstancia(nombre);
              }}
            >
              Usar datos de la constancia
            </Button>
          ) : null}
        </div>
      ) : null}

      {rfcEstimado && !rfc.trim() && canEdit ? (
        <div className="mt-3 rounded-md border border-blue-100 bg-white px-2 py-2 text-xs">
          <p>
            RFC estimado: <span className="font-mono font-medium">{rfcEstimado}</span>
          </p>
          <p className="mt-1 text-gray-600">
            RFC estimado. Pendiente de validación en el SAT.
          </p>
          <Button
            type="button"
            variant="primary"
            className="mt-2 min-h-[36px] text-xs"
            onClick={() => {
              if (
                !window.confirm(
                  "Se aplicará el RFC estimado al formulario. No es un RFC oficial. ¿Continuar?",
                )
              ) {
                return;
              }
              void onApplyRfcEstimado(rfcEstimado);
              setRfcStatus("RFC_ESTIMADO_APLICADO");
              void persistValidacion({
                tipo: "rfc_estimado",
                estado: "RFC_ESTIMADO_APLICADO",
                metodo: "manual_asistido",
                resultado: {
                  status: "RFC_ESTIMADO_APLICADO",
                  etiqueta:
                    "RFC estimado. Pendiente de validación en el SAT.",
                },
              });
            }}
          >
            Usar RFC estimado
          </Button>
        </div>
      ) : null}

      {rfc.trim() && rfcEstimado ? (
        <p className="mt-2 text-xs text-gray-600">
          RFC capturado vs estimado:{" "}
          {rfcStatus === "RFC_CAPTURADO_COINCIDE" ? "Coincide" : "No coincide"}{" "}
          (no se sobrescribe).
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {info ? (
        <p role="status" className="mt-2 text-xs text-green-700">
          {info}
        </p>
      ) : null}
      {uploading ? (
        <p className="mt-2 text-xs text-blue-700">Analizando constancia…</p>
      ) : null}
    </section>
  );
}
