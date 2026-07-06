"use client";

import {
  mergeMesaControlInboxByLatestUpdated,
  readMesaControlInboxSafe,
} from "@/lib/mesaControlInboxMock";
import { origenMesaDesdeEmailAsesor } from "@/lib/asesorTipoMesaMock";
import { hasActiveFirmasBookingForCita } from "@/lib/agendaFirmasBookingsGuard";
import { getEffectiveMockRole } from "@/lib/mockUser";
import type { ExpedientesRepo } from "./repo";
import type { CreateExpedienteInput } from "./create-expediente.input";
import type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
import {
  paginateSortedExpedientes,
  sortExpedientesByCreatedAtDesc,
  type ListForAsesorPaginatedOptions,
  type PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";
import {
  matchesEditorListSearch,
  normalizeEditorListPage,
  sortEditorListItems,
  type EditorListPage,
  type EditorListQuery,
} from "./editor-list-query";

export type EditorDecision = "pendiente" | "aprobado" | "no_cumple";
export type OperativoSubestado =
  | "pendiente"
  | "en_validacion_mesa"
  | "en_proceso"
  | "aprobado"
  | "rechazado";

export type ResultadoRealExpediente =
  | "pendiente_editor"
  | "no_cumple_editor"
  | "aprobado_editor"
  | "en_tramite"
  | "rechazado_mesa";

/** Origen del expediente para reglas de Mesa (interno / externo). */
export type OrigenMesa = "interno" | "externo";

export function normalizeOrigenMesa(value: unknown): OrigenMesa | null {
  if (value === "interno" || value === "externo") return value;
  return null;
}

export interface ExpedienteMock {
  id: string;
  base: {
    programa: string;
    nss: string;
    cliente_nombre: string;
    telefono_cliente: string;
    direccion_opcional: string;
    asesorId: string;
    /** Nombre del perfil asesor (si disponible). */
    asesorNombre?: string | null;
    /** Email del perfil asesor (si disponible). */
    asesorEmail?: string | null;
    createdAt: string;
    /** Definido al enviar a mesa (inbox); `null` si aún no existe en datos persistidos. */
    origenMesa: OrigenMesa | null;
  };
  editorDecision: {
    decision: EditorDecision;
    monto_aprobado: number | null;
    notas_revision: string;
  };
  operativo: {
    etapaActual: number | null;
    subestado: OperativoSubestado | null;
    motivoRechazo: string | null;
    /** Comentario libre del rechazo operativo (separado del motivo categórico). */
    comentarioRechazo: string | null;
    fechaCita: string | null;
    updatedAt: string | null;
    submittedToMesa: boolean;
    fechaEnvioMesa: string | null;
    cicloEstado: string | null;
  };
}

/**
 * Deriva el "resultado real" del expediente, separando:
 * - decisión del editor: `editorDecision.decision`
 * - resultado operativo real: `operativo.submittedToMesa` + `operativo.subestado`
 *
 * Regla mínima (prioridad):
 * 1. Si está enviado a mesa y está rechazado => rechazado_mesa
 * 2. Si está enviado a mesa y no está rechazado => en_tramite
 * 3. Si no está enviado a mesa => depende solo del editor
 */
export function deriveResultadoRealExpediente(exp: ExpedienteMock): ResultadoRealExpediente {
  if (exp.operativo.submittedToMesa && exp.operativo.subestado === "rechazado") {
    return "rechazado_mesa";
  }

  if (exp.operativo.submittedToMesa) {
    return "en_tramite";
  }

  switch (exp.editorDecision.decision) {
    case "no_cumple":
      return "no_cumple_editor";
    case "pendiente":
      return "pendiente_editor";
    case "aprobado":
      return "aprobado_editor";
    default:
      return "pendiente_editor";
  }
}

/** Vista de negocio derivada solo de `editorDecision` (sin `monto_aprobado`). */
export type EstatusPrecalificacionVista = "pendiente" | "aprobado" | "rechazado";

export function estatusPrecalificacionDesdeEditor(
  ed: ExpedienteMock["editorDecision"],
): EstatusPrecalificacionVista {
  if (ed.decision === "no_cumple") return "rechazado";
  if (ed.decision === "pendiente") return "pendiente";
  return "aprobado";
}

/** El asesor solo puede integrar (datos, documentos, envío a mesa) con monto numérico > 0. */
export function asesorPuedeIntegrarTrasMontoRevisor(
  ed: ExpedienteMock["editorDecision"],
): boolean {
  return (
    typeof ed.monto_aprobado === "number" &&
    !Number.isNaN(ed.monto_aprobado) &&
    ed.monto_aprobado > 0
  );
}

type RawPrecalificacion = {
  id: string;
  programa?: string;
  nss?: string;
  cliente_nombre?: string;
  telefono_cliente?: string;
  direccion_opcional?: string;
  asesorId?: string;
  createdAt?: string;
};

type RawDecision = {
  idPrecal?: string;
  id?: string;
  decision?: EditorDecision | string;
  monto_aprobado?: number | null;
  notas_revision?: string;
};

type RawOperativoInbox = {
  id?: string;
  idPrecal?: string;
  etapaActual?: number | null;
  subestado?: OperativoSubestado | string | null;
  motivoRechazo?: string | null;
  comentarioRechazo?: string | null;
  fechaCita?: string | null;
  /** ISO del primer envío a mesa (`enviarAMesa`); se conserva en `updateOperativo`. */
  fechaEnvioMesa?: string | null;
  updatedAt?: string | null;
  submittedToMesa?: boolean;
  origenMesa?: OrigenMesa | string | null;
  [key: string]: unknown;
};

type UpdateDecisionPatch = Partial<{
  decision: EditorDecision;
  monto_aprobado: number | null;
  notas_revision: string;
}>;

type UpdateOperativoPatch = Partial<{
  etapaActual: number | null;
  subestado: OperativoSubestado | null;
  motivoRechazo: string | null;
  comentarioRechazo: string | null;
  fechaCita: string | null;
  updatedAt: string | null;
  submittedToMesa: boolean;
}>;

type EnviarAMesaPayload = {
  cliente_nombre: string;
  telefono_cliente: string;
  programa: string;
  asesorNombre: string;
  /** Persistido en `mesa_control_inbox` al enviar; debe derivarse del asesor (p. ej. catálogo `tipoAsesor`). */
  origenMesa?: OrigenMesa | null;
  // Envío a mesa NO debe requerir cita. La cita se captura en mesa-control
  // en etapas específicas (3 y 9) y se persiste luego vía updateOperativo.
  fechaCita?: string | null;
  etapaActual?: number;
  subestado?: OperativoSubestado;
  docs?: unknown;
};

function safeParseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeDecision(value: unknown): EditorDecision {
  if (value === "aprobado" || value === "no_cumple" || value === "pendiente") {
    return value;
  }
  return "pendiente";
}

function normalizeSubestado(value: unknown): OperativoSubestado | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (
    raw === "pendiente" ||
    raw === "en_validacion_mesa" ||
    raw === "en_proceso" ||
    raw === "aprobado" ||
    raw === "rechazado"
  ) {
    return raw;
  }
  return null;
}

