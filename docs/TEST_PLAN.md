# ConCasa CRM — Plan de pruebas

## P115 — Pasos visuales Admin + exclusiones por fecha

- [x] Select general `/admin`: 11 pasos; Paso 3 → internas 3+4; sin opción 12.
- [x] Tarjetas internas 3/4 activan el mismo paso visual 3.
- [x] Reporte: Todas → 11 explícitos; resumen consultadas vs con resultados.
- [x] Rango: advertencia ámbar; Quitar rango solo limpia fechas (sin RPC/sin borrar snapshot).
- [x] Sin SQL/RPC/Cloud; Excel y citas Mesa intactos.
- [x] Gates TS (lint/typecheck/test/build/diff-check).

## P114 — Fecha canónica + rango + Limpiar filtros

- [x] Trigger: insert setea fecha; 3→4 conserva; rechazo sin cambio de etapa conserva; mutación directa de columna ignorada; sin backfill.
- [x] Historial solo creación y cruces visuales; authenticated sin INSERT.
- [x] RPC v2: sin rango = P112 + NULL fechas; con rango excluye NULL y reporta `excluidos_por_fecha_desconocida`; desde>hasta error; Monterrey.
- [x] UI: rango opcional; Limpiar sin RPC; vacío ≠ Todos; Todos/Todas explícitos; Excel + fecha; P112/P113/citas intactos.
- [x] SQL focal local `expediente_paso_visual_tracking_report_v2.sql` + regresión P112.
- [x] Tests TS 1102 + lint/typecheck/build / `git diff --check`.

## P113 — Reporte Admin colapsable + Excel estilos citas

- [x] Sección inicia colapsada; Abrir despliega; Cerrar minimiza sin modal.
- [x] Abrir/Cerrar no llama RPC; conserva filtros, resultados y última consulta.
- [x] Excel: mismos datos/hojas/columnas; encabezado `#1F4E79`; alternos `#D6EAF8`/`#FFFFFF`; subtotales `#6B2D8B`; bordes `#9BB3C9`; NSS texto.
- [x] Sin SQL/RPC/Cloud/deps nuevas; citas Mesa intactas.

## P112 — Reporte Admin expedientes por asesores/etapas

- [x] RPC `admin_report_expedientes_asesores_etapas` solo `super_admin`; STABLE; sin `action_log`; anon/PUBLIC sin EXECUTE.
- [x] Universo: org actor, no eliminados, enviados a Mesa, ciclo activo; activos+rechazados; excluye cancelados/otras orgs.
- [x] Pasos 1–11; Paso 3 ⊆ internas 3+4; `p_estado` vigentes|activos|rechazados; NULL/[] = Todos.
- [x] Payload `resumen`/`detalle`/`meta`; rechazo separado de activo; NSS con ceros.
- [x] UI `/admin`: consultar bajo demanda; tabla + expand; Excel de la última consulta; sin fechas.
- [x] Tests SQL `admin_report_expedientes_asesores_etapas.sql` + TS domain/Excel; sin commit/Cloud.

## P111 — Excel citas para Mesa Admin

- [x] `mesa_admin` / `mesa_control_admin` / `super_admin` pueden descargar.
- [x] Roles Mesa interno/externo conservan acceso; asesor no.
- [x] Mismo exportador/formato P107–P110; filtros/fecha; sin selección P089; sin refetch/mutación.
- [x] Sin SQL/RPC/Cloud/deps.

## P110 — Clasificación automática + Firmas 9:30 AM Excel

- [x] Sin columna/label/select «Clasificación Excel» en lista/día/semana; sin RPC desde UI.
- [x] Auto: `kind` → biométricos/firmas/notificación; conserva históricos `inscripcion` / `biometricos_tramite_completo`.
- [x] Firmas del día → un bloque `FIRMAS — 9:30 AM`; `booking_time` real intacto; otros tipos con hora real.
- [x] Sin citas perdidas; P089/filtros P095; sin SQL/RPC/Cloud/commit.

## P109 — Excel citas por tipo y horario

