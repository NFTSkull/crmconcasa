## P200 — Reagenda CRM→Sheets verificable

- [x] C1–C2 outbox create/cancel+prior (P160 SQL + worker).
- [x] C3 cancel antes que create (`sortOutboxForRescheduleMove`).
- [x] C4–C5 histórico REAGENDADO + destino; E/F no dead en reagenda.
- [x] C6 create no `done` sin readback; C7 rollback; C8 idempotente.
- [x] C9/C10 missing/ambiguous tab → `failed`.
- [x] C11 worker secret cerrado; C12–C14 UI CRM vs SYNCED/PENDING.
- [x] C15 fixture 26/08 08:00; C16 firmas worker compartido.
- [x] RPC `agenda_booking_sheet_sync_status` (mig **200**). `reagendar_biometricos` intacto.

## P199 — Disponibles = trabajo accionable libre

- [x] Helper `mesa_es_trabajo_accionable_mesa`. Take no cambia (escenario A).
- [x] D1–D16 SQL; D17 infinite-scroll R1–R8. Citas → **200**.

## Microfix Mesa — isolation infinite scroll

- [x] R1–R8 `mesaBandejaInfiniteQuery` (stale enrich, 6 de 6, cursor A≠B, append legítimo, subfiltro, inverso, out-of-order, refresh). Sin SQL. Citas → **199**.

## P202 — Latest request vigente vs latest response (LOCAL)

- [x] Helper `mesa_cambio_episodio_latest` (solicitudes abiertas del ciclo).
- [x] WAITING solo si `latest_request > latest_response` (o sin response).
- [x] E1–E14 (+ E5b cierre DG sin lote). UI badges gobernados por `estado_efectivo`.
- [x] 0 writers / 0 Disponibles writers / 0 agenda.

## P201 — Asesor Necesita/Enviada = episodio P198 (LOCAL)

- [x] Helper `asesor_inbox_estado_efectivo` REPLACE consume P198.
- [x] Sin `OR categoria_correccion`. Retención abierta helper propio.
- [x] A1–A12 + P197 S1–S10 adaptados. List/summary = estado_efectivo.
- [x] 0 writers / 0 smoke.

## Microfix Mesa — badge Rechazado vs corrección P198

- [x] U1–U6 `mesaBandejaSubestadoUi`. Sin SQL. Citas → **199**.

## P198 — Lifecycle efectivo Cambios por revisar (LOCAL)

- [x] Helper `mesa_cambio_revision_estado_efectivo`. RAW lote no se UPDATE.
- [x] M15–M24 causalidad: DG≠doc, mismo `tipo_documento`, operativo≠DG, ciclo, re-reject.
- [x] 0 Cloud writes. Citas → **199**.

## P195 — Disponibles excluye rechazo operativo activo (LOCAL)

- [x] RPC `mesa_list_bandeja_page` `p_ops_filter=sin_asignar`: `ciclo=activo` ∧ `subestado <> rechazado` ∧ sin `assigned_to` ∧ no `correccion_requerida`.
- [x] `activo+rechazado` → Disponibles FALSE; Rechazados TRUE.
- [x] Tras `subestado` deja de ser `rechazado` → Disponibles se reevalúa.
- [x] SQL `rpc_mesa_disponibles_excluye_rechazado_p195.sql` + TS `mesaOpsUi`. 0 writers. Operación de citas → **197**.

## P196 — Causalidad primer lote (REQUESTED vs ADVISOR) (LOCAL)

- [x] `mesa_cambio_revision_clasificacion`: una solicitud Mesa solo clasifica el **primer** lote P130 posterior (`submitted_at` entre R y L).
- [x] T1–T9 SQL. Sin stage gate. `mesa_list_bandeja_page` / Disponibles / writers intactos.
- [x] Copy Mesa: Esperando al asesor / Correcciones por revisar / Actualizaciones del asesor. CTA «Revisar corrección» abre detalle (no marca revisado).
- [x] 0 Cloud writes. Operación de citas → **197**.

## P197-B3 — Detalle expediente asesor: ciclo de corrección (LOCAL)

- [x] Estado principal = `estado_efectivo` (mismo helper P197).
- [x] Necesita / Enviada / Revisada (desaparece episodio) / Rechazo vigente / Cancelado.
- [x] F1–F12 + consistencia inbox=detalle=notif. Sin mig 198. 0 writers Mesa/asesor.

## P197-B2 — Dashboard asesor consume estado efectivo (LOCAL)

- [x] Columna Estado actual = `item.estado_efectivo` (presentation helper).
- [x] Documentación / Estatus op. no compiten como chips globales.
- [x] Chips/contadores siguen RPC P197. Sin mig 198. Excel intacto.

## P197 — Estado efectivo dashboard inbox (LOCAL)

- [x] Helper `asesor_inbox_estado_efectivo` + `mesa_correccion_episodio_flags`.
- [x] List y summary misma clasificación. S1–S10 SQL.
- [x] `/asesor/page.tsx` no modificado (chips ya van por RPC).
- [x] Disponibles / writers intactos. Operación de citas → **198**.

## P186 — Editor inbox: orden por trabajo pendiente + draft re-precal

