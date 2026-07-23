"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listAgendaSlotCapacities,
  upsertAgendaSlotCapacity,
  AgendaSlotCapacitiesError,
} from "./supabase.repo";
import type {
  AgendaSlotCapacity,
  AgendaSlotCapacityKind,
  UpsertAgendaSlotCapacityInput,
} from "./types";

export function useAgendaSlotCapacities(params: {
  kind: AgendaSlotCapacityKind;
  slotDate: string;
  locationId: string | null;
  enabled?: boolean;
}) {
  const enabled = params.enabled !== false;
  const [rows, setRows] = useState<readonly AgendaSlotCapacity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled || !params.slotDate) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listAgendaSlotCapacities({
        kind: params.kind,
        slotDate: params.slotDate,
        locationId: params.locationId,
      });
      setRows(data);
    } catch (err) {
      setRows([]);
      setError(
        err instanceof AgendaSlotCapacitiesError
          ? err.message
          : "No se pudieron cargar los cupos.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, params.kind, params.locationId, params.slotDate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (input: UpsertAgendaSlotCapacityInput) => {
      setSaving(true);
      setError(null);
      try {
        const result = await upsertAgendaSlotCapacity(input);
        await reload();
        return result;
      } catch (err) {
        const message =
          err instanceof AgendaSlotCapacitiesError
            ? err.message
            : "No se pudo guardar el cupo.";
        setError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  return { rows, loading, error, saving, reload, save, setError };
}