/**
 * Etapa operativa efectiva al leer inbox / persistir `updateOperativo`.
 *
 * En `en_validacion_mesa` el envío a Mesa **no** avanza etapa: se conserva la persistida
 * (típicamente **1** Integración). Solo cuando Mesa aprueba y avanza (`en_proceso` / etapa 2+)
 * cambia el número guardado en inbox.
 */
export function etapaActualParaOperativo(
  etapaPersistida: number | null | undefined,
  subestadoNormalizado: OperativoSubestado | null,
): number | null {
  if (subestadoNormalizado === "en_validacion_mesa") {
    if (typeof etapaPersistida === "number" && etapaPersistida >= 2) {
      return etapaPersistida;
    }
    return 1;
  }
  return typeof etapaPersistida === "number" ? etapaPersistida : null;
}

/** Etapa a guardar al enviar a Mesa desde Integración (asesor): no saltar a Registro. */
export function etapaAlEnviarAMesaDesdeAsesor(
  etapaPrevia: number | null | undefined,
): number {
  if (typeof etapaPrevia === "number" && etapaPrevia >= 2) return etapaPrevia;
  return 1;
}

/** Clave estable para cruzar inbox ↔ precal (siempre string; no descarta number u otros tipos JSON). */
function getInboxKey(i: RawOperativoInbox): string | null {
  const tryKey = (v: unknown): string | null => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  return tryKey(i.idPrecal) ?? tryKey(i.id);
}

