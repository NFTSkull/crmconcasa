"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDateTimeMx } from "@/lib/filters";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  type EditorDecision,
  type ExpedienteMock,
} from "@/domain/expedientes";
import { isDataModeSupabase } from "@/lib/dataMode";

const SUPABASE_SAVE_DEBOUNCE_MS = 750;

interface EditorPrecalRow {
  id: string;
  programa: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  asesorId: string;
  createdAt: string;
  decision: string;
  monto_aprobado: number | null;
  notas_revision: string;
}

type RowSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type RowSaveState = {
  status: RowSaveStatus;
  error?: string;
};

function mapExpedienteToEditorRow(e: ExpedienteMock): EditorPrecalRow {
  return {
    id: e.id,
    programa: e.base.programa,
    nss: e.base.nss,
    cliente_nombre: e.base.cliente_nombre,
    telefono_cliente: e.base.telefono_cliente,
    asesorId: e.base.asesorId,
    createdAt: e.base.createdAt,
    decision: e.editorDecision.decision,
    monto_aprobado: e.editorDecision.monto_aprobado,
    notas_revision: e.editorDecision.notas_revision,
  };
}

function computeDecision(montoStr: string, notasStr: string): EditorDecision {
  const montoTrim = (montoStr ?? "").trim();
  const notasTrim = (notasStr ?? "").trim();
  if (montoTrim !== "") {
    const num = Number(montoTrim);
    if (!Number.isNaN(num) && num > 0) return "aprobado";
  }
  if (notasTrim.length > 0) return "no_cumple";
  return "pendiente";
}

