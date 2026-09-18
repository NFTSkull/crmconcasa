import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export type AdminDetailRecord = Record<string, unknown>;

export type AdminExpedienteFullDetail = Readonly<{
  expediente: AdminDetailRecord;
  precalificacion: AdminDetailRecord | null;
  cliente_datos: AdminDetailRecord | null;
  documentos: readonly AdminDetailRecord[];
  citas: readonly AdminDetailRecord[];
  decisiones_cita: readonly AdminDetailRecord[];
  correcciones: readonly AdminDetailRecord[];
  rechazos_operativos: readonly AdminDetailRecord[];
  reactivaciones: readonly AdminDetailRecord[];
  retencion: AdminDetailRecord;
  historial: readonly AdminDetailRecord[];
  /** Timeline operativo paginado completo, incluyendo ciclo de corrección. */
  mesa_timeline: readonly AdminDetailRecord[];
}>;

function asRecord(value: unknown): AdminDetailRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AdminDetailRecord)
    : {};
}

function asArray(value: unknown): AdminDetailRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

async function fetchAllAdminMesaTimeline(
  expedienteId: string,
): Promise<AdminDetailRecord[]> {
  if (!supabaseBrowser) return [];
  const limit = 100;
  let offset = 0;
  const out: AdminDetailRecord[] = [];

  for (let page = 0; page < 1000; page += 1) {
    const { data, error } = await supabaseBrowser.rpc(
      "admin_get_expediente_mesa_timeline",
      {
        p_expediente_id: expedienteId,
        p_limit: limit,
        p_offset: offset,
      },
    );
    if (error) {
      throw new Error(error.message || "No se pudo cargar el timeline del expediente");
    }
    const root = asRecord(data);
    const items = asArray(root.items);
    out.push(...items);
    if (!Boolean(root.has_more) || items.length === 0) break;
    offset += items.length;
  }

  return out;
}

export async function fetchAdminExpedienteFullDetail(
  expedienteId: string,
): Promise<AdminExpedienteFullDetail> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new Error("Supabase no configurado");
  }

  const { data, error } = await supabaseBrowser.rpc(
    "admin_get_expediente_full_detail",
    { p_expediente_id: expedienteId },
  );

  if (error) {
    throw new Error(error.message || "No se pudo cargar el expediente completo");
  }

  const root = asRecord(data);
  const expediente = asRecord(root.expediente);
  if (!String(expediente.id ?? "").trim()) {
    throw new Error("Expediente no encontrado");
  }

  const mesaTimeline = expediente.submitted_to_mesa
    ? await fetchAllAdminMesaTimeline(expedienteId)
    : [];

  return {
    expediente,
    precalificacion:
      root.precalificacion && typeof root.precalificacion === "object"
        ? asRecord(root.precalificacion)
        : null,
    cliente_datos:
      root.cliente_datos && typeof root.cliente_datos === "object"
        ? asRecord(root.cliente_datos)
        : null,
    documentos: asArray(root.documentos),
    citas: asArray(root.citas),
    decisiones_cita: asArray(root.decisiones_cita),
    correcciones: asArray(root.correcciones),
    rechazos_operativos: asArray(root.rechazos_operativos),
    reactivaciones: asArray(root.reactivaciones),
    retencion: asRecord(root.retencion),
    historial: asArray(root.historial),
    mesa_timeline: mesaTimeline,
  };
}
