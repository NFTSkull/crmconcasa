/** Etiquetas RO de seguimiento Mesa (Admin). */

export type AdminMesaTimelineEvent = Readonly<{
  at: string;
  action: string;
  /** Grupo humano del actor (Mesa|Asesor|Editor|Super Admin|Sistema). */
  actorGeneral: string | null;
  /** Nombre real del perfil que generó el evento, cuando existe. */
  actorName: string | null;
  /** Rol persistido en action_log. */
  actorRole: string | null;
  summary: Readonly<Record<string, string | null>>;
}>;

export type AdminMesaCorreccionTipo = Readonly<{
  tipoDocumento: string;
  comentarioMesa: string | null;
}>;

export function labelAdminMesaAction(action: string | null | undefined): string {
  switch (action) {
    case "expediente.enviar_a_mesa":
      return "Enviado a Mesa";
    case "documento.revision.update":
      return "Revisión documental Mesa";
    case "cliente_datos.revision.update":
      return "Revisión de datos generales Mesa";
    case "expediente.documento.asesor_correccion":
      return "Asesor reenvió documento corregido";
    case "expediente.documento.register":
      return "Documento cargado por asesor";
    case "expediente.documento.replace":
      return "Documento reemplazado por asesor";
    case "cliente_datos.save":
      return "Datos generales guardados";
    case "cliente_datos.correccion_post_mesa":
      return "Asesor corrigió datos generales";
    case "cliente_datos.actualizado_post_mesa":
      return "Asesor actualizó datos generales";
    case "asesor.correccion.reenviada_a_mesa":
      return "Asesor reenvió corrección a Mesa";
    case "expediente.avanzar_etapa_operativa":
      return "Avance de etapa";
    case "mesa.expediente.mover_etapa":
      return "Movimiento manual de etapa";
    case "mesa.expediente.take":
      return "Mesa tomó el expediente";
    case "mesa.expediente.release":
      return "Mesa liberó el expediente";
    case "expediente.documento.mesa_register":
      return "Mesa registró documento";
    case "expediente.enviar_retencion_mesa":
      return "Envío de retención a Mesa";
    case "expediente.rechazo_operativo":
      return "Rechazo operativo";
    case "expediente.reingreso.crear":
      return "Reingreso creado";
    case "expediente.reingreso.cerrar_anterior":
      return "Ciclo anterior cerrado por reingreso";
    case "agenda.biometricos.book":
      return "Cita biométricos agendada";
    case "agenda.biometricos.cancel":
      return "Cita biométricos cancelada";
    case "agenda.biometricos.reagendar":
    case "agenda.biometricos.mesa_reagendar":
      return "Cita biométricos reagendada";
    case "agenda.notificacion.mesa_reagendar":
      return "Cita de notificación reagendada por Mesa";
    case "agenda.firmas.book":
    case "agenda.firmas.mesa_book":
      return "Cita de firma agendada";
    case "agenda.firmas.cancel":
    case "agenda.firmas.mesa_cancel":
      return "Cita de firma cancelada";
    case "agenda.firmas.reagendar":
    case "agenda.firmas.mesa_reagendar":
      return "Cita de firma reagendada";
    case "agenda.drive_validation.set":
      return "Validado en Drive";
    case "agenda.drive_validation.clear":
      return "Validación Drive quitada";
    default:
      return "Actividad";
  }
}

export function labelAdminMesaTimelineEvent(
  event: Pick<AdminMesaTimelineEvent, "action" | "summary">,
): string {
  const estadoNuevo = String(event.summary.estado_nuevo ?? "").trim();
  const estatusNuevo = String(event.summary.estatus_nuevo ?? "").trim();

  if (
    event.action === "cliente_datos.revision.update" &&
    estadoNuevo === "rechazado"
  ) {
    return "Mesa solicitó corrección de datos generales";
  }
  if (
    event.action === "documento.revision.update" &&
    estatusNuevo === "rechazado"
  ) {
    return "Mesa solicitó corrección de documento";
  }
  if (
    event.action === "cliente_datos.revision.update" &&
    estadoNuevo === "completo"
  ) {
    return "Mesa validó datos generales";
  }
  if (
    event.action === "documento.revision.update" &&
    estatusNuevo === "validado"
  ) {
    return "Mesa validó documento";
  }
  return labelAdminMesaAction(event.action);
}

