import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";

export type MesaCorreccionLecturaEstado = "no_aplica" | "nueva" | "abierta";

export type ClienteDatosCorreccionMeta = Readonly<{
  estado: ExpedienteClienteDatosEstado | null;
  updatedAt?: string | null;
  validatedAt?: string | null;
}>;

/** Último upload documental marcado como corrección enviada (`resubido`). */
export function deriveUltimaCorreccionDocumentoAt(
  resumen: readonly ExpedienteArchivoResumen[],
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const row of resumen) {
    if (row.estatus_revision !== "resubido") continue;
    const raw = typeof row.created_at === "string" ? row.created_at.trim() : "";
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (Number.isNaN(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = raw;
  }

  return latest;
}

/**
 * Datos generales corregidos por asesor y pendientes de nueva revisión en Mesa.
 * Señal: `completo` sin validar y `updated_at` posterior al primer envío a Mesa.
 */
export function clienteDatosCorreccionEnviadaPendiente(
  meta: ClienteDatosCorreccionMeta,
  fechaEnvioMesa: string | null | undefined,
): boolean {
  if (meta.estado !== "completo") return false;
  if (meta.validatedAt) return false;

  const updatedRaw = typeof meta.updatedAt === "string" ? meta.updatedAt.trim() : "";
  const envioRaw =
    typeof fechaEnvioMesa === "string" ? fechaEnvioMesa.trim() : "";
  if (!updatedRaw || !envioRaw) return false;

  const updatedMs = new Date(updatedRaw).getTime();
  const envioMs = new Date(envioRaw).getTime();
  if (Number.isNaN(updatedMs) || Number.isNaN(envioMs)) return false;

  return updatedMs > envioMs;
}

/** ISO de la última corrección enviada a Mesa (documentos o datos generales). */
export function deriveUltimaCorreccionEnviadaAt(params: {
  resumen: readonly ExpedienteArchivoResumen[];
  clienteDatos?: ClienteDatosCorreccionMeta | null;
  fechaEnvioMesa?: string | null;
}): string | null {
  const candidates: string[] = [];

  const docAt = deriveUltimaCorreccionDocumentoAt(params.resumen);
  if (docAt) candidates.push(docAt);

  const meta = params.clienteDatos;
  if (
    meta &&
    clienteDatosCorreccionEnviadaPendiente(meta, params.fechaEnvioMesa)
  ) {
    const updated =
      typeof meta.updatedAt === "string" ? meta.updatedAt.trim() : "";
    if (updated) candidates.push(updated);
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((best, cur) => {
    const bestMs = new Date(best).getTime();
    const curMs = new Date(cur).getTime();
    if (Number.isNaN(curMs)) return best;
    if (Number.isNaN(bestMs)) return cur;
    return curMs > bestMs ? cur : best;
  });
}

/**
 * Fecha efectiva para orden y badge «En Mesa hace X».
 * Prioriza última corrección enviada; si no hay, el primer envío a Mesa.
 */
export function resolveFechaEntradaMesaActual(
  fechaEnvioMesa: string | null | undefined,
  ultimaCorreccionEnviadaAt: string | null | undefined,
  createdAt?: string | null,
): string | null {
  const correccion =
    typeof ultimaCorreccionEnviadaAt === "string"
      ? ultimaCorreccionEnviadaAt.trim()
      : "";
  if (correccion) return correccion;

  const envio = typeof fechaEnvioMesa === "string" ? fechaEnvioMesa.trim() : "";
  if (envio) return envio;

  const created = typeof createdAt === "string" ? createdAt.trim() : "";
  return created || null;
}

export function mesaEntradaEsPorCorreccion(
  fechaEntradaMesaActual: string | null | undefined,
  ultimaCorreccionEnviadaAt: string | null | undefined,
): boolean {
  const correccion =
    typeof ultimaCorreccionEnviadaAt === "string"
      ? ultimaCorreccionEnviadaAt.trim()
      : "";
  if (!correccion) return false;

  const entrada =
    typeof fechaEntradaMesaActual === "string" ? fechaEntradaMesaActual.trim() : "";
  if (!entrada) return false;

  const correccionMs = new Date(correccion).getTime();
  const entradaMs = new Date(entrada).getTime();
  if (Number.isNaN(correccionMs) || Number.isNaN(entradaMs)) return false;

  return entradaMs === correccionMs;
}

/**
 * Abierto / no abierto para cualquier entrada a revisión en Mesa.
 * Compara `fechaEntradaMesaActual` vs última apertura en localStorage.
 */
export function deriveMesaCorreccionLecturaEstado(
  fechaEntradaMesaActual: string | null | undefined,
  lastOpenedAt: string | null | undefined,
): MesaCorreccionLecturaEstado {
  const entrada =
    typeof fechaEntradaMesaActual === "string" ? fechaEntradaMesaActual.trim() : "";
  if (!entrada) return "no_aplica";

  const opened = typeof lastOpenedAt === "string" ? lastOpenedAt.trim() : "";
  if (!opened) return "nueva";

  const entradaMs = new Date(entrada).getTime();
  const openedMs = new Date(opened).getTime();
  if (Number.isNaN(entradaMs)) return "nueva";
  if (Number.isNaN(openedMs)) return "nueva";

  return openedMs >= entradaMs ? "abierta" : "nueva";
}

export function mesaCorreccionLecturaLabel(
  estado: MesaCorreccionLecturaEstado,
  esCorreccion = false,
): string | null {
  if (estado === "nueva") {
    return esCorreccion ? "Corrección nueva" : "Nuevo en Mesa";
  }
  if (estado === "abierta") {
    return esCorreccion ? "Corrección abierta" : "Abierto";
  }
  return null;
}

export function mesaCorreccionLecturaBadgeClass(estado: MesaCorreccionLecturaEstado): string {
  if (estado === "nueva") {
    return "inline-flex rounded-md border border-indigo-400/90 bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-950 ring-1 ring-indigo-300/80";
  }
  if (estado === "abierta") {
    return "inline-flex rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200/80";
  }
  return "";
}