export class MockExpedientesRepo implements ExpedientesRepo {
  private readPrecalificaciones(): RawPrecalificacion[] {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem("precalificaciones_mock");
    const arr = safeParseArray(raw);
    const out: RawPrecalificacion[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const rid = obj.id;
      if (rid === undefined || rid === null) continue;
      if (typeof rid !== "string" && typeof rid !== "number") continue;
      out.push({
        id: String(rid),
        programa: typeof obj.programa === "string" ? obj.programa : "",
        nss: typeof obj.nss === "string" ? obj.nss : "",
        cliente_nombre: typeof obj.cliente_nombre === "string" ? obj.cliente_nombre : "",
        telefono_cliente: typeof obj.telefono_cliente === "string" ? obj.telefono_cliente : "",
        direccion_opcional:
          typeof obj.direccion_opcional === "string" ? obj.direccion_opcional : "",
        asesorId: typeof obj.asesorId === "string" ? obj.asesorId : "",
        createdAt:
          typeof obj.createdAt === "string" && obj.createdAt.trim() !== ""
            ? String(obj.createdAt)
            : new Date().toISOString(),
      });
    }
    return out;
  }

  private readDecisions(): RawDecision[] {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem("decisions_mock");
    const arr = safeParseArray(raw);
    return arr.filter(
      (d): d is RawDecision =>
        !!d &&
        typeof d === "object" &&
        (typeof (d as Record<string, unknown>).idPrecal === "string" ||
          typeof (d as Record<string, unknown>).id === "string")
    );
  }

  private buildDecisionMap(): Map<string, RawDecision> {
    const decisions = this.readDecisions();
    const map = new Map<string, RawDecision>();
    decisions.forEach((d) => {
      const key =
        typeof d.idPrecal === "string"
          ? d.idPrecal
          : typeof d.id === "string"
            ? d.id
            : null;
      if (!key) return;
      map.set(key, d);
    });
    return map;
  }

  private buildInboxMap(): Map<string, RawOperativoInbox> {
    const raw = readMesaControlInboxSafe() as RawOperativoInbox[];
    return mergeMesaControlInboxByLatestUpdated(raw) as Map<
      string,
      RawOperativoInbox
    >;
  }