- [x] B1A LOCAL: mig **181** `editor_list_expediente_ids_page` + `editor_guardar_borrador_reprecalificacion`; SQL A–AE; contratos Zod. Sin frontend `/editor`, sin Cloud/commit.
- [x] B1B LOCAL: wiring list RPC (orden SQL); autosave draft 750ms sin botón; resolve row-blur; restore draft; focus/visibility 8s; timeline 12+pagado Completado. Sin Cloud/commit.
- [x] B1B.1 LOCAL: blur/foco externo no resolve; relatedTarget en fila no resolve; relatedTarget null + app activa + activeElement fuera sí; draft parcial 12 sobrevive tab switch. Sin SQL/Cloud/commit.
- [ ] B2 publicación (fuera de B1).

## P185 — Editor: re-precalificación nueva llega limpia

- [x] B1 LOCAL: dashboard pending vacío; guardado único; sidecar intentos REALES; detalle comparte `editorRevisionDisplay`. Sin RPC/migration/Cloud.
- [ ] B2 publicación (fuera de B1).

## P184 — Asesor etapa 12: estado final Pago ConCasa

- [x] B1 LOCAL: override visual `/asesor` (Completado/Pagado vs Finalizado/No pagó; null no infiere). Sin RPC/migration/Cloud.
- [ ] B2 publicación (fuera de B1).

## P183 — Inbox asesor: re-precalificación como actividad nueva

- [x] B1 LOCAL: mig **180** REPLACE `asesor_list_expedientes_page` (orden `inbox_sort_at`, meta reprecal REAL); UI pills + columna Actualización; SQL A–P; tests FE. Sin mutar iniciar/resolver. Sin Cloud/commit.
- [ ] B2 Cloud apply 180 + smoke (fuera de B1).

## P182 — Localizador Admin Resumen (cliente / NSS)

- [x] B1 LOCAL: RPC `admin_search_cliente_expedientes` mig **179** (sin periodo; pre+post Mesa; 1 fila por `expediente_id`); UI Resumen «Resultados de búsqueda» separada de KPIs; debounce 300 ms + seq; SQL A–Q; tests FE. Sin Cloud/commit.
- [ ] B2 Cloud apply 179 + smoke (fuera de B1).

## Admin buscar NSS (mig 177)

- [x] `p_buscar` Mesa/Precal/Snapshot incluye `expedientes.nss` ILIKE
- [x] Placeholder UI «Cliente, NSS, asesor, programa»
- [x] Mock matcher paridad
- [x] SQL test `rpc_admin_buscar_nss_p177.sql`

## P179 — NSS bloquea solo después de enviar a Mesa

- [x] B1 LOCAL: mig **176** gate `asesor_lookup_nss_precal_gate` (bloqueo = `submitted_to_mesa=true`); suite SQL A–O; mock + FE helpers; P049 unique/`nss_bloqueado_en_mesa` intactos. Sin Cloud/commit.
- [ ] B2 Cloud apply + PR (tras certificación).

## P178 — Inscripción self-service asesor

- [x] Mig **175**: `source_type=asesor`; eligibility RPC; book autocrea requirement atómico; Monterrey+11:00; SQL suite A–N.
- [x] UI: elegible → Disponible + Agendar; ineligible → No disponible todavía; sin crear requirement desde FE.
- [ ] Cloud apply **solo** 175 + PR/merge (tras gates).

## P175 — Cita extraordinaria de inscripción

