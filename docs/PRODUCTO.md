# ConCasa CRM — Producto

**Estado:** mock funcional para demo/piloto controlado · schema producción en preparación (P1)  
**Última actualización:** 2026-06-15

---

## 1. Propósito

ConCasa CRM gestiona el ciclo operativo de precalificaciones / expedientes hipotecarios desde la captura del asesor hasta el cierre en Mesa de Control y KPIs administrativos.

**Modo actual (mock):** datos en `localStorage` + IndexedDB, login simulado, permisos en cliente.  
**Modo objetivo (producción):** Supabase Auth + Postgres + Storage + RLS + auditoría.

---

## 2. Modelo de expediente

| Regla | Descripción |
|-------|-------------|
| **1 expediente = 1 precalificación = 1 ciclo operativo** | Etapas 1–12, decisiones editor, documentos, retención, agendas. |
| **Nuevo trámite del mismo cliente** | Se crea **otro expediente** (`expediente_anterior_id` opcional). No se reutiliza el ciclo cerrado. |
| **NSS** | No único global. Evitar duplicados **activos** por `nss + programa + organization_id`. Historial permitido en ciclos cerrados. |
| **Piloto productivo** | Base **limpia**. No migrar mock/IndexedDB salvo seeds de prueba controlados. |

---

## 3. Roles oficiales (producción)

| Rol | Alias mock / legacy | Acceso |
|-----|---------------------|--------|
| `asesor` | `asesor` | Solo sus expedientes; captura, documentos, envío integración, biométricos etapa 4, retención etapa 8. |
| `editor` | `editor` | Todos los expedientes; aprueba monto / decisión editor. |
| `mesa_admin` | `mesa_control_admin` | Todos los expedientes en mesa; config agenda; avance operativo. |
| `mesa_interno` | `mesa_control_interno` | Expedientes con `origen_mesa = interno`. |
| `mesa_externo` | `mesa_control_externo` | Expedientes con `origen_mesa = externo`. PII completa **solo** de los suyos. |
| `super_admin` | `super_admin` | KPIs, catálogos, usuarios, agenda global. |

**Origen interno/externo:** no lo elige el asesor en UI. Viene del **perfil del asesor** (`profiles.tipo_asesor_origen` o catálogo admin) al crear el expediente.

---

## 4. Rutas principales (App Router)

| Ruta | Rol | Función |
|------|-----|---------|
| `/login` | Todos | Auth (mock hoy; Supabase Auth en producción). |
| `/asesor` | Asesor | Bandeja de expedientes propios. |
| `/asesor/nueva` | Asesor | Alta de precalificación / expediente. |
| `/asesor/expediente/[id]` | Asesor | Detalle: datos, docs, integración, biométricos, retención. |
| `/editor` | Editor | Bandeja global; monto y decisión. |
| `/editor/[id]` | Editor | Detalle editor. |
| `/mesa-control` | Mesa* | Bandeja operativa. |
| `/mesa-control/[id]` | Mesa* | Revisión documental, avance etapas, retención, lectura citas. |
| `/admin` | Super admin | KPIs y métricas. |
| `/revisor`, `/revisor/[id]` | Legacy mock | Redirigen a `/editor`; **no** es rol de producción. |

---

## 5. Pipeline operativo (etapas 1–12)

| # | Nombre | Notas clave |
|---|--------|-------------|
| 1 | Integración | Envío a Mesa **permanece en etapa 1** (`en_validacion_mesa`) hasta aprobación Mesa. |
| 2 | Registro | Mesa avanza 1→2 tras validar integración. |
| 3 | Listo para cita biométrico | — |
| 4 | Cita agendada (biométricos) | **Asesor** agenda; expediente **no** salta a 5 automáticamente. |
| 5 | Biometría (resultado) | Mesa avanza 4→5 **solo si existe cita** (`fecha_cita` / booking). |
| 6–7 | Inscripción / Notificación | — |
| 8 | Acuse / Aviso retención | Opción A (`con_sello`) o B (`sin_sello`); envío asesor + validación Mesa. |
| 9–10 | Firma | Agenda firmas (admin/asesor según reglas mock actuales). |
| 11 | Firmado | — |
| 12 | Pago a ConCasa | Cierre de ciclo. |