- [x] Fallback `report_group` null → `kind` (`biometricos|firmas|notificacion`).
- [x] RPC actualiza solo `report_group`; no muta kind/fecha/hora/status; permisos Mesa/admin; action_log.
- [x] Bloques Excel por tipo+hora; dos horarios mismo tipo; inscripción / trámite completo; SIN HORARIO; sin citas perdidas.
- [x] NSS texto con cero; filtros P095; P089 intacto; round-trip XLSX; estilos plantilla.
- [x] UI «Clasificación para Excel» solo Mesa; sin asesor / sin bulk P089.
- [x] SQL `rpc_mesa_agenda_report_group.sql` + migración `097_…sql`.

## P107 — Formato oficial Excel citas Mesa

- [x] Plantilla carga desde `public/templates/reporte-citas-mesa.xlsx`.
- [x] Título `CITAS DEL DÍA — DD/MM/YYYY`; encabezados Fecha|NSS|Nombre (…); datos desde fila 3.
- [x] Solo 3 columnas; NSS texto con ceros; estilos tras round-trip; dimensión ajustada.
- [x] Filtros/filename/orden por hora/P095 intactos; cero citas → empty; sin SQL/RPC/Cloud.

## P108A — Rechazo 1–12 + reactivación segura

- [x] `rechazar_etapa_operativa` permite internas 1–12; motivo/nota; conserva etapa; `subestado=rechazado`; ciclo activo.
- [x] `reactivar_expediente_rechazado`: mismo expediente/etapa; subestado canónico 1→`en_validacion_mesa`, 2–12→`en_proceso`.
- [x] Traza append-only + action_log; historial de rechazo intacto; sin doble rechazo/reactivación.
- [x] Cancelados no rechazan/reactivan; citas/docs/montos/bookings intactos.
- [x] UI Mesa: tarjeta en 11 pasos (motivo+nota). Asesor: badge/motivo/paso + «Corregir y reenviar a Mesa».
- [x] P072 intacto (reingreso hijo 5/6); reactivación no depende de biométricos.
- [x] Tests SQL `rpc_rechazo_reactivacion_p108a.sql` + regresión P071; sin commit/Cloud.

## P106 — Movimiento manual 11 pasos únicos

- [x] Selector: 11 opciones; Paso 3 una sola vez; envía interna 3 / Paso 4 → 5.
- [x] Interna 4 no seleccionable; se muestra como Paso 3.
- [x] Historial con numeración visible; sin «Etapa 12».
- [x] Sin SQL/RPC/Cloud.

## P105 — Mesa 11 pasos (paridad Asesor)

- [x] UI Mesa solo `Paso 1–11 de 11`; sin `Etapa 12` / hints asesor.
- [x] Interna 4 → paso 3; interna 5 → paso 4; interna 12 → paso 11.
- [x] Filtro paso 3 incluye internas 3+4; RPC recibe valores internos.
- [x] `book_biometricos` 3→4 (sin cambio SQL); Asesor 11 pasos intacto.
- [x] Sin Cloud write / sin renumerar `etapa_actual`.

## P104 — Notificación solo Apodaca (opcional)

- [x] Tipo `cliente_notificacion_apodaca` ≠ `cliente_notificacion` / `notificacion`.
- [x] Asesor upload/reemplazo vía checklist + DocumentDropzone; opcional no bloquea gates.
- [x] Mesa lo ve en documentos del asesor (preview/descarga); sin upload Mesa.
- [x] MIME PDF + 15 MiB heredados; migración `095_…sql` + test SQL local; sin Cloud.

## P103 — Drag & drop documentos Asesor/Mesa

- [x] Clic tradicional y drop llaman el mismo handler.
- [x] Single-file: >1 archivo se rechaza; multiple respetado si aplica.
- [x] preventDefault; busy bloquea doble envío; validaciones previas intactas.
- [x] Cubiertos: integración, retención, complementarios, Pagaré/Notif/Solicitud, mock seguimiento.
- [x] Sin SQL/RPC/Cloud; Asesor RO Mesa docs sin escritura.

