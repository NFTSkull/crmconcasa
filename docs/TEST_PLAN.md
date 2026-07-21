# ConCasa CRM — Plan de pruebas

## P093 — Separación UX rechazo vs movimiento manual

### B0 (auditoría RO)

- Caso índice y flota Cloud: movimiento manual con motivo «RECHAZO…» ≠ `subestado=rechazado`; filtros correctos; numeración Asesor paso visual ≠ etiqueta Mesa interna.

### B1 (UI)

- Helpers `mesa-rechazo-operativo-ux`: `motivoManualPareceRechazo`, `esElegibleRechazoOperativoPostBiometricos`, mensajes; tests unitarios.
- Panel movimiento manual: copy «no es rechazo»; advertencia si motivo parece rechazo (no bloquea / no ejecuta rechazo); atajo a `#mesa-rechazo-operativo` en etapas 5/6.
- Tarjeta `MesaRechazoOperativoPostBiometricosCard` montada en detalle Supabase (`MesaExpedienteDetalleReadOnly`) con mayor visibilidad; ancla estable.
- Sin cambios RPC/SQL/filtros/Cloud.

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