---

## 6. Flujos críticos

### 6.1 Integración (etapa 1→2)

1. Editor aprueba **monto > 0** y decisión `aprobado`.
2. Asesor captura **RFC** y datos cliente; sube documentos obligatorios.
3. Asesor **envía a Mesa** → etapa **1**, `subestado = en_validacion_mesa`.
4. Mesa valida/rechaza documentos y datos; **aprueba y avanza** → etapa **2**.

### 6.2 Biométricos (etapa 4)

1. Solo **asesor** agenda en etapa 4 (`agenda_bookings` + `fecha_cita` en operativo).
2. **Mesa no agenda** biométricos; solo consulta cita en lectura.
3. Mesa **4→5** bloqueado sin cita registrada.

### 6.3 Retención (etapa 8)

| Opción | Documentos requeridos |
|--------|----------------------|
| **A — con sello** | Acuse con sello, Aviso retención, INE frente/reverso. |
| **B — sin sello** | Carta sin sello, Aviso retención, INE frente/reverso. |

1. Asesor elige A/B y sube documentos.
2. Asesor **envía bloque a Mesa** (`retencion_envios`).
3. Mesa valida/rechaza **con nota obligatoria** en rechazo.
4. Mesa puede **rechazar documento ya validado** (corrección por error).
5. Avance **8→9** requiere: envío asesor + todos los docs de la opción en `validado`.

---

## 7. Documentos

### Obligatorios integración (etapas 1–2)

**Asesor antes de enviar a Mesa (4 obligatorios):** `cliente_ine_frente`, `cliente_ine_reverso`, `cliente_comprobante_domicilio`, `cliente_estado_cuenta`.

**Asesor opcional (upload, no bloquea envío):** `cliente_semanas_cotizadas`.

**Mesa de Control (complementarios, no bloquean envío asesor):** `cliente_semanas_cotizadas`, `cliente_acta_nacimiento`, `cliente_constancia_sat` — acta y constancia SAT las sube Mesa; el asesor no las sube.

**Validación Mesa 1→2:** 4 documentos del asesor con `estatus_revision = validado` (sin archivo NSS; el NSS es dato en Datos Generales).

**Legacy fuera del panel asesor (datos históricos pueden existir):** `ine`, `estado_cuenta`, `nss`, `direccion` (paquete sistema P2); no cuentan para gates activos.

`cliente_historial_laboral` eliminado del flujo activo (legacy en catálogo/IndexedDB).

### Estados de revisión

`subido` → Mesa revisa → `validado` | `rechazado` (con nota) → asesor `resubido` → …

---

## 8. Qué es mock vs producción

| Capacidad | Mock (hoy) | Producción (objetivo) |
|-----------|------------|------------------------|
| Persistencia | localStorage + IndexedDB | Postgres + Storage |
| Auth | `mock_user` / selector rol | Supabase Auth + JWT |
| Permisos | Cliente (`mesaControlAccess`) | RLS + policies |
| Archivos | Blob en IndexedDB | Storage + URL firmada |
| Auditoría | Eventos DOM | `action_log` + `audit_events` |
| Multi-usuario | No | Sí, con concurrencia |

**Feature flag planificado:** `NEXT_PUBLIC_DATA_MODE=mock|supabase` (P3).

---

## 9. Referencias de código mock

- Expediente operativo: `src/domain/expedientes/mock.repo.ts`
- Documentos: `src/domain/expediente-archivos/`
- Retención: `src/domain/expediente-retencion/`
- Agenda biométricos: `src/lib/agendaBiometricosMock.ts`
- UI Mesa detalle: `src/app/mesa-control/[id]/page.tsx`
- Seguimiento operativo: `src/components/seguimiento/SeguimientoOperativoMock.tsx`
