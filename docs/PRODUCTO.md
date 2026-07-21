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
| `/mesa-control/citas` | Mesa* | Agenda de citas (lectura + cancel/reagendar/Drive/P089 masivo; P095 fecha día + Excel). |
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
| 4 | Cita agendada (biométricos) | **Asesor** agenda; expediente **no** salta a 5 automáticamente. **Legacy en timeline asesor:** el paso visual 3 absorbe esta etapa. |
| 5 | Biometría (resultado) | Mesa avanza 4→5 **solo si existe cita** (`fecha_cita` / booking). |
| 6–7 | Inscripción / Notificación | — |
| 8 | Acuse / Aviso retención | Opción A (`con_sello`) o B (`sin_sello`); envío asesor + validación Mesa. |
| 9–10 | Firma | Agenda firmas (admin/asesor según reglas mock actuales). |
| 11 | Firmado | — |
| 12 | Pago a ConCasa | Cierre de ciclo. |

**Numeración Mesa vs Asesor (P093 B2):** ambas vistas leen el mismo `etapa_actual` (1–12). Mesa muestra «Etapa N». El asesor muestra «Paso K de 11» omitiendo la etapa interna 4 del timeline visual (`mapEtapaInternaAPasoVisual`: 5→paso 4, etc.). La UI muestra la correspondencia; no hay desfase de datos.

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

### 6.3 Retención (etapa 8 → 9)

| Opción | Documentos requeridos |
|--------|----------------------|
| **A — con sello** | Único obligatorio: Acuse con sello (`retencion_acuse_con_sello`). |
| **B — sin sello** | Único obligatorio: Carta sin sello (`retencion_carta_sin_sello`). |

1. Asesor elige A/B y sube el documento principal (`subido`/`resubido`/`validado`).
2. Asesor **envía bloque a Mesa** (`enviar_retencion_mesa`): registra envío **y** avanza atómicamente **8→9**.
3. Mesa **no** valida ni rechaza el Acuse para este flujo; consulta en lectura y agenda firma en etapa 9.
4. El documento **no** se marca como `validado` por el envío; puede permanecer `subido`/`resubido`/`validado`.
5. **No** se crea booking ni `fecha_cita` al enviar.
6. Aviso/INE históricos (`retencion_aviso_retencion`, `retencion_ine_*`) no son obligatorios ni bloquean; no se borran ni se hace backfill.
7. Gate normal 8→9 (recuperación) exige envío + principal activo en `subido|resubido|validado`.
### 6.4 Reingreso / Reinscripción post-biométricos

1. Mesa rechaza un expediente en etapa 5 o 6 y registra una decisión explícita sobre sus biométricos.
2. Solo una decisión `reutilizables`, respaldada por un intento biométrico pasado, habilita al asesor dueño.
3. El asesor inicia una acción atómica: el expediente anterior queda como ciclo histórico cerrado y se crea un expediente hijo activo en etapa 6.
4. El hijo no repite biométricos ni recibe una cita nueva. Conserva enlace al padre y al rechazo que lo originó.
5. El editor debe aprobar un monto nuevo. El sistema recalcula el cobro con el porcentaje precargado.
6. Comprobante de domicilio y estado de cuenta se capturan y validan de nuevo. Solo evidencia estable validada de la lista blanca puede reutilizarse.
7. Mesa avanza 6→7 únicamente con monto nuevo aprobado y los dos documentos nuevos validados.

La UI identifica al hijo como **Reingreso / Reinscripción** y **Biométricos reutilizados**. El padre sale de filtros operativos, pero permanece accesible como historial.

### 6.5 Libertad operativa manual de Mesa

- Los roles `mesa_admin`, `mesa_interno`, `mesa_externo` y `super_admin` pueden mover un expediente visible entre etapas 1–12 mediante una acción manual auditada.
- Solo aplica a expedientes activos, enviados a Mesa y en `en_validacion_mesa`/`en_proceso`; no reactiva rechazos, aprobados, pendientes ni ciclos cerrados/cancelados.
- El movimiento omite gates normales, pero no borra ni crea documentos, citas, bookings, montos, cobro, retención, decisiones o genealogía.
- **P093:** el movimiento manual **no** es un rechazo. No pone `subestado=rechazado`, no crea fila en `expediente_rechazos_operativos` ni alimenta filtros «Rechazados». Escribir «RECHAZO…» en el motivo no rechaza.
- **Rechazo canónico (etapas 5/6):** UI «Rechazo operativo post-biométricos» → RPC `rechazar_etapa_operativa`. La UI advierte si el motivo del movimiento parece un rechazo y ofrece atajo a esa acción cuando el expediente es elegible.
- Etapa 1 queda `en_validacion_mesa`; etapas 2–12 quedan `en_proceso`. Etapas 11/12 son posición operativa y no registran firma/pago ni cierran el ciclo.
- Los cuatro roles Mesa pueden agendar/reagendar firmas en etapas 9/10 de expedientes visibles. Un booking conservado fuera de esas etapas puede cancelarse explícitamente, nunca automáticamente.