- [x] B1 local foundation (NO Cloud / NO Sheet / NO UI final): mig **173** enum `inscripcion` + `agenda_inscripcion_requerimientos` + RPCs require/book/cancel/reagenda + ops flag `inscripcion_rebook_required` + P170 outcome `REQUIRES_INSCRIPCION_REBOOK`; detector/classifier/parsers/inventory 11:00; Mesa/Excel/advisor contracts; env-gate fail-closed. P170 APPLY OFF.
- [x] B2 UI LOCAL: asesor card/task; Mesa solicitar + Citas; Reporte del día KPI Inscripciones; tests mount/UI. Sin Cloud apply 173 / Sheet / deploy / commit. Bulk P089 inscripción no habilitado.
- [x] B3: manifiesto Sheet READ ONLY (append-only; Monterrey V1; cupo negocio pendiente → cerrado en B4 = 3).
- [x] B4 rollout: mig 173 Cloud + Edge + Sheet 3×11:00 Monterrey (FORMATO + futuras) + inventory + frontend; P170 OFF; auto-requirements OFF; sin backfill/smoke.
- [x] B5.1 LOCAL: wiring Edge Sheet→`agenda_inscripcion_require_from_sheet` (reconcile/webhook) con kill switch fail-closed; independiente P170; secrets OFF; sin Cloud/deploy.
- [x] P177 LOCAL: tab Inscripción en agenda asesor (embedded; sin requirement informativo).
- [x] P176: mig 174 availability contract + live-sync auth; Apodaca 17 AGO cupos visibles.
- [x] P188 B1 LOCAL: mig **182** cron availability horizon 2h + live-sync `scope=horizon` (worker-only, batchGet, isolation tab). Sin Cloud apply/deploy.
- [x] P189 B1 LOCAL: contrato SHA plantillas Infonavit + fill/flatten (`pdf-lib`) + tests; 0 Cloud/DB/Storage/UI/Edge.
- [x] P189 B2 LOCAL: `datos.infonavit` v1 en Datos Generales Mejoravit + unicidad teléfonos LADA; 0 SQL/Cloud/PDF/enviar Mesa.
- [x] P189 B2.1 LOCAL: mig **183** unicidad teléfonos intra-payload en `save_cliente_datos` (correccion delega); 15 pares + canónico MX; sin unique global / Cloud / `enviar_a_mesa`.
- [x] P189 B3 LOCAL: mig **184** snapshot inmutable + 3 outbox pending en la misma TX que `enviar_a_mesa` / reingreso (solo Mejoravit). Sin PDF/Storage/Edge/Cloud.
- [x] P189 B4 LOCAL: mig **185** claim/fail/complete + worker PDF fill/flatten + Storage local + versionado out-of-order. Sin cron/Cloud/UI Mesa.
- [x] P189 B4.1 LOCAL: mig **186** cron `infonavit-pdf-worker-dispatch` 1 min + pg_net + Vault P189 independiente. Sin Cloud cron/Vault/UI Mesa.
- [x] P189 B5 LOCAL: mig **187** RPC `get_expediente_infonavit_pdf_estado` + sección Mesa/asesor RO (preview/download blob privado, polling 10s, previous version). Sin Cloud/commit/upload manual/gates Mesa.
- [x] P189 B7.1 LOCAL: UX freeze — formulario P189 oculto si FLAG OFF / legacy sin v1. Solo `required` o legacy con captura. 0 SQL. Sin Cloud/commit.
- [x] P189 B7 LOCAL: mig **184** flag Vault DEFAULT OFF + elegibilidad `created_at` vs `p189_infonavit_activation_at`. Legacy never blocked. Kill switch = flag OFF. FE dual completeness + PGRST202 fallback. 183/185/186/187 intactas. Sin Cloud/commit.
- [x] P189 hotfix mapping v2 FINAL LOCAL: mig **189** Monto Mejoravit + parsers con confidence + propuesta + ciudad NUEVO LEÓN + plazo inválido warning; certificación 15 PDFs; snapshots viejos intactos. Sin Cloud/commit/regeneración.
- [x] P189 parser dirección SQL↔TS parity LOCAL: mig **190** `infonavit_parse_direccion_mx` alineado a `parseDireccionMxParaSolicitud` (18/18 fixtures). mappingVersion=2 intacto. Sin Cloud/regeneración.
- [x] Hotfix asesor tareas terminales LOCAL: mig **191** `asesor_inbox_es_accionable`; cancelado/rechazado_mesa fuera de agendar bio/firma/acuse; chips Cancelados/Rechazados intactos. Operación de citas → **192** al retomar. Sin Cloud/push.
- [x] P189 Word editable Mesa LOCAL: `docx` nativo on-demand (`POST /api/mesa/infonavit-docx`); 0 Storage/migration; PDF fill/flatten intacto; asesor denied; consistencia 15 PDF↔15 DOCX. Sin Cloud/push.
- [x] B5.2: deploy webhook+reconcile + FROM_DATE luego ENABLED; históricos 07 AGO=0; P170 OFF.
- [x] B5: secrets FROM_DATE=2026-08-13 + ENABLED=true (P170 OFF).

## P191 — Asesor: terminales fuera de tareas accionables (LOCAL)

- [x] Guard canónico `asesor_inbox_es_accionable` vía `resultado_real` (`cancelado` / `rechazado_mesa`).
- [x] `pendiente_agendar_biometricos` / `pendiente_agendar_firma` / `pendiente_subir_acuse` comparten el guard; list=summary.
- [x] Cancelados / Rechazados por Mesa / corrección documental / reagendar válido intactos.
- [x] SQL `rpc_asesor_tareas_terminales_p191.sql` + tests TS. Sin Cloud/push. Operación de citas → **192**.

## P174 — Protección hora visible Google Sheets (columna A)

- [x] B1 local: A read-only booking/cancel; webhook/reconcile sin auto-corrección; gate `SKIPPED_TIME_IDENTITY_CONFLICT`; classifier missing-links RO; P121 A histórica exacta en replacement; aliases/UI/availability intactos.
- [ ] B2: publicar gate + contratos (sin activar P170; sin reparar R/links aún).

## P173 — Red veto operativo Sheet (fondo #FF0000)

- [x] B1 local completo: mig **172** columnas + ops upsert + fingerprint + apply `COLOR_VETO` (POST-P172); TS/Edge `effective-background` + `getEffectiveBackgrounds`; flags builders; reconcile `E1:I200`; webhook `E{row}:I{row}`.
- [x] B1 tests: `effective-background.test.ts`, `operational-red-veto-b1.test.ts`, fingerprint color-only, `rpc_agenda_sheet_red_color_veto_p173.sql`, `verify:p173`; regresión P172/P170 via verify (re-apply 172).
- [x] Format-only: documentado → reconcile ~15m (sin Code.gs / onChange FORMAT).
- [x] B2: mig 172 Cloud + deploy webhook/reconcile; APPLY OFF; sync worker intacto; observación cron natural; sin Sheet write/smoke.
- [ ] Activación OPERATIONAL APPLY (fuera de P173 B2).

## P172 — Contingencia extraordinaria de citas (B1 + B1.1 + B2)

