"use client";

import { useCallback, useEffect, useState } from "react";
import {
  calculateMontoDifference,
  describeMontoDifference,
  formatDateTimeEsMx,
  formatMoneyMx,
  getExpedienteMontoMejoravitContext,
  MontoMejoravitSupabaseError,
  shouldShowAsesorMontoMejoravitSection,
  type ExpedienteMontoMejoravitContext,
} from "@/domain/monto-mejoravit-actualizado";

export type AsesorMontoMejoravitActualizadoSectionProps = Readonly<{
  expedienteId: string;
}>;

const ASESOR_COPY =
  "Mesa Control actualizó el monto operativo de Mejoravit de este expediente. El monto aprobado original se conserva y el cobro fue recalculado con el porcentaje registrado más $3,000.";

export function AsesorMontoMejoravitActualizadoSection({
  expedienteId,
}: AsesorMontoMejoravitActualizadoSectionProps) {
  const [context, setContext] = useState<ExpedienteMontoMejoravitContext | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await getExpedienteMontoMejoravitContext(expedienteId);
      setContext(ctx);
    } catch (err) {
      setContext(null);
      setError(
        err instanceof MontoMejoravitSupabaseError
          ? err.message
          : "No se pudo consultar el monto actualizado.",
      );
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return null;
  if (error) return null;
  if (!shouldShowAsesorMontoMejoravitSection(context) || !context) return null;

  const diff =
    context.montoOperativoVigente != null &&
    context.montoOriginalOperativo != null
      ? describeMontoDifference(
          calculateMontoDifference(
            context.montoOperativoVigente,
            context.montoOriginalOperativo,
          ),
        )
      : null;

  return (
    <section
      aria-label="Monto actualizado Mejoravit"
      className="rounded-lg border border-blue-200 bg-blue-50/40 px-4 py-4 text-sm text-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Monto actualizado Mejoravit
        </h3>
        <span className="inline-flex items-center rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs font-medium text-blue-900">
          Actualizado por Mesa
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{ASESOR_COPY}</p>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Item
          label="Monto original operativo"
          value={
            context.montoOriginalOperativo != null
              ? formatMoneyMx(context.montoOriginalOperativo)
              : "—"
          }
        />
        <Item
          label="Monto actualizado vigente"
          value={
            context.montoOperativoVigente != null
              ? formatMoneyMx(context.montoOperativoVigente)
              : "—"
          }
        />
        <Item
          label="Diferencia"
          value={
            diff && diff.kind !== "igual"
              ? `${diff.signedLabel} (${diff.proseLabel})`
              : formatMoneyMx(0)
          }
        />
        <Item
          label="Porcentaje de cobro"
          value={
            context.porcentajeCobro != null
              ? `${context.porcentajeCobro}%`
              : "—"
          }
        />
        <Item label="Cargo fijo" value={formatMoneyMx(context.cargoFijo)} />
        <Item
          label="Monto de cobro actualizado"
          value={
            context.montoCalculado != null
              ? formatMoneyMx(context.montoCalculado)
              : "—"
          }
        />
        <Item
          label="Última actualización"
          value={
            context.ultimaActualizacion
              ? formatDateTimeEsMx(context.ultimaActualizacion.updatedAt)
              : "—"
          }
        />
        <Item
          label="Motivo"
          value={context.ultimaActualizacion?.motivo?.trim() || "—"}
        />
      </dl>
    </section>
  );
}

function Item({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-900">{value}</dd>
    </div>
  );
}