### 6.5b Agenda de citas Mesa — fecha del día + Excel (P095)

**Pantalla:** `/mesa-control/citas` (`MesaAgendaCitasClient`). Alcance exclusivo Mesa Citas; no Asesor/Admin/creación de citas/RPC/Cloud en P095.

**Apertura (B1 implementado):**
- Vista inicial permanece **`lista`** (P089 intacto).
- Fecha operativa = **hoy** `America/Monterrey`; `date_from` = `date_to` = `selectedDay` = ese YMD.
- Fetch inicial: un solo día (no mes completo). Cambio de fecha resincroniza los tres al mismo YMD y limpia selección masiva; conserva filtros compatibles.

**Exportación Excel (B2 util + B3 UI):**
- Botón `Descargar Excel` en `/mesa-control/citas`; exporta el día operativo (`lista`→`listaStartDate`, `dia`→`selectedDay`, `semana`→`weekDetailDay ?? selectedDay`) con filtros activos.
- Util `exportMesaCitasExcel` genera `.xlsx` hoja `Citas`; archivo `citas-mesa-YYYY-MM-DD.xlsx`.
- Columnas únicas: `Fecha` | `NSS` | `Nombre completo`; in-memory; estados Generando/éxito/vacío/error; bloqueo doble clic; sin selección/límite 100/Storage/RPC.

**Intacto:** P089, cancel/reagendar individual, RPC `get_mesa_agenda_bookings`.

### 6.6 Rechazado vs Cancelado (P094 — diseño B0)

Dos resultados operativos distintos; **no** inferir por texto libre ni por movimiento manual.

| | **Rechazado** | **Cancelado** |
|--|---------------|---------------|
| Significado | Mesa rechaza por causa operativa | El cliente no continuará el trámite |
| Señal canónica | `subestado = rechazado` + fila en `expediente_rechazos_operativos` | `ciclo_estado = cancelado` + fila en `expediente_cancelaciones` |
| Ciclo | Permanece `activo` (habilita reingreso P071/P072) | Terminal: `cancelado` |
| Sale de «En proceso» | Sí (chip operativo) | Sí |
| Mesa UI | Dentro de «Rechazos y cancelaciones» → subvista **Rechazados** | Misma entrada → subvista **Cancelados** |
| Asesor | KPI/filtro «Rechazados por Mesa» | Estado visible **Cancelado** (no es `rechazado_mesa`) |
| Continuación | Reingreso post-biométricos cuando aplique (P072) | **No** flujo normal; solo futura acción admin explícita (fuera de P094 si negocio la pide) |
| Prohibido | Confundir con corrección documental | Avance, citas, movimiento, rechazo, reingreso común, uploads operativos |

**Estado actual (B4 SQL Admin local):** rechazo canónico + cancelación SQL (090) + UI Mesa/Asesor/Admin (B2–B3) + RPC Admin `p_estado` disjuntos (091). Sin reapertura/Cloud/push.

**No es:** corrección requerida (docs/datos), `booking_status=cancelled` (citas), `ciclo=cerrado` (historial de reingreso / cierre de ciclo distinto).

### 6.7 Monto actualizado Mejoravit (P090 — backend; sin UI aún)

Tres montos distintos (no confundir):

| Concepto | Fuente | Uso |
|----------|--------|-----|
| **Editorial** | `editor_decisions.monto_aprobado` | Decisión del editor; no lo reescribe Mesa. |
| **Snapshot 1ª aprobación** | `editor_decisions.monto_aprobado_al_aprobar` | Inmutable; base de KPIs Admin (P087). |
| **Operativo vigente** | Precedencia abajo | Base de cobro Mejoravit en el expediente. |

**Precedencia del monto operativo:**

1. `cliente_datos.monto_mejoravit_actualizado` (override Mesa), si existe y es > 0;
2. `cliente_datos.datos.montoMejoravit` JSON válido (> 0);
3. Fallback productivo: `LEAST(ROUND(monto_aprobado_editor × 0.89, 2), 169000)`.

La sección Datos Generales y el JSON `datos.montoMejoravit` **no** se modifican al actualizar desde Mesa. El asesor puede seguir editando Datos Generales; eso no borra el override Mesa.

**Cobro al actualizar desde Mesa:**

`ROUND(monto_nuevo × porcentaje_cobro / 100 + 3000, 2)` — los $3,000 se suman una sola vez. Se conserva `%` y método de pago; se reemplaza `monto_calculado`. Sin `%` → bloquea. Sin método de pago → no bloquea. Mismo monto (tras redondeo a 2 decimales) → bloquea.

**Quién puede escribir:** `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin` (+ aliases vigentes de mesa), misma org, `can_see_expediente`, activo, no eliminado, enviado a Mesa. El asesor es solo lector (UI en B2). Historial append-only por expediente; **sin** herencia padre↔hijo en reingreso.

**P087 intacto:** agregados Admin siguen usando `monto_aprobado_al_aprobar` con tope individual $169,000; no consultan el monto actualizado de Mesa.