- [x] Mig. **171**: tablas + RLS + RPCs declarar/rebook + helper inbox + flag reporting.
- [x] B1.1: `agenda_booking_has_contingency` active|closed → P170 SKIP permanente.
- [x] B1.1: trigger/assert `BOOKING_UNDER_CONTINGENCY` (cancel/reagenda/Drive).
- [x] B1.1: closed ≠ voided; sin RPC close aún.
- [x] B1.1: contrato notif `extraordinary_rebook_required` (prioridad 4); UI contract B2.
- [x] Declarar no muta `agenda_bookings` / inventory / slot_links / outbox / Sheets / etapa.
- [x] Extraordinaria en tabla separada (sin cupo); duplicate rebook bloqueado.
- [x] SQL `rpc_agenda_contingencia_p172.sql` + hardening A–K + `scripts/verify-p172-contingencia-local.sh`.
- [x] B2: preview `agenda_preview_contingencia` + listados Mesa/asesor expediente; UI Mesa botón/modal/panel/badges; campana Cloud; card extraordinaria; capacity isolation (sin remaining).
- [x] B2 tests: `mesa-ui.test.ts`, `MesaAgendaContingenciaDialog.mount.test.ts`, `AgendaExtraordinaryRebookCard.mount.test.ts`.
- [x] B3: mig 171 aplicada Cloud (`fvtqbxukqlajezyyvwzy`); tablas vacías; P170 APPLY OFF; sin smoke.
- [ ] B3 ops: declarar contingencia solo ante evento real (no 12/08 de prueba).
- [ ] B3 cierre administrativo contingencia (si aplica).

## P170 — Sheet → expediente (SQL + Edge, apply OFF)

- [x] B1 SQL: apply RPC, identidad P/Q, fingerprint, matriz bio/firma/rechazo, suite `rpc_agenda_sheet_apply_operational_p170.sql`.
- [x] B2: webhook/reconcile projection→apply; `notes_raw`; helper shared.
- [x] B2.5: kill switch default false + cutover FROM_DATE fail-closed; P165 intacto.
- [ ] Activación: `ENABLED=true` + `FROM_DATE=2026-08-13` solo con autorización explícita.

## Hotfix — Firmas 09:30 inventario / slots config (local)

- [x] Parser: `9:30 AM` / `9:30AM` / `09:30` → `09:30` (sin truncar a 09:00).
- [x] Fixture 07 AGOSTO filas 9–20: 09:30×3 + 10:00×3 available; `slot_key` distinto por row.
- [x] UI `applySheetInventoryToSlots`: agrega horarios solo-inventario (09:30/10:00) con capacidad física.
- [x] SQL `firmas_sync_slots_from_sheet_inventory.sql`: añade `09:30` a slots; reabre `10:00` de 0→3; idempotente.
- [x] Cloud RO: inventario ya OK; bug = `agenda_config.firmas.slots` sin 09:30 + `capacity_by_time[10:00]=0`.
- [ ] Cloud: aplicar mig. 157 + `agenda_firmas_sync_slots_from_sheet_inventory` (pendiente autorización).
- [ ] Sin escritura Sheet/citas/etapas en este hotfix local.

## P156 — Validación CURP (constancia PDF) + RFC estimado (piloto)

- CURP válida localmente / dígito incorrecto / fecha extraída.
- Constancia legible: leyenda Registro Civil; variaciones espacios/acento; sin leyenda; otra autoridad; CURP/nombre/fecha no coinciden; PDF sin texto → `PDF_NO_LEGIBLE`.
- Texto completo del PDF no se persiste; resumen sin PII completa en logs.
- RFC estimado se genera; nunca oficial; RFC existente no se sobrescribe; «Usar RFC» exige confirmación.
- Cambiar CURP/nombre/RFC o reemplazar constancia invalida vigentes (historial intacto).
- Asesor dueño OK; asesor ajeno bloqueado; Mesa lee + Ver/Descargar; una versión activa documental.
- Sin cambio de etapa / sin crear expedientes; envío a Mesa sigue disponible (piloto).
- SQL: `supabase/tests/rpc_cliente_constancia_curp_validaciones.sql`. FE: `src/domain/identidad-curp/identidad-curp.test.ts`.
- Probe local flags-only: `npx tsx scripts/probe-curp-constancia-local.ts` (PDF en `/tmp`, no al repo).

## Hotfix — Re-precalificar NSS propio activo (P155 / P168 / P169)

- [x] Gate: own / otro asesor / ambiguo / ok_create (universo = ciclo activo; **sin** exigir `submitted_to_mesa` desde P169).
- [x] P168: `reprecal_change_programa` (dueño + otro programa → mismo `expediente_id`).
- [x] P169: pre-Mesa propio same/change → mismo gate statuses; `iniciar`/`resolver` sin gate oculto de Mesa.
- [x] `asesor_iniciar_reprecalificacion` reutiliza `expediente_id`; historial; `programa_solicitado` diferido; no muta Mesa/etapa/docs.
- [x] Pendiente no muta `expedientes.programa` ni monto vigente; aplica programa solo al aprobar.
- [x] Editor resuelve vía `upsert_editor_decision` → `editor_resolver_reprecalificacion`.
- [x] Aprobado actualiza monto (+ programa si cambio); no_cumple conserva anterior; etapa/docs/citas intactos.
- [x] Reuso de pendiente + update solicitud; un solo pendiente; idempotency key; anon sin EXECUTE.
- [x] SQL `rpc_asesor_reprecalificar_nss_propio_mesa.sql` (regresión post-Mesa P155/P168).
- [x] SQL `rpc_asesor_reprecal_pre_mesa_p169.sql` (pre-Mesa + seguridad + no segundo expediente).
- [x] UI `/asesor/nueva` (P181): propio activo → confirmación + `iniciarReprecalificacion` (mismo `expediente_id`); P179 `ok_create` → `createExpediente`; `blocked_*` → 0 create / 0 reprecal.
- [x] UI detalle: CTAs embebidos en «Decisión del editor» **también PRE-MESA**; Guardar monto intacto.
- [x] Editor: banner actualización con programa vigente → solicitado; mismo `upsertEditorDecision`.