  private toExpedienteMock(
    p: RawPrecalificacion,
    decMap: Map<string, RawDecision>,
    inboxMap: Map<string, RawOperativoInbox>,
  ): ExpedienteMock {
    const d = decMap.get(p.id);
    const op = inboxMap.get(p.id);
    const submittedToMesa =
      Boolean(op?.submittedToMesa) ||
      (typeof op?.fechaEnvioMesa === "string" && op.fechaEnvioMesa.trim() !== "");
    const origenMesaResolved =
      normalizeOrigenMesa(op?.origenMesa) ?? (submittedToMesa ? "interno" : null);
    return {
      id: p.id,
      base: {
        programa: p.programa ?? "",
        nss: p.nss ?? "",
        cliente_nombre: p.cliente_nombre ?? "",
        telefono_cliente: p.telefono_cliente ?? "",
        direccion_opcional: p.direccion_opcional ?? "",
        asesorId: p.asesorId ?? "",
        createdAt: p.createdAt ?? new Date().toISOString(),
        origenMesa: origenMesaResolved,
      },
      editorDecision: {
        decision: normalizeDecision(d?.decision),
        monto_aprobado:
          typeof d?.monto_aprobado === "number" ? d.monto_aprobado : null,
        notas_revision: typeof d?.notas_revision === "string" ? d?.notas_revision : "",
      },
      operativo: {
        etapaActual: etapaActualParaOperativo(
          typeof op?.etapaActual === "number" ? op.etapaActual : null,
          normalizeSubestado(op?.subestado ?? "pendiente") ?? "pendiente",
        ),
        subestado:
          normalizeSubestado(op?.subestado ?? "pendiente") ?? "pendiente",
        motivoRechazo:
          typeof op?.motivoRechazo === "string" ? op.motivoRechazo : null,
        comentarioRechazo:
          typeof op?.comentarioRechazo === "string" ? op.comentarioRechazo : null,
        fechaCita: typeof op?.fechaCita === "string" ? op.fechaCita : null,
        updatedAt: typeof op?.updatedAt === "string" ? op.updatedAt : null,
        submittedToMesa,
        fechaEnvioMesa:
          typeof op?.fechaEnvioMesa === "string" ? op.fechaEnvioMesa : null,
        cicloEstado: null,
      },
    };
  }

  async listAll(): Promise<ExpedienteMock[]> {
    const pre = this.readPrecalificaciones();
    const decMap = this.buildDecisionMap();
    const inboxMap = this.buildInboxMap();
    return pre.map((p) => this.toExpedienteMock(p, decMap, inboxMap));
  }

  async listForAsesor(asesorId: string): Promise<ExpedienteMock[]> {
    const all = await this.listAll();
    return all.filter((e) => e.base.asesorId === asesorId);
  }

  async listForAsesorPaginated(
    asesorId: string,
    options: ListForAsesorPaginatedOptions,
  ): Promise<PaginatedExpedientesResult> {
    const mine = await this.listForAsesor(asesorId);
    const sorted = sortExpedientesByCreatedAtDesc(mine);
    return paginateSortedExpedientes(sorted, options);
  }

