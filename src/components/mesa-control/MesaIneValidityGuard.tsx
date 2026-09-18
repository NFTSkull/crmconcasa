"use client";

import { useEffect, useState } from "react";
import {
  rowMasRecientePorTipoDocumento,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoListItem,
} from "@/domain/expediente-archivos";
import {
  extractDocumentTextViaOcr,
  type OcrDocumentType,
} from "@/domain/document-extractions/document-ocr-client";
import {
  getMesaInfonavitOcrCache,
  type MesaInfonavitOcrCache,
} from "@/domain/document-extractions/document-ocr-precompute-client";
import {
  evaluateIneValidity,
  type IneValidityAssessment,
} from "@/domain/document-extractions/ine-validity";

type GuardState =
  | { status: "checking" }
  | { status: "valid"; assessment: IneValidityAssessment }
  | { status: "expired"; assessment: IneValidityAssessment; rejected: number }
  | { status: "review"; assessment: IneValidityAssessment; message: string }
  | { status: "unavailable" };

const REJECTABLE_STATUSES = new Set(["subido", "resubido"]);

async function readText(
  cache: MesaInfonavitOcrCache,
  doc: ExpedienteArchivoListItem | null,
  type: OcrDocumentType,
  getBlob: (id: string) => Promise<Blob>,
): Promise<string> {
  if (!doc) return "";
  const cached = cache[type];
  if (
    cached?.status === "done" &&
    cached.documentoId === doc.id &&
    cached.text.trim()
  ) {
    return cached.text;
  }

  const blob = await getBlob(doc.id);
  const extracted = await extractDocumentTextViaOcr({
    blob,
    documentType: type,
    filename: doc.nombre_original,
    cacheKey: `ine-validity:${doc.id}:${type}`,
  });
  return extracted.text;
}

export function MesaIneValidityGuard({
  expedienteId,
}: Readonly<{ expedienteId: string }>) {
  const archivosRepo = useExpedienteArchivosRepo();
  const [state, setState] = useState<GuardState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState({ status: "checking" });

      try {
        const list = await archivosRepo.listByExpediente(expedienteId);
        if (cancelled) return;

        const frente =
          rowMasRecientePorTipoDocumento(list, "cliente_ine_frente") ?? null;
        const reverso =
          rowMasRecientePorTipoDocumento(list, "cliente_ine_reverso") ?? null;

        if (!frente) {
          setState({ status: "unavailable" });
          return;
        }

        const cache = await getMesaInfonavitOcrCache(expedienteId);
        if (cancelled) return;

        const frontText = await readText(
          cache,
          frente,
          "cliente_ine_frente",
          (id) => archivosRepo.getArchivoBlob(id),
        );
        if (cancelled) return;

        let assessment = evaluateIneValidity({ frontText });

        // El frente manda. Solo si no se pudo leer la vigencia visible,
        // consultamos reverso como respaldo informativo; nunca auto-rechaza solo.
        if (assessment.status === "unknown" && reverso) {
          const reverseText = await readText(
            cache,
            reverso,
            "cliente_ine_reverso",
            (id) => archivosRepo.getArchivoBlob(id),
          );
          if (cancelled) return;
          assessment = evaluateIneValidity({ frontText, reverseText });
        }

        if (assessment.status === "expired" && assessment.canAutoReject) {
          const year = assessment.expirationYear;
          const comentario =
            `INE vencida: la credencial muestra vigencia ${year}. Debe cargarse una INE vigente.`;
          const currentSides = [frente, reverso].filter(
            (doc): doc is ExpedienteArchivoListItem =>
              doc != null && REJECTABLE_STATUSES.has(doc.estatus_revision),
          );

          let rejected = 0;
          for (const doc of currentSides) {
            try {
              await archivosRepo.updateRevision(doc.id, {
                estatus_revision: "rechazado",
                comentario_mesa: comentario,
              });
              rejected += 1;
            } catch {
              // Fail-safe: si no pudo registrar el rechazo, no fingir éxito.
            }
          }
          if (cancelled) return;

          setState(
            rejected > 0
              ? { status: "expired", assessment, rejected }
              : {
                  status: "review",
                  assessment,
                  message:
                    "La INE aparece vencida, pero no se pudo registrar automáticamente la corrección. Revísala manualmente.",
                },
          );
          return;
        }

        if (assessment.status === "valid") {
          setState({ status: "valid", assessment });
          return;
        }

        setState({
          status: "review",
          assessment,
          message:
            assessment.status === "expired"
              ? "El reverso sugiere una vigencia vencida, pero el frente no la confirmó. Revísala manualmente antes de validar."
              : "No se pudo confirmar automáticamente la vigencia visible de la INE. Revísala antes de validar.",
        });
      } catch {
        if (!cancelled) {
          setState({
            status: "review",
            assessment: evaluateIneValidity({}),
            message:
              "No se pudo ejecutar la revisión automática de vigencia de la INE. Revísala manualmente.",
          });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [archivosRepo, expedienteId]);

  if (state.status === "checking") {
    return (
      <div
        className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"
        data-testid="mesa-ine-validity-guard"
      >
        Verificando automáticamente la vigencia de la INE…
      </div>
    );
  }

  if (state.status === "unavailable") return null;

  if (state.status === "valid") {
    return (
      <div
        className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
        data-testid="mesa-ine-validity-guard"
      >
        INE vigente
        {state.assessment.displayVigencia
          ? ` · vigencia hasta ${state.assessment.displayVigencia}`
          : ""}
        .
      </div>
    );
  }

  if (state.status === "expired") {
    return (
      <div
        className="mx-4 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900"
        role="alert"
        data-testid="mesa-ine-validity-guard"
      >
        INE vencida · vigencia {state.assessment.expirationYear}. Se marcó para
        corrección y el asesor deberá sustituir la credencial vigente.
      </div>
    );
  }

  return (
    <div
      className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
      role="alert"
      data-testid="mesa-ine-validity-guard"
    >
      {state.message}
    </div>
  );
}