## Hotfix — Reingreso: domicilio y estado de cuenta editables

- [x] Tipos reales: `cliente_comprobante_domicilio`, `cliente_estado_cuenta`.
- [x] Reingreso manual (count>0) o P072 etapa 6: Subir si faltante / Reemplazar si existe.
- [x] Post-Mesa no exige `puedeIntegrar` para uploads ya permitidos por reglas.
- [x] Mig. 146 + storage allow; padre/INE/otros docs sin permisos nuevos.
- [x] Sin smoke escritura en expedientes reales.

## Hotfix — Tarjeta firmas ausente post-Acuse (etapa 8 inconsistente)

- [x] RO: Cardenas `7c114f16` etapa 8 + Acuse enviado + firmas cancelled; Norma `cdce9c91` etapa 8 + firmas booked (cohorte=2).
- [x] Mig. 145 repair + trigger; SQL `rpc_repair_retencion_enviada_etapa_9.sql`.
- [x] Timeline: Acuse no Completado si aún etapa 8; mensajes «listo agendar» solo etapa ≥9.
- [x] Gate firmas etapa 9 síncrono; error probe etapa 10 visible.
- [x] Sin Sheets/inventario/biométricos; sin UPDATE manual de expedientes.

## Hotfix — Reagendar firmas post-Acuse (UI)

- [x] `canShowFirmasManageActions`: etapa 9 **o** 10 + booking activo.
- [x] Card visible en etapa 10 con booking activo; sin fingir Reagendar solo por `fecha_cita`.
- [x] Sin migración (RPC ya 9/10); Acuse/biométricos/Sheets intactos.

## Hotfix — Notificación PDF/JPEG/PNG (mig. 144)

- [x] `cliente_notificacion_apodaca` MIME PDF + image/jpeg + image/png (SQL + FE).
- [x] Asesor + Mesa mismos formatos; accept/hint; preview PDF/imagen; WEBP/GIF/HEIC rechazados.
- [x] Sin ampliar otros tipos; Acuse/etapas/agenda intactos.
- [x] SQL `cliente_notificacion_apodaca_opcional.sql` + tests TS.

## Hotfix — Reingreso visible (mig. 143)

- [x] Card «Reingreso a Mesa» arriba de Datos Generales; visible sin etapa/checklist/`submittedToMesa`.
- [x] RPC relajado: dueño + no cancelado; nunca enviado / sin docs / sin monto OK.
- [x] Mismo `expediente_id`; cero duplicados NSS; docs/citas/`reingreso_rechazo_id` intactos.
- [x] Idempotencia ≤5s; `action_log` `expediente_reingreso_mesa` + `era_primer_envio`.
- [x] SQL `rpc_asesor_enviar_reingreso_a_mesa.sql`; helpers `puedeMostrarReingresoManualCard`.

## P133 — Formatos Datos Generales (asesor)

- [x] Helpers TS: `normalizePersonName` / `isValidPersonName` / `filterPersonNameInput` / `normalizeDigitsOnly` / `filterDigitsInput`.
- [x] `validateClienteDatos` + `normalizeClienteDatosForSave` (nombres, nss, tel, cp, plazo).
- [x] Hotfix B8: infonavit vacío no pisa refs/nombre/beneficiario legacy; refs siguen obligatorias.
- [x] Form `ExpedienteClienteDatosFormSection`: filtros onChange; sin `type=number` en nss/tel/cp.
- [x] Mig. 119: `cliente_datos_assert_payload_formats` en save + corrección; sin CHECK/backfill.
- [x] Tests TS casos 1–13; SQL estructural `rpc_cliente_datos_field_formats_p133.sql`.

## Hotfix 192 — Correcciones P130 en chip Mesa / Asesor

- [x] Helper `expediente_tiene_correccion_asesor_pendiente` (`pendiente_revision` + `submitted_at`).
- [x] Precedencia sobre `correccion_requerida` / faltantes; legacy P102/P167 si no hay lote pendiente.
- [x] Lista y `correccionesEnviadas` heredan `mesa_bandeja_categoria_resumen` (sin duplicar).
- [x] Asesor `correccion_enviada` alineado; sin gate de etapa.
- [x] Sort: latest pending `submitted_at`; marcar revisado sale del predicado.
- [x] SQL A–H + Luis-like; tests Mesa/P130/asesor; 0 Cloud writes.

## P193 — Clasificar Cambios por revisar (origen)

- [x] Universo P192 intacto (P130 pending OR legacy P102). Sin filtro por etapa.
- [x] Helper STABLE `mesa_cambio_revision_clasificacion`: REQUESTED_CORRECTION / ADVISOR_UPDATE / AMBIGUOUS / LEGACY.
- [x] RPC misma firma; subfiltros `correccion_solicitada` / `otras_actualizaciones` en SQL antes de paginar.
- [x] Counts `correccionesSolicitadas` + `otrasActualizaciones`; parent = suma; sin overlap.
- [x] UI chip «Cambios por revisar» + subfiltros compactos; cards origin-aware (Natividad-like = actualización).
- [x] SQL `rpc_mesa_cambios_revision_origen_p193.sql` + regresión P192. 0 Cloud writes. Operación de citas → **195**.
- [x] SQL `rpc_mesa_cambios_detalle_p194.sql` + TS `mesaAsesorCambiosUi` / `mesaAsesorCambiosCardUi` / `MesaAsesorCambiosPanel` / `mesaBandejaEnrichPage.p1302`. Preview máx 3, recover EXACT/PARTIAL/NO_DIFF, labels género. 0 Cloud writes. Operación de citas → **195**.

