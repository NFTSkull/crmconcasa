# ConCasa CRM — Plan de pruebas

## P095 — Citas Mesa: día operativo + Excel

### B0 / B0.1 (auditoría + contrato cerrado)

- [x] Ruta `/mesa-control/citas`, cliente `MesaAgendaCitasClient`, RPC `get_mesa_agenda_bookings`.
- [x] Gap actual: default `lista` = mes; `todayMesaAgendaYmd` = TZ local (no Monterrey).
- [x] Contrato: apertura = hoy Monterrey, solo ese día; cambio de fecha limpia selección P089 y conserva filtros.
- [x] Contrato Excel: `citas-mesa-YYYY-MM-DD.xlsx` / hoja `Citas` / Fecha|NSS|Nombre; in-memory; sin selección; sin límite 100; sin RPC/Storage.
- [x] Decisiones pendientes cerradas en docs; sin código app.

### B1+ (pendiente — no iniciar en B0.1)

- [ ] Implementar TZ Monterrey + default un día.
- [ ] Botón `Descargar Excel` según contrato.
- [ ] Regresión P089 Drive/avance masivo; sin RPC/Cloud.

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