## P102 — Paginación server-side `/mesa-control`

- [x] Primera carga 25 (no 160); cargar más +25 sin duplicados.
- [x] Contadores = universo (`counts`/`total_count`); lista = páginas acumuladas.
- [x] Filtros/búsqueda en servidor antes de paginar; reset a página 1.
- [x] P100 batch solo por página; P101 sentinel → fetch next page.
- [x] Migración `094_rpc_mesa_list_bandeja_page.sql` + test SQL estático; sin Cloud.

## P101 — Scroll infinito `/mesa-control`

- [x] Inicial 25; bloques +25 vía sentinel hasta el total; nunca supera filtrados.
- [x] Filtros/orden/búsqueda sobre colección completa; slice solo para render.
- [x] Reset a 25 al cambiar criterios; contador = total filtrado.
- [x] <25 sin «Cargar más»; 0 resultados OK; cargar más sin refetch.
- [x] Sin SQL/RPC/Cloud/commit; P100 intacto.

## P100 — Rendimiento `/mesa-control`

- [x] Medición: N+1 `listResumenByExpediente` vs batch (1 invocación / chunks).
- [x] Sin doble fetch por resolución de `currentUserId`.
- [x] Secundarias (resumen/estados/notif/ops) en paralelo; errores parciales absorbidos.
- [x] Mismos filtros/contadores; rechazos/cancelaciones intactos.
- [x] Sin SQL/RPC; sin caché persistente; sin commit/Cloud/smoke.

## P099 — Rechazo Mesa → bandeja asesor

- [x] Cancelación terminal: tarjeta roja; copy «no continuará».
- [x] Rechazo: tarjeta oscura; solo motivo (select+Otro) y nota opcional; defaults biométricos internos.
- [x] Cadena `rechazar_etapa_operativa` → `subestado=rechazado` → `rechazado_mesa` en `/asesor`.
- [x] Motivo/nota visibles para asesor; separado de Cancelados; reingreso consultable; sin movimiento manual.
- [ ] Sin Cloud/commit/smoke.

## P096 — Solicitud documento (`cliente_solicitud`)

- [x] Tipo técnico `cliente_solicitud` (nunca `solicitud`); etapa ≥ 7; roles Mesa iguales a Notificación.
- [x] Mesa: subir/reemplazar/ver/descargar; Asesor: RO ver/descargar.
- [x] MIME PDF/JPEG/PNG ≤ 15 MiB; versionado; independiente de Pagaré/Notificación; sin gate; sin reingreso automático.
- [x] Migración `092_…sql` local + Cloud `db query --linked`; UI orden Pagaré → Notificación → Solicitud.
- [x] Publish producción (sin smoke).

## P095 — Citas Mesa: día operativo + Excel

### B0 / B0.1 (contrato)

- [x] Contrato: hoy Monterrey, solo ese día; Excel Fecha|NSS|Nombre in-memory; P089 intacto.

### B1 (fecha — local)

- [x] `todayMesaAgendaYmd` / `defaultMesaAgendaDayRange` en `America/Monterrey`.
- [x] Apertura vista `lista` con from=to=selectedDay=hoy; sin mes completo.
- [x] Cambio de fecha sincroniza from/to/selectedDay; conserva filtros; limpia selección.

### B2 (Excel util — local, sin UI)

- [x] `exportMesaCitasExcel`: `citas-mesa-YYYY-MM-DD.xlsx` / hoja `Citas` / Fecha|NSS|Nombre.
- [x] In-memory + filtros activos; >100 filas; sin selección P089; sin botón UI.

### B3 / B3.1 (UI Descargar Excel — local commit)

- [x] Botón `Descargar Excel` en `MesaAgendaCitasClient`; día operativo + filtros.
- [x] Estados Generando / mensaje éxito-vacío-error; `exportExcelBusyRef` anti doble clic.
- [x] Independiente de selección/acciones masivas P089 (`loadedEntries`, no `selectedBookingIds`).
- [x] Tests helpers B3 + wiring `MesaAgendaCitasClient.excel.test.ts`; sin RPC/Cloud.
- [x] Auditoría B3.1: sin refetch/mutación en export; lint/typecheck/test/build; commit local.