## P130 — Lote de cambios del asesor (Mesa)

- [x] Formatters/anchors unit (`mesaAsesorCambiosUi.test.ts`).
- [x] Enrich batch adjunta `advisorChanges*` por IDs de página.
- [x] Tarjeta: badge / resumen / reenviado / Revisar cambios (stopPropagation).
- [x] Detalle: panel agrupado + Ir al cambio + preview docs + marcar revisados.
- [ ] SQL 115 + tests focales (agente SQL): freeze en correcciones canónicas; sin N+1; asesor no marca revisado.

## Fix P130 — Lotes vacíos + hook register_documento

- [x] `hasAdvisorChangeDetails` / `esLoteAsesorCambiosVacio`; sin «Revisar cambios» si count=0.
- [x] Tarjeta lote vacío ≠ histórico P130.2; CTA Abrir expediente.
- [x] Panel detalle no monta con 0 cambios.
- [x] Mig. 117: freeze no congela vacío; `pre_reingreso` → `asesor_cambio_record_doc_reemplazo` post-Mesa.
- [x] SQL `rpc_asesor_cambios_p130_empty_batch.sql`.

## P129 — Filtros Mesa (copies)

- [x] Predicados auditados; correccion_enviada vs correccion_requerida disjuntos.
- [x] Labels/tooltips inequívocos; ayuda vista vs asignación; Todo Mesa forzado documentado.
- [x] Sin cambio de RPC/SQL; contadores = mismos predicados.
- [x] Tests focales labels + disjuntos; Citas hoy → `/mesa-control/citas`.

## P128 — Presencia «Abierto ahora por»

- [x] Touch crea/actualiza sesión; heartbeat no duplica; close retira sesión.
- [x] Dos usuarios; dos pestañas mismo user → un nombre; TTL 90s.
- [x] No muta expediente / Actualizado por; Visto por (P127) intacto; asesor bloqueado.
- [x] Batch list sin N+1; badge tarjeta+detalle; poll bandeja 30s si visible.
- [x] SQL `rpc_mesa_presencia_p128.sql` + migración 114.

## P127 — Nombres Mesa + Visto/Actualizado por

- [x] Cinco perfiles por email exacto → Keyla/Jorge/Sara/July/Mirna; UID/email/rol/org intactos; no tocar `mesa.interno04`.
- [x] Abrir detalle → una vista; Strict Mode/dedup no duplica; vista no toca `last_updated_*`.
- [x] Mutación Mesa (`action_log`) → `last_updated_*`; acción asesor no.
- [x] Tarjeta+detalle muestran líneas; vacío canónico; JOIN batch sin N+1; P100/P102 intactos.
- [x] SQL `rpc_mesa_actividad_p127.sql` + migración 113.

## P126 — Cupo 0 por sede/horario

- [x] Vacío bloquea guardado; `0` persiste y cierra sede/hora; `≥1` cupo normal.
- [x] Asesor: sede con 0 no ofrecida; la otra sede del mismo horario sí.
- [x] Bookings existentes intactos al pasar a 0; aviso Mesa; P125 intacto para positivos.
- [x] SQL `112` + `rpc_agenda_allow_zero_recurring_capacity_p126.sql`; tests dominio/UI.

## P125 — Actualización segura de cupos

- [x] Aumentar cupo siempre; reducir solo si ≥ ocupados; mensaje canónico con N.
- [x] Excepción por fecha no afecta otras fechas; recurrente bloquea bajo max ocupados futuros.
- [x] Quitar horario conserva bookings; upsert idempotente (sin filas duplicadas).
- [x] Locks compartidos org+kind+sede+hora (+ slot fecha) entre upsert cupo y booking.
- [x] UX Mesa: éxito «citas conservadas»; helper; error con mínimo sin recargar.
- [x] SQL `rpc_agenda_capacity_update_safety_p125.sql` + mappers TS; regresión P119.2 concurrencia.

## P119 — Acciones rápidas bandeja Mesa

- [x] Siguiente etapa: visible solo con transición; gates bloquean; rechazado/cancelado; RPC canónica; doble clic seguro.
- [x] Tiene documentos (tipo interno `tiene_datos`): toggle + badge; persistencia 106; allowlist; sin cambiar etapa; batch sin N+1.
- [x] Tomar expediente: `mesa_take_expediente`; no apropiación; Asignado a mí.
- [x] Regresión: abrir expediente, filtros, P100/P102, P117/P118 intactos.

## P136 — Mesa reemplazar/eliminar Pagaré y Notificaciones

- [x] Reemplazo vía `register_mesa_documento` (activo único; cleanup huérfano si RPC falla).
- [x] Eliminación `mesa_eliminar_documento_expediente` soft-delete; idempotente; roles Mesa/super_admin.
- [x] Allowlist: `cliente_pagare` | `cliente_notificacion` | `cliente_notificacion_apodaca`.
- [x] UI Mesa Ver/Descargar/Reemplazar/Eliminar; asesor RO sin mutaciones.
- [x] Sin cambio de etapa/citas/montos/ingresos; SQL focal + regresiones P090/P092/P104.