/** Whitelist documentada: última actividad Mesa (solo códigos de flujo Mesa). */
export const ADMIN_MESA_LAST_ACTIVITY_ACTIONS = [
  "documento.revision.update",
  "cliente_datos.revision.update",
  "expediente.avanzar_etapa_operativa",
  "mesa.expediente.mover_etapa",
  "mesa.expediente.take",
  "mesa.expediente.release",
  "expediente.documento.mesa_register",
  "expediente.rechazo_operativo",
  "agenda.biometricos.mesa_reagendar",
  "agenda.notificacion.mesa_reagendar",
  "agenda.firmas.mesa_book",
  "agenda.firmas.mesa_reagendar",
  "agenda.firmas.mesa_cancel",
  "agenda.drive_validation.set",
  "agenda.drive_validation.clear",
] as const;

/** Whitelist documentada: timeline bajo demanda. */
export const ADMIN_MESA_TIMELINE_ACTIONS = [
  "expediente.enviar_a_mesa",
  ...ADMIN_MESA_LAST_ACTIVITY_ACTIONS,
  "expediente.documento.asesor_correccion",
  "expediente.documento.register",
  "expediente.documento.replace",
  "cliente_datos.save",
  "cliente_datos.correccion_post_mesa",
  "cliente_datos.actualizado_post_mesa",
  "asesor.correccion.reenviada_a_mesa",
  "expediente.enviar_retencion_mesa",
  "expediente.reingreso.crear",
  "expediente.reingreso.cerrar_anterior",
  "agenda.biometricos.book",
  "agenda.biometricos.cancel",
  "agenda.biometricos.reagendar",
  "agenda.firmas.book",
  "agenda.firmas.cancel",
  "agenda.firmas.reagendar",
] as const;

/** Claves permitidas en summary de timeline (nunca payload completo). */
export const ADMIN_MESA_TIMELINE_SUMMARY_KEYS = [
  "tipo_documento",
  "nombre_original",
  "estatus_nuevo",
  "estatus_anterior",
  "estado_nuevo",
  "estado_anterior",
  "etapa_destino",
  "etapa_origen",
  "etapa_nueva",
  "etapa_anterior",
  "motivo",
  "comentario_rechazo",
  "comentario",
  "request_type",
  "request_at",
  "submitted_at",
  "copied_cambios",
  "lote_id",
  "reemplazo",
  "is_resend",
] as const;

const SAFE_TEXT_MAX = 500;

/** Texto visible seguro: trim + tope; vacío → null. */
export function sanitizeAdminSafeText(
  value: unknown,
  maxLen: number = SAFE_TEXT_MAX,
): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** Motivo RO con fallback canónico. */
export function sanitizeAdminMotivo(value: unknown): string {
  return sanitizeAdminSafeText(value) ?? "Sin motivo registrado";
}

/** Redacta summary del timeline a allowlist + texto seguro. */
export function sanitizeAdminTimelineSummary(
  raw: Record<string, unknown> | null | undefined,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of ADMIN_MESA_TIMELINE_SUMMARY_KEYS) {
    const max =
      key === "comentario_rechazo" || key === "comentario"
        ? 1200
        : key === "motivo"
          ? 800
          : key === "nombre_original"
            ? 240
            : key === "tipo_documento"
              ? 160
              : key === "request_type" || key === "lote_id"
                ? 100
                : key === "request_at" || key === "submitted_at"
                  ? 80
                  : key.startsWith("etapa_")
                    ? 10
                    : key === "is_resend" || key === "reemplazo"
                      ? 5
                      : 60;
    out[key] = sanitizeAdminSafeText(raw?.[key], max);
  }
  return out;
}

/** Etiqueta asesor del listado Mesa (sin correo ni UUID). */
export function formatAdminMesaAsesorLabel(
  nombre: string | null | undefined,
): string {
  const n = String(nombre ?? "").trim();
  return n || "Asesor sin nombre registrado";
}

/** Espera visible del listado Mesa. */
export function formatAdminMesaEsperaLabel(input: {
  esperaLabel: string | null | undefined;
  esperaDesde: string | null | undefined;
}): string {
  const label = String(input.esperaLabel ?? "").trim();
  if (!label) return "—";
  if (!String(input.esperaDesde ?? "").trim()) {
    return "Pendiente · fecha no disponible";
  }
  return label;
}


/** Hora de negocio del CRM: siempre Monterrey, independiente del dispositivo del Admin. */
export function formatAdminTimelineDateTimeMx(
  value: string | null | undefined,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    timeZone: "America/Monterrey",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function labelAdminCorrectionRequestType(
  value: string | null | undefined,
): string | null {
  switch (String(value ?? "").trim()) {
    case "SOLICITUD_DATOS_GENERALES":
      return "Datos generales";
    case "SOLICITUD_DOCUMENTAL":
      return "Documento";
    case "RECHAZO_OPERATIVO_CON_CORRECCION":
      return "Rechazo operativo con corrección";
    default:
      return sanitizeAdminSafeText(value, 100);
  }
}