  async listForEditor(query: EditorListQuery): Promise<EditorListPage> {
    const { page, pageSize, from, to } = normalizeEditorListPage(
      query.page,
      query.pageSize,
    );
    const all = sortEditorListItems(await this.listAll());
    const filtered = all.filter((e) =>
      matchesEditorListSearch(e, query.search ?? ""),
    );
    return {
      items: filtered.slice(from, to + 1),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async listForAdmin(): Promise<ExpedienteMock[]> {
    return this.listAll();
  }

  async createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock> {
    if (typeof window === "undefined") {
      throw new Error("createExpediente mock requiere entorno navegador.");
    }

    const id = String(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `mock-${Date.now()}`,
    );
    const precal: RawPrecalificacion = {
      id,
      programa: input.programa,
      nss: input.nss.trim(),
      cliente_nombre: input.cliente_nombre.trim(),
      telefono_cliente: input.telefono_cliente.trim(),
      direccion_opcional: input.direccion_opcional.trim(),
      asesorId: input.asesorEmail.trim() || "mock",
      createdAt: new Date().toISOString(),
    };

    const raw = window.localStorage.getItem("precalificaciones_mock");
    const parsed = safeParseArray(raw);
    const without = parsed.filter((p) => {
      if (!p || typeof p !== "object") return true;
      const obj = p as Record<string, unknown>;
      return String(obj.id) !== id;
    });
    without.push(precal);
    window.localStorage.setItem("precalificaciones_mock", JSON.stringify(without));

    const created = await this.getById(id);
    if (!created) {
      throw new Error("No se pudo recuperar el expediente recién creado (mock).");
    }
    return created;
  }

  async listForMesa(): Promise<ExpedienteMock[]> {
    const all = await this.listAll();
    return all.filter((e) => e.operativo.submittedToMesa);
  }

  async listForMesaControl(): Promise<ExpedienteMock[]> {
    const mesa = await this.listForMesa();
    return mesa.filter((e) => {
      const ciclo = e.operativo.cicloEstado;
      return ciclo == null || ciclo === "activo";
    });
  }

  async getById(id: string): Promise<ExpedienteMock | null> {
    const idNorm = String(id).trim();
    if (!idNorm) return null;
    const pre = this.readPrecalificaciones();
    const found = pre.find((p) => p.id === idNorm);
    if (!found) return null;
    const decMap = this.buildDecisionMap();
    const inboxMap = this.buildInboxMap();
    const expediente = this.toExpedienteMock(found, decMap, inboxMap);
    return expediente;
  }

  async updateDecision(id: string, patch: UpdateDecisionPatch): Promise<ExpedienteMock | null> {
    if (typeof window === "undefined") return null;

    const existing = this.readDecisions().find(
      (x) => (typeof x.idPrecal === "string" && x.idPrecal === id) || (typeof x.id === "string" && x.id === id),
    );

    const rawDec = window.localStorage.getItem("decisions_mock");
    const parsedDec = safeParseArray(rawDec);

    const without = parsedDec.filter((x) => {
      if (!x || typeof x !== "object") return false;
      const obj = x as Record<string, unknown>;
      const idPrecal = obj.idPrecal;
      const _id = obj.id;
      return !(idPrecal === id || _id === id);
    });

    const entry = {
      idPrecal: id,
      decision: normalizeDecision(patch.decision ?? existing?.decision),
      monto_aprobado:
        patch.monto_aprobado !== undefined
          ? patch.monto_aprobado
          : typeof existing?.monto_aprobado === "number"
            ? existing!.monto_aprobado
            : null,
      notas_revision:
        patch.notas_revision !== undefined
          ? patch.notas_revision
          : typeof existing?.notas_revision === "string"
            ? existing!.notas_revision
            : "",
    };

    without.unshift(entry);
    window.localStorage.setItem("decisions_mock", JSON.stringify(without));
    window.dispatchEvent(new Event("decisions_mock_updated"));

    return this.getById(id);
  }

  async upsertEditorDecision(
    expedienteId: string,
    input: UpsertEditorDecisionInput,
  ): Promise<ExpedienteMock> {
    const result = await this.updateDecision(expedienteId, {
      decision: input.decision,
      monto_aprobado: input.monto_aprobado,
      notas_revision: input.notas_revision ?? "",
    });

    if (!result) {
      throw new Error("Expediente no encontrado.");
    }

    return result;
  }

  async asesorUpdateMontoAprobado(
    expedienteId: string,
    montoAprobado: number,
  ): Promise<ExpedienteMock> {
    const exp = await this.getById(expedienteId);
    if (!exp) {
      throw new Error("Expediente no encontrado.");
    }
    if (!Number.isFinite(montoAprobado) || montoAprobado <= 0) {
      throw new Error("El monto aprobado debe ser mayor a cero.");
    }

    const result = await this.updateDecision(expedienteId, {
      decision: exp.editorDecision.decision,
      monto_aprobado: montoAprobado,
      notas_revision: exp.editorDecision.notas_revision,
    });

    if (!result) {
      throw new Error("Expediente no encontrado.");
    }

    return result;
  }

  async updateOperativo(id: string, patch: UpdateOperativoPatch): Promise<ExpedienteMock | null> {
    if (typeof window === "undefined") return null;

    const idStr = String(id).trim();
    if (!idStr) return null;

    const inboxRaw = window.localStorage.getItem("mesa_control_inbox");
    const parsedInbox = safeParseArray(inboxRaw);

    const existing = (parsedInbox as RawOperativoInbox[]).find((x) => {
      if (!x) return false;
      const key = getInboxKey(x);
      return key === idStr;
    });

    const precal = this.readPrecalificaciones().find((p) => p.id === idStr);

    const nextEntry: RawOperativoInbox = existing
      ? { ...existing }
      : {
          id: idStr,
          idPrecal: idStr,
          cliente_nombre: precal?.cliente_nombre ?? "",
          telefono_cliente: precal?.telefono_cliente ?? "",
          programa: precal?.programa ?? "",
          asesorId: precal?.asesorId ?? "",
          asesorEmail: precal?.asesorId ?? "",
          asesorNombre: precal?.asesorId ?? "",
          origenMesa: origenMesaDesdeEmailAsesor(precal?.asesorId ?? null),
          tipoMesa: "interno",
          estadoEnvio: "pendiente",
          docs: undefined,
        };

    const nextUpdatedAt = patch.updatedAt ?? new Date().toISOString();

    const nextEtapaActual =
      patch.etapaActual !== undefined ? patch.etapaActual : nextEntry.etapaActual ?? null;

    const fechaCitaBase =
      patch.fechaCita !== undefined ? patch.fechaCita : nextEntry.fechaCita ?? null;

    // Regla: la cita solo es válida en las etapas donde se captura/usa.
    // - Biométricos: etapas 3 (captura) y 4 (agendada)
    // - Firma: etapas 9 (captura) y 10 (cita para firma)
    const shouldKeepFechaCita =
      nextEtapaActual != null && [3, 4, 9, 10].includes(nextEtapaActual);

    const merged: RawOperativoInbox = {
      ...nextEntry,
      id: idStr,
      idPrecal: idStr,
      etapaActual:
        nextEtapaActual,
      subestado:
        patch.subestado !== undefined ? patch.subestado : nextEntry.subestado ?? null,
      motivoRechazo:
        patch.motivoRechazo !== undefined ? patch.motivoRechazo : nextEntry.motivoRechazo ?? null,
      comentarioRechazo:
        patch.comentarioRechazo !== undefined
          ? patch.comentarioRechazo
          : nextEntry.comentarioRechazo ?? null,
      fechaCita:
        shouldKeepFechaCita ? fechaCitaBase : null,
      updatedAt: nextUpdatedAt,
      submittedToMesa:
        patch.submittedToMesa !== undefined
          ? patch.submittedToMesa
          : Boolean(nextEntry.submittedToMesa),
      origenMesa:
        normalizeOrigenMesa(nextEntry.origenMesa) ?? "interno",
      tipoMesa:
        nextEntry.tipoMesa === "externo" ? "externo" : "interno",
      estadoEnvio:
        (patch.submittedToMesa !== undefined
          ? patch.submittedToMesa
          : Boolean(nextEntry.submittedToMesa))
          ? "enviado"
          : "pendiente",
    };

    const subFinal =
      normalizeSubestado(merged.subestado ?? "pendiente") ?? "pendiente";
    merged.subestado = subFinal;
    merged.etapaActual = etapaActualParaOperativo(
      merged.etapaActual,
      subFinal,
    );
    const keepCitaAfterEtapa =
      merged.etapaActual != null && [3, 4, 9, 10].includes(merged.etapaActual);
    merged.fechaCita = keepCitaAfterEtapa ? fechaCitaBase : null;

    /**
     * Firma (etapas 9–10): `fechaCita` solo si existe booking activo en `agenda_firmas_bookings_v1`
     * y el actor mock es `asesor` o `mesa_control_admin`. Evita bypass vía `updateOperativo` sin agenda de firmas.
     * Biométricos (3–4): sin esta restricción en este bloque.
     */
    const finalEtapa = merged.etapaActual;
    const finalCita = merged.fechaCita;
    if (
      finalEtapa != null &&
      [9, 10].includes(finalEtapa) &&
      typeof finalCita === "string" &&
      finalCita.trim() !== ""
    ) {
      const mockRole =
        typeof window !== "undefined" ? getEffectiveMockRole() : null;
      if (!(mockRole === "mesa_control_admin" || mockRole === "asesor")) {
        throw new Error(
          "Solo asesor o mesa_control_admin pueden asignar la cita de firma (etapas 9–10).",
        );
      }
      if (!hasActiveFirmasBookingForCita(idStr, finalCita)) {
        throw new Error(
          "La cita de firma requiere una reserva activa en agenda_firmas_bookings_v1 que coincida con la fecha y hora.",
        );
      }
    }

    const without = (parsedInbox as RawOperativoInbox[]).filter((x) => {
      if (!x) return false;
      const key = getInboxKey(x);
      return key !== idStr;
    });

    without.unshift(merged);
    window.localStorage.setItem("mesa_control_inbox", JSON.stringify(without));
    window.dispatchEvent(new Event("mesa_control_inbox_updated"));

    return this.getById(idStr);
  }

  /** Contrato P3E: delega al flujo mock con payload derivado del expediente. */
  async enviarAMesa(expedienteId: string): Promise<ExpedienteMock> {
    const exp = await this.getById(expedienteId);
    if (!exp) {
      throw new Error("Expediente no encontrado.");
    }

    const result = await this.enviarAMesaWithPayload(expedienteId, {
      cliente_nombre: exp.base.cliente_nombre,
      telefono_cliente: exp.base.telefono_cliente,
      programa: exp.base.programa,
      asesorNombre: exp.base.asesorId,
      etapaActual: exp.operativo.etapaActual ?? 1,
      subestado: "en_validacion_mesa",
    });

    if (!result) {
      throw new Error("No se pudo enviar a mesa de control.");
    }

    return result;
  }

  async avanzarEtapaOperativa(
    expedienteId: string,
    _comentario?: string | null,
  ): Promise<ExpedienteMock> {
    void _comentario;
    const result = await this.updateOperativo(expedienteId, {
      etapaActual: 2,
      subestado: "en_proceso",
    });

    if (!result) {
      throw new Error("Expediente no encontrado.");
    }

    return result;
  }

  async enviarAMesaWithPayload(
    id: string,
    payload: EnviarAMesaPayload,
  ): Promise<ExpedienteMock | null> {
    if (typeof window === "undefined") return null;

    const idStr = String(id).trim();
    if (!idStr) return null;

    const inboxRaw = window.localStorage.getItem("mesa_control_inbox");
    const parsedInbox = safeParseArray(inboxRaw);
    const existing = (parsedInbox as RawOperativoInbox[]).find((x) => {
      if (!x) return false;
      const key = getInboxKey(x);
      return key === idStr;
    });

    const precalRow = this.readPrecalificaciones().find((p) => p.id === idStr);
    const origenMesaResolved: OrigenMesa = "interno";

    const enviadoEn = new Date().toISOString();
    const nextEntry: RawOperativoInbox = {
      ...(existing ?? {}),
      id: idStr,
      idPrecal: idStr,
      cliente_nombre: payload.cliente_nombre,
      telefono_cliente: payload.telefono_cliente,
      programa: payload.programa,
      asesorId: precalRow?.asesorId ?? payload.asesorNombre ?? "",
      asesorEmail: precalRow?.asesorId ?? payload.asesorNombre ?? "",
      asesorNombre: payload.asesorNombre,
      etapaActual: payload.etapaActual ?? 1,
      subestado: "en_validacion_mesa",
      motivoRechazo: undefined,
      comentarioRechazo: null,
      // Al enviar, la cita no está capturada aún.
      fechaCita: payload.fechaCita ?? null,
      fechaEnvioMesa: enviadoEn,
      updatedAt: enviadoEn,
      submittedToMesa: true,
      estadoEnvio: "enviado",
      docs: payload.docs,
      origenMesa: origenMesaResolved,
      tipoMesa: "interno",
    };

    const without = (parsedInbox as RawOperativoInbox[]).filter((x) => {
      if (!x) return false;
      const key = getInboxKey(x);
      return key !== idStr;
    });

    without.unshift(nextEntry);
    window.localStorage.setItem("mesa_control_inbox", JSON.stringify(without));
    window.dispatchEvent(new Event("mesa_control_inbox_updated"));

    return this.getById(idStr);
  }
}