function buildDecisionPayload(
  montoStr: string,
  notasStr: string,
): {
  decision: EditorDecision;
  monto_aprobado: number | null;
  notas_revision: string;
} {
  const montoTrim = montoStr.trim();
  const notasTrim = notasStr.trim();
  const num = montoTrim === "" ? null : Number(montoTrim);

  if (num !== null && (Number.isNaN(num) || num < 0)) {
    throw new Error("El monto aprobado no puede ser negativo.");
  }

  const decision = computeDecision(montoStr, notasStr);

  if (decision === "aprobado") {
    return {
      decision,
      monto_aprobado: num,
      notas_revision: notasTrim,
    };
  }

  if (decision === "no_cumple") {
    return {
      decision,
      monto_aprobado: null,
      notas_revision: notasTrim,
    };
  }

  return {
    decision: "pendiente",
    monto_aprobado: null,
    notas_revision: "",
  };
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

function RowSaveIndicator({ state }: { state?: RowSaveState }) {
  if (!state || state.status === "idle") return null;

  if (state.status === "pending") {
    return (
      <span className="mt-1 block text-[10px] text-gray-400">Pendiente…</span>
    );
  }
  if (state.status === "saving") {
    return (
      <span className="mt-1 block text-[10px] text-blue-600">Guardando…</span>
    );
  }
  if (state.status === "saved") {
    return (
      <span className="mt-1 block text-[10px] text-green-600">Guardado</span>
    );
  }
  return (
    <span className="mt-1 block text-[10px] text-red-600" title={state.error}>
      Error
    </span>
  );
}

export default function EditorDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = useExpedientesRepo();
  const dataSupabase = isDataModeSupabase();
  const [rows, setRows] = useState<EditorPrecalRow[]>([]);
  const [buscar, setBuscar] = useState("");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [rowSaveStates, setRowSaveStates] = useState<
    Record<string, RowSaveState>
  >({});

  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const savedClearTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  const loadData = useCallback(() => {
    void (async () => {
      try {
        const list = await repo.listForEditor();
        const combined = list
          .map(mapExpedienteToEditorRow)
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
        setRows(combined);
      } catch (err) {
        console.error(
          "[editor] error leyendo expedientes:",
          err instanceof Error ? err.message : String(err),
        );
        setRows([]);
      }
    })();
  }, [repo]);

  useEffect(() => {
    if (!currentUser) return;
    loadData();
  }, [currentUser, loadData]);

  useEffect(() => {
    if (!currentUser || dataSupabase) return;
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (
        e.key === "precalificaciones_mock" ||
        e.key === "decisions_mock"
      ) {
        loadData();
      }
    };
    const customHandler = () => {
      loadData();
    };
    window.addEventListener("storage", handler);
    window.addEventListener("decisions_mock_updated", customHandler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("decisions_mock_updated", customHandler);
    };
  }, [currentUser, dataSupabase, loadData]);

  useEffect(() => {
    const debounceTimers = debounceTimersRef.current;
    const savedClearTimers = savedClearTimersRef.current;
    return () => {
      Object.values(debounceTimers).forEach(clearTimeout);
      Object.values(savedClearTimers).forEach(clearTimeout);
    };
  }, []);

  const persistDecisionMock = (
    expedienteId: string,
    payload: {
      decision: EditorDecision;
      monto_aprobado: number | null;
      notas_revision: string;
    },
  ) => {
    setGlobalError(null);
    void repo
      .upsertEditorDecision(expedienteId, payload)
      .catch((err) => {
        const msg =
          err instanceof ExpedientesSupabaseError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Error al guardar la decisión.";
        setGlobalError(msg);
      });
  };

  const scheduleSupabaseSave = useCallback(
    (expedienteId: string, montoStr: string, notasStr: string) => {
      const existingDebounce = debounceTimersRef.current[expedienteId];
      if (existingDebounce) clearTimeout(existingDebounce);

      setRowSaveStates((prev) => ({
        ...prev,
        [expedienteId]: { status: "pending" },
      }));

      debounceTimersRef.current[expedienteId] = setTimeout(() => {
        void (async () => {
          let payload: ReturnType<typeof buildDecisionPayload>;
          try {
            payload = buildDecisionPayload(montoStr, notasStr);
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : "Error al guardar la decisión.";
            setGlobalError(msg);
            setRowSaveStates((prev) => ({
              ...prev,
              [expedienteId]: { status: "error", error: msg },
            }));
            return;
          }

          setGlobalError(null);
          setRowSaveStates((prev) => ({
            ...prev,
            [expedienteId]: { status: "saving" },
          }));

          try {
            const updated = await repo.upsertEditorDecision(
              expedienteId,
              payload,
            );
            const nextRow = mapExpedienteToEditorRow(updated);
            setRows((prev) =>
              prev.map((row) => (row.id === expedienteId ? nextRow : row)),
            );
            setRowSaveStates((prev) => ({
              ...prev,
              [expedienteId]: { status: "saved" },
            }));

            const existingSavedClear = savedClearTimersRef.current[expedienteId];
            if (existingSavedClear) clearTimeout(existingSavedClear);
            savedClearTimersRef.current[expedienteId] = setTimeout(() => {
              setRowSaveStates((prev) => {
                const current = prev[expedienteId];
                if (!current || current.status !== "saved") return prev;
                const next = { ...prev };
                delete next[expedienteId];
                return next;
              });
            }, 2500);
          } catch (err) {
            const msg =
              err instanceof ExpedientesSupabaseError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Error al guardar la decisión.";
            setGlobalError(msg);
            setRowSaveStates((prev) => ({
              ...prev,
              [expedienteId]: { status: "error", error: msg },
            }));
          }
        })();
      }, SUPABASE_SAVE_DEBOUNCE_MS);
    },
    [repo],
  );

  const handleMontoChange = (row: EditorPrecalRow, val: string) => {
    try {
      const nextMonto = val.trim() === "" ? null : Number(val);
      const nextDecision = computeDecision(val, row.notas_revision);

      if (nextMonto !== null && nextMonto < 0) {
        throw new Error("El monto aprobado no puede ser negativo.");
      }

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                monto_aprobado: nextMonto,
                decision: nextDecision,
              }
            : r,
        ),
      );

      const payload = buildDecisionPayload(val, row.notas_revision);

      if (dataSupabase) {
        scheduleSupabaseSave(row.id, val, row.notas_revision);
        return;
      }

      setGlobalError(null);
      persistDecisionMock(row.id, payload);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al guardar la decisión.";
      setGlobalError(msg);
    }
  };

  const handleNotasChange = (row: EditorPrecalRow, val: string) => {
    const montoStr =
      row.monto_aprobado != null ? String(row.monto_aprobado) : "";
    const nextDecision = computeDecision(montoStr, val);

    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? { ...r, notas_revision: val, decision: nextDecision }
          : r,
      ),
    );

    try {
      const payload = buildDecisionPayload(montoStr, val);

      if (dataSupabase) {
        scheduleSupabaseSave(row.id, montoStr, val);
        return;
      }

      setGlobalError(null);
      persistDecisionMock(row.id, payload);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al guardar la decisión.";
      setGlobalError(msg);
    }
  };

  const filteredRows = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => {
      return (
        p.cliente_nombre.toLowerCase().includes(q) ||
        p.telefono_cliente.includes(q) ||
        p.programa.toLowerCase().includes(q) ||
        (p.nss ?? "").includes(q) ||
        (p.asesorId ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, buscar]);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">
            ConCasa CRM · Editor
          </h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="min-w-0 max-w-xs truncate text-sm text-gray-500">
              {currentUser.email}
            </span>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await sessionRepo.logout();
                } catch (err) {
                  console.error(
                    "[logout] editor:",
                    err instanceof Error ? err.message : String(err),
                  );
                }
                if (typeof window !== "undefined") {
                  window.location.href = "/login";
                }
              }}
              className="min-h-[36px] touch-manipulation sm:min-h-0"
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:space-y-6 sm:py-6">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium text-gray-900 sm:text-lg">
            Precalificaciones para revisión
            {!dataSupabase ? " (mock)" : ""}
          </h2>
          <div className="w-full max-w-xs sm:w-72">
            <Input
              type="search"
              placeholder="Buscar (cliente, NSS, teléfono, programa, asesor)"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          </div>
        </section>

        {globalError ? (
          <p role="alert" className="text-xs text-red-600">
            {globalError}
          </p>
        ) : null}

        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Creada
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Programa
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  NSS
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Cliente
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Teléfono
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Asesor
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Decisión
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Monto aprobado
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Notas
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-sm text-gray-500"
                  >
                    No hay expedientes para revisar.
                    {!dataSupabase ? " (modo mock)" : ""}
                  </td>
                </tr>
              ) : (
                filteredRows.map((p) => {
                  const montoValue =
                    p.monto_aprobado != null ? String(p.monto_aprobado) : "";
                  const saveState = rowSaveStates[p.id];

                  return (
                    <tr key={p.id} className="align-top hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {formatDateTimeMx(p.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.programa}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.nss || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
                        {p.cliente_nombre || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.telefono_cliente || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.asesorId || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <DecisionBadge decision={p.decision} />
                        {dataSupabase ? (
                          <RowSaveIndicator state={saveState} />
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="no-spinner w-32 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={montoValue}
                          onChange={(e) => handleMontoChange(p, e.target.value)}
                        />
                      </td>
                      <td className="max-w-[260px] px-3 py-2 text-xs text-gray-600">
                        <textarea
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          rows={2}
                          value={p.notas_revision}
                          onChange={(e) => handleNotasChange(p, e.target.value)}
                          placeholder="Notas de revisión..."
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