### B4 (publicación — push + PR, sin merge)

- [x] `origin/main` compatible (`7b339c5`); sin SQL/RPC/Cloud/deps nuevas.
- [x] Validación final + push + Preview READY + PR abierto; sin merge/smoke/Producción.

## P094 — Rechazados vs Cancelados

### B0 (auditoría + diseño)

- Confirmar: rechazo = `subestado=rechazado` + `expediente_rechazos_operativos` + ciclo `activo`; cancelado enum sin writer.
- Contrato docs: PRODUCTO §6.6, API §17f (`cancelar_expediente_operativo` + `expediente_cancelaciones`); UI chip «Rechazos y cancelaciones» con subvistas disjuntas.
- Decisiones cerradas B0.1: historial = tabla append-only; predicados Rechazados/Cancelados explícitos; reapertura admin fuera de P094.
- Sin SQL/UI/Cloud/commit de implementación.

### B1 (SQL — local)

- Migración `090_cancelar_expediente_operativo.sql`: tabla append-only `expediente_cancelaciones` + RPC `cancelar_expediente_operativo`.
- Suite `rpc_cancelar_expediente_operativo.sql`: happy path, cancelar sobre rechazado, bookings intactos, auth/validaciones, gates post-cancel (avance/mover/rechazo/reingreso/book), RLS sin INSERT directo, `action_log`.
- Cableado en `scripts/test-sql.sh`; regresiones P071 rechazo + P072 reingreso.
- Sin UI/chip/selector/asesor/Admin/Cloud.

### B2 (UI Mesa — local)

- Chip «Rechazos y cancelaciones» + subvistas Rechazados | Cancelados (predicados disjuntos).
- Query bandeja incluye `ciclo=cancelado`; «Todos»/operativos excluyen cancelados.
- Acción `MesaCancelarExpedienteCard` → RPC `cancelar_expediente_operativo`; banner RO si cancelado.
- Tests TS filtros + dominio cancelación; sin Asesor/Admin/Cloud.

### B3 (UI Asesor + Admin — local)

- Asesor: `deriveResultadoRealExpediente` → `cancelado` (prioridad) vs `rechazado_mesa` (ciclo activo); KPI/chip/filtro Cancelados; detalle banner RO + writes apagados.
- Admin: `matchesAdminEstadoFilter` — Rechazados ≠ Cancelados; UI opciones separadas; mock + split cliente Supabase (listado/KPI envíos/cohorte/asesor); sin migración/RPC nuevas.
- Tests cableados: derive, admin-estado-filter, admin mock listado, notifications.
- Sin reapertura, backfill, SQL, Cloud, commit, push.

### B4 (SQL Admin p_estado — local)

- Migración `091_admin_estado_rechazados_cancelados.sql`: `rechazados` = `subestado=rechazado ∧ ciclo=activo`; `cancelados` = `ciclo=cancelado`.
- RPCs: `admin_get_production_summary`, `admin_get_mesa_cohort_by_etapa`, `admin_list_production_by_asesor`, `admin_list_mesa_envios_page`.
- Suite `admin_estado_rechazados_cancelados.sql` + `scripts/verify-p094-b4-sql.sh`; frontend pasa `p_estado=cancelados` nativo.
- Sin Cloud/push; reapertura admin fuera de P094.

## P093 — Separación UX rechazo vs movimiento manual

### B0 (auditoría RO)

- Caso índice y flota Cloud: movimiento manual con motivo «RECHAZO…» ≠ `subestado=rechazado`; filtros correctos; numeración Asesor paso visual ≠ etiqueta Mesa interna.

### B1 (UI)