## P135 — Ingresos: movimientos Mesa post-Biometría

- [x] `ingresos_bio_aprobacion_at` reconoce `mesa.expediente.mover_etapa` 3|4|5→≥6 además de 5_8/5_6/5_7 y P114.
- [x] MIN de evidencias; sin duplicar contribución; fórmula/snapshot/rechazo/cancelación intactos.
- [x] Sin tocar `mesa.expediente.mover_etapa`, quick actions, citas ni docs.
- [x] Resumen compacto Producción muestra Notificación cuando n>0; categorías Paty suman 31.
- [x] SQL focal + tests TS compacto; mig. 122.

## P138 — Excel profesional de Ingresos

- [x] Botones Descargar Excel / Personalizar Excel; snapshot de filtros activos.
- [x] RPC export detalle completo (≤10k); mismos filtros que KPIs; sin N+1 de página UI.
- [x] Hojas/columnas configurables; monedas numéricas; freeze/autofilter; ExcelJS paleta reporte.
- [x] Solo super_admin; sin tocar fórmula/snapshot/etapas/citas/docs.
- [x] Tests TS config/excel/UI + SQL focal P138; regresiones filtros Ingresos.

## Excepción one-time firmas (gate 5 días)

- [x] Tabla `agenda_booking_exceptions` + grant solo super_admin; assert respeta excepción exacta.
- [x] `book_firmas` consume excepción y avanza 9→10; capacidad/regla general intactas.
- [x] SQL focal + regresión P132 acuse/gate; sin Sheets.

## P137 — Ingresos: proyección por envío a Mesa + alcance de etapa

- [x] Universo proyectado = enviados a Mesa con monto/% (sin gate bio); incompletos aparte.
- [x] Alcance `all_submitted` / `from_step` / `exact_step` + mapeo visible→interna; filtros AND server-side.
- [x] Fechas: proyectado `fecha_envio_mesa`; real `reconocido_at`; UI Restablecer filtros + resumen de alcance.
- [x] Snapshot `11→12` / helper bio / citas / docs / métricas fuera de Ingresos intactos.
- [x] SQL focal P137 + regresiones P134/P135; tests TS filters/stage-map.

## P134 — Ingresos Super Admin

- [x] Fórmula `monto × % / 100` (prioridad Mesa actualizado > Datos Generales; sin tope 169k).
- [x] Elegibilidad por evidencia canónica bio; rechazo activo/cancelado excluidos; incompletos alertados. *(P137 amplia el universo a envío Mesa.)*
- [x] Snapshot real en `11→12` (idempotente); backfill estimado etapa 12 solo con evidencia.
- [x] RPCs resumen + detalle paginado; UI sección Ingresos; loading/error propios.
- [x] Regresión: producción Admin / citas / docs / quick actions intactos.

## P133 — Acciones rápidas Mesa ↔ etapas P132

- [x] Resolver único `resolveMesaQuickAction` / `resolveMesaSiguienteEtapaAccion` (tarjeta = detalle = bulk destino).
- [x] Etapa 5: «Pasar a Acuse» → `5→8` (individual + bulk biométricos).
- [x] Etapas 3/8/9: info (sin botón avance/agenda Mesa); 9 muestra fecha mínima o «Esperando agenda del asesor».
- [x] Sin bulk `9→10`; sin paneles Mesa 8→9/9→10; 10→11 / 11→12 / 12 final; históricos 4/6/7 intactos.
- [x] Sin `etapa_actual+1` genérico; sin SQL; Notificación/métricas/docs intactos.

# ConCasa CRM — Plan de pruebas

## P118 — Cupos por horario + gestionar cita

- [x] Sede UI: null/`notificacion` → Sin sede; monterrey/apodaca/legacy → labels; badge kind intacto.
- [x] Panel Cupos (solo `canManageAgendaConfig`): list/upsert; no bajar bajo ocupados (SQL).
- [x] Asesor picker: override capacity; inactive oculto/lleno; fallback semanal; refetch tras book.
- [x] Gestionar cita: reagendar/cancelar; cancelar_continuar disabled + STOP copy.
- [x] Aviso asesor `list_agenda_booking_decisiones`.
- [x] Tests TS focales + SQL `rpc_agenda_slot_capacities.sql` / `rpc_mesa_gestionar_cita.sql`.

## P116 — Tipo de fecha en reporte Admin

- [x] Auditoría: `fecha_envio_mesa` 100% en universo P112 Cloud (169/169).
- [x] RPC v3: `envio_mesa` / `entrada_paso_actual`; P112/P114 intactas; Monterrey; desde>hasta error.
- [x] Meta `tipo_fecha` + exclusiones; UI selector default envío; advertencia solo entrada+rango.
- [x] Excel columna según tipo consultado; citas Mesa intactas.
- [x] Gates TS + SQL focal.

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

## P154 — Desglose por asesor + NSS completo (Admin cohorte)

- [ ] Summary incluye `por_asesor`; suma = Entraron de la etapa.
- [ ] Page `entered|advanced|stayed|incident` totales coinciden con celdas.
- [ ] Super Admin recibe NSS completo con ceros; otro rol bloqueado.
- [ ] Excel NSS formato texto; hoja Desglose por asesor.
- [ ] Se quedó + avance posterior: stayed + `avanzo_despues`.
- [ ] action_log `admin.stage_cohort_outcome_detail`.

