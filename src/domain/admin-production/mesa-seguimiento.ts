/** Etiquetas RO de seguimiento Mesa (Admin). */

export type AdminMesaTimelineEvent = Readonly<{
  at: string;
  action: string;
  /** Actor general derivado del código de acción (Mesa|Asesor|Sistema). */
  actorGeneral: string | null;
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
      return "Asesor reenvió documento";
    case "cliente_datos.correccion_post_mesa":
      return "Asesor corrigió datos generales";
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
  "cliente_datos.correccion_post_mesa",
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
  "estatus_nuevo",
  "estatus_anterior",
  "etapa_destino",
  "etapa_origen",
  "motivo",
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
      key === "motivo"
        ? SAFE_TEXT_MAX
        : key === "tipo_documento"
          ? 120
          : key.startsWith("etapa_")
            ? 10
            : key === "is_resend"
              ? 5
              : 40;
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