- Helpers `mesa-rechazo-operativo-ux`: `motivoManualPareceRechazo`, `esElegibleRechazoOperativoPostBiometricos`, mensajes; tests unitarios.
- Panel movimiento manual: copy «no es rechazo»; advertencia si motivo parece rechazo (no bloquea / no ejecuta rechazo); atajo a `#mesa-rechazo-operativo` en etapas 5/6.
- Tarjeta `MesaRechazoOperativoPostBiometricosCard` montada en detalle Supabase (`MesaExpedienteDetalleReadOnly`) con mayor visibilidad; ancla estable.
- Sin cambios RPC/SQL/filtros/Cloud.

### B2 (numeración Mesa/Asesor)

- Helpers `etapa-numeracion-ux`: correspondencia etapa interna ↔ paso visual; labels Mesa/Asesor + hint bandeja.
- UI: detalle Mesa, bandeja, movimiento manual y seguimiento asesor muestran la conversión; timeline asesor indica etapa interna cuando difiere.
- Sin cambiar `etapa_actual`, IDs 1–12, avance, filtros, RPC ni SQL.

## P092 — Notificación documento (`cliente_notificacion`)

### Separación

- Documento: `cliente_notificacion` ≠ agenda `kind=notificacion` (P070). Tests no deben usar el string corto `notificacion` como tipo documental.

### B0 (contrato TS)

- `cliente-notificacion-contract.test.ts`: tipo, label, etapa 7, MIME PDF/JPEG/PNG, máx. 15 728 640, independencia vs Pagaré, fuera de complementarios UI / obligatorios / upload asesor.

### B1 (SQL)

- Migración `089_mesa_notificacion_documento_expediente.sql`: allowlist + MIME PDF/JPEG/PNG + gate etapa ≥ 7 en `register_mesa_documento`.
- Suite `rpc_mesa_notificacion_documento_expediente.sql`: allowlist (nunca `notificacion` corto), MIME, etapa 6/7, versionado, tamaño 15 MiB, permisos, RLS asesor, independencia vs `cliente_pagare`, path mismatch, `action_log`, enum agenda intacto.
- Cableado en `scripts/test-sql.sh`.

### B2 (UI)

- Mesa: `MesaNotificacionDocumentoSection` + upload dialog; acordeón dedicado; estado React independiente del Pagaré.
- Asesor: `AsesorNotificacionDocumentoSection` RO (estatus / Ver / Descargar) desde etapa 7.
- Helpers `cliente-notificacion.ts` + tests; validación MIME en `fileUploadValidation` / `upload-constraints`.
- Fuera de Documentos complementarios.

### Regresión

- Pagaré (`cliente_pagare`) intacto; P070/agenda intactos; sin ampliar MIME de acta/SAT/semanas.

## Libertad operativa de Mesa (P074/P075)

### SQL

- Runner: `scripts/preflight-reingreso-isolated.sh`.
- Base descartable; aplica migraciones productivas en orden y omite 061 conforme al preflight vigente.
- `rpc_mesa_mover_etapa_operativa.sql`: roles/origen/org, etapas 1–12, estados excluidos, etapa esperada, evento único, RLS/inmutabilidad, rollback y preservación de relaciones.
- `rpc_mesa_gestion_firmas.sql`: alta/reagenda/cancelación por cuatro roles Mesa, visibilidad, etapa/fecha/cupo, conservación de etapa/booking y regresión del flujo asesor.
- Regresiones incluidas: RLS, P070, P071/P072, documentos, retención, editor y avances normales.

### TypeScript/UI

- Zod valida entrada y respuesta de todas las RPC nuevas.
- Pruebas de modelo: roles, visibilidad, etapas, motivo, `saving`, errores estables, advertencias y booking fuera de 9/10.
- Comandos obligatorios: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

### Validación sin datos reales

1. Usar exclusivamente la base descartable local y fixtures UUID P074/P075.
2. Confirmar que el runner elimina la base al finalizar.
3. No conectar el proyecto local a Supabase Cloud durante Fase C.
4. Revisar `git diff` para confirmar que 001–073, P070, 051 y 061 permanecen sin cambios.