## P153 — Resultado de cohorte por etapa (Admin)

- [ ] RPCs `admin_stage_cohort_outcome_summary` / `_page` solo `super_admin`; STABLE; fuente `expediente_paso_visual_transiciones`; anon/PUBLIC sin EXECUTE.
- [ ] Cohorte = entrada en rango; avanzó / se quedó / incidencia / no determinado cuadran con Entraron.
- [ ] Entrada antes + avance en periodo: fuera de cohorte.
- [ ] Se quedó al cierre + avanzó después: stayed + `situacion_actual=avanzo_despues`.
- [ ] Reingreso: visitas distintas; P149 sin regresión; timezone Monterrey inclusive hasta.

## P149 — Reporte histórico de etapas (Admin)

- [ ] RPCs `admin_stage_history_report_summary` / `_page` solo `super_admin`; STABLE; sin `action_log`; anon/PUBLIC sin EXECUTE.
- [ ] Movimientos `entrada`|`avance`|`estuvieron` exigen `p_fecha_desde`+`p_fecha_hasta` (Monterrey); `estado_actual` referencia sin fechas.
- [ ] Pasos 1–11; `p_estado_actual` activos|rechazados|cancelados|todos; NSS parcial en page; resultado clasificado.
- [ ] UI `/admin`: tipo movimiento, consulta bajo demanda, banner cobertura, tarjetas resumen, tabla por etapa, detalle paginado, limpiar filtros.
- [ ] Excel `reporte-historico-etapas-YYYY-MM-DD.xlsx` (Resumen por etapa + Historial detallado); tests TS domain/Excel.
- [ ] Snapshot 147/148 y `admin_report_*` v3 sin cambios.

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

## P118 — Cupos + sede + gestionar cita (+ P118b cancelar y continuar)

- [x] Cupos por fecha/hora/sede/kind; assert anti-sobrecupo; UI Mesa Admin.
- [x] Sede legible (`notificacion` → Sin sede).
- [x] Gestionar: reagendar / cancelar / cancelar y continuar (bio 4→5, firmas 10→11; notif oculto).
- [x] RPC `mesa_cancelar_cita_y_continuar` (105); roles solo mesa_admin/super_admin.
- [x] Decisión `cancel_continue` + aviso asesor sin invitar reagendar.
- [x] Tests SQL/TS; sin Cloud/commit.

## P117 — Acuse MIME + avance 8→9 + Pasar a Firmado

- [x] Principal `retencion_acuse_con_sello` / `retencion_carta_sin_sello`: PDF/JPG/PNG; otros `retencion_*` PDF-only; 15 MiB.
- [x] `register_expediente_documento_retencion` en TX: register + (etapa 8 + principal) avance 8→9; 9+ no re-avanza; sin booking automático.
- [x] Mesa etapa 10: «Pasar a Firmado» → `avanzar_etapa_operativa` 10→11 (gates firma); asesor no opera.
- [x] Mesa etapa 11: «Sí pagó» / «No pagó» → `decidir_pago_concasa` 11→12 + `pago_concasa_resultado`; asesor RO; ingresos solo si pagado (P166).
- [x] Tests SQL `rpc_register_retencion_p117.sql`, `rpc_avanzar_etapa_10_11.sql` + TS focales; 11 pasos visuales intactos.
- [x] Sin Cloud/commit/smoke.

## P104 — Notificación opcional sede Apodaca (`cliente_notificacion_apodaca`)

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

### P120 (rango libre Lista — local)

- [x] `Fecha inicial`/`Fecha final` independientes; editar no consulta ni colapsa a un día.
- [x] «Actualizar citas» envía `p_start_date`/`p_end_date`; inválido bloquea sin auto-corregir.
- [x] «Hoy» consulta solo hoy Monterrey; Día/Semana intactos; volver a Lista conserva rango.
- [x] Excel usa rango consultado; sin SQL/Cloud.

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
- Snapshot stock (mig. 147+148): `admin_expedientes_snapshot_etapas` + `admin_list_expedientes_snapshot_page` — sin fechas de periodo; Integración solo `submitted_to_mesa`+`fecha_envio_mesa`; pre-Mesa fuera de total/drilldown; KPI periodo intacto; drilldown alinea con tarjetas.
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

- `cliente-notificacion-contract.test.ts`: tipo, label, etapa 7, MIME PDF/JPEG/PNG, máx. 15 728 640, independencia vs Pagaré; P132-acuse: `origen=Asesor|Mesa`, `esGateAvance=false`, allowlist upload asesor.

### B1 (SQL)

- Migración `089_mesa_notificacion_documento_expediente.sql` (+ P132 mig. 118 + **120 acuse libera firma**).
- Suites: `rpc_acuse_libera_firma_p132.sql`, residual `rpc_notificacion_libera_firma_p132.sql`, rehabilita asserts P117 `rpc_register_retencion_p117.sql`.

### B2 / P132-acuse FE

- Mesa: bio `5→8` (copy/bulk/bandeja); línea `Firma agendable desde` si campo presente.
- Asesor: Acuse copy avance 8→9 + fecha; AgendaFirmas banner `Podrás agendar…`; Notificación sin copy «libera firma».
- Timeline Acuse en 9 = completado si hay doc / pendiente si falta.

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