**Pagaré (P090 B4 UI):** tipo `cliente_pagare`; desde `etapa_actual >= 7`; no es gate; PDF/JPG/JPEG/PNG ≤ 15 MB; un vigente versionado; Mesa puede subir/reemplazar/ver/descargar; asesor RO ver/descargar; sin herencia en reingresos; no aparece en complementarios UI.

**Notificación documento (P092):** tipo `cliente_notificacion` (label «Notificación»). Distinto de `agenda_bookings.kind = 'notificacion'` (agenda/P070, intacto). Mismo perfil que Pagaré: etapa ≥ 7; Mesa carga/reemplaza; asesor RO; PDF/JPEG/PNG ≤ 15 MiB; no obligatorio; no gate; sección dedicada. Contrato TS B0; SQL B1; UI B2.

### UI B2 (local)

- **Mesa Control (detalle):** acordeón hermana de Datos Generales con sección `Monto actualizado Mejoravit`, historial DESC, diálogo de actualización y vista previa de cobro (`% + $3,000`). Escritura solo vía `mesa_actualizar_monto_mejoravit`; botón solo si `can_update`.
- **Asesor (detalle):** sección RO visible **solo** si existe `monto_mejoravit_actualizado`; sin controles de edición; lectura vía `get_expediente_monto_mejoravit_context`.
- Datos Generales y su JSON permanecen intactos. P087 y Admin sin cambios.

### 6.8 Pagaré (P090 B4 — UI Mesa + asesor RO)

- Tipo técnico: `cliente_pagare` (label: Pagaré).
- **Mesa (detalle):** acordeón hermana «Pagaré» (después de Monto Mejoravit, antes de documentos). Etapa menor a 7: visible deshabilitada (`Disponible después de Inscripción`). Etapa ≥ 7: subir / reemplazar / ver / descargar documento vigente (versión, nombre, formato, fecha, quien cargó). Sin eliminar, sin historial de versiones en UI, sin gate ni avance desde la sección.
- **Asesor (detalle):** sección RO solo si `etapa_actual >= 7`. Sin archivo: `Pendiente de Mesa`. Con archivo: badge `Cargado por Mesa` + Ver/Descargar. Sin Subir/Reemplazar/Eliminar/Validar.
- Carga/reemplazo solo Mesa vía Storage `expediente-documentos` + `register_mesa_documento` (backend B3). Confirmaciones explícitas; un refetch documental por operación.
- Formatos: PDF, JPG/JPEG, PNG. Máx. 15 MB. Path `{org}/{exp}/cliente_pagare/{uuid}.{ext}`.
- **No** obligatorio, **no** gate de avance, **no** checklist/faltantes, **sin** notificaciones nuevas, **sin** herencia padre↔hijo.
- No se lista en Documentos complementarios (`INTEGRATION_DOC_TIPOS_MESA_UPLOAD`); sección dedicada única.

### 6.9 Notificación documento (`cliente_notificacion`) — P092

**Separación de conceptos**

| Concepto | Significado |
|----------|-------------|
| `cliente_notificacion` | Documento de expediente cargado por Mesa; lectura asesor |
| `notificacion` | `agenda_bookings.kind` (cita Notificación extraordinaria / P070) — **intacto** |

- Tipo técnico: `cliente_notificacion` (label: Notificación). **Nunca** usar `notificacion` como tipo de documento.
- Disponible desde `etapa_actual >= 7` (misma fase que Pagaré).
- **Mesa (detalle):** acordeón hermana «Notificación» (`id=mesa-notificacion-documento`, después de Pagaré). Etapa &lt; 7: deshabilitada. Etapa ≥ 7: subir / reemplazar / ver / descargar. Estado React **independiente** del Pagaré (`MesaNotificacionDocumentoSection`).
- **Asesor (detalle):** `AsesorNotificacionDocumentoSection` RO solo si `etapa_actual >= 7`. Sin archivo: `Pendiente de Mesa`. Con archivo: `Cargado por Mesa` + Ver/Descargar.
- Carga/reemplazo solo Mesa vía Storage + `register_mesa_documento` (migración 089). Confirmaciones explícitas; un refetch documental por operación.
- MIME: `application/pdf`, `image/jpeg`, `image/png`. Extensiones `.pdf` / `.jpg` / `.jpeg` / `.png`. Máx. 15 728 640 bytes (15 MiB).
- Una versión activa por `(expediente, tipo)`; anteriores soft-delete; sin historial de versiones en UI.
- Path Storage: `{orgId}/{expedienteId}/cliente_notificacion/{uuid}.{ext}` — bucket privado; UUID generado; extensión validada; nombre original **no** es la ruta; separado de `cliente_pagare`.
- **No** obligatorio, **no** gate de avance, **sin** herencia en reingresos, **sin** notificaciones automáticas, **sin** cambios de agenda/etapa/P070/P090 monto.
- Fuera de `INTEGRATION_DOC_TIPOS_MESA_UPLOAD` (complementarios); sección dedicada independiente del Pagaré (estado React separado).
- Contrato TS: `CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT` (B0). Helpers: `cliente-notificacion.ts` (B2).

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
