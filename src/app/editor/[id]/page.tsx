"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDateTimeMx } from "@/lib/filters";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  isProgramaMejoravit,
  editorRevisionDisplay,
} from "@/domain/expedientes";
import { parseMontoAprobado } from "@/lib/monto";

type Decision = "pendiente" | "aprobado" | "no_cumple";

interface PrecalInfo {
  id: string;
  programa: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional: string;
  asesorId: string;
  createdAt: string;
  esReingreso: boolean;
  expedienteAnteriorId: string | null;
  reprecalificacionPendienteId: string | null;
  programaSolicitado: string | null;
  decisionVigente: Decision;
  montoVigente: number | null;
}

function DecisionBadge({ decision }: { decision?: string }) {
  const d = decision ?? "pendiente";
  let styles = "bg-gray-100 text-gray-700";
  if (d === "aprobado") {
    styles = "bg-green-100 text-green-800";
  } else if (d === "no_cumple") {
    styles = "bg-red-100 text-red-800";
  } else if (d === "pendiente") {
    styles = "bg-amber-100 text-amber-800";
  }
  const label =
    d === "aprobado"
      ? "Aprobado"
      : d === "no_cumple"
        ? "No cumple"
        : "Pendiente";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  );
}

export default function EditorExpedientePage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useSessionRepo();
  const repo = useExpedientesRepo();
  const [precal, setPrecal] = useState<PrecalInfo | null | undefined>(
    undefined,
  );
  const [decision, setDecision] = useState<Decision>("pendiente");
  const [montoStr, setMontoStr] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadExpediente = async () => {
      const exp = await repo.getById(id);
      if (!exp) {
        setPrecal(null);
        return;
      }
      const sidecar = await repo.listEditorReprecalMeta([exp.id]);
      const revision = editorRevisionDisplay(exp, sidecar[exp.id]);
      setPrecal({
        id: exp.id,
        programa: exp.base.programa,
        nss: exp.base.nss,
        cliente_nombre: exp.base.cliente_nombre,
        telefono_cliente: exp.base.telefono_cliente,
        direccion_opcional: exp.base.direccion_opcional,
        asesorId: exp.base.asesorId,
        createdAt: exp.base.createdAt,
        esReingreso: Boolean(
          exp.reingreso?.expedienteAnteriorId && exp.reingreso?.rechazoId,
        ),
        expedienteAnteriorId:
          exp.reingreso?.expedienteAnteriorId ?? null,
        reprecalificacionPendienteId:
          exp.reprecalificacionPendienteId ?? null,
        programaSolicitado:
          exp.reprecalificacionPendiente?.programaSolicitado ?? null,
        decisionVigente: exp.editorDecision.decision,
        montoVigente: exp.editorDecision.monto_aprobado,
      });

      setDecision(revision.decision);
      setMontoStr(
        revision.monto_aprobado != null ? String(revision.monto_aprobado) : "",
      );
      setNotas(revision.notas_revision);
    };

    loadExpediente();
  }, [id, repo]);

  const handleGuardar = async () => {
    if (!id) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      if (
        decision !== "pendiente" &&
        decision !== "aprobado" &&
        decision !== "no_cumple"
      ) {
        throw new Error("Decisión inválida");
      }
      if (precal?.reprecalificacionPendienteId && decision === "pendiente") {
        throw new Error(
          "La re-precalificación pendiente requiere Aprobado o No cumple.",
        );
      }
      const montoTrim = montoStr.trim();
      const num = montoTrim === "" ? null : parseMontoAprobado(montoTrim);
      if (montoTrim !== "" && num === null) {
        throw new Error("Formato de monto aprobado inválido.");
      }
      if (num !== null && num < 0) {
        throw new Error("El monto aprobado no puede ser negativo.");
      }
      if (decision === "aprobado") {
        if (num === null || num <= 0) {
          throw new Error("El monto aprobado debe ser mayor a cero.");
        }
      }
      const wasReprecal = Boolean(precal?.reprecalificacionPendienteId);
      const savedDecision = decision;
      const savedMonto = decision === "aprobado" ? num : null;
      const savedNotas = notas.trim();
      await repo.upsertEditorDecision(id, {
        decision,
        monto_aprobado: num,
        notas_revision: savedNotas,
      });
      setSavedMessage(
        wasReprecal
          ? "Precalificación actualizada en el mismo expediente."
          : "Decisión guardada correctamente.",
      );
      const refreshed = await repo.getById(id);
      if (refreshed) {
        const sidecar = await repo.listEditorReprecalMeta([refreshed.id]);
        const revision = editorRevisionDisplay(
          refreshed,
          sidecar[refreshed.id],
        );
        setPrecal((prev) =>
          prev
            ? {
                ...prev,
                reprecalificacionPendienteId:
                  refreshed.reprecalificacionPendienteId ?? null,
                programaSolicitado:
                  refreshed.reprecalificacionPendiente?.programaSolicitado ??
                  null,
                decisionVigente: refreshed.editorDecision.decision,
                montoVigente: refreshed.editorDecision.monto_aprobado,
              }
            : prev,
        );
        if (wasReprecal) {
          setDecision(savedDecision);
          setMontoStr(savedMonto != null ? String(savedMonto) : "");
          setNotas(savedNotas);
        } else {
          setDecision(revision.decision);
          setMontoStr(
            revision.monto_aprobado != null
              ? String(revision.monto_aprobado)
              : "",
          );
          setNotas(revision.notas_revision);
        }
      }
    } catch (err) {
      const msg =
        err instanceof ExpedientesSupabaseError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al guardar la decisión.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const esMejoravit = precal ? isProgramaMejoravit(precal.programa) : false;

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (!currentUser || currentUser.role !== "editor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          No has iniciado sesión como editor.{" "}
          <Link href="/login" className="text-blue-600 underline">
            Ir a login
          </Link>
        </p>
      </div>
    );
  }

  if (precal === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <Link
              href="/editor"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Volver al panel editor
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-xl px-4 py-8">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            Expediente no encontrado.
          </p>
          <Link href="/editor" className="mt-4 inline-block">
            <Button variant="secondary">Volver al panel editor</Button>
          </Link>
        </main>
      </div>
    );
  }

  if (!precal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando expediente...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link
            href="/editor"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Volver al panel editor
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            Revisión de precalificación
          </h1>
          <span />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Datos de la precalificación
          </h2>
          {precal.esReingreso ? (
            <p className="mb-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">
              Reingreso / Reinscripción: registra una nueva decisión de monto.
              {precal.expedienteAnteriorId
                ? ` Expediente anterior: ${precal.expedienteAnteriorId}.`
                : ""}
            </p>
          ) : null}
          {precal.reprecalificacionPendienteId ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <p className="font-semibold">Actualización de precalificación</p>
              <p className="mt-1">
                El asesor dueño solicitó un nuevo intento sobre este mismo
                expediente. Al aprobar se actualiza el monto vigente
                {precal.programaSolicitado &&
                precal.programaSolicitado !== precal.programa
                  ? " y el programa"
                  : ""}
                ; si no cumple, se conserva la decisión anterior
                {precal.decisionVigente === "aprobado" &&
                precal.montoVigente != null
                  ? ` (monto vigente: ${precal.montoVigente}).`
                  : "."}
              </p>
              {precal.programaSolicitado &&
              precal.programaSolicitado !== precal.programa ? (
                <div className="mt-2 space-y-0.5">
                  <p>
                    <span className="font-medium">Programa vigente:</span>{" "}
                    {precal.programa}
                  </p>
                  <p>
                    <span className="font-medium">Programa solicitado:</span>{" "}
                    {precal.programaSolicitado}
                  </p>
                </div>
              ) : (
                <p className="mt-2">
                  <span className="font-medium">Programa:</span> {precal.programa}
                </p>
              )}
            </div>
          ) : (
            <p>
              <span className="font-medium text-gray-900">Programa:</span>{" "}
              {precal.programa}
            </p>
          )}
          <p>
            <span className="font-medium text-gray-900">NSS:</span>{" "}
            {precal.nss}
          </p>
          <p>
            <span className="font-medium text-gray-900">Cliente:</span>{" "}
            {precal.cliente_nombre || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Teléfono:</span>{" "}
            {precal.telefono_cliente || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Dirección:</span>{" "}
            {precal.direccion_opcional || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Asesor:</span>{" "}
            {precal.asesorId || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Creada:</span>{" "}
            {formatDateTimeMx(precal.createdAt)}
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Decisión del editor
            </h2>
            <DecisionBadge decision={decision} />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(["pendiente", "aprobado", "no_cumple"] as Decision[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDecision(d)}
                className={`rounded-full px-3 py-1 text-xs font-medium border ${
                  decision === d
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                {d === "aprobado"
                  ? "Aprobado"
                  : d === "no_cumple"
                    ? "No cumple"
                    : "Pendiente"}
              </button>
            ))}
          </div>

          <div className="mb-4 max-w-xs">
            <Input
              type="number"
              min={0}
              step={1}
              label={esMejoravit ? "Subcuenta de vivienda" : "Monto aprobado"}
              value={montoStr}
              onChange={(e) => setMontoStr(e.target.value)}
            />
          </div>

          <div className="mb-4">
            <label
              htmlFor="notas_revision"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Notas de revisión
            </label>
            <textarea
              id="notas_revision"
              className="min-h-[100px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones, motivos de no cumplimiento, etc."
            />
          </div>

          {error && (
            <p className="mb-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {savedMessage && (
            <p className="mb-2 text-xs text-green-700">
              {savedMessage}
            </p>
          )}

          <Button
            type="button"
            variant="primary"
            onClick={handleGuardar}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar decisión"}
          </Button>
        </section>
      </main>
    </div>
  );
}

