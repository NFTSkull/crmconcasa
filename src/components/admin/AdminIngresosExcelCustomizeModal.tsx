"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  INGRESOS_EXCEL_COLUMN_OPTIONS,
  INGRESOS_EXCEL_SHEET_OPTIONS,
  moveIngresosExcelColumn,
  recommendedIngresosExcelConfig,
  validateIngresosExcelConfig,
  type IngresosExcelColumnId,
  type IngresosExcelExportConfig,
  type IngresosExcelSheetId,
} from "@/domain/admin-ingresos";

function ExcelCustomizeForm({
  initialConfig,
  busy,
  onClose,
  onConfirm,
}: {
  initialConfig: IngresosExcelExportConfig;
  busy: boolean;
  onClose: () => void;
  onConfirm: (config: IngresosExcelExportConfig) => void;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState<IngresosExcelExportConfig>(initialConfig);
  const validation = validateIngresosExcelConfig(draft);

  const toggleSheet = (id: IngresosExcelSheetId) => {
    setDraft((prev) => {
      const on = prev.sheets.includes(id);
      const sheets = on
        ? prev.sheets.filter((s) => s !== id)
        : [...prev.sheets, id];
      return { ...prev, sheets };
    });
  };

  const toggleColumn = (id: IngresosExcelColumnId) => {
    setDraft((prev) => {
      const on = prev.columns.includes(id);
      const columns = on
        ? prev.columns.filter((c) => c !== id)
        : [...prev.columns, id];
      return { ...prev, columns };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="admin-ingresos-excel-modal"
      >
        <h2 id={titleId} className="text-base font-semibold text-slate-950">
          Personalizar Excel
        </h2>
        <p className="mt-1 text-sm text-slate-700">
          Elige hojas y columnas. Los filtros de la pantalla no cambian.
        </p>

        <label className="mt-4 block text-xs font-semibold text-slate-900">
          Nombre opcional del reporte
          <Input
            className="mt-1 text-slate-900"
            value={draft.reportName}
            disabled={busy}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, reportName: e.target.value }))
            }
            placeholder="Ej. cierre julio"
          />
        </label>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-950">Hojas</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {INGRESOS_EXCEL_SHEET_OPTIONS.map((s) => {
              const on = draft.sheets.includes(s.id);
              return (
                <label
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-900"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={() => toggleSheet(s.id)}
                  />
                  {s.label}
                </label>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-950">
              Columnas del detalle
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={busy}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    columns: INGRESOS_EXCEL_COLUMN_OPTIONS.map((c) => c.id),
                  }))
                }
              >
                Seleccionar todas
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={busy}
                onClick={() => setDraft((prev) => ({ ...prev, columns: [] }))}
              >
                Limpiar selección
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={busy}
                onClick={() => setDraft(recommendedIngresosExcelConfig())}
              >
                Restaurar configuración recomendada
              </Button>
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {draft.columns.map((id) => {
              const label =
                INGRESOS_EXCEL_COLUMN_OPTIONS.find((c) => c.id === id)?.label ??
                id;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-900"
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked
                      disabled={busy}
                      onChange={() => toggleColumn(id)}
                    />
                    {label}
                  </label>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="rounded px-1 ring-1 ring-slate-300"
                      disabled={busy}
                      aria-label={`Subir ${label}`}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          columns: moveIngresosExcelColumn(
                            prev.columns,
                            id,
                            "up",
                          ),
                        }))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded px-1 ring-1 ring-slate-300"
                      disabled={busy}
                      aria-label={`Bajar ${label}`}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          columns: moveIngresosExcelColumn(
                            prev.columns,
                            id,
                            "down",
                          ),
                        }))
                      }
                    >
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
            {INGRESOS_EXCEL_COLUMN_OPTIONS.filter(
              (c) => !draft.columns.includes(c.id),
            ).map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-md border border-dashed border-slate-200 px-2 py-1 text-xs text-slate-700"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={busy}
                    onChange={() => toggleColumn(c.id)}
                  />
                  {c.label}
                </label>
              </li>
            ))}
          </ul>
        </div>

        {!validation.ok ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {validation.message}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={busy || !validation.ok}
            onClick={() => onConfirm(draft)}
            data-testid="admin-ingresos-excel-confirm"
          >
            {busy ? "Preparando Excel…" : "Descargar Excel"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AdminIngresosExcelCustomizeModal({
  open,
  initialConfig,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  initialConfig: IngresosExcelExportConfig;
  busy: boolean;
  onClose: () => void;
  onConfirm: (config: IngresosExcelExportConfig) => void;
}) {
  if (!open) return null;
  return (
    <ExcelCustomizeForm
      key={JSON.stringify(initialConfig)}
      initialConfig={initialConfig}
      busy={busy}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
