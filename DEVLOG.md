# Devlog

## 2026-07-22 - P103: Drag & drop documental Asesor/Mesa

### Objetivo
Unificar carga por arrastre y clic sin duplicar Storage/RPC/validaciones.

### Solución
- `DocumentDropzone` + helpers `documentDropzone.ts`: hint canónico, highlight drag, preventDefault, single-file reject, teclado/a11y.
- Integrado en: Asesor integración, retención/acuse, Mesa Pagaré/Notificación/Solicitud, complementarios Mesa, `FileUploadButton` mock seguimiento.
- Asesor RO (Pagaré/Notificación/Solicitud) sin escritura — intacto.
- Sin SQL/RPC/Cloud/deps; límites MIME y permisos sin cambio.

## 2026-07-22 - P102: Paginación server-side + infinite scroll Mesa

### Causa
Tras P101 el DOM ya no montaba 160 tarjetas, pero la entrada a `/mesa-control` seguía descargando **todos** los expedientes visibles (+ enrich P100 del universo) antes de filtrar/slicear en cliente.

### Auditoría paridad SQL↔TS (pre-publish)
- Categoría: misma prioridad faltantes→rechazado→resubido→subido→validado + `cliente_datos.rechazado` / corrección enviada pendientes.
- `sort_ts`: corregido a `COALESCE(corrección, envío, created)` (no `GREATEST` con envío).
- Citas hoy: `America/Monterrey` en SQL; cliente envía `todayYMD`.
- Resumen batch TS: desempate por `created_at` más reciente (como SQL).

### Arquitectura
1. RPC read-only `mesa_list_bandeja_page` (migración `094_…sql`): `filtros completos → orden (sort_ts, id) → página keyset 25` + `total_count` + `counts` + `next_cursor`.
2. Cursor estable `(sort_ts ASC, expediente_id ASC)` con `LIMIT+1` para `has_more` (no offset).
3. UI Supabase: debounce búsqueda 300 ms; al cambiar filtros reset + primera página; sentinel/«Cargar más» hace append de la siguiente página; error de página adicional reintentable sin perder lo cargado.
4. P100: `listResumenBatch` / secundarias **solo** para IDs de la página nueva.
5. Contadores KPI desde `counts` de la RPC (no desde filas cargadas).
6. Mock/legacy: conserva P101 (carga completa + slice DOM).

### Restricciones
Sin smoke; Cloud solo `db query --linked` de 094.

## 2026-07-22 - P101: Scroll infinito bandeja Mesa

### Problema
`/mesa-control` montaba todas las tarjetas filtradas a la vez (~160), saturando el DOM tras P100 (fetch ya batch).

### Solución
- Flujo fijo: casos completos → filtros/orden → `slice` visible (25 + bloques de 25).
- `IntersectionObserver` + fallback «Cargar más» si no hay observer.
- Reset a 25 al cambiar vista rápida / asignación / búsqueda / etapa / subestado / citas hoy.
- Contador = total filtrado; «Mostrando N de T» opcional; sin refetch al cargar más.
- Sin SQL/RPC/Cloud/server pagination; P100 intacto.

## 2026-07-22 - P100: Rendimiento página principal Mesa Control

### Causa comprobada
1. **N+1 documental:** al montar `/mesa-control`, `loadCasos` llamaba `archivosRepo.listResumenByExpediente(id)` una vez por expediente (p. ej. 85 → 85 round-trips a `expediente_documentos`) solo para badges/filtros de documentación.
2. **Doble carga inicial:** `loadCasos` dependía de `currentUserId`; el primer fetch corría con `null` y, al resolver el userId vía `mesaOpsRepo`, se re-ejecutaba todo el pipeline (×2 el N+1).
3. **Secundarias secuenciales:** estados cliente, notificaciones etapa 3 y `mesa_expediente_ops` esperaban al N+1 antes de empezar.

### Medición controlada (25 expedientes, delay simulado 8–20 ms/llamada)
- Antes: **25** llamadas resumen (+ resto secuencial); con doble mount real ≈ **2×(N+3…)** consultas.
- Después: **1** `listResumenBatch` + **1** estados + **1** notif + **1** ops en paralelo; wall ≈ 1 round-trip secundario; sin refetch por userId.
- Presupuesto 85 ids (chunk 40): **8** consultas máx. vs **~178** antes (N×2).

### Solución
- `listResumenBatchByExpedienteIds` (Supabase `.in` chunked 40; misma semántica que `listResumenByExpediente`).
- `fetchMesaBandejaSecondaryParallel` + `currentUserIdRef` (userId fuera de deps de `loadCasos`).
- Sin SQL/RPC/caché persistente; RLS intacto; sin commit/Cloud.

## 2026-07-22 - P099: Rechazo Mesa → bandeja asesor

### Causa
1. UX: cancelación estaba en verde (P097); el significado terminal debe ser rojo.
2. Asesor: el rechazo canónico ya escribe `subestado=rechazado`, pero el detalle/bandeja no mostraba motivo/nota y el badge de «Corrección requerida» podía tapar «Rechazado (mesa)».
3. Confusión operativa: movimiento manual no alimenta Rechazados (sigue advertido).

### Solución
- Cancelación: tarjeta roja «Cancelar trámite».
- Rechazo: oscuro «Rechazar expediente»; select de motivos + «Otro»; nota opcional; payload `desconocida`/nulls vía `buildRechazoOperativoPayload`.
- Asesor: banner de rechazo + chip/motivo en fila; badge rechazo/cancelación con prioridad sobre corrección documental.
- Sin SQL/RPC/Cloud/commit.

## 2026-07-21 - P098: Teléfonos repetidos entre expedientes

### Causa
`save_cliente_datos` bloqueaba el mismo `telefono_normalizado` en la org vía:
1. índice UNIQUE parcial `cliente_datos_org_telefono_normalizado_unique_idx` (migración 011);
2. helper `cliente_datos_telefono_ocupado_en_org` + pre-check en la RPC;
3. mapeo `unique_violation` → «teléfono repetido».

Alta de expediente (`create_expediente` / `expedientes.telefono_cliente`) no tenía UNIQUE; el fallo aparecía al guardar Datos Generales (celular precargado).

### Solución
- Migración `093_permitir_telefonos_repetidos_expedientes.sql`: DROP UNIQUE; índice no único; helper siempre `false`.
- Unicidad intra-payload (cliente ≠ refs) se conserva.
- Identidad canónica: `expediente_id` (+ reglas NSS vigentes). Teléfono no es upsert key.
- Sin mutar datos reales del caso reportado; sin hardcodes de personas/teléfonos.

### Verificación / publicación
- Suite SQL `rpc_save_cliente_datos` actualizada (dups permitidos; holder intacto; dos asesores; normalización).
- Tests TS P098 + mapper; lint/typecheck/test/build.
- Cloud: `093` vía `npx supabase db query --linked` (sin `db push`/repair).

## 2026-07-21 - UX Mesa rechazo/cancelación (detalle expediente)

### Causa
Las tarjetas invertían la lectura visual (rechazo en rojo “alarma”, cancelación en gris oscuro) y el formulario de rechazo pedía clasificación biométrica innecesaria para el flujo habitual.

### Solución
- Rechazo operativo: tarjeta negra/oscura + copy “puede continuar”; solo motivo obligatorio + nota opcional; envía `biometricosCondicion=desconocida` y nulls.
- Cancelación terminal: tarjeta verde + copy “no continuará”.
- Sin SQL/RPC; contrato Zod admite omitir condición (default `desconocida`).

## 2026-07-21 - P096: Solicitud documento (`cliente_solicitud`)

### Decisión
- Clonar patrón P092 Notificación: tipo `cliente_solicitud` (nunca `solicitud`); etapa ≥ 7; roles Mesa `mesa_admin|mesa_interno|mesa_externo|super_admin`; PDF/JPEG/PNG ≤ 15 MiB; versionado soft-delete; no gate; sin herencia reingreso.
- Migración `092_mesa_solicitud_documento_expediente.sql` (sin Cloud): allowlist + MIME + gate en `register_mesa_documento`; conserva Pagaré/Notificación.
- UI orden: Pagaré → Notificación → Solicitud (Mesa acordeón + Asesor RO).

### Verificación
- Tests TS cableados; suite SQL preparada; lint/typecheck/test/build.
- Cloud: `092` vía `db query --linked` (sin `db push`/repair); publish a `main`/Producción; sin smoke.

## 2026-07-21 - P095 B4: Publicación controlada (push + PR, sin merge)

### Alcance
- Push rama `p095-citas-mesa-excel` + PR a `main`; Preview Vercel READY.
- Sin merge, sin smoke, sin abrir Preview app, sin Producción, sin Cloud/SQL/RPC.

### Preflight
- `origin/main` = `7b339c5` (merge-base); ahead 4; sin deps nuevas; sin archivos SQL/migración.

### Verificación final
- lint / typecheck / test / build PASS antes de push.

## 2026-07-21 - P095 B3.1: Auditoría final Excel UI + commit local

### Auditoría
- Día + filtros: `resolveMesaCitasExportDayYmd` + `downloadMesaCitasExcel(loadedEntries, exportDayYmd, filters, sortBy)`.
- Sin P089: handler no lee `selectedBookingIds` / `executeBulk`; util ignora selección y tope 100.
- Doble clic: `exportExcelBusyRef` + `disabled` mientras Generando; retorno temprano si busy/loading/bulk.
- Mensajes: éxito `Se descargó…`, vacío filtros/día, catch genérico; invalid_date mapeado.
- Sin refetch/mutación en export (no `loadEntries`/RPC/Storage).
- Sin SQL/deps nuevas; solo cableado test en `package.json`.

### Verificación
- lint / typecheck / test / build PASS → commit B3 local único; sin push/PR/Cloud/smoke.

## 2026-07-21 - P095 B3: UI Descargar Excel en Mesa Citas

### Decisión
- Cablear `Descargar Excel` en `MesaAgendaCitasClient` sobre util B2; sin tocar P089 ni RPC.
- Día export: `resolveMesaCitasExportDayYmd` (lista→`listaStartDate`, dia→`selectedDay`, semana→`weekDetailDay ?? selectedDay`).
- Descarga: `downloadMesaCitasExcel(loadedEntries, …)` + Blob/anchor; `exportExcelBusyRef` + disabled mientras Generando; mensaje vacío/éxito/error.
- Independencia P089: no lee `selectedBookingIds`; limpia mensaje con `selectionClearKey` (fecha/filtros).

### Verificación
- Tests helpers B3 + `MesaAgendaCitasClient.excel.test.ts` cableados.
- Sin commit/push/PR/Cloud en este bloque.

## 2026-07-21 - P095 B2: Utilidad Excel citas Mesa (sin UI)

### Decisión

- Nueva util `src/lib/exportMesaCitasExcel.ts` (testeable): `prepareMesaCitasExport` / workbook hoja `Citas`.
- Columnas solo Fecha|NSS|Nombre; filename `citas-mesa-YYYY-MM-DD.xlsx`; título + subtítulo MX; NSS texto; sanitización fórmula.
- Alcance in-memory: día + filtros (kind/canceladas/sede/asesor/search); sin selección P089 ni límite 100; sin Storage/RPC.
- Sin cablear botón en `MesaAgendaCitasClient` (B3).

### Resultado

- Suite `exportMesaCitasExcel.test.ts` cableada en `package.json`.

## 2026-07-21 - P095 B1: Citas Mesa abre en hoy (America/Monterrey)

### Decisión

- Vista default sigue **`lista`** (no forzar `dia`) para no alterar el flujo P089.
- `todayMesaAgendaYmd` usa `zonedYmdParts` + `America/Monterrey` (mismo criterio Admin).
- Apertura: `defaultMesaAgendaDayRange()` → from=to=selectedDay=hoy; fetch un solo día.
- Cambio de fecha: `syncMesaAgendaSingleDay` / `applySingleDay` alinea los tres campos; selección masiva se limpia vía `selectionClearKey` existente; filtros intactos.
- Sin Excel, deps, SQL, RPC, Cloud ni commit B1.

### Resultado

- Helpers + Client/ViewControls + tests TZ/sync; docs B1.

## 2026-07-21 - P095 B0/B0.1: Contrato cerrado Citas Mesa + Excel

### Decisión (cerrada)

- Worktree `crmconcasa-p095-citas-mesa-excel` desde `origin/main` (`7b339c5`).
- Gap actual: apertura `lista` = mes; `todayMesaAgendaYmd` = TZ local (no Monterrey).
- Contrato apertura: hoy `America/Monterrey`, solo ese día; cambio de fecha limpia selección P089 y conserva filtros.
- Contrato Excel: `citas-mesa-YYYY-MM-DD.xlsx` / hoja `Citas` / columnas Fecha|NSS|Nombre; in-memory; independiente de selección y del límite 100; sin RPC/Storage/mutación.
- Residual UI: estilos Excel best-effort con `xlsx`.
- Sin B1 aún; sin push/Cloud/deploy/smoke.

### Resultado

- Docs alineados al contrato aprobado; un commit documental B0.1. Sin código app.

## 2026-07-21 - P094 B6: Cloud apply controlado 090 → 091 (`fvtqbxukqlajezyyvwzy`)

### Decisión

- Aplicación directa vía `npx supabase db query --linked -f <archivo>` (sin `db push` / `migration up` / `migration repair`).
- Orden: **090** (cancelación terminal) → verificación → **091** (Admin `p_estado` disjunto) → verificación.
- Backup previo de defs Admin en `/tmp/p094-cloud-backup-b6-20260721T210216Z/`.
- Conteos de negocio **iguales antes y después**: expedientes=2153, expediente_documentos=1017, agenda_bookings=119, editor_decisions=2153, cliente_datos=156; `expediente_cancelaciones`=0; expedientes `ciclo=cancelado`=0.
- Residual aceptado: `schema_migrations` Cloud sigue truncado hasta **040**; 090/091 **no** se registraron ahí y **no** se reparó.
- Sin smoke, sin abrir Preview/Producción, sin merge del PR #14.

### Resultado

- 090 (~21:02:41–21:02:45Z UTC, exit 0): tabla RLS `expediente_cancelaciones` + RPC `cancelar_expediente_operativo` (SECURITY DEFINER; authenticated EXECUTE; anon sin EXECUTE).
- 091 (~21:03:19–21:03:22Z UTC, exit 0): 4 RPC Admin con ramas `rechazados`/`cancelados` disjuntas; mezcla legada ausente; P087 `LEAST(...,169000)` intacto en summary/by_asesor.
- SHA archivos: 090 `e06c41de…2415`; 091 `41a1c65b…ad785`.

## 2026-07-21 - P094 B4: Admin RPC p_estado rechazados vs cancelados

### Decisión

- Predicados server-side canónicos: rechazados = `subestado=rechazado ∧ ciclo=activo`; cancelados = `ciclo=cancelado`.
- Migración 091 redefine las 4 RPC Admin de filtro operativo (summary, cohort, by_asesor, mesa_envios); firmas/SECURITY/P087 intactos.
- Frontend retira split cliente B3.1; `adminEstadoRpcParam('cancelados')='cancelados'`; mock TS exige ciclo activo para rechazados.
- Sin Cloud/push/commit aún.

### Resultado

- Suite SQL `admin_estado_rechazados_cancelados.sql` + verificador `verify-p094-b4-sql.sh`; lint/typecheck/test frontend.

## 2026-07-21 - P094 B3.1: Auditoría final + commit Asesor/Admin

### Decisión

- Gates críticos: (1) Asesor separa `cancelado` vs `rechazado_mesa`; (2) Admin no muestra mezcla bajo etiquetas Rechazados/Cancelados.
- Hallazgo: tests B3 nuevos no estaban en `package.json` (no corrían en `npm test`).
- Hallazgo: post-filtro de una sola página Supabase contaminaba `totalCount`/paginación y dejaba KPI/cohorte/asesor mezclados vía RPC 082–086.
- Cierre Gate Admin: split cliente — cargar bucket legado `rechazados`, filtrar, recalcular envíos/cohorte/asesor/paginación; normalizar labels cancelado.
- Conteo tests: B2 `test` script = 980; B3 sin cablear = 982 (+2 notifications); con suites B3 cableadas = 991. No hubo pérdida real 983→982 (983 no era baseline del script `test`).

### Resultado

- Commit B3 local único; sin SQL/Cloud/push.

## 2026-07-21 - P094 B3: Asesor Cancelados + Admin desacople

### Decisión

- `deriveResultadoRealExpediente`: `ciclo=cancelado` → `cancelado` (prioridad); `rechazado_mesa` exige enviado ∧ `subestado=rechazado` ∧ ciclo activo/null.
- Asesor: KPI/chip/filtro Cancelados independientes; notificaciones `cancelado` vs `rechazado_mesa`; detalle banner RO + `puedeIntegrar`/envío/agenda/retención apagados.
- Admin: predicados `matchesAdminEstadoFilter` disjuntos; UI «Rechazados» y «Cancelados»; mock correcto; Supabase listado post-filtra (RPC legado mezcla en `p_estado=rechazados`); summary/cohort residual documentado hasta follow-up SQL.
- Sin SQL/migración/RPC nuevas; sin reapertura; sin commit/Cloud/push.

### Resultado

- Código + tests + docs locales; verificación lint/typecheck/test del bloque.

## 2026-07-21 - P094 B2.1: Auditoría final + commit local UI Mesa

### Decisión

- Contadores y lista comparten `matchesMesaQuickFilter` / `esRechazadoOperativoActivo` / `esCanceladoOperativo`; subvistas disjuntas.
- «Todos» y chips operativos excluyen `ciclo=cancelado`; cancelados solo vía chip agrupado.
- UI terminal: banner RO + `puedeOperarMesaActivo`; cancel card solo con ciclo activo; rechazo 5/6 intacto.
- Sin Asesor/Admin (B3); SQL 071/072/090 sin tocar en este commit; sin Cloud/push.

### Resultado

- Un commit B2 sobre B0+B1; working tree limpio; ahead 3 de `origin/main`.

## 2026-07-21 - P094 B2: UI Mesa rechazos vs cancelaciones

### Decisión

- Chip agrupado `rechazos_cancelaciones`; contador = rechazados activos + cancelados; subvistas disjuntas.
- «Todos»/En proceso/etc. excluyen `ciclo=cancelado`; listado Supabase/mock incluye cancelados para el chip.
- Cancelar: card dedicada (motivo + confirmación) → `cancelarExpedienteOperativo`; rechazo 5/6 intacto.
- Cancelado: banner RO con historial; `puedeOperarMesaActivo` apaga writes; sin movimiento manual.

### Resultado

- Dominio `mesa-cancelacion-operativa`, filtros/tests, detalle Mesa, docs. Sin Asesor/Admin/Cloud/commit.

## 2026-07-21 - P094 B1.1: Auditoría final + commit local SQL

### Decisión

- Cancelado es terminal: único writer `cancelar_expediente_operativo` → `ciclo=cancelado` + fila `expediente_cancelaciones`; UPDATE solo `ciclo_estado`/`updated_at`; no muta `subestado`/etapa/bookings ni escribe `expediente_rechazos_operativos`.
- Gates post-cancel: predicados `ciclo ≠ activo` existentes (avance, mover, rechazo, reingreso, book, uploads); suite cubre avance/mover/rechazo/reingreso/book.
- Rechazo P071 y reingreso P072: migraciones 071/072 intactas; suites focales PASS.
- Sin UI/`src`; sin Cloud/push; no se atienden colisiones NSS de suites ajenas en el preflight completo.

### Resultado

- Un solo commit B1 sobre el documental B0; working tree limpio; ahead 2 de `origin/main`.

## 2026-07-21 - P094 B1: SQL cancelación terminal

### Decisión

- Cancelado = `ciclo_estado=cancelado` + fila `expediente_cancelaciones`; **no** reutilizar `subestado=rechazado`.
- RPC `cancelar_expediente_operativo`: Mesa + `can_see_expediente`; requiere enviado y ciclo activo; permite cancelar sobre rechazado; no toca etapa/subestado/agenda; `action_log` `expediente.cancelacion_operativa`.
- Escritura solo vía RPC (REVOKE INSERT a authenticated). Gates normales ya exigen `ciclo=activo` (avance/mover/rechazo/reingreso/book/uploads); B1 los cubre con suite, sin reescribir esas RPCs.
- Reapertura admin y UI fuera de B1.

### Resultado

- Migración `090_cancelar_expediente_operativo.sql` + suite `rpc_cancelar_expediente_operativo.sql` + cableado `test-sql.sh`; docs API §17f / PRODUCTO / TEST_PLAN / CHANGELOG.
- Verificación SQL focal: `scripts/verify-p094-b1-sql.sh` (090 + P071/P072 + complementarios). Suite completa `preflight-reingreso-isolated` sigue con colisiones NSS entre fixtures de suites no relacionadas (preexistente).
- Ajuste menor: `mesa_complementarios_opcionales.sql` espera 5 `mesa_upload` (pagaré + notificación P090/P092).
- Sin UI/Cloud/commit/push.

## 2026-07-21 - P094 B0.1: Auditoría final + commit documental

### Decisión

- Solo docs; sin SQL/UI/RPC. Cierre de ambigüedades: historial = `expediente_cancelaciones`; predicados chip/subvistas explícitos; `rechazado_mesa` exige ciclo activo; reapertura admin fuera de P094.

### Resultado

- Commit documental único B0; sin push/PR/B1.

## 2026-07-21 - P094 B0: Auditoría Rechazados vs Cancelados

### Decisión

- Rechazo canónico vigente (P071): `subestado=rechazado`, ciclo **activo**, tabla `expediente_rechazos_operativos`, etapas 5/6; reingreso P072 exige ese par.
- `ciclo_estado=cancelado` existe en enum desde 001 pero **sin RPC de escritura** ni UI; Admin mezcla rechazado∨cancelado.
- Diseño: Cancelado = `ciclo=cancelado` (terminal); no usar `subestado=rechazado` para cancelar; chip Mesa «Rechazos y cancelaciones» con subvistas; RPC tentativa `cancelar_expediente_operativo` en API §17f.
- Reapertura admin fuera de P094. Sin inferencia por texto. Sin implementación SQL/UI en B0.

### Resultado

- Docs PRODUCTO §6.6, API §17f, TEST_PLAN, RIESGOS, CHANGELOG. Worktree `p094-rechazados-vs-cancelados` @ `a1a6ae4`.

## 2026-07-21 - P093 B2.1: Auditoría final + commit local numeración

### Decisión

- Diff solo presentación/docs/tests; `mapEtapaInternaAPasoVisual` y `etapa_actual` intactos; sin SQL/RPC/filtros/avance.
- Helpers `etapa-numeracion-ux` reutilizan el mapeo existente; UI muestra correspondencia Mesa↔Asesor.

### Resultado

- Commit local único B2; sin push/PR/Cloud/smoke.

## 2026-07-21 - P093 B2: Numeración Mesa vs Asesor (solo UX)

### Decisión

- Misma `etapa_actual` DB; Mesa numera 1–12; asesor timeline omite legacy 4 → 11 pasos.
- Helpers de presentación (`etapa-numeracion-ux`) + copy de correspondencia en detalle Mesa, bandeja, movimiento manual y seguimiento asesor.
- Sin mutar IDs, avance, filtros, RPC, SQL ni datos.

### Resultado

- Worktree `crmconcasa-p093-numeracion-etapas-mesa-asesor` desde `d89a209`; sin commit.

## 2026-07-21 - P093 B1.1: Auditoría final + commit local UX rechazo

### Decisión

- Diff solo UX/docs/tests; sin migraciones, RPC, filtros, contadores ni Cloud.
- Montaje seguro: `MesaRechazoOperativoPostBiometricosCard` en `MesaExpedienteDetalleReadOnly` (path Supabase) con gates existentes (enviado, ciclo activo, no rechazado, etapas 5/6). Path mock conserva `dataModeSupabase={isDataModeSupabase()}` (tarjeta oculta en mock).
- Heurística `rechaz*` informativa: no bloquea movimiento ni ejecuta rechazo.
- Autorización sigue en RPC `rechazar_etapa_operativa` (sin ampliar etapas/roles en UI helpers).

### Resultado

- Commit local único B1; sin push/PR/deploy/smoke/numeración.

## 2026-07-21 - P093 B1: UX anti falsos rechazos (movimiento manual)

### Decisión

- B0: el caso «RECHAZO, BURO…» fue `mesa_mover_etapa_operativa`, no `rechazar_etapa_operativa`. Filtros correctos.
- B1 solo UX: copy explícito, advertencia heurística `rechaz*` (informativa, no bloquea ni ejecuta rechazo), atajo a `#mesa-rechazo-operativo` si elegible (5/6).
- Hallazgo: la tarjeta de rechazo canónico existía pero **no** estaba montada en `MesaExpedienteDetalleReadOnly` (path Supabase). Se monta antes del movimiento manual con mayor visibilidad.
- Sin cambios RPC/SQL/filtros/contadores/Cloud; sin backfill de motivos.

### Resultado

- Helpers `mesa-rechazo-operativo-ux` + tests; docs PRODUCTO/API/TEST_PLAN/RIESGOS/CHANGELOG.

## 2026-07-21 - P092 B3: Auditoría final B0–B2 + commit local

### Decisión

- Diff quirúrgico: contrato/docs/SQL 089/UI Mesa+asesor; sin agenda/`kind=notificacion`; Pagaré (`cliente-pagare*`) sin tocar.
- Verificación: SQL `P092 NOTIF DOC OK` + regresión Pagaré; `npm test` 983; lint/typecheck/build OK.
- Un solo commit local; sin push/PR/Cloud/smoke.

### Resultado

- Commit local de P092 B0–B2.

## 2026-07-21 - P092 B2: UI Mesa + asesor RO (`cliente_notificacion`)

### Decisión

- Secciones dedicadas espejo Pagaré pero **archivos/estado independientes**: `MesaNotificacionDocumentoSection`, `AsesorNotificacionDocumentoSection`, helpers `cliente-notificacion.ts`.
- Acordeón Mesa `mesa-notificacion-documento` después de Pagaré; label UI «Notificación»; tipo técnico siempre `cliente_notificacion` (nunca `notificacion`).
- Reutiliza Storage + `register_mesa_documento` / `getArchivoBlob`; cleanup best-effort heredado del repo Mesa.
- `fileUploadValidation` y `upload-constraints` aceptan el mismo perfil MIME/tamaño que Pagaré para este tipo.
- Sin compartir state React con Pagaré; sin listar en complementarios; sin agenda/P070.

### Resultado

- UI + tests dominio. Sin commit/Cloud/smoke.

## 2026-07-21 - P092 B1: SQL `cliente_notificacion`

### Decisión

- Migración `089_mesa_notificacion_documento_expediente.sql` espejo de 088: allowlist + MIME + gate etapa en `register_mesa_documento`.
- Tipo documental `cliente_notificacion` (nunca `notificacion`); error etapa: «El documento Notificación solo puede cargarse…».
- MIME JPEG/PNG compartido con Pagaré vía `v_tipo IN ('cliente_pagare','cliente_notificacion')`; acta/SAT/semanas siguen PDF-only.
- Versionado/RLS/tamaño reutilizan infraestructura existente; sin RPC nueva; sin UI; sin Cloud.
- Suite SQL con fixtures 9092* (no colisionan con P090 9091*); prueba independencia Pagaré↔Notificación doc; enum `booking_kind.notificacion` intacto.

### Resultado

- Migración 089 aplicada en Postgres local; suite `rpc_mesa_notificacion_documento_expediente.sql` → `P092 NOTIF DOC OK`; regresión Pagaré → `P090 PAGARE OK`.
- Sin UI / Cloud / commit. Residual B2: UI Mesa + asesor RO.

## 2026-07-21 - P092 B0: Contrato TS Notificación documento

### Decisión

- Tipo técnico obligatorio: `cliente_notificacion` (nunca `notificacion`, reservado a `agenda_bookings.kind` / P070).
- Contrato espejo de Pagaré en `integration-docs-completos.ts` (`Object.freeze`, mismas claves: `tipo`, `label`, `origen`, `formatos`, `mimePermitidos`, `maxBytes`, `etapaMinima`, `obligatorio`, `esGateAvance`) — objetos **independientes**.
- En `INTEGRATION_DOC_TIPOS_MESA_REGISTER` (espejo SQL B1) pero **fuera** de `INTEGRATION_DOC_TIPOS_MESA_UPLOAD` (complementarios UI).
- Catálogo `DOCUMENTO_CATALOGO_MAP.cliente_notificacion`; sin helpers upload/UI (B2); sin migración (B1).
- Storage documentado: `{org}/{exp}/cliente_notificacion/{uuid}.{ext}` bucket privado.
- Riesgos: colisión semántica agenda vs documento; duplicado en complementarios; estado React compartido con Pagaré; soft-delete huérfanos; ampliar MIME de otros tipos.

### Resultado

- Docs + contrato + `cliente-notificacion-contract.test.ts`. Sin SQL/UI/Cloud/commit.

## 2026-07-21 - P091: Buscador y contraste filtros `/asesor`

### Decisión

- Causa del «no filtra por nombre»: `term.replace(/\D/g,"")` vacío + `nssDigits.includes("")` === true → todas las filas pasaban. Extraído `matchesAsesorListadoBusqueda` (solo match por dígitos si hay dígitos).
- Contraste: inputs nativos heredaban `--foreground` claro (dark OS) sobre `bg-white`; forzar `text-gray-900` / `placeholder:text-gray-500` / labels `text-gray-700`.
- Paginación: `updateFilters` ya hacía `setPage(1)`; se conserva.
- Alcance quirúrgico: solo listado `/asesor` + helper/tests; sin producción/SQL/Supabase/otros módulos.

### Resultado

- Helper + tests P088 (NSS/tel) y P091 (nombre no matchea todos).
- UI contraste buscador + filtros avanzados; mensaje vacío específico con búsqueda.

## 2026-07-21 - P090 B7: Cloud apply controlado 087 → 088 (`fvtqbxukqlajezyyvwzy`)

### Decisión

- Aplicación directa vía `npx supabase db query --linked -f <archivo>` (sin `db push` / `migration up` / `migration repair`).
- Orden: **087** (Monto Mejoravit) → verificación → **088** (Pagaré) → verificación.
- Backup previo de defs Cloud en `/tmp/p090-cloud-backup-b7-20260721T101518/` (`save_cliente_datos`, `upsert_editor_decision`, `integration_doc_tipos_mesa_upload`, `expediente_documento_mime_permitido`, `register_mesa_documento`).
- Conteos de negocio **iguales antes y después**: cliente_datos=156, expedientes=2109, expediente_documentos=993, editor_decisions=2109.
- Overrides de monto: **0**; historial de monto: **0**; documentos `cliente_pagare`: **0**; sin backfill ni mutación de datos.
- Sin smoke, sin abrir UI nuevas, sin merge del PR #9 en B7.
- Residual: `schema_migrations` Cloud sigue truncado hasta **040**; 087/088 **no** se registraron ahí y **no** se reparó.

### Resultado

- 087 (~16:15:47–16:15:51Z UTC, exit 0): columnas override + historial RLS + RPCs monto + `save`/`upsert` con precedencia verificados.
- 088 (~16:16:40–16:16:44Z UTC, exit 0): allowlist + MIME Pagaré + gate etapa≥7 en `register_mesa_documento` verificados.
- SHA archivos locales: 087 `d2948000…de93`; 088 `232ce8d6…a33c`.

## 2026-07-20 - P090 B5: Auditoría integral + commit local

### Decisión

- Auditoría completa B0–B4 sin ampliar alcance: migraciones 087/088, UI Monto + Pagaré, precedencia cobro, P087/P089 intactos.
- Residuales **aceptados** (no se resuelven en B5):
  1. Formulario editable de Datos Generales del asesor puede seguir mostrando `datos.montoMejoravit`; la sección P090 es el monto operativo autoritativo.
  2. Posible objeto Storage huérfano si falla el cleanup best-effort tras RPC de Pagaré.
  3. Históricos soft-deleted del Pagaré no visibles en UI (RLS normal solo vigente).
  4. Migraciones 087/088 aplicadas manualmente en DB local; fuente de verdad = archivos de migración; **no** Cloud; no se repara `schema_migrations` local.
- Un único commit local; sin push/PR/deploy/smoke/Cloud.

## 2026-07-20 - P090 B4: UI Pagaré (Mesa + asesor RO)

### Decisión

- Sección Mesa dedicada `MesaPagareSection` (acordeón hermana), no dentro de complementarios ni Datos Generales / Monto.
- `cliente_pagare` permanece fuera de `INTEGRATION_DOC_TIPOS_MESA_UPLOAD` para evitar botón duplicado; registro tipado vía `IntegrationDocMesaRegisterTipo`.
- Reutiliza `uploadMesaDocumento` / `replaceMesaDocumento` → Storage + `register_mesa_documento` + cleanup best-effort del objeto nuevo si RPC falla.
- Preview/descarga: `getArchivoBlob` + `MesaArchivoPreviewDialog` (PDF e imagen); sin URLs públicas.
- Asesor: `AsesorPagareSection` solo lectura desde etapa 7; no importa upload/RPC de escritura.
- Un refetch documental por operación Mesa; no toca etapa/monto/cobro/Admin.
- Residual: si Storage sube y cleanup falla tras RPC, queda objeto huérfano (mismo patrón complementarios); sin UI de versiones históricas (RLS solo vigente).

### Archivos

- Dominio: `cliente-pagare.ts` (+ tests), mapper `version`/`full_name`, repo Mesa register tipo
- UI: `MesaPagareSection`/`UploadDialog`, `AsesorPagareSection`, cableado detalle Mesa/asesor
- Docs: PRODUCTO, API_CONTRATOS, CHANGELOG

## 2026-07-20 - P090 B3: Backend Pagaré (`cliente_pagare`)

### Decisión

- Reutilizar `register_mesa_documento` (sin tabla paralela).
- Allowlist Mesa +4: `cliente_pagare`.
- MIME específico: PDF/JPEG/PNG; acta/SAT/semanas siguen PDF-only.
- Gate solo Pagaré: `etapa_actual >= 7`; mensaje fijo de inscripción.
- UI complementarios (`INTEGRATION_DOC_TIPOS_MESA_UPLOAD`) **sin** pagaré aún; allowlist SQL completa en `INTEGRATION_DOC_TIPOS_MESA_REGISTER`.
- Asesor: RLS SELECT vigente; sin escritura.
- Sin gate de avance, sin checklist, sin herencia reingreso, sin UI B4.

### Archivos

- `supabase/migrations/088_mesa_pagare_expediente.sql`
- `supabase/tests/rpc_mesa_pagare_expediente.sql`
- Catálogo TS + tests; docs

## 2026-07-20 - P090 B2: UI Monto actualizado Mejoravit

### Decisión

- Sección Mesa **hermana** de Datos Generales (acordeón propio); no se embebe en `MesaClienteDatosReadOnlySection`.
- Escritura exclusiva RPC `mesa_actualizar_monto_mejoravit`; lectura `get_expediente_monto_mejoravit_context`.
- Asesor: sección RO solo si `montoMejoravitActualizado != null`; sin controles.
- Vista previa cobro = `% + cargo_fijo(3000)`; backend autoridad final.
- Tras éxito: 1 refetch contexto + 1 `load` del detalle padre (cobro en Datos Generales).
- Sin Pagaré, sin SQL nuevo, sin Admin/P087.

### Archivos

- Dominio: `src/domain/monto-mejoravit-actualizado/*` (+ tests)
- UI: `MesaMontoMejoravitActualizadoSection/Dialog`, `AsesorMontoMejoravitActualizadoSection`
- Cableado: `MesaExpedienteDetalleReadOnly`, `asesor/expediente/[id]/page`

## 2026-07-20 - P090 B0–B1: Monto actualizado Mejoravit (backend)

### Decisión

- Tres capas: editorial (`monto_aprobado`), snapshot (`monto_aprobado_al_aprobar` / P087), operativo (`COALESCE(actualizado, JSON válido, fallback −11%/169k)`).
- **No** mutar `datos.montoMejoravit`; Datos Generales permanece editorial del asesor.
- Cobro Mesa: `ROUND(nuevo × % / 100 + 3000, 2)`; bloquea sin `%`; método opcional; mismo monto (2 dec) bloqueado.
- Historial append-only por expediente; `created_at` vía `clock_timestamp()` para orden estable intra-transacción.
- Lectura: `get_expediente_monto_mejoravit_context`; `cargo_fijo=3000`; asesor `can_update=false`.
- `save_cliente_datos` / reingreso editor respetan override; no herencia padre↔hijo.
- P087 intacto (Admin solo snapshot). Pagaré documentado, **no** implementado. Sin UI.

### Archivos

- `supabase/migrations/087_mesa_monto_mejoravit_actualizado.sql`
- `supabase/tests/rpc_mesa_monto_mejoravit_actualizado.sql`
- Docs: `PRODUCTO.md`, `API_CONTRATOS.md`, `CHANGELOG.md`

## 2026-07-20 - P089 B3: Pasar a siguiente etapa masivo

### Decisión

- Reutilizar `expedientesRepo.avanzarEtapaOperativa` → RPC `avanzar_etapa_operativa` **una vez por expediente único**.
- Dedupe por `expedienteId`; si hay transiciones distintas en la selección → omitir con razón explícita (sin adivinar).
- Drive **no** es gate; no se llama validación Drive antes del avance.
- Concurrencia máx. **5** expedientes (`runWithConcurrencyLimit`); sin reintentos; fallos parciales; un solo `loadEntries()` al final.
- Éxitos: quitar todos los `bookingId` del expediente de la selección. Fallidos/omitidos: conservar si siguen seleccionables.
- Sin SQL, sin RPC batch, sin cambios de permisos. El lote **no** es atómico entre expedientes.

### Archivos

- Dominio: `planBulkStageAdvance`, `executeBulkStageAdvance`, `groupBulkAdvancePlanByTransition`, `removeSuccessfulExpedientesFromSelection` (+ tests)
- UI: `MesaAgendaBulkAdvanceConfirmDialog`, `MesaAgendaBulkAdvanceResultPanel`, botón en barra, cableado en `MesaAgendaCitasClient`

## 2026-07-20 - P089 B2: Validar en Drive masivo (resultados parciales)

### Decisión

- Reutilizar el wrapper individual `setMesaAgendaDriveValidation` → RPC `mesa_set_agenda_drive_validation` con `p_validated=true`. Sin RPC batch, sin SQL, sin permisos.
- Concurrencia cliente máx. **5** (`runWithConcurrencyLimit`); sin reintentos; un fallo no cancela el resto.
- Confirmación obligatoria (diálogo accesible); recalcula elegibilidad justo antes de escribir (`planBulkDriveValidation` / `executeBulkDriveValidation`).
- Post-lote: un solo `loadEntries()`; deseleccionar exitosos; conservar fallidos/omitidos seleccionables; reconciliación existente limpia IDs ausentes.
- Copy y UI dejan claro: **no avanza etapas**. Avance masivo queda para bloque posterior.

### Archivos

- Dominio: `mesa-bulk-actions.ts` (+ tests de plan/concurrencia/ejecución/selección)
- UI: `MesaAgendaBulkSelectionBar`, `MesaAgendaBulkDriveConfirmDialog`, `MesaAgendaBulkDriveResultPanel`, cableado en `MesaAgendaCitasClient` + List/Day/Week

## 2026-07-20 - P089 B0–B1: elegibilidad y selección múltiple en Citas Mesa

### Decisión

- Selección local por `bookingId` (Drive es por cita). Límite **100**.
- «Seleccionar elegibles visibles» = bookings elegibles del alcance renderizado (Lista filtrada / Día / detalle Día de Semana).
- Elegibilidad predictiva separada: Drive vs avance; **Drive no es gate** de avance.
- Avance: espejo conservador de transiciones 3→5 / 4→5 / 5→6 / 9→10; sin `cicloEstado` en el listado (residual; la RPC sigue siendo autoridad).
- Sin escrituras masivas en este bloque (barra informativa solamente).

### Archivos

- `src/domain/agenda-calendar/mesa-bulk-actions.ts` (+ tests)
- UI: `MesaAgendaCitasClient`, List/Day/Week/EntryParts, `MesaAgendaBulkSelectionBar`

## 2026-07-20 - P087 B4.3: restaurar `monto_aprobado_snapshot_no_recuperable` en 086

### Hallazgo

- Cloud pre-086 (`/tmp/p087_cloud_rpc_before_086.sql`) exponía en **items** de `admin_list_precalificaciones_page` la columna booleana `ed.monto_aprobado_snapshot_no_recuperable` (origen P084).
- La 086 inicial se basó en 083/085 y omitió ese campo; al `CREATE OR REPLACE` en Cloud se perdió el contrato.
- Consumidores: `supabase.repo.ts` → `montoSnapshotNoRecuperable`; UI Admin etiqueta; Excel Precalificaciones; docs P084.

### Decisión

- Restaurar **exactamente** `ed.monto_aprobado_snapshot_no_recuperable` en el SELECT de items de 086, sin tocar `LEAST`/agregados ni otras claves JSON.
- No reparar historial `schema_migrations`; no Cloud en este commit (aplicación correctiva pendiente de aprobación).

## 2026-07-20 - P087: tope $169,000 por expediente en agregados Admin

### Decisión

- Alcance **solo Admin agregados**. No asesor, Mesa, editor, cobro ni `cliente_datos`.
- Fuente intacta: `editor_decisions.monto_aprobado_al_aprobar` (snapshot real).
- Aportación al indicador «Monto aprobado Mejoravit»:
  `LEAST(COALESCE(monto_aprobado_al_aprobar, 0), 169000)` **por expediente antes** de `SUM`/`AVG`.
- El total agregado **puede superar** $169,000 (no `LEAST` sobre el total).
- El promedio usa la misma base limitada (`AVG(LEAST(...))`).
- Filas individuales / Excel hoja Precalificaciones: monto crudo sin tope.
- Excel Resumen/Asesores: consume agregados RPC ya limitados (sin re-suma).

### RPCs

Migración `086_admin_monto_aprobado_mejoravit_cap_aggregate.sql` redefine:

- `admin_get_production_summary` (base 083) → `monto_aprobado_total`
- `admin_list_production_by_asesor` (base 085) → `monto_aprobado_total`
- `admin_list_precalificaciones_page` (base 083+P084) → `monto_mejoravit_total` / `monto_mejoravit_promedio` + items con `monto_aprobado_snapshot_no_recuperable`

Sin `UPDATE`, sin backfill, sin Cloud en esta entrega.

### Mock TS

`aportacionMontoAprobadoMejoravitAdmin` en `monto-aportacion-admin.ts`; usada solo en `computeAdminProductionSummary` y `computePrecalMontosMejoravit`.

### Rollback

Restaurar cuerpos 083/084/085 con `sum`/`avg` sin `LEAST` (documentado al final de 086).

### Verificación SQL local (sin Cloud)

`npx supabase db reset` puede fallar en `078_profile_asesor_mejoravit.sql` (UID Auth ausente en local). Eso **no** se automatiza en `scripts/test-sql.sh` (solo se registró el archivo de prueba P087). Procedimiento seguro usado:

1. DB local con migraciones ≥077 (o reset hasta donde aplique).
2. Aplicar a mano `079`…`086` con `psql` local (`127.0.0.1:54322`).
3. `psql -f supabase/seed.sql` una vez si faltan perfiles/org.
4. `psql -f supabase/tests/admin_monto_aprobado_mejoravit_cap_aggregate.sql`.

No aplica migraciones a Cloud ni convierte fallos en éxito.

## 2026-07-17 - P085 §16A–§21: privacidad asesor, timeline, Excel, rendimiento

### Decisión

- Contrato Mesa visible: `asesor_nombre → «Asesor sin nombre registrado»`. **Nunca** correo como fallback (listado, diálogo, timeline, Excel Expedientes, tipos públicos).
- Selector global / producción por asesor / precal **sí** pueden usar email (fuera del contrato Mesa).
- Listado: `count cohorte` → `v_page_ids` (orden+paginación) → `unnest(v_page_ids)` + laterales pesados (actividad/correcciones/rechazos/bookings) **solo de la página**.
- Timeline: `limit` NULL→10, ≤0→1, >100→100; `offset` NULL/−→0; orden `created_at DESC, id DESC` (id interno, no expuesto); `has_more`; inexistente ≡ fuera de alcance.
- Excel Expedientes: columnas §20; aborta si `total_count` cambia o filas ≠ count (sin archivo parcial).
- UI: orden Filtros→KPIs→Etapas→Mesa→Producción→Precal; diálogo a11y + Cargar más; 0 llamadas timeline al cargar `/admin`.

### Arquitectura SQL listado (`admin_list_mesa_envios_page`)

| Paso | Sección |
|---|---|
| Cohorte + filtros | `WHERE` sobre `expedientes` (+ join `profiles` solo para búsqueda) |
| Count total | `SELECT count(*) …` → `v_total` |
| Página | `array_agg(e.id) … OFFSET/LIMIT` → `v_page_ids` |
| Actividad Mesa | `LEFT JOIN LATERAL` action_log whitelist sobre `unnest(v_page_ids)` |
| Correcciones | `LEFT JOIN LATERAL` docs/datos/retención sobre page ids |
| Rechazos | `LEFT JOIN LATERAL` `expediente_rechazos_operativos` sobre page ids |
| Bookings | `LEFT JOIN LATERAL` agenda sobre page ids |
| Resultado | `jsonb_agg(to_jsonb(t) …)` sin `asesor_email` |

### EXPLAIN (DB aislada, 30 expedientes / timeline denso)

| Caso | Execution |
|---|---|
| listado sin filtros | ~15.6 ms |
| listado asesor | ~11.6 ms |
| listado etapa | ~8.8 ms |
| asesor + etapa | ~7.8 ms |
| búsqueda | ~8.6 ms |
| página alta | ~7.0 ms |
| timeline p1 | ~0.6 ms |
| timeline p2 | ~0.3 ms |

Arquitectura page-first confirmada; costos estables en fixture. Cloud sigue bloqueado hasta autorización explícita post-§21.

## 2026-07-17 - P085 §16 sanitización / privacidad

### Decisión

- Motivos: `trim` + `left(...,500)` + fallback `Sin motivo registrado` (SQL + TS + Excel).
- Timeline summary: allowlist fija de claves; sin payload completo; sin `actor_role`/`actor_id`.
- Etiquetas: códigos desconocidos → `Actividad` (no exponer clave técnica).
- UI: texto React normal; sin `dangerouslySetInnerHTML`.
- UUID asesor: `formatAsesorExpedienteLabel` ya enmascara a `—`.
- `expediente_id` solo interno para RPC timeline; no Excel.

## 2026-07-17 - P085 §7–§12: whitelist, situación, correcciones por elemento

### Decisión

- Última actividad Mesa / actor «Mesa» **solo** por código de acción de flujo Mesa (nunca `actor_role` ni rol actual del actor).
- Situación ≠ etapa: se muestran por separado; prioridad rechazo → reingreso → corrección abierta → reenviada → cita cancelada → etapa/booking → cerrado.
- Correcciones por elemento (doc/sección); casos A–F + unicidad 1 fila en `supabase/tests/admin_mesa_correcciones_por_elemento.sql`.
- Rechazo operativo exclusivo de `expediente_rechazos_operativos`; motivo `Sin motivo registrado` si vacío.
- Etapa 12 → situación `Pago a ConCasa` (no confundir con cerrado de ciclo).
- Sin Cloud/commit/push/deploy.

### Whitelist de eventos (implementada)

| Evento interno | Etiqueta visible | Actor general | Resumen listado | Timeline |
|---|---|---|---|---|
| `documento.revision.update` | Revisión documental Mesa | Mesa | Última act. Mesa | Sí |
| `cliente_datos.revision.update` | Revisión de datos generales Mesa | Mesa | Última act. Mesa | Sí |
| `expediente.avanzar_etapa_operativa` | Avance de etapa | Mesa | Última act. Mesa | Sí |
| `mesa.expediente.mover_etapa` | Movimiento manual de etapa | Mesa | Última act. Mesa | Sí |
| `mesa.expediente.take` | Mesa tomó el expediente | Mesa | Última act. Mesa | Sí |
| `mesa.expediente.release` | Mesa liberó el expediente | Mesa | Última act. Mesa | Sí |
| `expediente.documento.mesa_register` | Mesa registró documento | Mesa | Última act. Mesa | Sí |
| `expediente.rechazo_operativo` | Rechazo operativo | Mesa | Última act. Mesa | Sí |
| `agenda.biometricos.mesa_reagendar` | Mesa reagendó biométricos | Mesa | Última act. Mesa | Sí |
| `agenda.notificacion.mesa_reagendar` | Mesa reagendó notificación | Mesa | Última act. Mesa | Sí |
| `agenda.firmas.mesa_book` | Mesa agendó firma | Mesa | Última act. Mesa | Sí |
| `agenda.firmas.mesa_reagendar` | Mesa reagendó firma | Mesa | Última act. Mesa | Sí |
| `agenda.firmas.mesa_cancel` | Mesa canceló firma | Mesa | Última act. Mesa | Sí |
| `agenda.drive_validation.set` | Validado en Drive | Mesa | Última act. Mesa | Sí |
| `agenda.drive_validation.clear` | Validación Drive quitada | Mesa | Última act. Mesa | Sí |
| `expediente.enviar_a_mesa` | Enviado a Mesa | Asesor | No (no es act. Mesa) | Sí |
| `expediente.documento.asesor_correccion` | Asesor reenvió documento | Asesor | Correcciones reenviadas | Sí |
| `cliente_datos.correccion_post_mesa` | Asesor corrigió datos generales | Asesor | Correcciones reenviadas | Sí |
| `expediente.enviar_retencion_mesa` | Envío de retención a Mesa | Asesor | Correcciones / Acuse | Sí |
| `expediente.reingreso.crear` | Reingreso creado | Asesor | Reingreso activo | Sí |
| `expediente.reingreso.cerrar_anterior` | Ciclo anterior cerrado por reingreso | Asesor | Reingreso | Sí |
| `agenda.biometricos.book` | Cita biométricos agendada | Asesor | Situación por booking | Sí |
| `agenda.biometricos.cancel` | Cita biométricos cancelada | Asesor | Situación cancelada | Sí |
| `agenda.biometricos.reagendar` | Cita biométricos reagendada | Asesor | Situación booking | Sí |
| `agenda.firmas.book` | Cita de firma agendada | Asesor | Situación booking | Sí |
| `agenda.firmas.cancel` | Cita de firma cancelada | Asesor | Situación cancelada | Sí |
| `agenda.firmas.reagendar` | Cita de firma reagendada | Asesor | Situación booking | Sí |

Excluidos a propósito: login, autosave, updates genéricos, cambio de monto, notas, cargas irrelevantes, payload completo.

### Matriz de situación (prioridad)

| Prioridad | Situación visible | Fuente | Espera desde |
|---:|---|---|---|
| 1 | Rechazado operativamente | `expediente_rechazos_operativos` + `subestado=rechazado` | — |
| 2 | En reingreso | `reingreso_rechazo_id` | — |
| 3 | Corrección pendiente del asesor | docs `rechazado` / datos / retención `correccion_requerida` | min revisión/rechazo del elemento |
| 4 | Corrección reenviada; esperando Mesa | docs `resubido` / datos post-envío / retención `enviado`+`is_resend` | max evento canónico del elemento |
| 5 | Cita biométrica/firma cancelada; requiere reagenda | bookings cancelled sin booked | — |
| 6 | Situación por etapa/subestado/booking | `etapa_actual` + bookings | `fecha_envio_mesa` si en revisión Mesa |
| 7 | Cerrado | `ciclo_estado` cerrado/cancelado | — |

### Matriz siguiente acción (RPC)

| Situación | Siguiente acción | Actor esperado | Fuente del permiso |
|---|---|---|---|
| Corrección pendiente del asesor | Corregir y reenviar | Asesor | corrección post-mesa / upload |
| Corrección reenviada; esperando Mesa | Revisar corrección | Mesa | `documento.revision.update` / datos |
| En revisión de Mesa | Validar integración | Mesa | revisión / `avanzar_etapa_operativa` |
| Listo para cita de biométrico | Agendar biométricos | Asesor | `book_biometricos` |
| Cita biométrica cancelada | Reagendar biométricos | Asesor | `book_biometricos` / reagendar |
| Pendiente de Acuse | Cargar y enviar Acuse | Asesor | `enviar_retencion_mesa` |
| Listo para agendar firma | Agendar firma | Mesa | `mesa_book_firmas` (+ `book_firmas` asesor) |
| Firma cancelada | Reagendar firma | Asesor | `book_firmas` post-cancel |
| Firma agendada | Realizar o registrar firma | Mesa | `avanzar_etapa_operativa` |
| Rechazado operativamente | Revisar reingreso | Asesor | `iniciar_reingreso_post_biometricos` |
| Resto | Continuar etapa actual | Mesa | etapa canónica |

## 2026-07-17 - P085 seguimiento: timeline bajo demanda

### Decisión

- `admin_list_mesa_envios_page` **ya no** embebe `timeline` por fila (solo resumen).
- Nueva RPC RO `admin_get_expediente_mesa_timeline(p_expediente_id, p_limit, p_offset)`.
- UI: botón «Ver seguimiento» → diálogo con carga bajo demanda, Escape, restauración de foco.
- SHA migración 085 recalculado tras el cambio.

## 2026-07-17 - P085 seguimiento transparente Mesa (ampliación)

### Auditoría canónica (fuentes)

| Señal | Fuente |
|---|---|
| Envío a Mesa | `expedientes.fecha_envio_mesa` (+ `expediente.enviar_a_mesa`) |
| Etapa / situación | `etapa_actual` + `situacion_*` (separados) |
| Última actividad Mesa | whitelist de `action` (flujo Mesa) — **no** rol ni `updated_at` |
| Corrección por elemento | docs `rechazado`/`resubido`; `cliente_datos`; `retencion_envios` |
| Rechazo operativo | solo `expediente_rechazos_operativos` |
| Reingreso | `reingreso_rechazo_id` |
| Siguiente acción | CASE por `situacion_code` |
| Timeline | RPC bajo demanda, payload redactado |

### Decisión

- Ampliada migración `085_…sql` (sin P086): redefine `admin_list_mesa_envios_page` con campos de seguimiento.
- UI/Excel Admin solo lectura; sin mutaciones.

## 2026-07-17 - P085 filtros globales + navegación por etapa (parcial)

### Auditoría filtro asesor

| Sección | Recibe asesor_id | Lo aplica | Problema |
|---|---|---|---|
| KPIs | sí → `admin_get_production_summary` | sí | OK |
| Etapas actuales | sí → `admin_get_mesa_cohort_by_etapa` | sí | OK |
| Producción por asesor | **antes NO** | **antes NO** | RPC sin `p_asesor_id`; UI listaba todos |
| Expedientes enviados | sí | sí | OK |
| Precalificaciones | sí | sí | OK |
| Excel | vía `listByAsesor` | heredaba bug | exportaba todos los asesores |

### Decisión

- Migración nueva `085_admin_list_production_by_asesor_filter.sql` (no toca 070–084): DROP firma 3-args + CREATE con `p_asesor_id UUID DEFAULT NULL`.
- Repo TS pasa `p_asesor_id`; mock filtra por UUID.
- UI: opciones del select desde lista sin filtro; tabla/Excel con filtro; tarjetas etapa = `<button aria-pressed>`; scroll/foco a `#admin-mesa-expedientes`; ocultar producción por asesor con etapa activa.
- **Pendiente:** columnas de seguimiento Mesa (última actividad real, correcciones, tiempos, motivo rechazo, siguiente acción) — el prompt llegó truncado tras el bloque de scroll; no inventar contrato SQL/UI.

## 2026-07-17 - P084 reparación snapshots monto + KPI responsive

### Causa

- SUM Admin correcto; 3 snaps Mejoravit > $100M por 1ª aprobación tipográfica + bounce a pendiente (~2s).
- **Reparables:** 2 con re-aprobación válida → reemplazar snap por `monto_nuevo` de re-aprobación.
- **No recuperable:** 1 sin re-aprobación → `monto_aprobado_al_aprobar=NULL` + `monto_aprobado_snapshot_no_recuperable=true` (conserva `aprobado_at`; CHECK P081 ampliado en P084).
- Cloud RO confirmó: 1 sola aprobación, bounce→pendiente→no_cumple, 0 montos razonables en action_log, actual null.
- Precondición migración: 0 (noop) o exactamente **3** (2+1).
- Trigger `editor_decisions_clear_no_recuperable`: solo `true→false` si monto > 0.
- SHA final: `33158391de8d90d39025d8627b560853cac725efb8afad6be008110ae14a1cf2` (reemplaza `1699496e…`).
- Sin máximo oficial de `monto_aprobado`.

### Rango monto aprobado

- Contrato vigente escritura: `> 0`, `NUMERIC(14,2)`, round 2.
- `169000` = tope de **base cobro** Mejoravit (−11%), **no** máximo de `monto_aprobado`.
- Sin máximo canónico comprobable para aprobación → no se inventa validación max.

### Observado Cloud (Mejoravit snaps >0)

- n≈997; p50≈33.6k; p99≈302k; gt_169k=40; gt_1m=4; gt_100m=3.

## 2026-07-17 - P083 cierre: preservación updated_at + publicación

### Backfill Cloud

- Universo: **595** filas con `no_cumple_at` (594 actuales + 1 hoy aprobada).
- DISABLE/ENABLE solo `editor_decisions_set_updated_at` (transaccional); trigger post=`O`.
- Prueba de ventana apply: **0/595** filas con `updated_at` en [19:33,19:34Z]; checksum global pre/post difiere por tráfico concurrente (2 filas ajenas en ventana), no por el backfill.
- Apply: `2026-07-17T19:33:47Z` → `19:33:52Z`, exit 0, proyecto `fvtqbxukqlajezyyvwzy`.

### SHA

- `06024c6aa2b59e20b7288c05a517c83a3b2f23cb6bd15a161b63c6bf6a3665d0` (invalidó `5258f2d5…`).

## 2026-07-17 - P083 canónico: no_cumple_at (pre-Cloud)

### Auditoría Cloud RO (agregados)

- Actuales `no_cumple`: **594**
- Eventos `decision_nueva=no_cumple`: **707**
- Transiciones confiables: **599** (595 expedientes únicos)
- Actuales con ≥1 transición: **594** (100%)
- Sin evidencia recuperable: **0**
- Varias transiciones: **4**
- Huérfanos: **0**
- `updated_at` > último evento decisión: **9** (confirma que updated_at no es canónico)
- Payload distingue anterior/nueva: **100%**
- Rango transiciones: 2026-07-03 → 2026-07-17 UTC

### Decisión UX

- Filtro default **Resueltas** (más coherente que “Todas” mezclando pendientes sin fecha de producción).
- Pendientes: etiqueta «Pendiente actual»; no usan `updated_at` como día de producción.

### No hecho

- Aplicar 083 en Cloud / commit / push / deploy / smoke.

## 2026-07-17 - P083 ampliado: Precal diarias + KPI Mejoravit

### Producto

- Default periodo UI: `Hoy`.
- Tabla Precalificaciones: todas las decisiones del periodo (`aprobado` / `no_cumple` / `pendiente`) con paginación real.
- Fecha de inclusión: `aprobado_at` si aprobado; `updated_at` si No cumple/Pendiente.
- Resumen en 6 chips (no línea comprimida).
- KPI superior + monto por asesor: solo Mejoravit aprobado (`monto_aprobado_al_aprobar`).

### No hecho

- Aplicar `083` en Cloud / commit / push / deploy.

## 2026-07-17 - Admin Precalificaciones: contraste + Total Mejoravit

### Causa texto claro

- En `src/app/admin/page.tsx` el bloque usaba `text-slate-500` / `text-slate-600` / `text-xs` en resumen, encabezados y pie; celdas sin color explícito. Sin opacity padre; no era `disabled` en el select (ya `text-gray-900` en `Select`).

### Causa Total incorrecto

- `admin_list_precalificaciones_page` (082) y mock sumaban `monto_aprobado_al_aprobar` de **todos** los programas del set filtrado.
- Ajuste: Total/Promedio solo `decision=aprobado` + `programa` normalizado `mejoravit`; `>$20k` sin cambio de regla.

### No hecho

- Aplicar `083` en Cloud / commit / push / deploy.

## 2026-07-17 - P081/P082 aplicados en Cloud (Admin producción)

### Preflight

- Semántica backfill: primera transición a `aprobado` **sin** filtrar `decision` actual; conserva histórico si hoy es `no_cumple`/`pendiente`.
- SHA-256 081: `ae74f5e1e1cbca7ce5f576277c962711ce43d47bd21ff855409e89f38b1eb990`
- SHA-256 082: `67097420f5e0ba4f821090882ea503f77244164c22acd8548445e9523b7c288d`
- Cohortes RO: actualmente aprobadas 1034; alguna vez 1049; hoy no aprobadas con historial 2; varias transiciones 8; sin monto 0; sin evento 0.

### Aplicación

- 081 y 082 vía `supabase db query --linked` (proyecto `fvtqbxukqlajezyyvwzy`).
- Backfill: **1036** snapshots (1049 − 13 eventos huérfanos sin fila `editor_decisions`).
- Post: columnas/constraint/índices OK; aprobadas sin snapshot 0; pares incompletos 0; RPCs Admin presentes; `__admin_require_super_admin` sin EXECUTE a authenticated; RPCs públicas con EXECUTE authenticated (service_role por default ACL Cloud, gate de rol en cuerpo).

### No hecho

- commit / push / deploy / smoke UI.

## 2026-07-17 - feat/admin-production-dashboard (P081/P082, local)

### Auditoría Cloud RO (agregados, sin PII)

- `editor_decisions`: 1645 filas; 1034 `decision=aprobado`.
- Eventos `editor.decision.upsert` con `decision_nueva=aprobado`: 1079; transiciones confiables: 1057.
- Aprobadas con ≥1 evento: 1034; sin evento utilizable: **0**.
- Eventos con `monto_nuevo` válido >0: 1079; inválidos: 0.
- Varios eventos de aprobación: 13; varias transiciones: 7.
- Payload distingue `decision_anterior` / `decision_nueva` / `monto_nuevo`.
- Rango eventos: 2026-06-22 → 2026-07-17 (UTC).

### Decisiones de producto

- C + M1: `aprobado_at` = primera transición a `aprobado`; `monto_aprobado_al_aprobar` snapshot inmutable.
- Métricas periodo: `aprobado_at` + `monto_aprobado_al_aprobar` (`> 20000` estricto).
- Envíos Mesa: `fecha_envio_mesa`.
- TZ: `America/Monterrey`.
- Etiquetas etapa: `ETAPAS_OPERATIVAS_ASESOR` (canónicas).
- Admin observador: sin acciones de mutación; sin enlace a `/admin/[id]` mock.
- Nombre admin: email temporal (helper `full_name` pendiente en otra rama).

### SQL

- `081_admin_production_canonical_approval.sql`: columnas, constraint, índices, upsert ambos caminos, backfill, ACL.
- `082_admin_production_dashboard_rpcs.sql`: RPCs RO solo `super_admin`.
- Test SQL `rpc_p081_canonical_approval.sql`.
- **No aplicadas en Cloud.**

### Frontend

- Dominio `src/domain/admin-production/*` + Excel `exportAdminProductionExcel.ts`.
- `/admin` reconstruido; paginación real vía RPC (mock pagina en memoria sobre listado admin).

## 2026-07-17 - feat/retencion-envio-auto-firma (P079, local)

### Causa

- Tras enviar el Acuse, Mesa seguía exigiendo validación documental (`validado`) en el gate 8→9; el envío no avanzaba etapa y bloqueaba agendar firma.

### Decisiones

- `enviar_retencion_mesa` (misma firma/ACL/SECURITY DEFINER/`search_path`) registra envío + `UPDATE` atómico 8→9; no toca estatus documental; no crea booking/`fecha_cita`.
- Idempotencia: reintento en etapa 9 + enviado → OK sin mutar ni avanzar a 10.
- Gate `avanzar_etapa_operativa_pre_reingreso` 8→9 acepta principal `subido|resubido|validado`.
- UI: Mesa deja de exponer Validar/corrección del Acuse (`mesaPuedeRevisarRetencionDocumentos` → false); asesor copy «listo para agendar firma» + refetch canónico.
- P080 backfill Cohorte A preparado en `080_…sql` + rollback condicional en `scripts/rollback/`; no aplicado en Cloud.
- Snapshots pre-P079 en `scripts/rollback/p079_pre_*.sql`.

### Verificación

- Runner aislado + npm test/lint/typecheck/build (ver reporte entrega).
- Cloud RO cohortes A/B/C/D sin PII; sin mutación Cloud/commit/push/deploy.

## 2026-07-17 - feat/login-alias-asesor-mejoravit (local)

### Causa

- Se necesita un login corto `asesor.mejoravit` sin abrir un sistema general de usernames, vinculando un Auth user ya creado al perfil CRM.

### Auditoría

- `public.profiles` es la fuente de rol (`app_role`), org (`organization_id`) y `active`; no hay `handle_new_user` ni alta automática de perfil.
- Cloud: el UID `6e48ff6b-…` y el email interno no tenían fila en `profiles`.
- Org única piloto: `ConCasa` / slug `concasa` / `50beae49-…` (23 asesores activos; mayoría `tipo_asesor_origen=interno`).

### Decisiones

- Helper puro `normalizeLoginIdentifier`: trim + lowercase; alias exacto `asesor.mejoravit` → email interno; `@` = correo normal; resto sin `@` se rechaza.
- Integración solo en `SupabaseSessionRepo.login` + label/input del formulario (`type=text` para permitir username).
- Perfil vía migración `078` (INSERT `profiles`, no `auth.users`, no `user_metadata`); rol `asesor`, activo, org ConCasa, origen `interno`.
- `078` endurecida: verifica Auth UID/email, org ConCasa, no-op si perfil idéntico, error si incompatible; sin `ON CONFLICT DO UPDATE`.
- Origen `interno`: sin metadata Auth de origen; dominio técnico `@usuarios.concasa.mx`; sin evidencia de `externo`; resultado pedido explícito.

### Verificación

- Tests del helper; lint/typecheck/npm test.
- Cloud (2026-07-17): `078` aplicada en proyecto linked `fvtqbxukqlajezyyvwzy` (ConCasa CRM); perfil verificado.
- Publicación: un commit + push + deploy frontend; sin reaplicar 078; sin smoke automatizado.

## 2026-07-16 - fix/retencion-solo-documento-principal (P077, local)

### Causa

- El bloque Acuse/Aviso exigía 4 documentos por opción (acuse/carta + aviso + INE frente/reverso), aunque el flujo operativo solo necesita el documento principal.

### Decisiones

- Fuente de verdad TS: `tiposRequeridosRetencion` → 1 tipo por opción; uploads asesor/Mesa y gates 8→9 consumen esa lista.
- Catálogo: aviso/INE → `opcional` (históricos intactos; upload SQL `retencion_doc_tipos_asesor_upload` sin cambio).
- SQL: migración `077` redefine `retencion_doc_tipos_requeridos` (consumida por `enviar_retencion_mesa` y avance 8→9).
- Sin backfill, sin soft-delete de filas históricas, sin Cloud/commit/push/deploy.

### Verificación

- Tests domain/UI + suite SQL local `rpc_enviar_retencion_mesa` tras aplicar 077; lint/typecheck/npm test.

## 2026-07-16 - fix/asesor-retencion-enviar-mesa-ux (botón Enviar a Mesa Control, local)

### Causa

- El botón de envío se ocultaba cuando faltaban documentos (`panel.puedeEnviarAMesa ? … : null`), así que el asesor no veía qué faltaba para habilitarlo.
- `deriveRetencionAcuseAvisoFaltantes` contaba cualquier fila con `id` (incl. `rechazado`) como presente; el RPC `enviar_retencion_mesa` exige `subido|resubido|validado`.
- Tras el último upload, el refetch de `archivosResumen` era fire-and-forget; el botón no se recalculaba de forma fiable sin recarga manual.

### Decisiones

- Botón siempre visible en `no_enviado` / `correccion_requerida`; deshabilitado con copy canónico (opción / ambigüedad / lista de faltantes). Labels: «Enviar a Mesa Control» / «Reenviar a Mesa Control».
- Predicado único `retencionDocListoParaEnvioMesa` alimenta faltantes, habilitación y tests (espejo del RPC).
- Ambigüedad A+B sin radio/DB explícitos bloquea envío; con selección explícita se permite si los docs de esa opción están listos.
- `onUpdated` async: tras upload/envío se espera `listResumenByExpediente` + meta; si el refetch falla, mensaje stale sin re-subir.
- Sin migración ni cambio de RPC.

### Verificación

- Tests de panel (botón visible/deshabilitado, ambigüedad, rechazado, labels) + faltantes; lint/typecheck/npm test.

## 2026-07-16 - fix/asesor-retencion-pdf-persistencia (Acuse/Aviso etapa 8, local)

### Causa

- `ExpedienteRetencionSupabaseRepo.uploadRetencionDocumento` enviaba `params.file.type` crudo a Storage y a `register_expediente_documento_retencion`. La UI aceptaba PDF por extensión (`validatePdfFile` / `isPdfLikeFile`), pero un MIME vacío o `application/octet-stream` hacía fallar el bucket o el gate SQL `expediente_documento_mime_permitido`; el catch borraba el objeto de Storage y el documento no quedaba en `expediente_documentos`. El nombre podía verse un instante si el refresh parcial o el picker mostraba el archivo local antes del fallo / al recuperar un intento previo.
- La opción A/B vivía solo en estado React (`opcionDraft`) hasta `enviar_retencion_mesa`. Tras recargar, `opcionPanel` quedaba `null` y la lista de uploads desaparecía aunque los PDF ya estuvieran persistidos.
- `retencionDocPuedeReemplazarAsesor` bloqueaba `subido` siempre y la UI decía «En revisión por Mesa» antes del envío, contradiciendo el RPC (solo bloquea `validado`).

### Decisiones

- Reutilizar `resolveExpedienteDocumentoUploadMime` (igual que integración) y forzar `application/pdf` en path, `contentType` y `p_mime_type`.
- Restaurar opción: `sessionStorage` por expediente + `inferRetencionOpcionFromArchivos` (acuse → A, carta → B) dentro de `deriveAsesorRetencionPanelView`.
- Reemplazo: `no_enviado` permite corregir no-validados; `enviado` congela; `correccion_requerida` solo `rechazado`; `validado` nunca.
- `listByExpediente` añade `.is("deleted_at", null)` de forma explícita (RLS ya lo filtraba).
- Sin migración nueva ni Cloud: el RPC 035 sigue aceptando PDF con el overload MIME de un argumento (default NULL post-047).

### Verificación

- Tests de dominio: inferencia A/B, restauración de panel tras reload, reglas de reemplazo por `uiEstado`; suite completa lint/typecheck/build.

## 2026-07-15 - fix/mesa-bandeja-filtros (filtros Mesa Control + acceso directo a citas, local)

### Causa

- `quickFilter` («Vista rápida») y `mesaOpsFilter` («Asignación operativa») eran estados independientes que se intersectaban en `filteredCasos`; el default de asignación es `sin_asignar` («Disponibles»), así que pulsar `En proceso (84)` mostraba `en_proceso ∩ Disponibles` (menos resultados o vacío) mientras el contador se calculaba globalmente sobre `casos`. La misma intersección oculta explicaba que búsqueda/etapa/subestado «no funcionaran»: sí filtraban, pero sobre la lista ya recortada por «Disponibles».
- La búsqueda de teléfono usaba `telefono_cliente.includes(q)` sin normalizar dígitos: «81 1234 5678» no encontraba «8112345678».
- El chip «Citas hoy» filtraba la bandeja en lugar de abrir la pantalla de citas existente.
- No hay paginación en esta bandeja: `listForMesaControl()` trae el conjunto completo visible (RLS + `submitted_to_mesa` + ciclo activo) y todo se filtra en memoria; el contador «N casos» sale de la misma lista filtrada, por lo que no existía un bug de «filtrar después de paginar».

### Decisiones

- Predicados y transiciones centralizados en `src/lib/mesaBandejaFiltros.ts`: `matchesMesaQuickFilter`/`contarVistaRapida` (misma definición para contador y lista), `seleccionarVistaRapida` (fuerza `todo_mesa`), `seleccionarAsignacion` (regresa vista rápida a `todos`), `coincideBusquedaClienteTelefono` (nombre case-insensitive + teléfono por dígitos), `esCitaHoy`/`toYMDLocal` (día calendario local; fechas `YYYY-MM-DD` no se corren por timezone) y `aplicarFiltrosBandejaMesa` (orden: vista rápida → búsqueda → etapa → subestado → citas hoy).
- Los filtros adicionales (búsqueda/etapa/subestado/citas hoy) se conservan al cambiar de chip porque son visibles en pantalla; solo «Limpiar filtros» los restablece. Al limpiar, la asignación queda en `todo_mesa` (no en el default «Disponibles») para que la limpieza muestre el conjunto completo.
- «Citas hoy» dejó de ser filtro: `MesaQuickFilter` ya no incluye `citas_hoy` y el chip hace `router.push("/mesa-control/citas")` (constante `MESA_CITAS_ROUTE`, la misma ruta del botón «Ver citas»). El checkbox «Solo citas de hoy» se mantiene para refinar la bandeja por `fecha_cita`.
- No se agregó debounce ni protección de respuestas obsoletas a la búsqueda: es 100 % en memoria sobre la lista ya cargada (no dispara consultas por tecla), y no hay parámetros de URL en esta pantalla (patrón inexistente; no se amplió el alcance). Sin cambios en repos/SQL: la visibilidad sigue viniendo de RLS + `filterExpedientesByRole` (modo mock).
- Estado vacío: «No hay expedientes que coincidan con los filtros seleccionados.» + botón «Limpiar filtros» (solo si hay filtros activos); se conservan los mensajes específicos de «Disponibles»/«En espera de asesor».

### Verificación local

- `src/lib/mesaBandejaFiltros.test.ts` (22 casos): exclusividad de selección principal, coherencia contador/lista por chip, búsqueda nombre/teléfono con y sin espacios, cadena vacía sin filtro, filtros sobre el conjunto completo (no una página), etapa/subestado/combinados, citas hoy local e ISO, limpiar filtros. `npm test`, lint, typecheck y build en verde; sin cambios SQL ni Cloud.

## 2026-07-15 - fix/mesa-movimiento-manual-pendiente (P076, corrección urgente local)

### Causa

- El panel `MesaControlManualEtapaSection` retornaba `null` cuando `puedeMostrarControlManualMesa` era `false`; ese helper exigía `subestado ∈ {en_validacion_mesa, en_proceso}`, por lo que un expediente enviado a Mesa con `subestado='pendiente'` no mostraba ningún control manual (desaparecía silenciosamente). SQL 074 tenía el mismo gate (`MESA_MOVE_BAD_SUBSTATE` para `pendiente`), es decir frontend y SQL estaban alineados entre sí pero ambos excluían `pendiente`.

### Decisiones

- Las migraciones publicadas 001–075 no se editan: el cambio SQL va en la migración nueva `076_mesa_mover_etapa_allow_pending.sql`, que redefine únicamente `mesa_mover_etapa_operativa(uuid, smallint, smallint, text)` agregando `'pendiente'` al gate de subestado (diff verificado contra 074: una línea + comentario). Firma, `SECURITY DEFINER`, `search_path=''`, `FOR UPDATE`, auditoría, `action_log` y ACL idénticos; `rechazado`, `aprobado`, ciclos no activos, eliminados, no enviados y no visibles siguen bloqueados.
- Nuevo helper de dominio `getMesaControlManualEstado` devuelve `{visible, habilitado, razon}`: el panel se oculta solo para roles sin permiso (asesor/editor); para roles Mesa/super_admin siempre se renderiza y, si el expediente no es elegible, se deshabilita mostrando la razón exacta. `puedeMostrarControlManualMesa` se reimplementa encima y ahora incluye `pendiente`.
- El panel se renombró «Movimiento manual de Mesa», se movió después de los bloques «Decisión Mesa» y antes de «Seguimiento operativo», y los bloques de avance normal muestran (solo cuando hay bloqueos y el movimiento manual está habilitado) el atajo «También puedes usar el movimiento manual de Mesa para continuar sin cita.» con scroll al ancla `#mesa-movimiento-manual`. El bloque normal y sus gates quedan intactos.
- Destino 1 sigue derivando `en_validacion_mesa` y 2–12 `en_proceso`, de modo que un `pendiente` movido queda normalizado.

### Verificación local

- Suite SQL `rpc_mesa_mover_etapa_operativa.sql` ampliada: pendiente→5 queda `en_proceso` sin cita/booking/documentos; pendiente→1 queda `en_validacion_mesa`; el movimiento registra actor y subestados; los casos bloqueados y la preservación de datos relacionados se mantienen. Runner aislado aplica 001–076 (omite 061) con regresión completa; frontend con `npm test`, lint, typecheck y build.

## 2026-07-15 - feat/mesa-libertad-operativa (P074/P075, Fase C local)

### Decisiones

- El movimiento manual es una RPC separada; nunca llama ni relaja `avanzar_etapa_operativa`. Solo actualiza `etapa_actual`, `subestado` derivado y `updated_at`.
- `p_etapa_esperada` es obligatorio y se valida bajo `SELECT … FOR UPDATE`; una pantalla obsoleta recibe `MESA_MOVE_STAGE_CONFLICT`.
- El historial especializado `expediente_movimientos_mesa` es append-only, sin PII, con FKs `RESTRICT`, lectura RLS por `can_see_expediente` y escritura únicamente desde la RPC `SECURITY DEFINER`.
- Etapa 1 deriva `en_validacion_mesa`; etapas 2–12 derivan `en_proceso`. Entrar a 11/12 no firma, paga, aprueba ni cierra.
- La firma propuesta necesitó `p_location_id`: `agenda_bookings.location_id` es obligatorio y el cupo se calcula por sede. Se conserva además `p_timezone`, que debe coincidir con `agenda_config`.
- No se amplían `book_firmas`/`reagendar_firmas` del asesor. P075 crea RPCs Mesa para los cuatro roles. Se agregó `mesa_cancel_firmas` porque `cancel_firmas` compartida bloquea fuera de 9/10, pero el producto exige cancelación explícita de un booking conservado tras un movimiento manual.
- `mesa_cancel_firmas` no cambia etapa y solo limpia `fecha_cita` si no queda otro booking activo del expediente.

### Fase C.1 — preflight final (2026-07-15)

- El runner aislado ahora ejecuta la regresión SQL completa (`scripts/test-sql.sh`) sobre el seed limpio en lugar de una lista parcial duplicada: las suites no son re-ejecutables entre sí porque mutan datos del seed. Además captura md5 de `avanzar_etapa_operativa`, `book_firmas`, `reagendar_firmas`, `cancel_firmas` y `convert_biometricos_to_notificacion` antes y después de aplicar 074/075 y falla si cambian (quedaron idénticos).
- Dos fallos preexistentes de fixtures se reprodujeron en baseline 001–073 (sin 074/075) y se corrigieron solo en tests, sin tocar migraciones ni expectativas: `rpc_get_asesor_agenda_calendar.sql` insertaba expedientes sin `origen_mesa` (NOT NULL desde 001; se agrega parámetro explícito interno/externo según el asesor del seed) y `rpc_get_mesa_agenda_bookings.sql` usaba `ON CONFLICT (slug)` para una org cuyo id ya existía con otro slug y reutilizaba el NSS `90701000001` ya ocupado por la suite de avanzar (se cambia a `ON CONFLICT (id)` y NSS `90751000001`). Ambos tests pasan en baseline y con 074/075.

### Verificación local

- Runner aislado aplica 001–075, omite únicamente 061 conforme al preflight existente y ejecuta la regresión SQL completa (RLS, P070/P071/P072, 074/075, agenda, documentos, editor, retención y avances normales) en verde.
- P074 prueba roles/origen/org, estados excluidos, concurrencia, rollback forzado, inmutabilidad y preservación de datos relacionados.
- P075 prueba alta/reagenda/cancelación, etapas 9/10, conservación al mover, cancelación fuera de etapa y regresión de `book_firmas` original.
- UI valida con Zod entradas/respuestas, bloquea doble clic durante `saving`, refresca en conflicto y muestra advertencias no bloqueantes.

## 2026-07-15 - fix/reingreso-internas-acl (P073, Fase D.2)

- 071/072 aplicadas en Cloud (Fase D.1) con hashes intactos; los default ACL de Cloud (`ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO service_role`) dejaron `service_role=X` en las 3 internas de reingreso porque 072 solo revocaba `PUBLIC/anon/authenticated` ahí.
- Regla: cualquier corrección post-aplicación va en migración nueva; 073 contiene solo 3 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` con firmas exactas (`UUID`, `()`, `UUID, UUID`). Sin cambios de cuerpo/firma/SECURITY DEFINER/RLS.
- Runner aislado ampliado con probe de internas (`anon/auth/service=false`, `postgres=true`); 72 migraciones aplicadas (061 omitida), todas las suites verdes.
- Post-073 en Cloud: internas cerradas para roles de aplicación; públicas, respaldos `*_pre_reingreso` y P070 intactos; conteos sin mutación (delta natural por uso real del CRM entre D.1 y D.2: +1 booking, +1 cliente_datos, +4 documentos).

## 2026-07-15 - feat/reingreso-post-biometricos (P071/P072, Fase C local)

### Preflight seguridad `*_pre_reingreso` (antes de Cloud)

- Riesgo: al renombrar, PostgreSQL conserva ACLs. Si `authenticated`/`service_role` conservaran `EXECUTE` sobre `*_pre_reingreso`, podrían saltar gates de monto/documentos del hijo.
- Hallazgo local (antes de refuerzo de texto): `proacl={postgres=X/postgres}` y `has_function_privilege(...)=false` para anon/authenticated/service_role — el riesgo no estaba activo en la DB ya aplicada, pero 072 solo revocaba `PUBLIC, anon, authenticated` y **omitía `service_role`**.
- Corrección en 072: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` en las tres firmas de respaldo.
- No existe `expediente_documento_storage_asesor_post_mesa_upload_allowed_pre_reingreso` (072 hace `CREATE OR REPLACE` in-place).
- Pruebas nuevas: llamadas directas authenticated a `avanzar/upsert/register_*_pre_reingreso` fallan por `insufficient_privilege`; tras gates válidos la pública `avanzar_etapa_operativa` sí avanza 6→7.
- Runner aislado `scripts/preflight-reingreso-isolated.sh`: DB descartable, omite 061, aplica 001–070+071+072, seed limpio (4 expedientes), RLS PASS, suites P070/071/072/Storage/editor/avance PASS; destruye la DB.

### Decisión

- Un ciclo operativo = un expediente. El reingreso crea hijo enlazado (`expediente_anterior_id` + `reingreso_rechazo_id`) y cierra sólo `ciclo_estado` del padre.
- FK compuesta `(reingreso_rechazo_id, expediente_anterior_id) → expediente_rechazos_operativos(id, expediente_id)` garantiza pertenencia del rechazo al padre.
- Índice de hijo activo acotado a reingresos reales (`expediente_anterior_id` y `reingreso_rechazo_id` no nulos).
- Condiciones `reutilizables|repetir|invalidos` exigen booking + razón. Bookings futuros `booked` bloquean; bookings históricos no se mutan.
- Elegibilidad e inicio comparten `reingreso_post_biometricos_elegibilidad_interna` (sin EXECUTE al cliente).
- Excepciones 072 se activan solo con el conjunto completo de señales de reingreso válido.

### Matriz exacta `cliente_datos` del hijo

Copian (precarga editable):

- JSON `datos`: `nombreCliente`, `nss`, `curp`, `rfc`, `celular`, `telefono`, `correo`, `empresa`, `registroPatronal`, `telefonoEmpresa`, `referencias`, `beneficiario`, `direccionEmpresa`, `plazo`, `notaMesa`.
- Columnas: `referencias`, `imagenes`, `porcentaje_cobro`, `metodo_pago`.
- `estado='completo'` solo si el padre no estaba `pendiente` (significa capturado, no aprobado por Mesa).

Reinician:

- `validated_at`, `validated_by`, `rejected_at`, `rejected_by`, `comentario_rechazo`.
- `telefono_normalizado = NULL` (evita choque con índice único/migración 061 rota).
- `monto_calculado = NULL`.
- JSON eliminado explícitamente del payload copiado: `montoMejoravit` / `monto_mejoravit`, `montoCalculado` / `monto_calculado`, y cualquier clave fuera del modelo.
- `editor_decisions` del hijo nace `pendiente` / monto `NULL`.

Recalculan:

- Tras `upsert_editor_decision` aprobado en el hijo: fórmula productiva base Mejoravit `least(monto*0.89, 169000)` o monto directo; luego `round(base * porcentaje_cobro / 100 + 3000, 2)`.

Plazo:

- Se precarga como valor editable, no como revalidación silenciosa. Mejoravit sigue exigiendo confirmarlo antes de guardar datos del ciclo nuevo; el gate 6→7 no usa el plazo antiguo como aprobación.

### UI

- Asesor: card de elegibilidad/inicio + badges de hijo; dashboard marca reingreso y oculta ciclos `cerrado` fuera del filtro «Todos».
- Mesa: badge genealógico + card de rechazo operativo (sin alterar bookings).
- Editor: etiqueta «Reingreso · revalidar monto». No había guard frontend por `submitted_to_mesa`; la excepción vive en RPC.

## 2026-07-14 - feat/asesor-convert-biometricos-to-notificacion (P070)

### Decisión

- Conversión extraordinaria atómica en RPC (no cancel+book desde frontend).
- Cancel bio + insert notif nueva (no mutar kind); etapa 4→3; legacy etapa 3 + bio booked también permitido (datos Cloud reales).
- Hora fija 12:00 / sin cupo; Mesa sigue aprobando 3→5.
- UI en tarjeta verde de bio activa; una llamada `convertBiometricosToNotificacion`.
- Endurecimiento: tests SQL amplios (auth/estado/Drive/rollback/regresiones); Drive del bio se conserva cancelado; Notificación inicia sin validar Drive; `REVOKE anon`.

## 2026-07-13 - feat/mesa-agenda-drive-validation (P069)

### Decisión

- Validación Drive pertenece a `agenda_bookings.id`, no al expediente: reagenda = nuevo booking sin validar.
- Columnas `drive_validated`, `drive_validated_at`, `drive_validated_by`; RPC única `mesa_set_agenda_drive_validation(p_booking_id, p_validated)`.
- Roles alineados con lectura Mesa (`mesa_*` + `super_admin`). Validar exige `booked`.
- UPDATE solo columnas drive_*; `get_mesa_agenda_bookings` se recrea con return ampliado (DROP+CREATE).
- UI verde + badge + botón Validar/Quitar; sin localStorage.

## 2026-07-13 - feat/mesa-agenda-bookings-read (B6)

### Decisión

- Pulido UI `/mesa-control/citas`: vistas Lista (default), Día y Semana sin cambiar RPC/SQL/permisos.
- Resúmenes, chips de filtros activos, orden cliente-side y historial inferido (`expedienteId + kind`) sobre conjunto filtrado.
- Navegación de fechas por vista; rango RPC sigue máx. 62 días vía `resolveMesaAgendaFetchRange`.
- Badges por tipo/estado/historial; modales con Escape; responsive tabla/cards.

## 2026-07-13 - feat/mesa-agenda-bookings-read (B5.1 revisión)

### Decisión

- `mesa_control_admin` es alias UI de `app_role.mesa_admin` (`mapAppRoleToMockRole`); no existe en enum Postgres.
- Gate reagenda normaliza alias → `mesa_admin` | `super_admin` antes de mostrar botón; RPC 068 sin ampliación.
- `mesa_control` colapsado no autoriza reagenda admin (solo lectura/cancel interno según B4).
- RPC 068: cancel → assert cupo → insert en una transacción; fallo de cupo hace rollback total (test 10).

## 2026-07-13 - feat/mesa-agenda-bookings-read (B5)

### Decisión

- Reagenda admin solo para `mesa_admin`, `mesa_control_admin`, `super_admin` (roles explícitos; sin `mesa_interno`/`externo`).
- Biométricos y notificación: RPC nuevas en `068` (`mesa_reagendar_biometricos`, `mesa_reagendar_notificacion`); firma reutiliza `reagendar_firmas` (ya permite `mesa_admin`/`super_admin`).
- Patrón transaccional: cancel booking activo → insert nuevo `booked`; actualiza `fecha_cita`; no cambia etapa.
- UI: `MesaReagendarCitaDialog` con slot picker bio/firma; notificación solo fecha (12:00 backend).

## 2026-07-13 - feat/mesa-agenda-bookings-read (B4)

### Decisión

- Cancelación desde `/mesa-control/citas` reutiliza repos existentes y RPCs 037/063/066 (sin SQL nuevo).
- Gate por fila: `canMesaCancelAgendaListEntry` → `canMesaShowCancelCitaButton` (mismas reglas que Decisión Mesa).
- Notificación: solo `mesa_admin` / `mesa_control_admin` / `super_admin`; biométricos/firmas: roles Mesa amplios.
- Motivo obligatorio en modal; historial vía RPC (`status=cancelled`, `note`); lista se refresca con `fetchMesaAgendaBookings`.
- Sin reagenda, editar sede ni cambiar fecha en B4.

## 2026-07-13 - feat/mesa-agenda-bookings-read (B3)

### Decisión

- Ruta `/mesa-control/citas` con `MesaAgendaCitasClient` + helpers `mesaAgendaCitasUi`.
- Solo lectura: única acción «Ver expediente» → `/mesa-control/[id]`.
- `kind` e `includeCancelled` al RPC; sede/asesor/búsqueda en cliente sobre el conjunto cargado.
- Sin `MesaCancelarCitaDialog` ni botones de mutación.

## 2026-07-13 - feat/mesa-agenda-bookings-read (B2)

### Decisión

- Dominio en `src/domain/agenda-calendar/`: `mesa.types`, `mesa.mapper`, `mesa.repo`.
- Reutiliza `normalizeBookingDate/Time` y `assertCalendarDateRange` del calendario asesor.
- `fetchMesaAgendaBookings` usa `supabaseBrowser` + JWT; sin service role.
- Objeto anidado `asesor` vs `createdBy` para la futura UI «Ver citas».

## 2026-07-13 - feat/mesa-agenda-bookings-read (B1)

### Decisión

- Nueva RPC `get_mesa_agenda_bookings` (067) en lugar de extender 064: roles mesa_interno/externo, `expediente_id`, PII condicionada y `created_by` requieren contrato distinto.
- Solo lectura; sin tocar RLS, book/cancel/reagendar ni bookings existentes.
- PII (`cliente_nombre`, `nss`) solo cuando `can_see_expediente` (filtro en WHERE + CASE defensivo).

## 2026-07-10 - fix/asesor-chip-biometricos-notificacion

### Diagnóstico

- P065 mantiene el expediente en etapa 3 cuando existe un booking activo `kind=notificacion`; el helper de tareas solo conocía el booking biométrico y por eso lo contaba en «Agendar biométricos».

### Decisión

- El helper del chip exige etapa 3, envío a Mesa, ausencia de booking biométrico activo y ausencia de Notificación activa.
- `/asesor` reutiliza `listActiveNotificacionByExpedienteIds` para candidatos de etapa 3; la consulta usa la sesión JWT y RLS existentes. Sin SQL, RPC ni mutaciones.

## 2026-07-10 - feat/asesor-export-precalificaciones-excel

### Diagnóstico

- Bandeja `/asesor` carga con `repo.listForAsesor(currentUser.email)` → lista completa en `mockPrecalList`; paginación cliente (`PAGE_SIZE=50`) sobre `expedientesFiltrados`.
- Programas DB: `mejoravit`, `compro_tu_casa`, `subcuenta`; UI «Compro tu casa». «Compra de casa» en export = `compro_tu_casa`. «Ambos» = mejoravit + compro_tu_casa (excluye Subcuenta).
- Campos listado: `cliente_nombre`, `nss`, `telefono_cliente`, `programa`, `monto_aprobado` (editor). No hay monto_solicitado/precalificado/mejoravit en el modelo de lista.
- Sin librería Excel previa; se agrega `xlsx` (SheetJS) para `.xlsx` real.

### Decisión

- Helper `exportAsesorPrecalificacionesExcel.ts`; filtro solo por programa; defensa `asesorId === currentUser.email`; sin tocar RLS/RPC.

## 2026-07-10 - fix/mesa-notificacion-extraordinaria-ui

### Decisión

- Notificación **no** va dentro de «Agenda / Citas» ni se resume como biométricos.
- Acordeón propio «Notificación extraordinaria» en detalle; bandeja con bloque ámbar en etapa 3 + booking activo.
- «Agendada por» desde `agenda_bookings.created_by` + `get_asesor_display_batch` (solo UI; sin migración).

## 2026-07-10 - feat/notificacion-etapa3-agenda

### Diagnóstico

- Flujo biométricos normal (pre-065): `book_biometricos` en etapas 3/4/5; P063 permitía Mesa 3→5 con booking biométricos.
- Requerimiento: rama **Notificación** separada (`kind=notificacion`), sin cupo, hora 12:00, expediente permanece etapa 3; Mesa 3→5 solo con notificación.
- Biométricos normal debe volver a: agendar en etapa 3 → etapa 4 → Mesa 4→5.

### Decisión

- Migraciones **`065_booking_kind_notificacion`** (solo enum) + **`066_notificacion_etapa3_agenda`** (book/cancel/reagendar + parches book/avanzar biométricos).
- RPC `cancel_notificacion_etapa3`: asesor dueño o `mesa_admin`/`super_admin`; solo etapa 3; historial `cancelled`.
- RPC `reagendar_notificacion_etapa3`: solo asesor dueño; cancel+insert; 12:00 fijo; sin cupo.
- Cancel Mesa notificación más restrictivo que biométricos (sin mesa_interno/externo).

## 2026-07-10 - fix/agenda-disponibilidad-slot-count

### Diagnóstico

- RPC 064 y `listBookedSlots` org-wide OK; calendario muestra 3 citas correctas.
- Bug en `computeAdvisorSlotAvailability`: `countBookedForSlotAcrossLocations` comparaba `location_id` exacto vs `sourceLocationIds`.
- Bookings legacy (`sede-centro`, `mty-centro`, …) no coincidían con config canónica solo `monterrey` → subconteo en 08:00.
- Conteo correcto: una pasada por booking, sede vía `mapLocationIdToAdvisorCanonical`, clave `fecha + hora + sede canónica`.

### Decisión

- `countBookedForAdvisorSede` + `bookingBelongsToAdvisorSede`; normalizar fecha/hora en map RPC.

## 2026-07-10 - fix/agenda-disponibilidad-org-wide

### Diagnóstico

- **Backend OK:** `book_biometricos` / `book_firmas` llaman `agenda_*_assert_slot_available`, que cuenta org-wide (`agenda_*_count_slot_booked`) con advisory lock; cupos separados por `kind`.
- **UI rota:** `listBookedSlots` hacía SELECT a `agenda_bookings` sujeto a RLS (`can_see_expediente`) → cada asesor solo veía sus bookings → `remaining` no bajaba al agendar otro asesor.
- **Constraint slot:** no hay unique parcial por slot; protección es lock + assert en RPC (capacidad configurable por sede).

### Decisión

- Reutilizar RPC `get_asesor_agenda_calendar` (064) en `listBookedSlots` biométricos/firmas vía `fetchOrgAgendaBookedSlots`.
- Sin migración nueva; sin tocar bookings existentes.

## 2026-07-10 - feat/asesor-calendario-citas-readonly

### Diagnóstico

- Header asesor: `NotificationsBell` en `src/app/asesor/page.tsx` (zona superior derecha).
- `agenda_bookings`: `kind`, `status`, `booking_date`, `booking_time`, `location_id`, `created_by`, `expediente_id`; asesor visible vía `expedientes.asesor_id`.
- RLS `agenda_bookings_select` usa `can_see_expediente` → asesor solo ve bookings de **sus** expedientes; lectura directa no sirve para calendario org-wide.
- Campos seguros: hora, tipo, asesor (nombre/email), ubicación, estatus. **Sin** `cliente_nombre` ni `expediente_id` en RPC.

### Decisión

- RPC read-only `get_asesor_agenda_calendar(start, end, include_cancelled)` SECURITY DEFINER; roles `asesor|mesa_admin|super_admin`; rango máx 62 días.
- UI modal junto a campana; filtros y selector de día; mock localStorage cuando `DATA_MODE!=supabase`.

## 2026-07-10 - feat/biometricos-etapa3-flujo-11-pasos (P063)

### Diagnóstico aplicado

- Etapa 4 era solo “cita agendada” intermedia; gates repartidos en UI asesor, RPC `book_biometricos` (4/5), Mesa `3→4` sin cita y acordeón agenda oculto en etapa 3.
- Renumerar IDs = alto riesgo para expedientes vivos y dashboards.

### Decisiones operativas (aprobadas)

1. Tras `book_biometricos` en etapa 3 el expediente **permanece en 3** (sin avance automático).
2. Mesa avanza **3→5** solo con `fecha_cita` + booking `biometricos/booked`; UI reemplaza panel 3→4.
3. Etapa 4 **legacy**: 4→5, book/cancel/reagendar en 4/5 sin migración de datos.

### Implementación

- **B0:** `ETAPAS_VISUALES_OPERATIVAS` (11 pasos), `mapEtapaInternaAPasoVisual`, stepper asesor.
- **B1:** gates asesor etapa 3; chip “Agendar biométricos”; mock `canShowAgendaBiometricosForEtapa`.
- **B2/B4 SQL:** migración `063` — `book/cancel/reagendar_biometricos` aceptan etapa 3; `avanzar_etapa_operativa` reemplaza `3_4` por `3_5` con gates de cita.
- **B3:** Mesa `showBio` etapa 3; panel `3A5`; cancel biométricos etapa 3.
- Tests TS + SQL (`rpc_avanzar_etapa_2_3_4`, `rpc_book_biometricos`).

## 2026-07-10 - feat/cliente-acta-nacimiento-digital-opcional

### Diagnóstico

- Patrón idéntico a `cliente_carta_empresa` (056/058): `integration_doc_tipos_asesor_opcionales()` + catálogo TS + `PDF_OR_IMAGE_DOCUMENT_TIPOS`.
- `integration_doc_tipos_asesor_upload()` = envío (4) || opcionales — no requiere función aparte.
- Mesa ve opcionales solo-asesor vía `deriveIntegrationDocsChecklistOpcionalesSoloAsesor` (excluye semanas/acta/SAT complementarios).
- Distinto de `cliente_acta_nacimiento` (Mesa complementario).

### Decisión

- Migración `062`: opcional asesor + MIME PDF/imagen en `expediente_documento_mime_permitido`.
- Frontend: catálogo, checklist opcionales, validación upload compartida con carta/INE.
- Sin cambio 4/4, RLS ni bucket.

## 2026-07-09 - feat/asesor-dashboard-tareas-pendientes

### Diagnóstico (condiciones reales)

- **Agendar biométricos:** `submittedToMesa` + `canShowAsesorBiometricosSupabaseCard` (etapa 4 siempre; etapa 5 solo con último booking cancelado y sin activo) + sin booking activo (`agenda_bookings` / `fecha_cita`).
- **Agendar firma:** análogo en etapas 9/10 vía `canShowAsesorFirmasSupabaseCard`.
- **Subir acuse:** etapa 8 + enviado a Mesa + `deriveRetencionAcuseAvisoFaltantes` > 0 o docs rechazados en `correccion_requerida` (tipos `retencion_*`).

### Decisión

- Helper puro `asesorTareasPendientes.ts`; dashboard carga hints de booking/retención en frontend (lectura) para candidatos etapa 4/5/9/10 y 8.
- Filtros y KPIs sobre lista global antes de paginar; sin SQL/RPC/RLS.

## 2026-07-08 - fix/storage-key-ine-filename

### Diagnóstico

- `buildExpedienteDocumentoStoragePath` concatenaba `uuid-{safeFileName}` donde `sanitizeExpedienteDocumentoFileName` **conservaba espacios y paréntesis**.
- Supabase Storage rechaza keys con esos caracteres → `Invalid key` en INE JPG con nombre de escáner/celular.

### Decisión

- Key: `{org}/{exp}/{tipo}/{uuid}.{ext}`; extensión desde MIME (`inferStorageFileExtension`).
- `p_nombre_original` sigue siendo `file.name` en RPC (UI sin cambio).
- Paths ya subidos no se migran.

## 2026-07-08 - fix/mesa-entrada-lectura-todos

### Diagnóstico

- `deriveMesaCorreccionLecturaEstado` retornaba `no_aplica` salvo `resumenDocumental === correccion_enviada`.
- Primer envío a Mesa no mostraba badge ni color no abierto.

### Decisión

- Comparar siempre `fechaEntradaMesaActual` vs `mesaExpedienteOpenedStorage`.
- `mesaEntradaEsPorCorreccion` elige copy corrección vs primer envío.
- `rowSurfaceClass` usa estado lectura, no solo categoría documental.

## 2026-07-08 - fix/mesa-correccion-revision-domicilio

### Diagnóstico domicilio

- Migración **050** exigía `p_direccion_opcional`; **053/055** lo relajó (`NULLIF`, sin `RAISE` si vacío).
- Frontend (validation/completeness) lo trataba como opcional desde 053.
- `enviar_a_mesa` no valida domicilio en columna expedientes.

### Diagnóstico corrección Mesa

- Orden/badge usaban solo `fecha_envio_mesa` (`mesaBandejaOrden`, `listForMesaControl`).
- Documentos corregidos: `estatus_revision = resubido` → `correccion_enviada`; `created_at` del documento.
- Datos generales: `save_cliente_datos_correccion` → `cliente_datos.correccion_post_mesa` en `action_log`; estado pasa a `completo`; no impactaba bandeja.
- No existe `mesa.expediente.open` ni tabla de lectura; solo `mesa.expediente.take|release`.

### Decisión

- **Solo frontend:** validación domicilio; helpers `mesaCorreccionEntrada`; batch `listEstadoBatchByExpedienteIds`; apertura en localStorage por usuario Mesa.
- **Sin SQL/RPC** en este bloque. Re-hacer obligatorio en backend requeriría migración mínima (revertir lógica 050 en `save_cliente_datos`).
- Migración futura opcional: `ultima_correccion_enviada_at` + `mesa_expediente_reads` si se necesita lectura multi-dispositivo sin localStorage.

## 2026-07-07 - fix/monto-calculado-auto-cobro

### Diagnóstico

- `handleClienteDatosChange` devolvía `next` sin recalcular si `montoCalculadoLockedRef` era true, **antes** de evaluar cambio de porcentaje.
- Tras editar manualmente el monto (o hidratar valor distinto al auto), escribir porcentaje no recalculaba.
- Borrar el campo monto no desbloqueaba el lock.
- Backend (055): acepta `p_monto_calculado_manual`; sin cambio SQL requerido.
- `monto_aprobado` viene de `editorDecision.monto_aprobado` (`montoAprobadoEditor`).

### Decisión

- Helper `applyClienteDatosCobroRecalc`: porcentaje → siempre recalc; borrar monto → unlock; montoMejoravit → respeta lock manual.

## 2026-07-07 - fix/upload-storage-post-mesa

### Diagnóstico

- Mensaje usuario «Verifica que sea PDF y que no supere 15 MB» = fallback de `mapSupabaseStorageUploadError` (cc8dcd5).
- Causa real post-Mesa: RPC `register_expediente_documento` (057/059) permitía upload/reemplazo, pero **Storage RLS** `expediente_documento_storage_asesor_upload_allowed` sigue con `submitted_to_mesa = true → false`. Solo pasaban corrección (rechazado) o pre-Mesa.
- Causa adicional pre-Mesa: `isPdfLikeFile` rechazaba `.pdf` con MIME `text/plain` (común en macOS/escáner) → validación frontend o MIME vacío a Storage.
- Bucket Cloud OK: 15 MB, MIME PDF + imágenes.

### Decisión

- Migración `060`: `expediente_documento_storage_asesor_post_mesa_upload_allowed` + OR en policies INSERT/DELETE (mínimo, espejo RPC 059).
- `isPdfLikeFile`: confiar en extensión `.pdf` salvo `image/*`.
- `mapSupabaseStorageUploadError`: detectar RLS/policy; mensaje por tipo; sin falso positivo `max`.

## 2026-07-07 - feat/asesor-reemplazo-documento-post-mesa

### Diagnóstico

- UI (`AsesorIntegracionDocsUpload`): `asesorPuedeSubirOCorregirDocumento` solo permitía post-Mesa rechazados u opcionales faltantes; mensaje «no editable salvo rechazo».
- Repo (`uploadOrReplace`): bloqueaba todo upload post-Mesa salvo opcional faltante; rechazaba reemplazo de opcional existente.
- RPC `register_expediente_documento` (057): post-Mesa bloqueaba obligatorios y segundo upload de opcional.
- Reemplazo: soft-delete fila previa + INSERT nueva versión; RLS solo expone `deleted_at IS NULL`.
- Mesa: `latestByTipo` y `resolveMesaArchivoPorTipo` ya priorizan `created_at` más reciente.

### Decisión

- Helper `asesorPuedeReemplazarDocumentoExistentePostMesa` (estatus ≠ faltante/rechazado).
- Migración `059`: post-Mesa permite si existe doc activo del tipo, o primer upload opcional faltante; bloquea obligatorio faltante.
- Reemplazo vuelve estatus a `subido` (o `resubido` si previo rechazado — flujo corrección RPC separado).
- Sin tocar envío Mesa, etapas, RLS, 4/4.

## 2026-07-07 - fix/carta-empresa-pdf-imagen

### Diagnóstico

- Frontend: `cliente_carta_empresa` pasaba por `validatePdfFile` (solo PDF).
- SQL `expediente_documento_mime_permitido`: imágenes solo en INE frente/reverso.
- Bucket `expediente-documentos` en Cloud ya incluye `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` (migración 047) — sin cambio de bucket.

### Decisión

- Tratar carta empresa como PDF-or-imagen en `fileUploadValidation` (mismo accept que INE).
- Migración `058`: ampliar `expediente_documento_mime_permitido` para `cliente_carta_empresa`.
- Copy: «INE y Carta de la empresa: PDF o imagen…».
- Sin tocar obligatorios, envío Mesa, semanas cotizadas (sigue PDF).

## 2026-07-07 - fix/asesor-carta-empresa-upload

### Diagnóstico

- Cloud: bucket `expediente-documentos` con `file_size_limit = 15728640` (15 MB); RPC `expediente_documento_max_size_bytes()` = 15 MB.
- No había límite de 2 MB en código ni BD.
- Causa: validación PDF exigía **MIME `application/pdf` y extensión `.pdf` a la vez**; muchos PDFs reales (macOS/escáner) llegan como `application/octet-stream` o MIME vacío.
- Storage rechazaba `contentType` inválido; el mensaje genérico mezclaba formato y tamaño → el asesor lo interpretaba como “muy pesado”.

### Decisión

- `isPdfLikeFile`: aceptar `.pdf` con MIME vacío/octet-stream, o MIME PDF canónico.
- `resolveExpedienteDocumentoUploadMime`: normalizar a `application/pdf` en upload.
- `mapSupabaseStorageUploadError`: separar errores MIME vs tamaño.

## 2026-07-07 - feat/asesor-docs-visibilidad

### Diagnóstico

- Documentos se registran en Storage + `expediente_documentos`; `enviar_a_mesa` solo marca flags (no mueve archivos).
- Asesor no tenía Ver/Descargar (Mesa sí usa `getArchivoBlob` + preview).
- Post-Mesa: UI y RPC bloqueaban todo upload, incluidos opcionales faltantes (`cliente_carta_empresa`, `cliente_semanas_cotizadas`).

### Decisión

- Resumen «Documentos que se enviarán a Mesa» / «Documentos enviados a Mesa» + badges.
- Reutilizar `MesaArchivoPreviewDialog` y patrón blob del detalle Mesa.
- `asesorPuedeSubirOpcionalFaltantePostMesa` + migración `057` para primer upload opcional post-envío.
- Obligatorios 4/4, correcciones rechazadas y validaciones MIME sin cambio.

## 2026-07-07 - fix/asesor-datos-generales-borrador-local

### Diagnóstico (producción)

- Commit `7f1deb1` sí en `main`; el borrador no persistía/restauraba por:
  1. `isDraftNewerThanOfficial` borraba el draft al cargar si `cliente_datos.updated_at` del servidor era más reciente (desfase reloj).
  2. El efecto de hidratación re-ejecutaba por deps `precal.cliente_nombre/nss/telefono`, reseteando `hasUserEdited` y cancelando el debounce.
  3. Autosave corría durante hidratación y podía sobrescribir el draft con datos oficiales/vacíos.
  4. Refresh antes de 400ms perdía datos (sin flush síncrono).

### Decisión

- `shouldOfferClienteDatosDraftRestore`: comparar contenido normalizado, no solo timestamp.
- `hasHydratedClienteDatosRef` + `suppressDraftAutosave`: autosave solo tras hidratación y edición real del usuario.
- `persistClienteDatosDraftNow` + `pagehide`/`beforeunload` para flush inmediato.
- Deps del efecto de carga: `precal?.id` (no campos derivados del expediente).

## 2026-07-07 - feat/asesor-datos-generales-borrador-local

### Diagnóstico

- Ya existía `clienteDatosDraftLocalStorage.ts` con autosave parcial (600ms, solo `clienteDatos`, `window.confirm`).

### Decisión

- Extender borrador con `direccionOpcional`; debounce `400ms`; banner «Restaurar borrador» / «Descartar borrador» en lugar de confirm nativo.
- `beforeunload` si hay cambios sin guardar o borrador local activo.
- Limpiar borrador tras Guardar datos / Guardar corrección exitosos (sin cambiar RPCs ni flujo Supabase).

## 2026-07-07 - feat/cliente-carta-empresa-opcional

### Diagnóstico

- Catálogo TS en `types.ts` + listas espejo en `integration-docs-completos.ts`.
- RPC `register_expediente_documento` valida contra `integration_doc_tipos_asesor_upload()` (SQL).
- Opcional existente: `cliente_semanas_cotizadas` en `integration_doc_tipos_asesor_opcionales()`.

### Decisión

- Nuevo tipo `cliente_carta_empresa`, label «Cliente · Carta de la empresa», `obligatorio: opcional`.
- Agregar a `INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES` y migración `056` (mínima: solo función opcionales).
- Progreso envío sigue 0–4/4 (`count_integration_docs_presentes` solo `asesor_envio`).
- Mesa: `buildMesaIntegrationDocViews` incluye opcionales solo-asesor (excluye semanas/acta/SAT en complementarios).
- PDF only (mismo límite 15 MB); sin cambio INE/cobro/NSS.

## 2026-07-06 - fix/asesor-dashboard-filtros-globales

### Diagnóstico

- Fase A paginación (`listForAsesorPaginated`) cargaba solo la página actual; filtros se aplicaban sobre esa porción → «Corrección requerida» en página 2 mostraba 1 de 67 en lugar de todos los coincidentes.

### Decisión

- Volver a `listForAsesor` (lista completa en cliente).
- Orden: filtrar globalmente → paginar con `PAGE_SIZE=50` sobre `expedientesFiltrados`.
- Reset de página a 1 al cambiar cualquier filtro (handlers, no `useEffect`).
- `safePage` acota página cuando el resultado filtrado tiene menos páginas.
- Sin tocar RPC, migraciones ni backend.

## 2026-07-06 - feat/p055-monto-calculado-editable: monto calculado editable

### Decisión

- Fórmula automática sin cambio: `round((base_cobro * porcentaje / 100) + 3000, 2)`.
- Base cobro: Mejoravit usa `montoMejoravit` del JSON; otros programas usan `editor_decisions.monto_aprobado`.
- RPC: `p_monto_calculado_manual` opcional al final de `save_cliente_datos` y `save_cliente_datos_correccion` (desde P054).
- Frontend: `montoCalculadoLockedRef` + `onMontoCalculadoEdited`; si no editado → `null` al RPC (servidor calcula); si editado → valor manual.
- Detección manual vs auto al cargar: comparar valor guardado con auto actual (`isMontoCalculadoManualRespectoAuto`).
- P054/P053/P052 sin cambio de contrato salvo nuevo parámetro opcional.

## 2026-07-03 - feat/cliente-datos-mejoravit-plazo: Monto Mejoravit y Plazo en Datos Generales

### Decisión

- `montoMejoravit` y `plazo` en JSON `cliente_datos.datos` (mismo patrón que `beneficiario`, `direccionEmpresa`); sin columna nueva ni migración — `save_cliente_datos` persiste `p_datos` como JSONB flexible.
- `direccion_opcional` sin cambio de columna/payload; solo copy UI → «Domicilio real del cliente».
- Validación frontend obligatoria; monto Mejoravit > 0 con `parseMontoCalculadoInput`; no interfiere con cobro ni `monto_aprobado`.
- Contador obligatorios 22 → 24.

## 2026-07-03 - fix/mesa-bandeja-espera-asesor: Disponibles solo accionables

### Problema

- Expedientes con «Corrección req.» (`correccion_requerida`, datos o docs rechazados) seguían en filtro **Disponibles** aunque Mesa no puede actuar hasta corrección del asesor.

### Decisión

- Helper `estaEnEsperaDeAsesor(resumenDocumental)` → `correccion_requerida` (ya unifica rechazo documental + `cliente_datos.rechazado`).
- Nuevo chip ops **En espera de asesor**; **Disponibles**, **Mi bandeja** y **En trabajo** excluyen esos casos; **Todo Mesa** conserva vista completa.
- Solo UI/filtros; sin migración, RPC ni cambio de estados.

## 2026-07-03 - feat/notifications-bell: campana en header (reemplaza panel grande)

### Decisión

- `NotificationsBell` en header junto a email y «Cerrar sesión» (`/asesor`, `/mesa-control`).
- Lista compartida en `notifications-ui.tsx`; dropdown máx. 5 ítems, badge con total (build hasta 50).
- Panel `DashboardNotifications` sobre KPIs **eliminado** de ambos dashboards (componente conservado por si se reutiliza).
- Sin cambios a `buildDashboardNotifications` ni fuentes de datos.

## 2026-07-03 - feat/dashboard-notificaciones: panel visual en /asesor y /mesa-control

### Fuentes de datos (sin `action_log`)

- **Asesor:** expedientes de `listForAsesor` + `cliente_datos.estado` (`listEstadoByExpedienteIds`) + `deriveResumenExpedienteCorreccion` (documentos base + datos).
- **Mesa:** bandeja `casos` con `resumenDocumental`, `clienteDatosEstado`, `subestado`, `fechaEnvioMesa`, `fechaCita`, `updatedAt`.
- **No** se lee `action_log` (asesor sin RLS; evita RPC nuevo). Avance de etapa histórico y reagenda exacta quedan fuera de alcance v1.

### Decisión

- Una alerta por expediente (mayor prioridad): corrección → rechazo → corrección enviada → nuevo/pendiente → envío Mesa → citas.
- Máximo 5 en dashboard; link directo al detalle.
- Solo UI; no altera estados ni flujos operativos.

## 2026-07-03 - fix/asesor-dashboard-correccion-datos: fila del dashboard alinea con rechazo Datos Generales

### Diagnóstico

- `resumenDocumentalPorId` omitía expedientes sin resumen de archivos cargado (`if (!r) continue`).
- KPI/filtro sí usaban `deriveResumenExpedienteCorreccion`, pero la **tabla** pintaba columnas con fuentes viejas: `deriveResultadoRealExpediente` → «En trámite», `deriveEstadoDocumentacionColumnaAsesor` → «Pendiente de aprobación», `subestado` → «En validación por mesa».
- Monto exigía `decision === "aprobado"` aunque `monto_aprobado > 0` (captura asesor post-045).

### Decisión

- Resumen único por fila: `deriveResumenExpedienteCorreccion(resumen ?? [], clienteDatosEstado)`.
- Helpers de fila (`asesorResultadoFilaBadge`, `asesorDocumentacionFilaBadge`, `asesorEstatusOperativoFilaBadge`) priorizan `correccion_requerida` sobre subestado/resultado documental.
- `formatMontoAprobadoFila`: muestra monto si `> 0`.
- `deriveResumenExpedienteCorreccion`: `cliente_datos.rechazado` gana sobre `faltantes` documentales.
- KPI/filtro «En trámite» excluye corrección requerida/enviada.

## 2026-07-03 - fix/mesa-rechazo-datos-generales: bandejas reconocen rechazo de Datos Generales

### Diagnóstico

- `update_cliente_datos_revision` solo actualiza `cliente_datos` (estado `rechazado`, motivo, `action_log`); **no** cambia `expedientes.subestado`.
- Bandejas Mesa/Asesor derivan corrección con `deriveResumenDocumental` (solo documentos base); rechazo de datos quedaba huérfano: detalle Mesa sí lo mostraba, KPIs/filtros no.

### Decisión

- Mismo patrón que corrección documental (DEVLOG P3J): **no** mover `subestado` del expediente; extender derivación con `deriveResumenExpedienteCorreccion(resumen, clienteDatosEstado)`.
- `cliente_datos.estado === 'rechazado'` → categoría `correccion_requerida` para KPIs/filtros/estilo de fila.
- «En validación mesa» excluye `correccion_requerida` y `correccion_enviada` (alineado con intención documental).
- Lectura batch `listEstadoByExpedienteIds` en repos mock/Supabase; Supabase emite `expediente_cliente_datos_updated` tras `updateEstado` / `save` / `saveCorreccion`.
- Dashboard asesor usa `useExpedienteArchivosRepo` (antes forzaba mock IndexedDB en Supabase).
- Sin migración ni cambio a RPC `update_cliente_datos_revision`; flujo asesor `save_cliente_datos_correccion` intacto.

## 2026-07-03 - fix/mesa-asesor-monto-direccion: etiqueta asesor, monto vigente, dirección obligatoria

### Decisión

- Mesa no puede leer `profiles` del asesor por RLS (`profiles_select_own`); en lugar de ampliar RLS, RPC `get_asesor_display_batch` SECURITY DEFINER filtra por `can_see_expediente`.
- `monto_aprobado` se muestra en resumen Mesa si `> 0`, independiente de `decision` (incluye captura asesor con `no_cumple`).
- Dirección del cliente = columna `expedientes.direccion_opcional`; obligatoria en validación frontend y en `save_cliente_datos` (migración **050**); campo en formulario Datos Generales, no en JSON `cliente_datos.datos`.
- Sin tocar 049 NSS, INE/documentos, fórmula cobro +3000, biométricos, firmas, agenda ni RLS general.

## 2026-07-03 - fix/nss-lock-after-mesa: NSS libre hasta envío a Mesa

### Decisión

- Un NSS solo bloquea creación/envío cuando **otro** expediente activo con mismo NSS/programa tiene `cliente_datos` y `submitted_to_mesa = true`.
- Migración **049**: `normalize_nss_mexico`, `nss_bloqueado_en_mesa`; reemplaza índice `expedientes_nss_programa_activo_unique` por uno parcial solo en enviados a Mesa.
- Sin cambios a UI salvo mapeo de error en repos; sin documentos, cobro, INE, Mesa ops, RLS.

## 2026-07-03 - fix/monto-calculado-automatico: fórmula con +$3,000

### Decisión

- Se revierte la captura manual de `monto_calculado` (P046 commiteada en `main`, no desplegada en Cloud).
- Migración **048** (Cloud): `save_cliente_datos` calcula `round(monto_aprobado * porcentaje / 100 + 3000, 2)`; sin parámetro `p_monto_calculado`.
- Frontend: campo readOnly; `calcMontoCalculadoCobro` comparte la misma fórmula; texto «El monto calculado es el porcentaje del monto aprobado más $3,000.»
- Sin cambios a decisión del editor, monto aprobado asesor, Mesa, RLS.

## 2026-07-03 - feat/asesor-monto-aprobado: monto desbloquea flujo asesor

### Decisión

- La llave operativa para captura de datos, documentos y envío a Mesa pasa de `editor_decisions.decision = 'aprobado'` a `monto_aprobado > 0`.
- El asesor dueño puede registrar/editar `monto_aprobado` vía RPC `asesor_update_monto_aprobado` aunque la decisión visible siga siendo `no_cumple`; no se modifican `decision` ni `notas_revision`.
- Migración **045** (local, sin Cloud): RPC nuevo + parche mínimo en `save_cliente_datos` y `enviar_a_mesa`; `action_log` `asesor.monto_aprobado.update`.
- Frontend: `hasMontoAprobado` único para gating; sección «Decisión del editor» con input y botón «Guardar monto».
- Sin cambios a Mesa, biométricos, firmas, cobro (salvo gate previo), documentos especiales, agenda, roles, auth ni RLS general.

## 2026-07-02 - fix/documentos-obligatorios-roles: NSS sin archivo; acta/SAT solo Mesa

### Decisión

- El **NSS** sigue obligatorio como dato en Datos Generales / `expedientes.nss`; se elimina el tipo documental `nss` de listas asesor, gates `enviar_a_mesa` y validación Mesa 1→2.
- **Acta de nacimiento** y **constancia SAT** ya estaban fuera del upload asesor (028/030); Mesa los sube vía `integration_doc_tipos_mesa_upload` (complementarios opcionales post-032).
- Migración **044** (local, sin Cloud): redefine `integration_doc_tipos_asesor_envio` a 4 tipos (`cliente_ine_*`, comprobante, estado de cuenta); `integration_doc_tipos_obligatorios` hereda vía 032.
- Frontend: espejo en `integration-docs-completos.ts`; UI asesor/Mesa sin NSS documental; contadores 4/4.
- Sin RLS, Storage, agenda, Mesa Ops (salvo copy validación), cancel/reagenda, usuarios.

## 2026-07-02 - feat/cliente-cobro-fields: cobro en Datos Generales

### Decisión

- Tres campos obligatorios nuevos: `porcentaje_cobro`, `monto_calculado` (calculado en servidor con `monto_aprobado` del editor), `metodo_pago` (texto, sin enum DB).
- Columnas en `cliente_datos` migración **043**; obligatoriedad en RPC + frontend, no `NOT NULL` en tabla.
- Contador obligatorios: 18 → 21; RFC opcional intacto.
- UI asesor: sección «Información de cobro»; Mesa read-only muestra los tres campos.
- Sin Cloud, RLS, Mesa Ops, agenda, Storage ni usuarios.

## 2026-07-02 - fix/cliente-rfc-opcional: RFC opcional en Datos Generales

### Decisión

- RFC se captura/muestra en Datos Generales (asesor editable; Mesa lectura + validar/rechazar).
- Frontend: `clienteDatosValidation` y `clienteDatosFormCompleteness` sin RFC obligatorio; label `RFC (opcional)` en asesor y Mesa.
- Backend **sí exigía RFC** en `save_cliente_datos` (011/031) y `enviar_a_mesa` (026); migración **042** local (no Cloud): RFC vacío permitido; formato solo si `v_rfc <> ''`.
- Tests TS + SQL actualizados; sin Mesa Ops, agenda, RLS, Storage, PDF-only, usuarios ni reportes.

## 2026-06-25 - fix/pdf-only-backend-and-copy: backend solo PDF

### Decisión

- Auditoría go-live: UI ya bloqueaba JPG/PNG pero `expediente_documento_mime_permitido` (027) y bucket Storage aceptaban imágenes.
- Migración **041** (nueva, no edita 027): función MIME solo `application/pdf`; `UPDATE storage.buckets.allowed_mime_types` a PDF únicamente.
- RPCs existentes (`register_expediente_documento`, mesa, corrección, retención) siguen llamando la misma función; error DB: `mime_type no permitido (%)`.
- Copy UI y mappers TS: «Solo se permiten archivos PDF» / «formato PDF»; sin tocar preview de archivos legacy ni columna `imagenes` de datos cliente.
- Sin Cloud, `db push`, RLS, Mesa Ops, agenda, avanzar etapa, cancel/reagenda, usuarios ni borrado Storage.

## 2026-06-25 - feat/cliente-datos-validaciones: solo PDF en uploads

### Decisión

- Todos los **nuevos** uploads de documentos del CRM deben ser PDF (`application/pdf` + extensión `.pdf`).
- Validación central en `src/lib/fileUploadValidation.ts`; `validateExpedienteDocumentoFile` delega ahí.
- UI valida antes del repo; repos Supabase y mock IndexedDB validan antes de `.upload()` / persistencia local.
- No conversión automática; no borrado de archivos existentes; preview de imágenes legacy se mantiene.
- Sin Cloud, migraciones, RLS ni cambios a Mesa Ops / agenda / avanzar etapa / cancel-reagenda.

## 2026-06-25 - feat/cliente-datos-validaciones: Datos Generales

### Decisión

- Validación pura en `clienteDatosValidation.ts`; 19 campos obligatorios alineados con `clienteDatosFormCompleteness`.
- Guardado Supabase bloqueado con errores por campo; mock permite borrador sin validación completa.

## 2026-06-29 - Fase 1C-B Mesa: default Disponibles en bandeja

### Decisión

- Default operativo al cargar `/mesa-control`: chip **Disponibles** (`sin_asignar`), no `Todo Mesa`.
- `Todo Mesa` conserva vista completa; `Mi bandeja` y `En trabajo` sin cambio de criterio.
- Label chip «Disponibles»; badges de fila siguen «Sin asignar» / «Trabajando por…».
- Orden chips: Disponibles → Mi bandeja → En trabajo → Todo Mesa.
- Constantes `DEFAULT_MESA_OPS_FILTER`, `MESA_OPS_FILTER_CHIPS`, `MESA_OPS_FILTER_HELP_TEXT` en `mesaOpsUi.ts`.
- Sin backend, migraciones, RLS, Cloud ni bloqueo operativo.

## 2026-06-29 - Fase 1C-A Mesa Ops: cleanup y estabilidad (sin bloqueo)

### Cambios

- `hasAlertMessage`: no renderizar `role="alert"` sin texto (bandeja + bloque ops).
- Fallo lectura `mesa_expediente_ops`: bandeja conserva expedientes con `mesaOps: null` → badge «Sin asignar»; warn solo en `development`.
- Tras take/release en detalle: `mesa_ops_updated` → `loadCasos({ silencioso: true })` en bandeja (mismo patrón que `expediente_archivos_updated`).

### Análisis Fase 1C-B — fila ops en nuevos envíos a Mesa

| Opción | Descripción | Riesgo | Nota |
|--------|-------------|--------|------|
| **A** | Dejar como está; `mesa_take_expediente` llama `ensure_mesa_expediente_ops_row` al tomar | Bajo | UI ya trata ausencia como «Sin asignar»; filtros coherentes |
| **B** | Hook en `enviar_a_mesa` para crear fila ops al enviar | Medio | Toca RPC core; requiere migración + pruebas SQL; mejor observabilidad temprana |
| **C** | RPC/helper separado (p. ej. `ensure_mesa_ops_row` expuesto o job backfill incremental) | Medio-bajo | Sin tocar `enviar_a_mesa`; más superficie API |

**Recomendación 1C-B:** **Opción A** a corto plazo (suficiente en modo sombra). Valorar **Opción C** si se necesita fila ops en reporting antes del primer take; **Opción B** solo si negocio exige fila garantizada al envío y se autoriza migración.

### Mini guía UX Mesa (propuesta, sin UI aún)

- **Sin asignar:** nadie ha tomado el expediente en Mesa.
- **Trabajando por ti:** lo tienes marcado como tuyo; aparece en «Mi bandeja».
- **Trabajando por [nombre] / otro usuario:** otro operador lo tiene; por ahora no bloquea otras acciones.
- **Mi bandeja:** solo expedientes que tú tomaste.
- **Todo Mesa:** vista completa (comportamiento histórico de la bandeja).

### Pendiente framework

- Next.js puede insertar `role="alert"` vacío en route announcer; no es de la app. Los alertas de aplicación quedan guardados con `hasAlertMessage`.

## 2026-06-29 - Fase 1B Mesa: UI modo sombra (asignación operativa)

### Decisión

- UI consume `mesa_expediente_ops` y RPCs take/release **sin bloquear** avance, cancel, documentos ni orden Fase 0 (`fecha_envio_mesa ASC`).
- Lectura ops en bandeja: query expedientes intacta + `listByExpedienteIds`; fallo silencioso → sin badge o «Sin asignar».
- Filtros operativos chips adicionales (default `Todo Mesa`); KPIs y quick filters existentes sin cambio.
- Detalle: bloque «Responsable Mesa» + prompt no bloqueante con `sessionStorage`; liberación admin vía `profiles.app_role` primero, `sessionRole` (`super_admin`) y `getEffectiveMockRole()` solo como fallback dev.
- Helpers puros `mesaOpsUi.ts`; repo `domain/mesa-ops`; mock mode → ops vacíos, sin errores.
- Sin migraciones, RLS, Cloud ni cambios a RPCs de flujo existente.

### Archivos

- `src/lib/mesaOpsUi.ts`, `src/lib/mesaOpsUi.test.ts`
- `src/domain/mesa-ops/*`
- `src/components/mesa-control/MesaExpedienteOpsSection.tsx`
- `src/app/mesa-control/page.tsx`
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`

## 2026-06-29 - Fase 1A Mesa: ops modo sombra (backend local)

### Decisión

- Nueva tabla `mesa_expediente_ops` 1:1 con `expedientes`; estados `sin_asignar` … `completado`.
- Backfill idempotente solo para `submitted_to_mesa = true`, `ciclo_estado = activo`, sin fila ops.
- RPCs `mesa_take_expediente` / `mesa_release_expediente`: roles Mesa + `super_admin`; `can_see_expediente`; lock `FOR UPDATE` en fila ops; `action_log` `mesa.expediente.take|release`.
- **Modo sombra:** RPCs no invocadas por flujos existentes; no bloquean avance/cancel/documentos.
- Sin cambios a `enviar_a_mesa`, `avanzar_etapa_operativa`, cancel/reagenda, RLS de `expedientes`, UI ni Cloud.

### Follow-up GRANT SELECT (pre-merge)

- `039`: `GRANT SELECT ON mesa_expediente_ops TO authenticated` tras policy RLS.
- Tests `mesa_expediente_ops_rls.sql` (lectura Mesa, RLS `can_see_expediente`, DML denegado).
- Tests negativos RPC take/release en `rpc_mesa_take_release.sql`.

### Archivos

- `supabase/migrations/039_mesa_expediente_ops.sql`
- `supabase/migrations/040_rpc_mesa_take_release.sql`
- `supabase/tests/mesa_expediente_ops_backfill.sql`
- `supabase/tests/rpc_mesa_take_release.sql`

## 2026-06-29 - Limpieza marcador build Fase 0

### Decisión

- Removido pill `Fase 0 orden · commit {sha}` y `mesaBandejaBuildMarker` tras validación en producción.
- Se mantiene orden antigüedad, copy Expedientes y badge «En Mesa hace X».

## 2026-06-29 - Fase 0 bandeja Mesa: orden por antigüedad

### Decisión

- Orden default bandeja: `fecha_envio_mesa ASC` (más viejos primero); se elimina reorden por tier documental/subestado en la lista.
- Badge «En Mesa hace X» en esquina superior de tarjeta (ámbar, `data-testid=mesa-bandeja-en-mesa-hace`); fallback `createdAt` si falta `fecha_envio_mesa`.
- Subtítulo Expedientes + línea aclaratoria: antigüedad primero; urgencia en colores/filtros.
- Helpers `mesaBandejaOrden.ts`; query Supabase `listForMesaControl` alineada a ASC.
- Sin migraciones, sin RPC, sin bloqueos operativos.

## 2026-06-26 - Fix gate cancel: `mesa_control` vía sesión (no mockRole)

### Decisión

- **Causa raíz Preview `99903805001`:** `canMesaShowCancelCitaOperativa` evaluaba solo `getEffectiveMockRole()`; sin `mock_user` en localStorage → `mockRole=null` → check **`rol`** fallaba. «Aceptar post-cita biométrica» sí aparecía porque usa `currentUser.role === "mesa_control"`.
- `resolveMesaAgendaCancelRole({ mockRole, sessionRole })`: fallback a rol de sesión Supabase (`mesa_control`, `super_admin`, variantes `mesa_*`).
- `MesaAvanceOperativoSection` recibe `cancelCitaGate` y evalúa `explainMesaShowCancelCitaOperativa` dentro del panel Decisión Mesa.
- `mesaHasCitaProgramadaParaCancel`: booking activo **o** `fecha_cita` no vacía.
- Debug temporal: `NEXT_PUBLIC_DEBUG_MESA_CANCEL=1` → `data-testid="mesa-cancel-gate-debug"` con `failedChecks`.
- Test explícito fixture Cloud `99903805001` (`mockRole: null`, `sessionRole: "mesa_control"`, etapa 5, booking).

## 2026-06-26 - Cancel cita visible en Decisión Mesa

### Decisión

- Botón cancelar cita en panel **Decisión Mesa** (`MesaAvanceOperativoSection`): biométricos etapas 4/5, firmas 9/10; panel dedicado etapa 10 firmas.
- Labels: «Cancelar cita biométrica…» / «Cancelar cita de firmas…»; éxito: «Cita cancelada. El asesor puede reagendar.»
- Gate UI: `submittedToMesa`, `subestado=en_proceso`, booking activo, roles Mesa Supabase (`mesa_admin`, `mesa_interno`, `mesa_externo`).

## 2026-06-26 - Gate fuerte RPC 038 (book etapa 5/10)

### Decisión

- `book_biometricos` etapa 5: exige `subestado = en_proceso`, sin booking activo y que la **última** cita `biometricos` del expediente esté `cancelled` (`ORDER BY created_at DESC`).
- `book_firmas` etapa 10: misma validación de última cita `firmas` cancelada (subestado `en_proceso` ya aplicaba a 9/10).
- Tests SQL negativos: etapa 5/10 sin cancel, último booking no cancelado, bio subestado ≠ `en_proceso`.
- Sin Cloud / sin `db push`.

## 2026-06-25 - Asesor reagenda tras cancel Mesa (etapa 5/10)

### Decisión

- `canShowAsesorBiometricosSupabaseCard` / `canShowAsesorFirmasSupabaseCard`: etapa 5/10 solo con última cita cancelada y sin booking activo.
- `AsesorAgendaBiometricosSupabaseGate` / `AsesorAgendaFirmasSupabaseGate` en detalle asesor.
- `038_rpc_book_citas_post_mesa_cancel.sql`: `book_*` permite etapas 5 y 10 (agendar tras cancel, no reagendar RPC).
- Sin cambio de etapa; sin Cloud.

## 2026-06-25 - Migración 037: Mesa cancela citas (biométricos + firmas)

### Decisión

- `037_rpc_cancel_citas_mesa.sql`: reemplaza `cancel_biometricos` y `cancel_firmas`.
- Biométricos: etapas 4/5; firmas: 9/10; roles Mesa + asesor dueño.
- Motivo obligatorio para `mesa_*` y `super_admin`; opcional para asesor (compat).
- `can_see_expediente` para Mesa; no cambia etapa ni borra historial bookings.
- UI: botón biométricos + firmas en `MesaExpedienteAgendaCitasSection`.
- **Solo local** — sin `db push` Cloud.

### Archivos

- `supabase/migrations/037_rpc_cancel_citas_mesa.sql`
- Tests SQL biométricos/firmas cancel
- `mesaAgendaCancelAccess`, `MesaExpedienteDetalleReadOnly`, `API_CONTRATOS.md`

## 2026-06-25 - Mesa cancelar cita y solicitar reagenda (firmas)

### Decisión

- Usar RPC existente `cancel_firmas` (roles `mesa_admin`, `super_admin`; etapas 9/10).
- **No implementar** cancel biométricos Mesa sin migración: `cancel_biometricos` restringe a asesor dueño etapa 4.
- Motivo obligatorio en UI; persistido en `agenda_bookings.note` (`Cancelado: …`).
- Asesor: `getLastCancelledBooking` + `AsesorAgendaCitaCanceladaNotice`; formulario agendar sigue en etapa 9.
- Sin cambio de etapa, sin `db push`, sin tocar `concasacrm`.

### Archivos

- `MesaCancelarCitaDialog`, `mesaAgendaCancelAccess`, `agendaCancelNote`
- `MesaExpedienteAgendaCitasSection`, `MesaExpedienteDetalleReadOnly`
- `AgendaFirmasSupabaseCard`, `AgendaBiometricosSupabaseCard`
- repos `getLastCancelledBooking` (firmas + biométricos)

## 2026-06-25 - UX Mesa: detalle expediente colapsable

### Decisión

- `MesaAccordionSection` + resúmenes por bloque; cerrado por default salvo resumen arriba.
- Consulta datos/documentos en todas las etapas; `mesaPuedeRevisar*` limita acciones (etapa 1 / retención 8 enviada).
- Agenda unifica biométricos + firma; avance operativo fuera de acordeones.

### Archivos

- `MesaAccordionSection`, `MesaExpedienteDocumentosResumen`, `MesaExpedienteAgendaCitasSection`
- `MesaExpedienteDetalleReadOnly` + helpers en `mesa-decision-ux.ts`

## 2026-06-25 - UX Mesa: ocultar config agendas para Interno/Externo

### Decisión

- `canManageAgendaConfig`: solo `mesa_admin` / `mesa_control_admin`, `super_admin` y legacy `mesa_control`.
- Mesa Interno/Externo: no montar `AgendaBiometricosConfigPanel` ni bloques read-only.
- Sin cambios en agenda asesor, RPCs ni schema.

### Archivos

- `canManageAgendaConfig.ts` (+ test), `mesa-control/page.tsx`, panels Supabase, `AgendaBiometricosConfigPanel`.

## 2026-06-25 - UX asesor: próxima disponibilidad en agenda

### Decisión

- `findNextAvailableAgendaSlot` busca hasta 45 días con `computeAdvisorSlotAvailability`.
- Diagnóstico de fecha vacía: día no habilitado, anticipación mínima, cupo lleno o sin config.
- Componente compartido `AdvisorAgendaSlotPicker` para biométricos y firmas.
- Botón navega a fecha/hora sin cambiar sede.

### Archivos

- `agendaAdvisorNextAvailability.ts` (+ test), `AdvisorAgendaSlotPicker.tsx`
- Cards biométricos/firmas; `applyMinLeadHours` opcional en disponibilidad asesor.

## 2026-06-25 - UX asesor: sedes Monterrey/Apodaca en agenda

### Decisión

- Reutilizar `resolveCanonicalSedeId` vía `agendaAdvisorLocations.ts` para UI asesor.
- Selector muestra solo labels humanos; valor interno `monterrey`/`apodaca`.
- Reserva RPC: `bookLocationId` = canónico si está en config, si no primer legacy mapeable.
- Disponibilidad: cupo = max entre legacy de la ciudad; bookings sumados en todos los `sourceLocationIds`.
- Biométricos y firmas comparten helpers; sin tocar `agenda_bookings` ni RPC.

### Archivos

- `agendaAdvisorLocations.ts` (+ test), `weekly-availability.ts` (`computeAdvisorSlotAvailability`)
- `AgendaBiometricosSupabaseCard.tsx`, `AgendaFirmasSupabaseCard.tsx`

## 2026-06-25 - UX Cynthia: horarios rápidos en configuración de agendas

### Decisión

- Horarios con pills de un click (09:00–17:00) + botón «Usar jornada estándar».
- Input manual secundario; sin error rojo si está vacío; helper hasta primer intento inválido.
- Lógica pura en `agendaCynthiaSlots.ts` (merge, sort, validación manual).
- Mismo formulario compartido para biométricos y firmas; sin RPC ni schema.

### Archivos

- `AgendaWeeklyConfigForm.tsx`, `agendaCynthiaSlots.ts` (+ test), secciones biométricos/firmas.

## 2026-06-25 - UX Cynthia: configuración de agendas (biométricos + firmas)

### Decisión

- UI orientada a operación: título «Configuración de agendas», subtítulo amigable, sin copy técnico (RPC, Bloque A/B, `location_id`).
- Sedes canónicas fijas: **Monterrey** (`monterrey`) y **Apodaca** (`apodaca`); al cargar se colapsan IDs legacy conocidos; al guardar solo persisten esas dos.
- Zona horaria visible fija `America/Monterrey` (no editable en UI).
- Componente compartido `AgendaWeeklyConfigForm` para biométricos (sky) y firmas (violet).
- Helpers en `src/lib/agendaCynthiaLocations.ts` + tests; defaults vacíos con ambas sedes activas cupo 5.

### Archivos

- `AgendaWeeklyConfigForm.tsx`, `AgendaBiometricosWeeklySupabaseSection.tsx`, `AgendaFirmasWeeklySupabaseSection.tsx`
- `agendaCynthiaLocations.ts` (+ test), `map-agenda-config.ts` (defaults sedes)

## 2026-06-25 - P3R.0: Mesa Decision UX copy/visibilidad

### Decisión

- Copy unificado «Aceptar y avanzar» / «Confirmar aceptación» en paneles de avance existentes (1→10); sin RPC nuevo ni 10→11.
- «Solicitar corrección» reemplaza «Rechazar» solo donde hay backend real (`update_documento_revision`, `update_cliente_datos_revision`).
- Gates de visibilidad: docs integración solo etapa 1 o con corrección pendiente; datos generales etapa 1, rechazado, o etapa 8+ sin validar.
- `MesaCitaFirmasResumenSection` visible en etapas 9 y 10; etapa 10 read-only con nota P3Q.
- Aviso «sin rechazo directo» en avances operativos 2→3 … 7→8 y 9→10 (no en 8→9 ni cierre integración).

### Archivos

- `mesa-decision-ux.ts` (+ tests), `MesaAvanceOperativoSection`, `MesaCierreValidacionDocumentalSection`, `MesaCitaFirmasResumenSection`, `MesaExpedienteDetalleReadOnly`, secciones rechazo docs/datos/retención.

## 2026-06-25 - Merge origin/main en p3-supabase-connection

### Decisión

- Integrar 13 commits de `main` (monto_aprobado, decimales, locale es-MX, CSV admin) sin tocar flujo Supabase 1→10.
- Admin P3 conserva dashboard por expedientes; CSV exporta `dayList` / `filteredList` (no query directa a `precalificaciones` como en main legacy).
- `precalificaciones/supabase.repo.ts` eliminado (rama P3 usa mock store); `lib/monto.ts` unifica parseo/formato.
- `/revisor` mantiene redirect a `/editor` (P2B.1).

### Archivos tocados en merge

- `src/lib/monto.ts` (desde main)
- `src/app/admin/page.tsx` (+ CSV, formatMontoMX)
- `src/app/asesor/page.tsx` (formatMontoMX)
- `src/components/FormEditarPrecalificacion.tsx` (parseMontoAprobado)

## 2026-06-25 - P3P.3: Mesa avance 9→10 cita firma Supabase

### Decisión

- Reutilizar RPC `avanzar_etapa_operativa` (033): `fecha_cita` + booking `firmas` `booked`; **no** exige cita pasada.
- Roles Mesa: `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin` (asesor no avanza).
- UI espejo backend en `deriveAvanceOperativo9a10View`; resumen cita solo etapa 9.
- Patrón biométricos P3M.3/P3N.1: `MesaCitaFirmasResumenSection` + `MesaAvanceOperativoSection`.

### Archivos

- `src/domain/expedientes/mesa-avance-integracion.ts` (+ tests 9a10)
- `src/components/mesa-control/MesaCitaFirmasResumenSection.tsx`
- `src/components/mesa-control/MesaAvanceOperativoSection.tsx` (`MESA_AVANCE_OPERATIVO_9A10_COPY`)
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/domain/expedientes/avanzar-etapa-rpc-error.ts` (+ tests firma)

### No tocado

- Agenda asesor (P3P.2), cancel/reagendar firmas asesor, 10→11, migraciones, mock, biométricos.

## 2026-06-25 - P3P.2: Asesor agenda firma etapa 9 Supabase

### Decisión

- Espejo de biométricos P3M.2/P3M.4: `SupabaseAgendaFirmasBookingRepo` + `AgendaFirmasSupabaseCard`.
- Disponibilidad vía `computeWeeklySlotAvailability` sobre `agenda_config kind='firmas'` y bookings RLS.
- RPC `book_firmas` actualiza `fecha_cita` sin cambiar etapa (`no_etapa_change`).
- Incluye cancel/reagendar firmas (RPC 022) solo en etapa 9 con booking activo.
- Mock `AgendaFirmasAsesorCard` intacto en modo mock.

### Archivos

- `src/domain/agenda-firmas/supabase-booking.repo.ts`, RPC error mappers, `AgendaFirmasSupabaseCard.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`

## 2026-06-25 - P3P.1B: UI Cynthia agenda firmas Supabase

### Decisión

- Repo `SupabaseAgendaFirmasConfigRepo`: lectura `agenda_config kind='firmas'` + RPC `upsert_agenda_config_firmas`; reutiliza `map-agenda-config` de biométricos (mismo modelo semanal).
- `AgendaFirmasWeeklySupabaseSection` espejo de biométricos; warnings en UI.
- `AgendaBiometricosConfigPanel`: en `DATA_MODE=supabase` muestra bloques A/B Supabase y oculta mock firmas (`agenda_firmas_config_v1`).
- Sin booking asesor firmas (P3P.2); sin migraciones ni Cloud schema.

### Archivos

- `src/domain/agenda-firmas/*`
- `AgendaFirmasWeeklySupabaseSection.tsx`, `AgendaBiometricosConfigPanel.tsx`

## 2026-06-25 - P3P.1A: RPC upsert agenda firmas (local)

### Decisión

- Espejo de `upsert_agenda_config_biometricos` (034) con `kind='firmas'` fijo.
- Preproceso `agenda_firmas_normalize_config` antes de validar para aceptar legacy `minLeadDays`.
- Warnings vía `agenda_firmas_config_upsert_warnings` + `agenda_firmas_count_slot_booked`; no cancela bookings.
- Roles escritura: solo `mesa_admin`, `super_admin`; bloqueados `mesa_interno`, `mesa_externo`, `asesor`, `editor`.
- Auditoría: `action_log` → `agenda.firmas.config_upsert`.
- Migración `036_*` (035 reservada en Cloud para retención).
- Sin UI Cynthia ni repo TS en P3P.1A.

### Archivos

- `supabase/migrations/036_rpc_upsert_agenda_config_firmas.sql`
- `supabase/tests/rpc_upsert_agenda_config_firmas.sql`
- `scripts/test-sql.sh`, `docs/API_CONTRATOS.md` §8.2

## 2026-06-25 - P3N.4: Mesa avance 8→9 Supabase

### Decisión

- `deriveAvanceOperativo8a9View` reutiliza `getBloqueosRetencionAvanceEtapa8Mesa` + gates `cliente_datos` y `retencion_envios.estado`.
- Panel `MesaAvanceOperativoSection` con copy «La retención fue validada…»; confirmación modal; solo Mesa (`puedeRevisar`).
- RPC existente `avanzar_etapa_operativa` (P2C-17); sin migraciones ni firmas UI.

### Archivos

- `mesa-avance-integracion.ts`, `MesaExpedienteDetalleReadOnly.tsx`, `MesaAvanceOperativoSection.tsx`
- `docs/API_CONTRATOS.md` §10 avance 8→9

## 2026-06-25 - P3O.3: Retención etapa 8 Mesa Supabase

### Decisión

- Reutiliza RPC `update_documento_revision` (migración 018 hook retención) — rechazo `retencion_*` marca `retencion_envios.estado = correccion_requerida`.
- Sección `MesaRetencionAcuseAvisoSection` solo en `MesaExpedienteDetalleReadOnly` etapa 8; asesor sin cambios en P3O.3.
- Preview/descarga vía `getArchivoBlob` existente; sin botón avance 8→9 (informativo bloqueos).
- Mock intacto; sin migraciones.

### Archivos

- `mesa-retencion-docs.ts`, `MesaRetencionAcuseAvisoSection.tsx`, wire `MesaExpedienteDetalleReadOnly.tsx`
- `docs/API_CONTRATOS.md` §10 UI Mesa

## 2026-06-25 - P3O.2: Retención etapa 8 asesor Supabase

### Decisión

- Backend P3O.1 + P2C-16 suficiente: no RPC separado para guardar opción A/B; `enviar_retencion_mesa` hace upsert en `retencion_opciones` + `retencion_envios`.
- Opción A/B en estado local (`opcionDraft`) hasta primer envío; tras envío bloqueada hasta `correccion_requerida`.
- Upload: bucket `expediente-documentos` + RPC `register_expediente_documento_retencion` (gates etapa 8, `submitted_to_mesa`, `en_proceso`).
- Copy asesor: “Mesa revisará después del envío”; no implica validación Mesa ni avance 8→9 (P3O.3 / posterior).
- Mock intacto; sin migraciones ni Cloud schema.

### Archivos

- `expediente-retencion/supabase.repo.ts`, `asesor-retencion-panel.ts`, mappers errores RPC
- `RetencionAcuseAvisoSupabaseCard.tsx`, wire en `asesor/expediente/[id]/page.tsx`
- `docs/API_CONTRATOS.md` §9 UI asesor

## 2026-06-25 - P3N.3: Mesa avance 7→8 Supabase

### Decisión

- Transición **7→8** (Notificación → Acuse/Aviso retención) ya en RPC P2C-15; solo UI Mesa.
- Gates espejo SQL: etapa 7 + `en_proceso` + `submitted_to_mesa` + ciclo `activo`; sin flujo retención ni firmas.
- Patrón idéntico a P3N.2 (6→7); sin mock ni asesor.

### Archivos

- `mesa-avance-integracion.ts` — `deriveAvanceOperativo7a8View`
- `MesaExpedienteDetalleReadOnly.tsx` — panel + handler
- `docs/API_CONTRATOS.md` §7 transición 7→8

## 2026-06-25 - P3N.2: Mesa avance 6→7 Supabase

### Decisión

- Transición **6→7** (Inscripción → Notificación) ya en RPC P2C-14; solo UI Mesa.
- Gates espejo SQL: etapa 6 + `en_proceso` + `submitted_to_mesa` + ciclo `activo`; sin `fecha_cita` ni booking.
- Patrón idéntico a P3L.1/P3L.2 (2→3, 3→4); sin mock ni asesor.

### Archivos

- `mesa-avance-integracion.ts` — `deriveAvanceOperativo6a7View`
- `MesaExpedienteDetalleReadOnly.tsx` — panel + handler
- `docs/API_CONTRATOS.md` §7 transición 6→7

## 2026-06-25 - P3N.1: Mesa avance 5→6 post-cita biométrica Supabase

### Decisión

- Solo UI Mesa (`MesaExpedienteDetalleReadOnly`); reutiliza RPC `avanzar_etapa_operativa` P2C-13 sin migraciones.
- Gates UI espejan SQL: etapa 5 + `en_proceso` + `fecha_cita <= now()` + booking `biometricos/booked`.
- P3N.1 **no** registra resultado biométrico formal (aprobado/rechazado/evidencia); copy evita “biometría aprobada”.
- Resumen cita (`MesaCitaBiometricosResumenSection`) visible en etapas 4 y 5 con indicador cita pendiente/ocurrida.
- Asesor sin botón de avance; mock intacto.

### Archivos

- `src/domain/expedientes/mesa-avance-integracion.ts` — `deriveAvanceOperativo5a6View`
- `src/components/mesa-control/MesaCitaBiometricosResumenSection.tsx`
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `docs/API_CONTRATOS.md` §7 transición 5→6

## 2026-06-25 - P3M.4: cancel/reagenda biométricos asesor Supabase

### Decisión

- UI asesor en etapa 4 con booking activo: botones Cancelar / Reagendar sobre RPCs P2C-8 existentes.
- Cancel limpia `fecha_cita` y deja etapa 4; reagenda cancela booking anterior + nuevo `booked`.
- Mesa sin acciones (solo lectura); tras cancel Mesa no puede 4→5 (gates P3M.3).
- No-show fuera de alcance; sin migraciones ni cambios enum `booking_status`.

### Archivos

- `src/domain/agenda-biometricos/supabase-booking.repo.ts` + mappers cancel/reagenda
- `src/components/asesor/AgendaBiometricosSupabaseCard.tsx`
- `docs/API_CONTRATOS.md` §8.2/8.3

## 2026-06-25 - P3M.3: Mesa resumen cita biométrica y avance 4→5

### Decisión

- Solo ruta Supabase (`MesaExpedienteDetalleReadOnly`); mock gigante de `mesa-control/[id]` sin cambios.
- Gates UI en `deriveAvanceOperativo4a5View` espejan RPC 4→5: `fecha_cita` + booking `biometricos/booked`; subestado no bloquea.
- Booking activo vía `SupabaseAgendaBiometricosBookingRepo.getActiveBooking`; label sede desde `agenda_config`.
- Avance con `expedientesRepo.avanzarEtapaOperativa` existente; no modifica booking ni `fecha_cita`.
- Sin migraciones, sin Cloud schema, sin 5→6, cancel/reagendar ni firmas.

### Archivos

- `src/components/mesa-control/MesaCitaBiometricosResumenSection.tsx` (nuevo)
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/components/mesa-control/MesaAvanceOperativoSection.tsx` (`MESA_AVANCE_OPERATIVO_4A5_COPY`, bloqueos)
- `src/domain/expedientes/mesa-avance-integracion.ts` + tests
- `src/domain/expedientes/avanzar-etapa-rpc-error.ts` + tests

## 2026-06-25 - P3M.2: agenda biométricos asesor Supabase (etapa 4)

### Decisión

- Rama Supabase de `/asesor/expediente/[id]` monta `AgendaBiometricosSupabaseCard` (no se modifica `AgendaBiometricosCard` mock).
- Disponibilidad semanal en cliente (`weekly-availability.ts`) espeja reglas de `agenda_biometricos_assert_slot_available`; cupo final lo valida RPC.
- `book_biometricos` persiste `agenda_bookings` + `expedientes.fecha_cita`; etapa permanece 4.
- Sin cancel/reagendar UI; sin Cloud deploy.

### Archivos

- `src/components/asesor/AgendaBiometricosSupabaseCard.tsx`
- `src/domain/agenda-biometricos/supabase-booking.repo.ts`, `weekly-availability.ts`, `book-biometricos-rpc-error.ts`, tests
- `src/app/asesor/expediente/[id]/page.tsx`

### No tocado

- Mock/localStorage, migraciones, Cloud repair, `033`, avance 4→5, `AgendaBiometricosConfigPanel` (salvo tipos compartidos).

## 2026-06-25 - P3M.1B: UI config biométricos Supabase (Mesa)

### Decisión

- Bifurcación por `NEXT_PUBLIC_DATA_MODE=supabase`: biométricos usa repo + RPC; mock conserva calendario por día en localStorage.
- Modelo UI semanal (`AgendaBiometricosWeeklyConfig`) mapeado a JSON canónico SQL vía `map-agenda-config.ts`.
- Permisos UI: `mesa_admin` (Cynthia → `mesa_control_admin`) y `super_admin`; otros roles solo lectura sin guardado.
- Firmas permanece mock en P3M.1B; `AgendaBiometricosCard` asesor sin cambios.

### Archivos

- `src/domain/agenda-biometricos/supabase.repo.ts`, `map-agenda-config.ts`, tests
- `src/components/mesa-control/AgendaBiometricosWeeklySupabaseSection.tsx`
- `src/components/mesa-control/AgendaBiometricosConfigPanel.tsx`, `src/app/mesa-control/page.tsx`

### No tocado

- Cloud deploy migración `034`, `033`, `AgendaBiometricosCard`, avance 4→5, cancel/reagendar.

## 2026-06-25 - P3M.1A: RPC upsert_agenda_config_biometricos

### Decisión

- Numeración migración **034** (033 reservado en `production-backend`).
- Escritura solo `mesa_admin` / `super_admin`; Cynthia opera como `mesa_admin`.
- Modelo semanal SQL canónico; sin portar mock por día; sin vigencia por fecha ni excepciones por día en P3M.1.
- `kind = biometricos` fijo; claves `config`: `enabled`, `timezone`, `min_lead_hours`, `allowed_weekdays`, `slots`, `locations`.
- Reducción de disponibilidad con bookings futuros: `warnings` no bloqueantes + `action_log`; sin cancelación automática.
- Reutiliza `agenda_biometricos_normalize_config` (012); validación nueva `agenda_biometricos_validate_config`.

### Archivos

- `supabase/migrations/034_rpc_upsert_agenda_config_biometricos.sql`
- `supabase/tests/rpc_upsert_agenda_config_biometricos.sql` (18 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`, `docs/API_CONTRATOS.md`

### No tocado

- UI (`AgendaBiometricosConfigPanel`, `AgendaBiometricosCard`), avance 4→5, cancel/reagendar UI, Cloud deploy, migración 033, mock/Storage/DATA_MODE.

## 2026-06-25 - P3L.2: avance operativo Mesa 3→4 (UI Supabase)

### Decisión

- Reutilizar `MesaAvanceOperativoSection` parametrizado con `copy` por transición (2→3 y 3→4).
- Gates 3→4: etapa 3 + `en_proceso` + `submitted_to_mesa` + `ciclo_estado === 'activo'` (estricto; sin aceptar null).
- Copy obligatorio: el avance 3→4 no agenda la cita biométrica; el asesor la agenda en etapa 4.
- Mismo RPC `avanzar_etapa_operativa`; sin optimismo; `load()` tras éxito.
- **Deuda técnica:** P3L.1 2→3 sigue aceptando `cicloEstado null`; P3L.2 no. Alinear en bloque futuro.

### Archivos

- `src/components/mesa-control/MesaAvanceOperativoSection.tsx`
- `src/domain/expedientes/mesa-avance-integracion.ts` + tests
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/domain/expedientes/index.ts`

## 2026-06-25 - P3L.1: avance operativo Mesa 2→3 (UI Supabase)

### Decisión

- Panel separado «Avance operativo Mesa» (no timeline mock); visible solo etapa 2 + `en_proceso` + enviado + ciclo activo.
- RPC existente `avanzar_etapa_operativa` vía `SupabaseExpedientesRepo.avanzarEtapaOperativa`; sin avance optimista; `load()` tras éxito.
- Sin 3→4, denegar operativo ni `SeguimientoOperativoMock` en Supabase.

### Archivos

- `src/components/mesa-control/MesaAvanceOperativoSection.tsx`
- `src/domain/expedientes/mesa-avance-integracion.ts` + tests
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/domain/expedientes/index.ts`

## 2026-06-25 - P3K.1: cierre validación documental y avance 1→2 (UI)

### Decisión

- Sin migración SQL nueva: reutilizar `avanzar_etapa_operativa` + gates ya alineados con 032 (5 obligatorios).
- Panel «Cierre de validación documental» en detalle Mesa Supabase read-only: checklist, bloqueos explícitos, modal de confirmación, RPC y `load()` post-avance.
- `deriveCierreValidacionDocumentalView` centraliza vista UI; complementarios solo informativos.

### Archivos

- `src/components/mesa-control/MesaCierreValidacionDocumentalSection.tsx`
- `src/domain/expedientes/mesa-avance-integracion.ts`
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `supabase/tests/rpc_avanzar_etapa_operativa.sql` (tests 16–17 complementarios / datos no validados)

## 2026-06-25 - P3K.2: complementarios Mesa opcionales (no bloquean 1→2)

### Decisión

- Regla corregida: `cliente_semanas_cotizadas`, `cliente_acta_nacimiento`, `cliente_constancia_sat` son complementarios opcionales.
- Migración `032`: `integration_doc_tipos_obligatorios()` = `integration_doc_tipos_asesor_envio()` (5). `integration_doc_tipos_mesa_upload()` sin cambio (3 tipos).
- Avance 1→2 vía `avanzar_etapa_operativa` + `integration_docs_todos_validados`: solo 5 docs asesor `validado` + `cliente_datos.validado`.
- UI complementarios: sin sección Revisión; badge «Opcional / Complementario»; presencia «Faltante» / «Cargado».
- **No aplicar 032 en Cloud hasta commit local y smoke post-migración.**

### Archivos

- `supabase/migrations/032_mesa_complementarios_opcionales.sql`
- `supabase/tests/mesa_complementarios_opcionales.sql`
- `src/domain/expediente-archivos/integration-docs-completos.ts`
- `src/domain/expediente-archivos/mesa-complementarios-docs.ts`
- `src/components/mesa-control/MesaControlDocumentosComplementariosSection.tsx`
- `src/domain/expedientes/mesa-avance-integracion.ts`

## 2026-06-25 - P3K.1: Continuar integración Mesa (1→2)

### Decisión

- Sin SQL nuevo: reutilizar `avanzar_etapa_operativa(p_expediente_id, p_comentario?)` ya desplegada en Production.
- Transición: `etapa_actual=1` + `en_validacion_mesa` → `etapa_actual=2` + `en_proceso`.
- Gates UI en `mesa-avance-integracion.ts` espejo de RPC: `cliente_datos.validado` + `integration_docs_todos_validados` (7 tipos; acta/SAT por Mesa).
- `ExpedientesRepo.avanzarEtapaOperativa()` en Supabase + stub mock (`updateOperativo`).
- UI: `MesaExpedienteDetalleReadOnly` — botón Continuar, lista de bloqueos, éxito verde, `load()` post-RPC.

### Archivos

- `src/domain/expedientes/mesa-avance-integracion.ts`
- `src/domain/expedientes/avanzar-etapa-rpc-error.ts`
- `src/domain/expedientes/supabase.repo.ts`
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/domain/expediente-archivos/integration-docs-completos.ts` (`integrationDocsTodosValidados`)

## 2026-06-25 - P3J Cloud: migraciones 029/030/031 en Supabase Production

### Decisión

- Despliegue **manual** en SQL Editor (no `supabase db push`): `029_rpc_update_cliente_datos_revision.sql` → `030_rpc_register_mesa_documento.sql` → `031_rpc_correcciones_asesor_post_mesa.sql`.
- Contenido aplicado = archivos en repo (SHA-256: `029` `7a1760c3…`, `030` `62877c8d…`, `031` `51932483…`).
- Verificación post-aplicación: 6 funciones/helpers + `integration_doc_tipos_mesa_upload()` + policies `expediente_documentos_storage_insert`/`_delete` con ramas asesor + mesa + corrección asesor.
- Historial remoto de migraciones Supabase CLI puede quedar desalineado hasta reconciliar; el estado real de Production es la fuente de verdad.
- Siguiente paso operativo: push rama `p3-supabase-connection` + deploy frontend con commits P3J.3–P3J.6.

### Archivos (repo, sin cambio de SQL)

- `supabase/migrations/029_rpc_update_cliente_datos_revision.sql` (172 líneas)
- `supabase/migrations/030_rpc_register_mesa_documento.sql` (386 líneas)
- `supabase/migrations/031_rpc_correcciones_asesor_post_mesa.sql` (900 líneas)

## 2026-06-25 - P3J.6: corrección asesor post-rechazo Mesa

### Auditoría (funciones existentes)

- **`register_expediente_documento`:** no tocada; sigue bloqueando `submitted_to_mesa=true` para upload inicial.
- **`register_mesa_documento`:** no tocada; Mesa complementarios intactos.
- **`update_documento_revision` / `update_cliente_datos_revision`:** no tocadas; Mesa revalida con las mismas RPCs.
- **`save_cliente_datos`:** parcheada en migración `031` vía `set_config('concasa.cliente_datos_correccion','1')` para permitir guardado solo cuando datos `rechazado` y expediente enviado; flujo normal pre-envío sin cambios.
- **Storage policies INSERT/DELETE:** tercera rama OR `expediente_documento_storage_asesor_correccion_allowed` (no amplía upload pre-Mesa ni tipos Mesa).

### Decisión

- Corrección documental: nueva RPC `register_expediente_documento_correccion` — requiere doc activo `estatus_revision='rechazado'`, soft-delete anterior, nueva versión `resubido`, `action_log` `expediente.documento.asesor_correccion`.
- Corrección datos: wrapper `save_cliente_datos_correccion` delega a `save_cliente_datos` con flag; limpia `comentario_rechazo`/`rejected_*`/`validated_*`; `action_log` `cliente_datos.correccion_post_mesa`.
- UI asesor: upload bloqueado post-envío salvo ítems rechazados; formulario datos editable solo si `estado='rechazado'`.
- UI Mesa: etiqueta `resubido` → “Corregido por asesor”; datos `completo` post-envío → “Corregido, pendiente de revisión”.
- Migración `031` desplegada en Production (manual); ver entrada P3J Cloud arriba.

### Archivos

- `supabase/migrations/031_rpc_correcciones_asesor_post_mesa.sql`
- `supabase/tests/rpc_correcciones_asesor_post_mesa.sql`
- `src/domain/expediente-archivos/asesor-correccion-post-mesa.ts`
- `src/domain/expediente-archivos/register-expediente-documento-correccion-rpc-error.ts`
- `src/domain/expediente-archivos/supabase.repo.ts` (`correctArchivoRechazado`)
- `src/domain/expediente-cliente-datos/supabase.repo.ts` (`saveCorreccion`)
- `src/components/asesor/AsesorIntegracionDocsUpload.tsx`
- `src/components/asesor/ExpedienteClienteDatosFormSection.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`
- `src/components/mesa-control/MesaDocumentosAsesorSection.tsx`
- `src/components/mesa-control/MesaControlDocumentosComplementariosSection.tsx`
- `src/components/mesa-control/MesaClienteDatosReadOnlySection.tsx`


## 2026-06-25 - P3J.5: documentos complementarios / upload Mesa

### Decisión

- Migración `030_rpc_register_mesa_documento.sql`: `integration_doc_tipos_mesa_upload()`, `register_mesa_documento`, policy Storage Mesa (desplegada en Production manual).
- Tipos Mesa: `cliente_semanas_cotizadas`, `cliente_acta_nacimiento`, `cliente_constancia_sat`.
- UI: `MesaDocumentosAsesorSection` (5 docs) + `MesaControlDocumentosComplementariosSection` (3 docs con upload).

### Archivos

- `supabase/migrations/030_rpc_register_mesa_documento.sql`
- `src/components/mesa-control/MesaControlDocumentosComplementariosSection.tsx`
- `src/domain/expediente-archivos/mesa-complementarios-docs.ts`
- `src/domain/expediente-archivos/register-mesa-documento-rpc-error.ts`
- `src/domain/expediente-archivos/supabase.repo.ts`

## 2026-06-15 - P3J.4b: revisión datos generales Mesa + panel rediseñado

### Decisión

- **No existía RPC** para revisar `cliente_datos` (solo `save_cliente_datos` asesor). RLS: solo SELECT en `cliente_datos` para `authenticated`; sin UPDATE directo.
- Migración `029_rpc_update_cliente_datos_revision.sql`: `update_cliente_datos_revision(p_expediente_id, p_estado, p_comentario_rechazo)` — roles mesa_*, gate `submitted_to_mesa`, `action_log` `cliente_datos.revision.update` (desplegada en Production manual).
- Frontend Supabase llama RPC vía `updateEstado()`; si RPC no está desplegada, mensaje claro al usuario.
- Panel `MesaClienteDatosReadOnlySection`: header + badge + cards + modal rechazo con motivos.
- **Corrección asesor post-Mesa bloqueada:** `save_cliente_datos` lanza `expediente ya enviado a Mesa` (hueco resuelto en P3J.6).

### Archivos

- `supabase/migrations/029_rpc_update_cliente_datos_revision.sql`
- `src/components/mesa-control/MesaClienteDatosReadOnlySection.tsx`
- `src/domain/expediente-cliente-datos/supabase.repo.ts`
- `src/domain/expediente-cliente-datos/mesa-cliente-datos-rechazo-motivos.ts`
- `src/domain/expediente-cliente-datos/update-cliente-datos-revision-rpc-error.ts`

## 2026-06-15 - P3J.4: datos generales completos y revisión documental Mesa (Supabase)

### Decisión

- Parte A: `MesaClienteDatosReadOnlySection` con 7 secciones; lectura de columna `imagenes` (metadata, sin preview Storage).
- Parte B: `SupabaseExpedienteArchivosRepo.updateRevision()` → RPC `update_documento_revision`.
- Parte C: rechazo persiste `estatus_revision=rechazado` + `comentario_mesa`; asesor ve motivo en checklist.
- Sin subestado `correccion_documental`; no se toca `submitted_to_mesa` ni avance de etapa.

### Archivos

- `src/components/mesa-control/MesaClienteDatosReadOnlySection.tsx`
- `src/components/mesa-control/MesaDocumentosAsesorSection.tsx`
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/domain/expediente-archivos/supabase.repo.ts`
- `src/domain/expediente-archivos/mesa-rechazo-motivos.ts`
- `src/domain/expediente-archivos/update-documento-revision-rpc-error.ts`

## 2026-06-15 - P3J.3: preview/descarga documentos Mesa Control (Supabase)

### Decisión

- Reutilizar `getArchivoBlob(id)` del contrato: SELECT `storage_path` en `expediente_documentos` (RLS) + `storage.download` con JWT.
- UI: botones **Ver archivo** / **Descargar** solo si hay fila y estatus ≠ faltante; modal reutiliza helpers `archivoPreviewMime`.
- Sin signed URL en pantalla; blob URL efímera en cliente. Sin API route ni service role.

### Archivos

- `src/domain/expediente-archivos/supabase.repo.ts`
- `src/domain/expediente-archivos/mesa-archivo-acceso.ts`
- `src/domain/expediente-archivos/mesa-integration-docs.ts`
- `src/components/mesa-control/MesaArchivoPreviewDialog.tsx`
- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`

## 2026-06-15 - P3J.2: detalle Mesa Control read-only (Supabase)

### Decisión

- Wrapper en `page.tsx`: `isDataModeSupabase()` → `MesaExpedienteDetalleReadOnly`; mock sin cambios (`MesaControlExpedienteMockPage`).
- `getById` vía RLS: null = no acceso o no existe (mensaje unificado).
- Documentos: checklist integración asesor (5+1) read-only; sin validar/rechazar/preview.
- Reutiliza `AsesorSeguimientoOperativo` para timeline 12 etapas.

### Archivos

- `src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx`
- `src/app/mesa-control/[id]/page.tsx` (wrapper)

## 2026-06-15 - P3J.1: bandeja Mesa Control read-only (Supabase)

### Decisión

- `listForMesaControl()` en contrato expedientes; Supabase consulta `expedientes` con `submitted_to_mesa`, `ciclo_estado=activo`, `deleted_at IS NULL`; orden `fecha_envio_mesa DESC`.
- RLS `can_see_expediente` filtra por `mesa_admin` / `mesa_interno` / `mesa_externo`; sin filtro cliente duplicado en Supabase.
- `/mesa-control` deja de instanciar `MockExpedientesRepo` directo; mock conserva inbox LS + `filterExpedientesByRole`.
- Detalle `/mesa-control/[id]` fuera de alcance (sigue mock).

### Archivos

- `src/domain/expedientes/repo.ts`, `mock.repo.ts`, `supabase.repo.ts`
- `src/app/mesa-control/page.tsx`, `mockData.ts`
- `src/domain/expedientes/list-for-mesa-control.test.ts`

## 2026-06-15 - P3I.1: timeline operativo asesor read-only (Supabase)

### Decisión

- Bloque `AsesorSeguimientoOperativo` en `/asesor/expediente/[id]` solo modo Supabase.
- 12 etapas oficiales; sin acciones Mesa ni documentos legacy.
- Datos: `etapa_actual`, `subestado`, `submitted_to_mesa`, `fecha_envio_mesa`, `updated_at`, `ciclo_estado`, `origen_mesa`.
- Sin migraciones ni cambios Cloud.

### Archivos

- `src/components/asesor/AsesorSeguimientoOperativo.tsx`
- `src/domain/expedientes/asesor-seguimiento-operativo.ts` + tests
- `src/domain/expedientes/map-supabase-row.ts`, `supabase.repo.ts`
- `src/app/asesor/expediente/[id]/page.tsx`

## 2026-06-15 - P3H.2b: catálogo documental sin duplicados

### Decisión

- Gate `enviar_a_mesa`: **5** obligatorios (`nss` + 4 `cliente_*`); sin legacy `ine`/`estado_cuenta`/`direccion`.
- Upload/RPC/Storage asesor: **6** tipos vía `integration_doc_tipos_asesor_upload()` (5 + `cliente_semanas_cotizadas` opcional). **No** incluye acta ni constancia SAT.
- Validación Mesa 1→2: **7** validados (5 asesor + acta + constancia SAT). Acta y constancia las sube **Mesa de Control** por expediente; fuera del panel/upload asesor.
- Tipos legacy permanecen en catálogo TypeScript/DB histórica; fuera de gates y UI Supabase asesor.
- Migración `028` local; **no** Cloud en este bloque.

### Archivos

- `supabase/migrations/028_integration_doc_tipos_sin_duplicados.sql`
- `src/domain/expediente-archivos/integration-docs-completos.ts` + tests
- `src/components/asesor/AsesorIntegracionDocsUpload.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `supabase/tests/rpc_enviar_a_mesa.sql`, `rpc_register_expediente_documento.sql`

## 2026-06-15 - P3H.2: upload documentos asesor (Storage + RPC)

### Decisión

- Bucket privado `expediente-documentos`; path `{org}/{exp}/{tipo}/{uuid}-{nombre}`.
- Metadata solo vía RPC `register_expediente_documento` (SECURITY DEFINER); sin INSERT directo desde cliente.
- Versión en DB (`max+1`); UUID en path evita colisión sin leer versión en frontend.
- Si RPC falla tras upload, cliente intenta `storage.remove` del objeto huérfano.
- Preview/descarga diferida (P3H.2b).
- Migración `027` local; **no** Cloud en este bloque.

### Archivos

- `supabase/migrations/027_rpc_register_expediente_documento.sql`
- `supabase/tests/rpc_register_expediente_documento.sql`
- `src/domain/expediente-archivos/supabase.repo.ts`, `storage-path.ts`, `upload-constraints.ts`
- `src/components/asesor/AsesorIntegracionDocsUpload.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`

## 2026-06-15 - P3H.1c: documentos asesor 8 vs validación Mesa 10

### Decisión

- SQL: `integration_doc_tipos_asesor_envio()` (8) para `count_integration_docs_presentes` / `enviar_a_mesa`.
- `integration_doc_tipos_obligatorios()` (10) intacto para `count_integration_docs_validados` y avance 1→2.
- Acta y constancia SAT: `ownerRole: mesa` en catálogo; fuera del checklist/upload asesor.
- `cliente_historial_laboral`: eliminado del listado mock; permanece en catálogo para datos legacy.
- Migración `026` en repo; **no** aplicada en Cloud en este bloque.

### Archivos

- `supabase/migrations/026_integration_doc_tipos_asesor_envio.sql`
- `src/domain/expediente-archivos/integration-docs-completos.ts` + tests
- `src/domain/expediente-archivos/types.ts`, `checklist.ts`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`
- `supabase/tests/rpc_enviar_a_mesa.sql`

## 2026-06-15 - P3H.1: documentos Supabase read-only en asesor

### Decisión

- Lectura RLS de `expediente_documentos` sin migración ni Storage.
- Helper `integrationDocsCompletos` espejo de `integration_doc_tipos_obligatorios` + estatus `subido|resubido|validado`.
- Gate Enviar a Mesa usa cálculo real; upload diferido a P3H.2 (RPC + bucket).
- Mock IndexedDB y `getChecklistDocumentos` sin cambios de comportamiento.

### Archivos

- `src/domain/expediente-archivos/supabase.repo.ts`, `integration-docs-completos.ts`, mapper + tests
- `src/app/asesor/expediente/[id]/page.tsx` — panel Documentos requeridos + checklist OK/Falta

## 2026-06-15 - P3G: datos generales cliente Supabase en asesor

### Decisión

- RPC existente `save_cliente_datos(p_expediente_id, p_rfc, p_telefono, p_referencias, p_imagenes, p_datos, p_estado)` sin migración nueva.
- `SupabaseExpedienteClienteDatosRepo`: SELECT `cliente_datos` con RLS; guardado vía RPC; mock `localStorage` sin cambios.
- UI Supabase: formulario datos generales + estados cargando/guardando/guardado/error; checklist Enviar a Mesa.
- Botón Enviar a Mesa bloqueado hasta editor aprobado + datos completos guardados + documentos (P3H: `documentosRealesConectados=false`).
- Extracción `ExpedienteClienteDatosFormSection` compartida mock/Supabase.

### Archivos

- `src/domain/expediente-cliente-datos/*` (supabase.repo, mapper, rpc-error, tests)
- `src/components/asesor/ExpedienteClienteDatosFormSection.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`

## 2026-06-15 - P3F.1b: layout editor prioriza monto/notas

### Decisión

- Solo UX en `/editor`: `table-fixed` + `min-w-[1500px]` + `colgroup` con anchos por columna.
- Monto (160–180px) y notas (280–320px) con fondo sutil; asesor/cliente truncados con `title`.
- Contenedor amplio (`max-w-[min(100%,96rem)]`); scroll horizontal en wrapper. Sin cambios de lógica/autosave.

### Archivos

- `src/app/editor/page.tsx`

## 2026-06-15 - P3F.1: restaurar UX legacy editor

### Decisión

- P3F conectó RPC real pero introdujo columna Acciones con botones; producto exige UI tipo lista legacy (monto/notas → decisión automática).
- Supabase: debounce 750ms por fila antes de `upsertEditorDecision`; indicador por fila (Pendiente… / Guardando… / Guardado / Error); sin RPC por tecla.
- Mock: mismo flujo legacy — `onChange` actualiza fila y llama `upsertEditorDecision` (delega a `updateDecision` / localStorage).
- Regla decisión: monto > 0 → `aprobado`; notas sin monto → `no_cumple`; ambos vacíos → `pendiente`.
- Columnas: creada, programa, NSS, cliente, teléfono, asesor, decisión, monto, notas.

### Archivos

- `src/app/editor/page.tsx`

## 2026-06-15 - P3F: editor decisión real Supabase

### Decisión

- RPC `upsert_editor_decision(p_expediente_id, p_decision, p_monto_aprobado, p_motivo)` sin migración nueva.
- Contrato: `listForEditor()` + `upsertEditorDecision()`; mock delega a `updateDecision` / `listForEditor` existentes.
- `/editor` y `/editor/[id]` usan `useExpedientesRepo()`; errores `ExpedientesSupabaseError`; validación monto > 0 en aprobado.
- RLS editor ya permite SELECT org; mutación solo RPC.

### Archivos

- `repo.ts`, `mock.repo.ts`, `supabase.repo.ts`, `upsert-editor-decision.*`
- `src/app/editor/page.tsx`, `src/app/editor/[id]/page.tsx`

## 2026-06-15 - P3E.1: bloqueo UI envío a Mesa sin editor

### Decisión

- `enviarAMesa(expedienteId)` en contrato; Supabase llama RPC `enviar_a_mesa` (sin service role) y recarga con `getById`.
- Errores RPC → `mapEnviarAMesaRpcError` (mensajes en español); la RPC es fuente de verdad de gates.
- Mock: `enviarAMesaWithPayload` conserva flujo SeguimientoOperativoMock; `enviarAMesa(id)` wrapper para contrato.
- UI Supabase: sección “Enviar a Mesa” con confirmación, loading, éxito/error; nota de validación Supabase.
- Sin migraciones; sin conectar documentos/cliente_datos/editor UI en este bloque.

### Archivos

- `repo.ts`, `mock.repo.ts`, `supabase.repo.ts`, `supabase.error.ts`, `enviar-mesa-rpc-error.ts`
- `src/app/asesor/expediente/[id]/page.tsx`
- `enviar-mesa-rpc-error.test.ts`

## 2026-06-15 - P3D: detalle asesor read-only Supabase

### Decisión

- `getById(id)` en contrato; mock sin cambios; Supabase: `.eq('id').maybeSingle()` + mismo SELECT/mapper P3B.
- RLS decide permiso; 0 filas → `null`; errores → `ExpedientesSupabaseError`.
- `/asesor/expediente/[id]`: `useExpedientesRepo()`; banner read-only; panel estado (editor + operativo).
- Modo Supabase oculta SeguimientoOperativoMock, cliente_datos LS, documentos IndexedDB, agenda mock.
- Mock: página completa intacta.

### Archivos

- `src/domain/expedientes/repo.ts`, `supabase.repo.ts`, `src/app/asesor/expediente/[id]/page.tsx`

## 2026-06-15 - P3B.2: bandeja `/asesor` read-only Supabase

### Decisión

- `listForAsesor(asesorEmail)` en contrato; mock filtra por email; Supabase usa JWT (`session.user.id`) + RLS + `.eq('asesor_id', userId)`.
- Reutiliza SELECT/mapper de P3B.1 (`mapSupabaseRowToExpedienteMock`).
- `/asesor` migra a `useExpedientesRepo()`; `listError` visible; vacío Supabase: "Aún no tienes expedientes."
- Filtros/KPIs client-side sin cambios; documentación/detalle siguen mock.

### Archivos

- `src/domain/expedientes/repo.ts`, `supabase.repo.ts`, `src/app/asesor/page.tsx`

## 2026-06-15 - P3C: crear expediente real desde `/asesor/nueva`

### Decisión

- RPC `create_expediente` SECURITY DEFINER (migración 025): solo rol `asesor` activo; `organization_id` y `asesor_id` desde perfil/JWT; `origen_mesa` desde `profiles.tipo_asesor_origen` (fallback `interno`).
- Estado inicial: `ciclo_estado=activo`, `etapa_actual=1`, `subestado=pendiente`, `submitted_to_mesa=false`; fila `editor_decisions` pendiente en la misma transacción; `action_log` `expediente.create`.
- Rechazo duplicado activo `(organization_id, nss, programa)`; sin INSERT directo (RLS).
- Frontend: `useExpedientesRepo().createExpediente()`; mock sigue escribiendo `precalificaciones_mock`.
- **Fuera de alcance:** `listForAsesor` Supabase (P3B.2); mesa/editor/agenda/documentos/detalle.

### Archivos

- `supabase/migrations/025_rpc_create_expediente.sql`, `supabase/tests/rpc_create_expediente.sql`
- `src/domain/expedientes/create-expediente.input.ts`, `map-programa.ts`, `repo.ts`, `mock.repo.ts`, `supabase.repo.ts`, `map-supabase-row.ts`, `index.ts`
- `src/app/asesor/nueva/page.tsx`
- Tests: `map-programa.test.ts`, `map-supabase-row.test.ts` (RPC mapper)

## 2026-06-15 - P3B.1: admin listado read-only Supabase

### Decisión

- Flag datos: `NEXT_PUBLIC_DATA_MODE=supabase` (default mock); independiente de auth P3A.
- Primer módulo datos: solo `/admin` → `listForAdmin()` read-only.
- SELECT con JWT usuario (RLS); sin service role ni RPC nueva.
- Mapper `map-supabase-row.ts`: `programa` enum DB → labels UI; `asesor_id` → email vía embed `profiles`; tolera `editor_decisions`/asesor ausentes.
- Listado vacío = estado limpio; errores auth/config en `ExpedientesSupabaseError`.

### Archivos

- `src/lib/dataMode.ts`, `src/domain/expedientes/repo.ts`, `index.ts`, `supabase.repo.ts`, `map-supabase-row.ts`
- `src/app/admin/page.tsx` — `useExpedientesRepo()`
- Tests: `dataMode.test.ts`, `map-supabase-row.test.ts`

## 2026-06-15 - P3A: Auth Supabase mínima (login/logout)

### Decisión

- Solo auth: `signInWithPassword` + `SELECT` en `public.profiles` por `auth.uid()`.
- Validar `profiles.active = true`; si inactivo → `signOut` + mensaje claro.
- Mapeo `app_role` → rol mock UI (`mesa_admin`→`mesa_control_admin`, etc.); sin rol `revisor`.
- `organization_id` se lee del perfil pero **no** se persiste en `mock_user` (contrato mock intacto).
- Puente temporal: `persistMockUser` sincroniza `mock_user`, `mock_role`, `mock_email` para no romper UI mock.
- Flag `NEXT_PUBLIC_USE_SUPABASE_AUTH=true` + `isSupabaseConfigured()`; si no → login mock actual.
- Sin expedientes, agenda, documentos, editor_decisions, precalificaciones, migraciones ni `db push`.

### Archivos

- `src/lib/supabaseBrowser.ts` — `isSupabaseAuthEnabled()`
- `src/domain/session/supabase.repo.ts` — `SupabaseSessionRepo`
- `src/domain/session/index.ts` — factory mock/Supabase
- `src/app/login/page.tsx` — dual mock/Supabase
- `src/lib/loginRedirect.ts` — redirect post-login compartido
- Tests: `supabase.repo.test.ts`, `loginRedirect.test.ts`

## 2026-06-15 - P2C-21: backfill agenda_config firmas

### Decisión

- Producción: `seed.sql` solo inserta `biometricos`; `book_firmas` / `reagendar_firmas` requieren fila `kind=firmas`.
- Migración `024`: función `backfill_agenda_config_firmas()` + ejecución inicial idempotente (`ON CONFLICT DO NOTHING`; no UPDATE de existentes).
- Config canónica vía `agenda_firmas_normalize_config('{}')` (mty-centro, slots 09–16h, min_lead 24h).
- Sin cambios a `seed.sql`, UI, Storage, DATA_MODE.

### Archivos

- `supabase/migrations/024_backfill_agenda_config_firmas.sql`
- `supabase/tests/backfill_agenda_config_firmas.sql` (7 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`, `docs/API_CONTRATOS.md`

## 2026-06-15 - P2C-20: avanzar_etapa_operativa 9→10

### Decisión

- Rama `ELSIF etapa_actual = 9` en `avanzar_etapa_operativa`: solo `mesa_admin` y `super_admin` (no `mesa_interno`/`mesa_externo`).
- Gates: `fecha_cita IS NOT NULL` + booking `firmas` con `status = booked` (enum real; no existe `scheduled`).
- Actualiza `etapa_actual = 10`, mantiene `subestado = en_proceso`; **no** modifica `fecha_cita` ni bookings.

### Archivos

- `supabase/migrations/023_rpc_avanzar_etapa_9_10.sql`
- `supabase/tests/rpc_avanzar_etapa_9_10.sql` (14 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`, `docs/API_CONTRATOS.md`

## 2026-06-15 - P2C-19: cancel_firmas + reagendar_firmas

### Decisión

- Patrón biométricos P2C-8 adaptado a firmas: roles `asesor` dueño + `mesa_admin` + `super_admin`.
- Gates etapa **9 o 10** (permite cancel/reagendar con cita activa sin avance automático 9→10).
- `reagendar_firmas`: cancela booking anterior **antes** de `agenda_firmas_assert_slot_available` (cupo no cuenta booking previo).
- Limpia/actualiza `fecha_cita`; **no** cambia `etapa_actual`.
- Sin avance 9→10, UI, Storage, DATA_MODE.

### Archivos

- `supabase/migrations/022_rpc_firmas_cancel_reagendar.sql`
- `supabase/tests/rpc_firmas_cancel_reagendar.sql` (44 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`, `docs/API_CONTRATOS.md`

### No tocado

- UI mock, seed, migraciones 001–021, avance 9→10, Storage, DATA_MODE.

## 2026-06-15 - P2C-18: agenda_config firmas + book_firmas

### Decisión

- Helpers `agenda_firmas_*` separados de biométricos; config canónica JSON con `min_lead_hours`, `locations`, `slots`.
- `book_firmas`: asesor dueño + `mesa_admin` + `super_admin`; etapa 9; persiste booking + `fecha_cita`; **no** cambia `etapa_actual`.
- Índice único parcial un `booked` firmas por expediente.
- Sin `cancel_firmas`, `reagendar_firmas`, avance 9→10, UI, Storage.

### Archivos

- `supabase/migrations/020_agenda_config_firmas_rules.sql`
- `supabase/migrations/021_rpc_book_firmas.sql`
- `supabase/tests/rpc_book_firmas.sql` (37 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`, `docs/API_CONTRATOS.md`

### No tocado

- UI mock, seed, migraciones 001–019, cancel/reagendar firmas, avance 9→10, Storage, DATA_MODE.

## 2026-06-15 - P2C-17: avanzar_etapa_operativa 8→9

### Decisión

- Rama `ELSIF etapa_actual = 8` en `avanzar_etapa_operativa`: Mesa avanza a etapa 9 solo con retención enviada y documentos requeridos `validado`.
- Opción efectiva: `retencion_envios.opcion` (fallback `retencion_opciones.retencion_opcion` por compatibilidad; schema actual NOT NULL en envío).
- Reutiliza helper `retencion_doc_tipos_requeridos` de P2C-16.
- `action_log` con `transition: 8_9`, `retencion_opcion`, `required_documentos`.
- Sin tocar `enviar_retencion_mesa`, Storage, UI mock ni firmas.

### Archivos

- `supabase/migrations/019_rpc_avanzar_etapa_8_9.sql`
- `supabase/tests/rpc_avanzar_etapa_8_9.sql` (38 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`

### No tocado

- UI mock, seed, migraciones 001–018, `enviar_retencion_mesa`, Storage, firmas, `DATA_MODE`.

## 2026-06-15 - P2C-16: enviar_retencion_mesa + hook retención

### Decisión

- RPC `enviar_retencion_mesa`: asesor dueño, etapa 8, docs requeridos subidos (`subido`/`resubido`/`validado`); upsert `retencion_opciones` + `retencion_envios`.
- Primer envío si no hay fila o `correccion_requerida`; bloqueo si `estado = enviado`.
- Hook en `update_documento_revision`: rechazo `retencion_*` → `correccion_requerida` sin crear envío.
- Sin `etapa_actual`, Storage, avance 8→9.

### Archivos

- `supabase/migrations/017_rpc_enviar_retencion_mesa.sql`
- `supabase/migrations/018_rpc_documento_revision_retencion_hook.sql`
- `supabase/tests/rpc_enviar_retencion_mesa.sql` (36 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`

### No tocado

- UI mock, seed, migraciones 001–016, `avanzar_etapa_operativa` 8→9, Storage, firmas, `DATA_MODE`.

## 2026-06-15 - P2C-15: avanzar_etapa_operativa 7→8

### Decisión

- Rama `7_8` en la misma RPC; gates espejo P2C-14: Mesa + `submitted_to_mesa` + `ciclo_estado=activo` + `subestado=en_proceso` + `etapa_actual=7`.
- Sin retención (no crea/envía/valida), `fecha_cita`, bookings, documentos, `cliente_datos`, `editor_decisions` ni firmas.
- `action_log` con `transition: 7_8`.

### Archivos

- `supabase/migrations/016_rpc_avanzar_etapa_7_8.sql`
- `supabase/tests/rpc_avanzar_etapa_7_8.sql` (23 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`
- Regresión mínima: `rpc_avanzar_etapa_6_7.sql` (fixture etapa 8 para no 8→9); `rpc_avanzar_etapa_operativa.sql`, `rpc_avanzar_etapa_4_5.sql`, `rpc_avanzar_etapa_5_6.sql` (fixtures wrong-etapa → 8)

### No tocado

- UI mock, seed, migraciones 001–015, Storage, `enviar_retencion_mesa`, avance 8→9, firmas, `DATA_MODE`.

## 2026-06-15 - P2C-14: avanzar_etapa_operativa 6→7

### Decisión

- Rama `6_7` en la misma RPC; gates espejo P2C-12: Mesa + `submitted_to_mesa` + `ciclo_estado=activo` + `subestado=en_proceso` + `etapa_actual=6`.
- Sin `fecha_cita`, bookings, documentos, `cliente_datos`, retención ni firmas.
- `action_log` con `transition: 6_7`.

### Archivos

- `supabase/migrations/015_rpc_avanzar_etapa_6_7.sql`
- `supabase/tests/rpc_avanzar_etapa_6_7.sql` (22 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`
- Regresión mínima: `rpc_avanzar_etapa_5_6.sql` (test 19: fixture etapa 7 para no 7→8)

### No tocado

- UI mock, seed, migraciones 001–014, Storage, retención, firmas, `DATA_MODE`.

## 2026-06-15 - P2C-13: avanzar_etapa_operativa 5→6

### Decisión

- Rama `5_6` en la misma RPC; gates espejo de 4→5: `subestado=en_proceso`, `fecha_cita` y booking biométrico `booked` activo.
- **Gate temporal adicional:** `fecha_cita <= now()` — evita encadenar 4→5→6 con cita futura; **no confirma asistencia** (fase futura con columna/RPC dedicada).
- Error controlado: `avanzar_etapa_operativa: cita biométrica aún no ha ocurrido`.
- No cancela ni crea bookings; no modifica `fecha_cita`; sin validación documental/retención/firmas.
- `action_log` con `transition: 5_6`, `booking_id` y `fecha_cita` en payload.

### Archivos

- `supabase/migrations/014_rpc_avanzar_etapa_5_6.sql`
- `supabase/tests/rpc_avanzar_etapa_5_6.sql` (25 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`
- Regresión mínima: `rpc_avanzar_etapa_4_5.sql` (test 16: segundo avance bloqueado con cita futura), `rpc_avanzar_etapa_operativa.sql` (wrong etapa → 7)

### No tocado

- UI mock, seed, migraciones 001–013, Storage, retención, firmas, `DATA_MODE`.

## 2026-06-15 - P2C-12: avanzar_etapa_operativa 2→3 y 3→4

### Decisión

- Misma RPC `avanzar_etapa_operativa(p_expediente_id, p_comentario)`; ramas `2_3` y `3_4` con gates conservadores (Mesa + `submitted_to_mesa` + `ciclo_estado=activo` + `subestado=en_proceso`).
- Sin validación documental ni `cliente_datos` en 2→3/3→4 (API_CONTRATOS no detalla gates; mock aplica bloqueos solo en UI).
- No modifica `fecha_cita`, bookings ni documentos; deja expediente en etapa 4 listo para `book_biometricos`.
- `action_log` mantiene `expediente.avanzar_etapa_operativa` con `transition: 2_3 | 3_4`.

### Archivos

- `supabase/migrations/013_rpc_avanzar_etapa_2_3_4.sql`
- `supabase/tests/rpc_avanzar_etapa_2_3_4.sql` (27 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`

### No tocado

- UI mock, seed, migraciones 001–012, Storage, retención, firmas, `DATA_MODE`.

## 2026-06-15 - P2C-11: agenda_config en biométricos

### Decisión

- Validación centralizada en `agenda_biometricos_assert_slot_available`; `book_biometricos` y `reagendar_biometricos` conservan firmas.
- Config canónica JSONB documentada en README; seed legacy (`minLeadDays`) se normaliza con trigger `BEFORE INSERT OR UPDATE` + `UPDATE` en migración 012 (sin tocar `seed.sql`).
- Claves ausentes en legacy se completan con defaults; `locations`/`slots`/`allowed_weekdays` vacíos explícitos fallan en RPC.
- Ya no hay modo permisivo: sede y hora deben estar en config normalizada.
- Índice único por expediente P2C-6 intacto.

### Archivos

- `supabase/migrations/012_agenda_config_biometricos_rules.sql`
- `supabase/tests/agenda_config_biometricos_rules.sql` (36 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`

### No tocado

- UI mock, seed, migraciones 001–011, Storage, retención, `cancel_biometricos`.

## 2026-06-15 - P2C-10: RPC save_cliente_datos

### Decisión

- RFC y teléfono principal viven en `datos` JSONB (`rfc`, `celular`) para compatibilidad con `enviar_a_mesa`; columnas dedicadas `telefono_normalizado`, `referencias`, `imagenes` para validación/duplicados y metadata P3.
- Asesor solo puede `completo` o `pendiente`; `validado` queda para Mesa.
- `p_imagenes NULL` conserva existentes; `[]` limpia; sin binarios ni Supabase Storage en P2C-10.
- Anti-duplicado teléfono principal: índice UNIQUE parcial `cliente_datos_org_telefono_normalizado_unique_idx` + pre-check `cliente_datos_telefono_ocupado_en_org` + `pg_advisory_xact_lock`; `unique_violation` → mensaje controlado. Teléfonos en `referencias` JSONB solo por RPC (sin índice UNIQUE).

### Archivos

- `supabase/migrations/011_rpc_save_cliente_datos.sql`
- `supabase/tests/rpc_save_cliente_datos.sql` (42 pruebas)
- `scripts/test-sql.sh`, `supabase/README.md`

### No tocado

- UI mock, seed, migraciones 001–010, Storage, retención, `agenda_config`.

## 2026-06-15 - P2B.1: alinear producto — `revisor` no existe, solo `editor`

### Decisión

- Supabase `app_role` y RPCs usan `editor`; `revisor` es alias legacy del mock únicamente.

### Cambios

- Login mock: se retira `revisor` del selector; `normalizeLegacyMockRole` mapea `revisor`→`editor` en `mockUser`.
- Rutas `/revisor` y `/revisor/[id]`: redirect a `/editor` / `/editor/[id]`.
- `useSessionRepo`: mesa mock usa rol sesión `mesa_control` (ya no `revisor`).
- Docs producto/arquitectura/contratos/riesgos actualizados; e2e sin login `revisor`.
- Textos UI: «editor» en mensajes de integración y formulario de decisión.

### No tocado

- Migraciones Supabase, RLS, RPCs P2C; helper `asesorPuedeIntegrarTrasMontoRevisor` (nombre legacy).
- Docs históricos `AUDITORIA_CRM.md`, `CONTEXTO_TECNICO_AUDITOR.md`, `supabase-precalificaciones-rls.sql` (precalificaciones legacy).

## 2026-06-15 - Retención etapa 8: rechazar documento ya validado

### Causa

- Al pulsar «Rechazar» en Acuse/Aviso, `selectRetencionDoc` limpiaba `retencionRejectTipo` y el comentario en el mismo click; el formulario nunca aparecía (incluido tras validar por error de dedo).

### Corrección

- Rechazar abre el formulario sin reset; botón «Rechazar (corregir)» en docs validados.
- Helpers `retencionDocPuedeRechazarMesa` / `retencionDocPuedeReemplazarAsesor`; asesor solo reemplaza rechazados y ve nota Mesa.

## 2026-06-15 - B1: Mesa 4→5 tras cita biométrica (asesor)

### Causa

- Mesa mostraba cita desde `agenda_bookings_v1` (`citasAgenda.biometrico`), pero `handleAprobarYSiguiente` solo consultaba `timeline[4]?.fechaCita ?? initialFechaCita` (inbox operativo).
- Cuando inbox no tenía `fechaCita` sincronizada, el avance 4→5 fallaba en silencio (`setOperativoWarning` sin `alert`).

### Corrección

- Helper `resolveFechaCitaBiometricosOperativa`: inbox primero, fallback booking activo.
- `SeguimientoOperativoMock`: bloqueo 4→5 y sync de timeline usan el helper.
- `mesa-control/[id]`: `backfillFechaCitaBiometricosInboxIfMissing` en `load()` y recarga al evento `agenda_bookings_updated`.
- Tests en `agenda-biometricos-mock.test.ts`.

### No tocado

- B0D5: asesor sigue agendando en etapa 4 sin saltar a 5; Mesa sin calendario biométricos.
- B0D4/B0D6 retención, rutas, backend Supabase.

## 2026-06-15 - Fase A1: estabilización localhost/piloto mock

### Cambios

- `clearMockData`: claves retención etapa 8 (`expediente_retencion_opcion_v1`, `expediente_retencion_envio_mesa_v1`); test `clearMockData.test.ts`.
- ESLint: `diff_artifacts/**` en `globalIgnores` (artefactos de diff, no parte del build).
- Retención post-envío: `retencionOpcionAsesorEditable` / `retencionOpcionParaPanelAsesor`; radios bloqueados en estado `enviado`; banner con opción enviada a Mesa.

### Rutas legacy (solo reporte, sin cambio)

- `/revisor`, `/revisor/[id]`, `/admin/[id]` siguen compilando; rol `revisor` redirige desde login. Recomendación: ocultar enlaces en nav principal y documentar como alias del flujo editor hasta decisión de producto.

### Git remoto

- Canónico: `crmconcasa` (`main` @ `b3794c5`, tracking actual). `origin`/`concasacrm` diverge desde `813ecab` con 13 commits de formato CSV/montos (2026-05-21) sin retención B0D4–B0D6.

## 2026-05-27 - B0D6.4: alineación opción A/B retención en Mesa

### Causa

- `getChecklistDocumentos(etapa 8)` exige los 5 tipos `retencion_*` del catálogo (A y B a la vez).
- Al avanzar, `getBloqueosAvanceMesa` mostraba “Retención · Carta motivo sin sello” aunque la UI decía Opción A.

### Corrección

- `retencionOpcionMesaEfectiva = envio.opcion ?? retencion_opcion` en Mesa y en `handleAprobarYSiguiente`.
- En etapa 8 se excluyen `retencion_*` del bloqueo genérico de checklist; solo `getBloqueosRetencionAvanceEtapa8Mesa` con la opción efectiva.

## 2026-05-27 - B0D6.3: vista previa retención en Mesa (etapa 8)

### Decisión

- Mismo patrón que documentos cliente: `getArchivoBlob(id)` + `URL.createObjectURL` en modal fijo (`z-65`).
- El panel lateral de revisión ya cargaba el blob al seleccionar tipo, pero la miniatura queda lejos del bloque Acuse/Aviso.
- Botón explícito “Ver documento”; abrir preview no llama `updateRevision`.

### Archivos

- `mesa-control/[id]/page.tsx`, `lib/archivoPreviewMime.ts`, tests.

## 2026-05-27 - B0D6.2: validar/rechazar retención en Mesa + corrección al asesor

### Decisión

- Reutilizar `archivosRepo.updateRevision` (`estatus_revision`, `comentario_mesa`); rechazo exige nota (repo + UI).
- `markCorreccionRequerida` en envío mesa conserva `fechaEnvioMesa` y `opcion`; evento `expediente_retencion_envio_mesa_updated`.
- UX Mesa: botones inline en sección Acuse/Aviso además del panel lateral (los `retencion_*` no están en la lista documental etapa 2).
- Asesor: etiqueta de estatus + nota Mesa en docs rechazados; reenvío con `save({ estado: "enviado" })` sin cambiar etapa.

### Archivos

- `envio-mesa.mock-localstorage.repo.ts`, `types.ts`, `retencion-envio-mesa.ts`
- `mesa-control/[id]/page.tsx`, `SeguimientoOperativoMock.tsx`
- `retencion-acuse-aviso.ts` (`isRetencionTipoDocumento`)
- Tests: `retencion-envio-mesa.test.ts`, `envio-mesa.mock-localstorage.repo.test.ts`

## 2026-05-27 - B0D6: envío Acuse/Aviso retención a Mesa (asesor etapa 8)

### Decisión

- Estado aparte en `expediente_retencion_envio_mesa_v1` (no reutilizar `submittedToMesa` de integración).
- Asesor envía cuando opción + docs completos; reenvío si Mesa rechazó (`correccion_requerida` derivado de `estatus_revision`).
- Sin cambio de etapa al enviar.

### Archivos

- `expediente-retencion/types.ts`, `envio-mesa.mock-localstorage.repo.ts`, `retencion-envio-mesa.ts`
- `SeguimientoOperativoMock.tsx`, `mesa-control/[id]/page.tsx`, `retencion-envio-mesa.test.ts`

## 2026-05-27 - B0D5: agenda biométricos → asesor etapa 4

### Decisión

- Mesa no contacta al cliente; el calendario de biométricos sale de `mesa-control/[id]` y queda solo en expediente asesor en **etapa 4**.
- `canMountAgendaBiometricosUI` → solo rol `asesor`. `canShowAgendaBiometricosForEtapa(4)`.
- Mesa avanza 3→4 sin cita; bloqueo 4→5 exige cita agendada por asesor.
- Storage `agenda_config_v1` / `agenda_bookings_v1` y `AgendaBiometricosConfigPanel` sin cambios.

### Archivos

- `agendaFirmasBookingsGuard.ts`, `AgendaBiometricosCard.tsx`, `asesor/expediente/[id]/page.tsx`, `mesa-control/[id]/page.tsx`, `SeguimientoOperativoMock.tsx`, tests guard.

## 2026-05-27 - B0D4: etapa 1 al enviar a Mesa (no saltar a Registro)

### Causa

- `etapaActualParaOperativo` devolvía siempre `2` con `en_validacion_mesa`.
- `SeguimientoOperativoMock` enviaba `etapaActual: 2` y movía UI a etapa 2 tras el click.

### Corrección

- `en_validacion_mesa` conserva etapa persistida (default 1; no retrocede si ya es >= 2).
- `etapaAlEnviarAMesaDesdeAsesor` + timeline post-envío en etapa 1.
- Tests: `enviar-mesa-etapa.test.ts`, actualizado `etapa-validacion-mesa.test.ts`.

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `src/domain/expedientes/enviar-mesa-etapa.test.ts`
- `src/domain/expedientes/etapa-validacion-mesa.test.ts`

## 2026-05-27 - B0D3B: Acuse / Aviso de retención (mesa-control)

### Decisiones

- Sección propia en `mesa-control/[id]` solo cuando `etapaActualDisplay === 8`; checklist cliente (B0C2/B0C3) intacto.
- Validar/rechazar: mismo `selectedTipo` + `persistRevision` + panel lateral de “Revisión de documentos”.
- Bloqueo 8→9: `getBloqueosRetencionAvanceEtapa8Mesa` (exige `validado` en los 4 docs de la opción) dentro de `getBloqueosAvanceMesa` en `SeguimientoOperativoMock`.

### Impacto técnico

- `src/domain/expediente-archivos/retencion-acuse-aviso.ts` (+ tests)
- `src/components/seguimiento/SeguimientoOperativoMock.tsx` (`getBloqueosAvanceMesa`)
- `src/app/mesa-control/[id]/page.tsx`

## 2026-05-27 - B0D3A: Acuse / Aviso de retención (solo asesor)

### Decisiones

- Catálogo `retencion_*` con `etapasRequeridas: [8]` para no mezclar con los 6 obligatorios de Integración (etapas 1–2).
- `retencion_opcion` en `localStorage` clave `expediente_retencion_opcion_v1` (patrón similar a datos cliente).
- Uploads en IndexedDB vía `MockExpedienteArchivosIndexedDbRepo` (misma mecánica que documentos cliente).
- UI solo en `SeguimientoOperativoMock` cuando asesor + enviado a mesa + etapa 8 (operativa o seleccionada en timeline).
- Avance 8→9 lo hace mesa con `handleAprobarYSiguiente`; helper `getBloqueosRetencionAvanceEtapa8` listo, integración en B0D3B.

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`, `retencion-acuse-aviso.ts`, `retencion-acuse-aviso.test.ts`
- `src/domain/expediente-retencion/types.ts`, `mock-localstorage.repo.ts`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-05-27 - B0D2: Semanas Cotizadas e Historial Laboral (opcionales)

### Decisiones

- Reutilizar `obligatorio: "opcional"` del catálogo (misma convención que `asesor_*`).
- El checklist (`deriveChecklistDocumentosFromResumen` + `soloObligatorios: true`) no incluye opcionales en faltantes ni en el contador de 6 obligatorios.
- Mesa: `buildClienteItemsRevisionDocumental` une obligatorios del checklist + opcionales con archivo subido; el panel B0C2 “Documentos requeridos” no se modifica.

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`
- `src/domain/expediente-archivos/checklist.ts`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `src/app/mesa-control/[id]/page.tsx` (solo lista de revisión / validar todos / stats)
- `src/domain/expediente-archivos/derive-resumen-documental.test.ts`

## 2026-05-26 - B0C2: contador Validados alineado al checklist cliente

### Decisiones

- `docStats` en `mesa-control/[id]` deja de iterar `DOCUMENTO_TIPOS` sobre `archivosResumenPaquete`.
- Usa el mismo subconjunto que la lista visible: `filterChecklistDocumentoItemsPorOwnerRole(..., "cliente")` + `findRowPorTipoDocumento(archivosResumen, tipo)`.
- Sin cambios en badges individuales, validación/rechazo, bulk “Validar todos”, ni IndexedDB.

### Impacto técnico

- `src/app/mesa-control/[id]/page.tsx`

## 2026-05-14 - Limpieza a modo 100% mock (sin Supabase)

### Decisiones

- `useSessionRepo()` pasa a `MockSessionRepo` y deja de instanciar repositorio Supabase.
- Se elimina export de `SupabasePrecalificacionesRepo` en el índice de dominio para mantener un único camino de datos mock.
- Se retira el canal realtime de `revisor/page.tsx` (suscripción `postgres_changes`) porque no existe backend en este entorno.
- `getAsesorDisplayMap()` deja de consultar `user_profiles`; retorna mapa vacío y el label cae al fallback del `asesorId` (o nombre derivado si parece email).
- Se eliminan archivos `src/lib/env.ts`, `src/lib/supabaseClient.ts`, `src/domain/session/supabase.repo.ts`, `src/domain/precalificaciones/supabase.repo.ts` y la dependencia `@supabase/supabase-js`.

## 2026-05-07 - Mesa-control: documentos cliente no desaparecen en etapas 9–12

### Decisiones

- Se separa explícitamente etapa operativa vs etapa documental para el panel visual de mesa-control.
- Se agrega helper `getChecklistDocumentosClientePermanente(expedienteId)` en `checklist.ts`:
  - usa etapa documental base fija `2`,
  - restringe a `ownerRole: "cliente"`,
  - respeta `pendienteRevisionCuentaComoCompleto` para progreso visual.
- En `mesa-control/[id]`, el checklist del panel deja de llamar `getChecklistDocumentos(..., etapaActualDisplay)` y usa el helper permanente.
- No se cambia la lógica de guards de avance por etapa en seguimiento operativo.

### Impacto técnico

- `src/domain/expediente-archivos/checklist.ts`
- `src/app/mesa-control/[id]/page.tsx`
- `src/domain/expediente-archivos/derive-resumen-documental.test.ts`
- `CHANGELOG.md`

## 2026-05-07 - Agendas configuradas por Cynthia: biométricos + firmas

### Decisiones

- Se mantiene separación estricta de fuentes:
  - biométricos: `agenda_config_v1` + `agenda_bookings_v1`
  - firmas: `agenda_firmas_config_v1` + `agenda_firmas_bookings_v1`
- Se extiende el panel de Cynthia en `/mesa-control` a “Configuración de agendas” con dos bloques funcionales (biométricos y firmas), ambos con ubicación, días, horarios, cupos y activo/inactivo.
- Para firma se agrega configuración formal (`agenda_firmas_config_v1`) y cálculo de disponibilidad por slot con cupos restantes; ya no se reserva firma con fecha/hora libre sin agenda.
- En asesor expediente se agrega `AgendaFirmasAsesorCard` para etapa 9:
  - muestra horarios según configuración de Cynthia,
  - valida cupo,
  - escribe booking activo (cancelando booking previo del mismo expediente),
  - persiste operativo a etapa 10 con `fechaCita`.
- `updateOperativo` en etapas 9–10 mantiene validación fuerte de reserva activa en `agenda_firmas_bookings_v1`, pero permite actor `asesor` además de `mesa_control_admin` para habilitar el flujo solicitado.
- Mesa-control detalle expone resumen explícito de cita biométricos/firma (ubicación, fecha/hora, actor, estado) a partir de bookings activos por expediente.

### Impacto técnico

- `src/components/mesa-control/AgendaBiometricosConfigPanel.tsx`
- `src/lib/agendaFirmasMock.ts`
- `src/lib/agendaFirmasBookingsGuard.ts`
- `src/components/asesor/AgendaFirmasAsesorCard.tsx`
- `src/components/mesa-control/AgendaFirmasCard.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`
- `src/app/mesa-control/[id]/page.tsx`
- `src/domain/expedientes/mock.repo.ts`
- `src/lib/dev/clearMockData.ts`
- `CHANGELOG.md`

## 2026-05-07 - Agenda biométricos: panel de configuración para Cynthia

### Decisiones

- Se conserva la fuente única de configuración en `agenda_config_v1` y de ocupación en `agenda_bookings_v1` (sin Supabase, sin tablas nuevas).
- Se usa el repo existente `MockAgendaBiometricosLocalStorageRepo` para lectura/escritura, reutilizando el evento `agenda_config_updated` para refresco reactivo.
- La edición se centraliza en `/mesa-control` con un panel dedicado:
  - solo `mesa_control_admin` puede editar/guardar,
  - interno/externo ven resumen en solo lectura.
- Para soportar ubicaciones dinámicas (Monterrey, Apodaca, Guadalupe, San Nicolás, etc.) el `locationId` deja de ser unión cerrada y pasa a `string`.
- Se añade estado opcional `active` en ubicación/slot dentro de `AgendaBiometricosConfigV1`; disponibilidad ignora ubicaciones o slots inactivos.
- En `mesa-control/[id]`, biométricos ya no dependen del guard de firmas: se habilita para todos los roles de mesa; firmas sigue admin-only.

### Impacto técnico

- `src/components/mesa-control/AgendaBiometricosConfigPanel.tsx`
- `src/app/mesa-control/page.tsx`
- `src/components/asesor/AgendaBiometricosCard.tsx`
- `src/domain/agenda-biometricos/types.ts`
- `src/domain/agenda-biometricos/availability.ts`
- `src/lib/agendaFirmasBookingsGuard.ts`
- `src/lib/agendaFirmasBookingsGuard.test.ts`
- `src/app/mesa-control/[id]/page.tsx`
- `CHANGELOG.md`

## 2026-05-07 - Fix flujo “Enviar a mesa de control” (mock/localStorage)

### Decisiones

- El estado de “enviado” en UI del asesor no puede ser optimista antes de persistir. Se cambió el orden en `SeguimientoOperativoMock`: primero callback de persistencia (`onEnviarAMesa`), luego actualización local (`submittedToMesa`, timeline etapa 1→2).
- Se formalizó contrato de callback con retorno booleano opcional (`false` = no persistido/no continuar), para que validaciones del padre bloqueen el cambio visual sin lanzar side effects.
- En `asesor/expediente/[id]`, el callback devuelve `false` en cada guard de validación previa, y tras `repo.enviarAMesa` hace lectura de confirmación (`getById`) para evitar “enviado fantasma”.
- En el repo mock, la escritura de `mesa_control_inbox` para envío es upsert por expediente (`idPrecal`/`id`) y deja un registro único actualizado.
- Temporal de producto: todos los envíos nuevos a mesa se normalizan como `origenMesa: "interno"` y `tipoMesa: "interno"`; además, cualquier origen faltante en lectura/acceso cae a interno para no ocultar expedientes en bandeja.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`
- `src/domain/expedientes/mock.repo.ts`
- `src/lib/mesaControlAccess.ts`
- `src/lib/mesaControlAccess.test.ts`
- `src/app/mesa-control/page.tsx`
- `src/app/asesor/page.tsx`
- `src/app/mesa-control/[id]/page.tsx`
- `CHANGELOG.md`

## 2026-05-07 - Mesa-control sin documentos (0/0) pese a archivos cargados

### Decisiones

- Se confirma una sola fuente de verdad de archivos en mock: IndexedDB (`concasa-crm-files` / store `expediente_archivos`), no `localStorage`.
- El problema no era pérdida de blobs ni del envío a mesa: `mesa-control/[id]` calculaba checklist en etapa 2, pero `DOCUMENTO_CATALOGO` marcaba documentos obligatorios (base + `cliente_*`) solo en etapa 1.
- Para mantener compatibilidad y no crear estructuras nuevas, se amplían `etapasRequeridas` de documentos obligatorios a `[1, 2]`.
- En panel de mesa, `getChecklistDocumentos(..., { pendienteRevisionCuentaComoCompleto: true })` para que documentos `subido`/`resubido` cuenten como presentes en progreso (6/6) sin perder revisión posterior (validar/rechazar).

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`
- `src/app/mesa-control/[id]/page.tsx`
- `src/domain/expediente-archivos/derive-resumen-documental.test.ts`
- `CHANGELOG.md`

## 2026-05-07 - Validación/Rechazo de Datos Generales (mesa-control)

### Decisiones

- Se mantiene la misma fuente mock: `localStorage` key `expediente_cliente_datos` + evento `expediente_cliente_datos_updated`.
- Se añade estado `validado` (además de `pendiente`, `completo`, `rechazado`) para distinguir claramente “capturado por asesor” vs “aprobado por mesa”.
- Metadata de auditoría en la entidad:
  - validación: `validatedAt`, `validatedBy`
  - rechazo: `rejectedAt`, `rejectedBy`, `comentarioRechazo`
  - siempre: `updatedAt`, `updatedBy`
- En mesa-control se reemplaza `prompt` por modal con textarea obligatorio para rechazo; validar limpia metadata/comentario de rechazo previo.
- En asesor se agregan mensajes explícitos para estados `validado` y `rechazado` con detalle de fecha/usuario y motivo.

### Impacto técnico

- `src/domain/expediente-cliente-datos/types.ts`
- `src/domain/expediente-cliente-datos/mock-localstorage.repo.ts`
- `src/domain/expediente-cliente-datos/mock-localstorage.repo.test.ts`
- `src/app/mesa-control/[id]/page.tsx`
- `src/app/asesor/expediente/[id]/page.tsx`
- `CHANGELOG.md`

## 2026-05-07 - Mesa-control: avance operativo 2→3 con bloqueos explícitos

### Decisiones

- Causa principal detectada:
  1) El handler de “Aprobar y pasar a siguiente” tenía una rama temprana para `en_validacion_mesa` que solo pasaba a `en_proceso` en la misma etapa y hacía `return`.
  2) La validación de datos generales comparaba contra `estado === "completo"` (desalineado con el nuevo estado de mesa `validado`), bloqueando el avance aunque mesa ya hubiera validado.
- Se agrega helper local `getBloqueosAvanceMesa(expedienteId, etapaActual)` para centralizar bloqueos y evitar fallos silenciosos.
- Si hay bloqueos, se muestra mensaje claro en UI (`operativoWarning`) y `alert` con listado:
  - datos generales no validados por mesa,
  - documentos obligatorios pendientes/rechazados.
- Si no hay bloqueos, el flujo avanza etapa y persiste vía `onChangeSummary` → `updateOperativo` en `mesa_control_inbox`.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `src/app/mesa-control/[id]/page.tsx`
- `CHANGELOG.md`

## 2026-05-07 - Guard documental mesa: cliente_* vs legacy sistema

### Decisiones

- Se detectó desalineación entre:
  - UI de mesa (`Documentos requeridos` y `Revisión`) que filtra checklist por `ownerRole: "cliente"`.
  - guard de avance (`getBloqueosAvanceMesa`) que evaluaba `checklist.completos` global e incluía obligatorios legacy `sistema` (`ine`, `nss`, `estado_cuenta`, `direccion`).
- Se corrige el guard para evaluar solo `faltantes` del subconjunto cliente con `filterChecklistDocumentoItemsPorOwnerRole(..., "cliente")`.
- Se mantiene el criterio de avance solicitado: solo `estatus_revision === "validado"` cuenta como completo (no se usa `pendienteRevisionCuentaComoCompleto` en el guard).

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`
- `CHANGELOG.md`

## 2026-04-21 - Admin: KPIs operativos y funnel (stats puras)

### Decisiones

- Una sola carga `listForAdmin()` → estado `expedientesMock`; KPIs/funnel leen ese array; `mockList` es `map` derivado para filtros/tablas existentes.
- Funnel excluyente con prioridad documentada en código; KPIs operativos no excluyentes (pueden solaparse entre sí).
- “Firmados” = `etapaActual >= 11`; rechazos separados: operativo (`subestado === "rechazado"`) vs editor (`decision === "no_cumple"`).

### Impacto técnico

- `src/lib/adminDashboardStats.ts`, `src/lib/adminDashboardStats.test.ts`, `src/app/admin/page.tsx`, `package.json`

## 2026-04-21 - Admin: métricas por asesor (solo ExpedienteMock)

### Decisiones

- Sin fuente de “oportunidades” ni métricas inventadas: todo sale de `ExpedienteMock` ya cargado en admin.
- Agrupación por `base.asesorId` normalizado; vacío → clave literal `(sin asesor)` para filas estables en tabla.
- Mismas reglas de conteo que KPIs globales para biométricos (mesa + etapa 3–5), firma (mesa + 9–10), firmados (≥11) y rechazos.
- Conversión explícita `firmados / enviadosMesa` por asesor; si `enviadosMesa === 0`, `null` en datos y “—” en UI (no dividir).

### Impacto técnico

- `src/lib/adminDashboardStats.ts`, `src/lib/adminDashboardStats.test.ts`, `src/app/admin/page.tsx`, `CHANGELOG.md`

## 2026-04-21 - Admin: tiempos del proceso (sin tramos estimados)

### Decisiones

- Solo cuatro campos: `base.createdAt`, `operativo.updatedAt`, `operativo.etapaActual`, `operativo.submittedToMesa`; el boolean solo se muestra en el top 10, no alimenta promedios por etapa.
- Intervalo único `updatedAt - createdAt`; excluir si falta timestamp o si `updatedAt < createdAt`.
- “Antigüedad por etapa” = media de ese intervalo agrupada por el valor **actual** de `etapaActual` (incluye bucket sin etapa).
- Cuello de botella: entre filas con `sampleSize >= 3`, la de mayor media; empate en media → menor número de etapa (clave de ordenación estable).
- No se implementa tiempo hasta mesa ni duración por tramo real.

### Impacto técnico

- `src/lib/adminDashboardStats.ts`, `src/lib/adminDashboardStats.test.ts`, `src/app/admin/page.tsx`, `CHANGELOG.md`

## 2026-04-21 - Mock usuario (`mock_user`) y bandeja mesa (Cynthia)

### Decisiones

- `mock_user` como JSON único con `email`, `role`, `name`; se mantienen `mock_role` y `mock_email` en paralelo para no tocar reglas existentes en repos (solo lectura centralizada vía `getEffectiveMockRole` / `getEffectiveMockEmail`).
- `useSessionRepo` trata todos los roles `mesa_control_*` y legacy `mesa_control` como sesión mock con `UserSession.role = "revisor"` (igual que antes con solo `mesa_control`).
- Filtro Internos/Externos solo para admin o legacy `mesa_control`; datos de `origenMesa` en tarjetas desde `ExpedienteMock.base`.

### Impacto técnico

- `src/lib/mockUser.ts`, `src/lib/mockUser.test.ts`, `src/app/login/page.tsx`, `src/domain/session/index.ts`, `src/lib/dev/clearMockData.ts`, `src/app/mesa-control/mockData.ts`, `src/app/mesa-control/page.tsx`, `src/app/mesa-control/[id]/page.tsx`, `src/components/asesor/AgendaBiometricosCard.tsx`, `src/components/mesa-control/AgendaFirmasCard.tsx`, `package.json`

## 2026-04-21 - Firma: `fechaCita` acoplada a `agenda_firmas_bookings_v1`

### Decisiones

- Opción **B** para el rol en `updateOperativo`: leer `localStorage.getItem("mock_role")` (sin tercer argumento al repo), coherente con el resto del mock de mesa.
- La validación se aplica al **estado final** tras merge (`merged.etapaActual` / `merged.fechaCita`), no solo al patch entrante.
- UI: solo `mesa_control_admin` monta `AgendaFirmasCard` y puede ejecutar `tryWriteFirmasBooking` (doble chequeo en escritura).

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`, `src/lib/agendaFirmasBookingsGuard.ts`, `src/lib/agendaFirmasMock.ts`, `src/components/seguimiento/SeguimientoOperativoMock.tsx`, `src/components/mesa-control/AgendaFirmasCard.tsx`, `src/app/mesa-control/[id]/page.tsx`, `src/lib/dev/clearMockData.ts`, `src/lib/agendaFirmasBookingsGuard.test.ts`, `package.json`

## 2026-04-21 - `origenMesa` desde `tipoAsesor` al `enviarAMesa`

### Decisiones

- Resolución central en `MockExpedientesRepo.enviarAMesa`: `origenMesa` = `normalizeOrigenMesa(payload.origenMesa)` si viene válido; si no, `origenMesaDesdeEmailAsesor(precal.asesorId)` (email del dueño en `precalificaciones_mock`).
- Catálogo `asesores_tipo_mesa_v1`: mapa email → `interno` | `externo`; ausencia de clave ⇒ **interno** (nunca `null` en inbox para envíos nuevos).
- Las páginas no duplican la derivación: basta con el repo (opcionalmente pueden seguir pasando `origenMesa` en payload si hiciera falta un override explícito).

### Impacto técnico

- `src/lib/asesorTipoMesaMock.ts`, `src/lib/asesorTipoMesaMock.test.ts`, `src/domain/expedientes/mock.repo.ts`, `src/lib/dev/clearMockData.ts`, `package.json`

## 2026-04-21 - Mesa de control: helpers de acceso por `origenMesa`

### Decisiones

- Un solo archivo `mesaControlAccess.ts`: `canUserAccessExpediente({ mockRole }, expediente)` y `filterExpedientesByRole`; no duplicar condiciones en páginas.
- `mock_role` se lee en cliente desde `localStorage` (no `UserSession.role` para mesa).
- `mesa_control` legacy se trata como acceso total (igual que admin) para no vaciar la bandeja hasta que exista catálogo `tipoAsesor` + envío con `origenMesa`.
- `origenMesa: null` niega acceso a interno/externo (fuerza datos completos o rol admin/legacy).

### Impacto técnico

- `src/lib/mesaControlAccess.ts`, `src/lib/mesaControlAccess.test.ts`, `src/domain/expedientes/mock.repo.ts`, `src/app/mesa-control/page.tsx`, `src/app/mesa-control/[id]/page.tsx`, `package.json`

## 2026-04-20 - Persistencia de reservas biométricos (`agenda_bookings_v1`)

### Decisiones

- La ocupación de cupo debe materializarse al agendar: función pura `planBookBiometricosSlot` (cancelar `booked` del expediente + validar cupo con `getAgendaBiometricosDisponibilidad` + append de la nueva fila).
- Los rechazos operativos desde mesa llaman `cancelBiometricosBookingsForExpediente` **después** de `updateOperativo` con éxito, para no liberar cupo si el inbox no se actualizó.
- En asesor, orden efectivo: validar slot → escribir bookings → `updateOperativo`; si el inbox falla, `rollback` del documento de bookings previo.
- `createdBy.role` admite `asesor` y `mesa_control` además de `mesa_control_admin` para reflejar `mock_role` real.

### Impacto técnico

- `src/domain/agenda-biometricos/booking-mutations.ts`, `booking-mutations.test.ts`, `types.ts`, `index.ts`
- `src/lib/agendaBiometricosMock.ts`
- `src/components/asesor/AgendaBiometricosCard.tsx`
- `src/app/mesa-control/[id]/page.tsx`

## 2026-04-09 - Mesa control: orden por subestado

### Decisiones

- Tras `exps.map(mapExpToCaso)`, enriquecer con `fechaEnvioMesa` opcional desde fila del inbox (si existe en JSON); orden: `getPrioridad(subestado)` y `getFechaUrgenciaBandejaMesa` (`fechaEnvioMesa` → `createdAt` base → `updatedAt` operativo). SSR: sin `window`, inbox vacío y mismo fallback.
- `enviarAMesa` escribe `fechaEnvioMesa` en la fila del inbox (mismo ISO que `updatedAt` de ese evento); `updateOperativo` no la borra al hacer spread de `nextEntry`.

### Impacto técnico

- `src/app/mesa-control/page.tsx`

## 2026-04-09 - Columna Documentación (dashboard asesor)

### Decisiones

- La celda no debe depender solo de `deriveResumenDocumental`, que solo mira `DOCUMENTO_TIPOS` (4 filas base): si el mock guarda `cliente_*`, los base quedan `faltante` y la categoría era siempre «Faltantes» aun con archivos subidos.
- Nueva derivación `deriveEstadoDocumentacionColumnaAsesor` en `checklist.ts`: mismos obligatorios por etapa que `deriveChecklistDocumentosFromResumen`, y por cada tipo se usa `estatus_revision` del resumen (`faltante`/`rechazado` → bucket faltante; `subido`/`resubido` → pendiente aprobación; `validado` → OK).
- **Equivalencias base ↔ cliente**: se agrupan `ine` + `cliente_ine_frente` + `cliente_ine_reverso`, `estado_cuenta` + `cliente_estado_cuenta`, `direccion` + `cliente_comprobante_domicilio`; el estatus del grupo es el mejor entre filas del grupo. `nss` no tiene `cliente_*` en catálogo. Grupos deduplicados para no evaluar INE tres veces.
- **NSS y columna DOCUMENTACIÓN**: `nss` se filtra antes del loop de `deriveEstadoDocumentacionColumnaAsesor` (no bloquea Faltantes/Pendiente/Completos en dashboard); catálogo y otros flujos intactos.
- El dashboard guarda `listResumenByExpediente` por id y deriva en `useMemo` la categoría antigua para KPIs/filtros; la tabla usa solo la nueva terna para la columna.

### Impacto técnico

- `src/domain/expediente-archivos/checklist.ts`, `src/domain/expediente-archivos/columna-documentacion-asesor.test.ts`, `src/app/asesor/page.tsx`, `package.json` (entrada `npm test`)

## 2026-04-09 - Utilidad `clearMockData` (solo desarrollo)

### Decisiones

- Centralizar claves reales del repo (`precalificaciones_mock`, `decisions_mock`, `mesa_control_inbox`, `expediente_cliente_datos`, `mock_role`, `mock_email`, `concasa_session`). No existe `expedientes_mock` ni `cliente_datos_mock` en código; expedientes mock viven dentro de `precalificaciones_mock` + inbox.
- IndexedDB única para mocks de archivos: `concasa-crm-files`. Tras `deleteDatabase`, exportar `resetMockArchivosIndexedDbConnection()` para anular `dbPromise` en memoria y evitar reusar una conexión cerrada sin recargar.
- `window.clearMockData` solo si `NODE_ENV !== "production"`; registro vía componente cliente `DevClearMockGlobal` montado desde `layout` en desarrollo.

### Impacto técnico

- `src/lib/dev/clearMockData.ts`, `src/lib/dev/DevClearMockGlobal.tsx`, `src/app/layout.tsx`, `src/domain/expediente-archivos/mock-indexeddb.repo.ts`

## 2026-04-09 - `clearMockData`: clave `agenda_biometricos_config`

### Decisiones

- Incluir en `MOCK_LOCAL_STORAGE_KEYS` la clave de configuración mock de agenda biométricos para que un reset dev borre también cupo/horarios persistidos manualmente en consola.

### Impacto técnico

- `src/lib/dev/clearMockData.ts`

## 2026-04-20 - Agenda biométricos: fuente única `agenda_config_v1`

### Decisiones

- Se cierra la integración de agenda biométricos para que la disponibilidad dependa **solo** de configuración persistida y no de inferencias desde `mesa_control_inbox`.
- Se definen dos keys nuevas:
  - `agenda_config_v1`: config flexible por día/ubicación con slots y cupo.
  - `agenda_bookings_v1`: reservas por slot con status (`booked`/`cancelled`).
- La función central de disponibilidad es `getAgendaBiometricosDisponibilidad(config, bookings, date, locationId, excludeExpedienteId?)` y toda validación/UI delega a ella (sin fallback).
- Se elimina la lógica anterior de “slots 9–17 cada 30min” y la ocupación basada en `mesa_control_inbox` dentro de `agendaBiometricosMock`.
- `clearMockData` borra también `agenda_config_v1` y `agenda_bookings_v1` para reiniciar pruebas desde cero.

### Impacto técnico

- `src/domain/agenda-biometricos/*`
- `src/lib/agendaBiometricosMock.ts`
- `src/components/asesor/AgendaBiometricosCard.tsx`
- `src/lib/dev/clearMockData.ts`
- `src/lib/agenda-biometricos-mock.test.ts`

## 2026-04-09 - Etapa operativa 2 con `en_validacion_mesa` (reemplaza modelo `etapaActual: null`)

### Decisiones

- El avance de etapa no se infiere solo con `subestado`: con `en_validacion_mesa`, `etapaActual` persistido y expuesto en dominio es **siempre 2** (Registro / validación documental por mesa). Integración (1) queda reflejada como aprobada en el timeline al enviar.
- `enviarAMesa` escribe `etapaActual: 2`. `toExpedienteMock` y el cierre de `updateOperativo` aplican `etapaActualParaOperativo` para corregir JSON antiguo (`null` o `1` con `en_validacion_mesa`). Se elimina el guard que anulaba `patch.etapaActual` en validación.
- En `SeguimientoOperativoMock`, salir de validación con “Aprobar y pasar a siguiente” pone `en_proceso` en la **misma** etapa operativa (2), sin avanzar a la 3; el checklist previo usa la etapa operativa actual.

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`, `src/domain/expedientes/etapa-validacion-mesa.test.ts`, `src/components/seguimiento/SeguimientoOperativoMock.tsx`, `package.json` (`npm test`)

## 2026-04-09 - Asesor dashboard: subestado desde `operativo`

### Decisiones

- El modelo local de fila (`PrecalificacionMockLocal`) incluye `operativo: ExpedienteMock["operativo"]` para que la UI lea explícitamente `operativo.subestado` en “Estatus op.” y en el filtro de estatus operativo, alineado con el repo. Se elimina el duplicado `subestadoOperativo` en esa vista.
- Log temporal `[diag dashboard asesor]` antes del badge por fila.

### Impacto técnico

- `src/app/asesor/page.tsx`

## 2026-04-09 - Inbox duplicado: `subestado` perdido en dashboard

### Decisiones

- El síntoma (“`enviarAMesa` guarda `en_validacion_mesa` pero el dashboard sigue en Pendiente”) no era solo el merge `op?.subestado`: con varias filas en `mesa_control_inbox` para el mismo `idPrecal`, el `Map` se construía con **última fila del array gana**. Tras `unshift` del envío, una entrada vieja al final podía quedarse con `subestado` ausente o `pendiente` y sobrescribir la nueva.
- Fusión explícita: por cada clave (`idPrecal` o `id`), conservar la fila con `updatedAt` ISO más reciente (`mergeMesaControlInboxByLatestUpdated`).
- `toExpedienteMock` deja el subestado como `normalizeSubestado(op?.subestado ?? "pendiente") ?? "pendiente"` y un solo `console.log("[diag subestado final]", …)` temporal.

### Impacto técnico

- `src/lib/mesaControlInboxMock.ts`, `src/lib/mesaControlInboxMock.test.ts`, `src/domain/expedientes/mock.repo.ts`

## 2026-04-08 - `toExpedienteMock`: subestado desde inbox + trim

### Decisiones

- El merge ya no deja `operativo.subestado` en `null` cuando falta valor en inbox: se usa `op?.subestado ?? "pendiente"` y luego `normalizeSubestado(... ) ?? "pendiente"` para el campo expuesto al dashboard.
- `normalizeSubestado` normaliza strings con `trim` para que valores persistidos con espacios no caigan en `null` y el UI muestre “Pendiente”.
- Log `[diag subestado final]` (temporal) para contrastar `op?.subestado` crudo vs el normalizado en `[diag merge operativo]`.

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`

## 2026-04-08 - Dashboards: etiqueta única para `en_validacion_mesa`

### Decisiones

- Centralizar mapeo texto + clases Tailwind en `subestadoOperativoUi` para que bandejas no caigan en “Pendiente” por ramas duplicadas o valores con espacios; badge de validación mesa en tono sky (revisión), sin verde.

### Impacto técnico

- `src/lib/subestadoOperativoUi.ts`, `src/lib/subestadoOperativoUi.test.ts`, `package.json` (script test), `src/app/asesor/page.tsx`, `src/app/mesa-control/page.tsx`, `src/app/mesa-control/[id]/page.tsx`, `src/app/admin/page.tsx`

## 2026-04-08 - Subestado tras enviar a mesa: `en_validacion_mesa`

### Decisiones

- Tras envío asesor, el inbox no debe reflejar trabajo operativo iniciado (`en_proceso`); se introduce `en_validacion_mesa` como estado explícito “en validación por mesa” en etapa 1. Mesa sigue poniendo `en_proceso` al avanzar/operar (p. ej. `handleAprobarYSiguiente` → etapa siguiente en proceso).
- Se amplía `OperativoSubestado`, `normalizeSubestado`, UI de etiquetas (SeguimientoOperativoMock, mesa-control, asesor, admin) y mock de bandeja.

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`, `src/components/seguimiento/SeguimientoOperativoMock.tsx`, `src/app/asesor/expediente/[id]/page.tsx`, `src/app/asesor/page.tsx`, `src/app/mesa-control/page.tsx`, `src/app/mesa-control/[id]/page.tsx`, `src/app/mesa-control/mockData.ts`, `src/app/admin/page.tsx`

## 2026-04-08 - Asesor enviar a mesa: solo checklist cliente_* (sin DOCUMENTO_TIPOS)

### Decisiones

- Criterio de habilitación del botón: `faltantesCliente !== null && faltantesCliente.length === 0`, donde `faltantesCliente` sale de `getChecklistDocumentos` + filtro cliente; `null` si el checklist aún no cargó (no confundir con cero faltantes).
- Quitar `useMemo` basados en `DOCUMENTO_TIPOS`, el `if (operativoEtapaId === 1) docsNoValidados` en mesa, UI legacy del paquete de 4 y componentes solo usados ahí (`ChecklistItem`, `RevisionBadge`, preview/descarga). El estado `docs` + sync contra IndexedDB con `DOCUMENTO_TIPOS` se mantiene solo para el payload `onEnviarAMesa` (`docs`).

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-04-08 - Diagnóstico: traza submittedToMesa (envío → merge → expediente final)

### Decisiones

- Añadir logs explícitos en `enviarAMesa` (`nextEntry`), en `toExpedienteMock` (`inboxMatch` + `Boolean(op?.submittedToMesa)`) y en `getById` (objeto `ExpedienteMock` completo tras merge), sin cambiar lógica de negocio.

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`

## 2026-04-08 - Enviar a mesa: autosave directo al repo (sin pasar por el botón Guardar)

### Decisiones

- Tras validar completitud con `getClienteDatosCamposFaltantes` sobre el estado local, el flujo de envío llama directamente a `clienteDatosRepo.save({ expedienteId, datos: clienteDatos, updatedBy })` y luego checklist + `enviarAMesa`. Así el `localStorage` de `expediente_cliente_datos` queda alineado con lo que el usuario escribió aunque nunca pulse **Guardar borrador**.
- El botón **Guardar borrador** sigue usando `handleSaveClienteDatos` (mismo repo y forma de `save`).

### Impacto técnico

- `src/app/asesor/expediente/[id]/page.tsx`

## 2026-04-07 - Enviar a mesa: guardado automático de datos cliente

### Decisiones

- Orden efectivo histórico: validar campos → persistencia → checklist → `enviarAMesa` (desde 2026-04-08 el envío usa `clienteDatosRepo.save` inline; ver entrada 2026-04-08).
- La validación de completitud vive en `src/lib/clienteDatosFormCompleteness.ts` con pruebas unitarias; el botón **Guardar borrador** sigue usando `handleSaveClienteDatos`.

### Impacto técnico

- `src/app/asesor/expediente/[id]/page.tsx`, `src/lib/clienteDatosFormCompleteness.ts`, `src/lib/clienteDatosFormCompleteness.test.ts`, `package.json` (script `test`)

## 2026-04-07 - Asesor: quitar lista legacy tras envío a mesa

### Decisiones

- Opción **A**: eliminar el bloque que hacía `(DOCUMENTO_TIPOS).map` bajo “Enviado a mesa de control”; la fuente de verdad de documentos cliente sigue en el checklist / flujo previo al envío, y la lista duplicada generaba estados incorrectos.
- No se tocó repos ni el paquete legacy opcional (`showLegacyPaqueteIntegracionEnAsesor`).

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-04-07 - Mesa-control: lista de revisión alineada con checklist cliente

### Decisiones

- La opción A (quitar la lista) dejaría el panel de revisión sin selector local; se eligió **opción B**: misma fuente que “Documentos requeridos” (`filterChecklistDocumentoItemsPorOwnerRole(..., "cliente")`) y `findRowPorTipoDocumento` por `it.tipo_documento`.
- KPIs, “validar todos” y lógica de paquete de 4 no se tocaron; solo UI del listbox y estado `selectedTipo` ampliado a catálogo completo.

### Impacto técnico

- `src/app/mesa-control/[id]/page.tsx`

## 2026-04-07 - enviarAMesa: pendiente hasta acción mesa

### Decisiones

- Tras envío asesor, inbox no debe marcar `en_proceso` (eso implicaba trabajo mesa ya iniciado); se usa `subestado: "pendiente"` con `submittedToMesa: true` y etapa 1.
- Timeline optimista etapa 1 y `onEnviarAMesa` payload alineados; mesa sigue poniendo `en_proceso` al aprobar/pasar etapa (`handleAprobarYSiguiente` + `onChangeSummary` → `updateOperativo`).

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`, `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-04-07 - Checklist envío asesor: subido ≠ validado

### Decisiones

- El checklist marcaba obligatorio solo si `estatus_revision === "validado"`; las subidas del asesor quedan en `subido`/`resubido`, así que `completos` nunca era true antes de mesa.
- Opción `pendienteRevisionCuentaComoCompleto` solo en flujos de integración/envío asesor; avance mesa (`handleAprobarYSiguiente`) sigue usando el default (solo `validado`).
- `getChecklistDocumentos` ya usaba `listByExpediente`; no había bug de resumen vs lista.
- Refresco explícito: `archivosChecklistNonce` tras sync exitoso + deps del efecto.

### Impacto técnico

- `src/domain/expediente-archivos/checklist.ts`, `derive-resumen-documental.test.ts`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`, `src/app/asesor/expediente/[id]/page.tsx`

## 2026-04-07 - Bloqueo envío a mesa sin documentos cliente (checklist)

### Decisiones

- Con `showLegacyPaqueteIntegracionEnAsesor === false` no corría la validación por `DOCUMENTO_TIPOS` / `docsMissing` en el botón; la validación solo vivía en el padre y la UI permitía click optimista.
- Fuente única en el componente: `getChecklistDocumentos(id, 1)` recargado al cambiar `archivosResumen` / evento sync; `faltantesCliente` = filtro `filterChecklistDocumentoItemsPorOwnerRole(..., "cliente")`; `puedeEnviar` exige checklist cargado y cero faltantes cliente.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-04-07 - Bandeja mesa: match precal ↔ inbox (ids string)

### Decisiones

- **Causa**: `getInboxKey` solo aceptaba `id`/`idPrecal` con `typeof === "string"`; filas con id numérico (JSON) o mezcla number/string no entraban al `Map` → `submittedToMesa` falso en `toExpedienteMock`.
- **Fix**: clave inbox = `String(v).trim()` con preferencia `idPrecal` luego `id`; escritura en `enviarAMesa`/`updateOperativo` con `idStr` en ambos campos; lectura precal con `id` string o number → `String(rid)`.
- Logs de diagnóstico en creación precal, `enviarAMesa`, `listForMesa` (remover cuando ya no hagan falta).

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`, `src/app/asesor/nueva/page.tsx`

## 2026-04-07 - Mesa: carga cliente por URL + normalización de ids

### Decisiones

- **Bug**: `loadClienteDatos` hacía early return con `!expediente?.id`, así que al abrir mesa tras enviar, la lectura de `expediente_cliente_datos` esperaba a que terminara `getById` del mock (o fallaba el orden respecto a datos ya en LS).
- **Fix**: `routeExpedienteId = String(id)` desde `useParams`; `getByExpedienteId(routeExpedienteId)` y un `useEffect` único `[routeExpedienteId, loadClienteDatos, loadArchivos]` para montaje/cambio de ruta.
- Eventos: si viene `expedienteId` en el `detail`, comparar con `String(...)`; broadcasts sin id siguen refrescando (no filtrar cuando `changedId` es ausente).
- Logs `console.log` temporales en `loadClienteDatos` para diagnóstico.

### Impacto técnico

- `src/app/mesa-control/[id]/page.tsx`, `src/app/asesor/expediente/[id]/page.tsx`

## 2026-04-07 - Evento `expediente_enviado_a_mesa` (mesa-control en vivo)

### Decisiones

- El evento se dispara **solo después** de `await repo.enviarAMesa` en los callbacks `onEnviarAMesa` (asesor y mesa), no dentro de `SeguimientoOperativoMock`, para no emitir si el asesor sale por `return` tras validaciones (checklist / integración deshabilitada) sin persistir.
- Un solo `useEffect` en `mesa-control/[id]` con cleanup `removeEventListener`; dependencias `[id, loadClienteDatos, loadArchivos]` (callbacks ya memoizados con `useCallback`).

### Impacto técnico

- `src/app/asesor/expediente/[id]/page.tsx`, `src/app/mesa-control/[id]/page.tsx`

## 2026-04-07 - Bloqueo asesor hasta monto aprobado por revisor

### Decisiones

- Fuente de verdad: `exp.editorDecision` que ya arma `getById` desde `decisions_mock` vía `buildDecisionMap` (sin cambiar contratos del repo).
- Funciones puras nuevas en `mock.repo.ts`: `estatusPrecalificacionDesdeEditor`, `asesorPuedeIntegrarTrasMontoRevisor`.
- Página asesor: `fieldset disabled` + banner; primer guard en `onEnviarAMesa`; refetch al evento `decisions_mock_updated`.
- `SeguimientoOperativoMock`: prop `asesorIntegracionHabilitada`; si es `boolean`, sustituye el fallback `aprobadoConMonto` en rol asesor; uploads post–envío a mesa por rechazo documental no se tocan.

### Impacto técnico

- `src/domain/expedientes/mock.repo.ts`, `asesor-monto-revisor.test.ts`, `package.json`
- `src/app/asesor/expediente/[id]/page.tsx`
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-04-07 - Filtros documentos: solo helpers de dominio en UI

### Decisiones

- `filterItemsPorOwnerRoleCatalogo` centraliza el criterio `DOCUMENTO_CATALOGO_MAP[tipo].ownerRole`; `filterResumenPorOwnerRole` lo reutiliza.
- Paneles que listan solo documentos del cliente usan `filterChecklistDocumentoItemsPorOwnerRole(..., "cliente")` sobre el checklist ya acotado por etapa; no se repite lógica de `etapasRequeridas` en JSX (el checklist se cargó con la misma `etapaActual`).

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`, `checklist.ts`, `derive-resumen-documental.test.ts`
- `src/app/mesa-control/[id]/page.tsx`, `src/app/asesor/expediente/[id]/page.tsx`

## 2026-04-07 - Resumen: filtros por paquete / rol y orden de checklist

### Decisiones

- Fuente única de orden: índice en `TIPO_DOCUMENTO_CATALOGO` vía `Map` (`MAP_INDICE_TIPO_DOCUMENTO_CATALOGO` + `ordenarPorTipoDocumentoCatalogo`); el checklist aplica orden al devolver `faltantes` y `completosLista` para que la UI no dependa del orden de iteración.
- Mesa: `archivosResumenPaquete` + `filterResumenPaqueteDocumental` para estadísticas de revisión documental y bulk “validar pendientes” (solo los 4 del paquete); `getLatestDocByTipo` sigue usando el resumen completo para `cliente_*`.
- `isTipoPaqueteDocumental` vive en dominio (`types.ts`); se elimina el duplicado local en mesa-control.

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`, `checklist.ts`, `derive-resumen-documental.test.ts`
- `src/app/mesa-control/[id]/page.tsx`

## 2026-04-07 - `listResumenByExpediente`: catálogo completo

### Decisiones

- Una fila por cada clave de `TIPO_DOCUMENTO_CATALOGO`, en ese orden: mantiene índices 0–3 = paquete documental histórico.
- `deriveResumenDocumental` no cambia: solo evalúa `DOCUMENTO_TIPOS`; se añadió test de regresión con filas `cliente_*` extra.

### Impacto técnico

- `src/domain/expediente-archivos/mock-indexeddb.repo.ts`
- `src/domain/expediente-archivos/derive-resumen-documental.test.ts`

## 2026-04-07 - Resumen archivos: `tipo_documento` como catálogo

### Decisiones

- Unificar el tipo de `ExpedienteArchivoResumen.tipo_documento` con el del store (`TipoDocumentoCatalogo`) para que comparaciones como `a.tipo_documento === tipo` sean válidas sin `as string`.
- Las etiquetas en UI que antes usaban `TIPO_DOCUMENTO_LABEL` (solo 4 tipos) pasan a `labelTipoDocumentoCatalogo` vía `DOCUMENTO_CATALOGO_MAP`.
- Tras validar/rechazar, `afterRevisionPersist` recibe cualquier clave de catálogo; la lógica de “siguiente documento pendiente” sigue acotada al paquete de 4 con guard `isTipoPaqueteDocumental`.

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`, `mock-indexeddb.repo.ts`, `derive-resumen-documental.test.ts`
- `src/app/mesa-control/[id]/page.tsx`, `src/components/seguimiento/SeguimientoOperativoMock.tsx`

## 2026-04-07 - Mesa-control: preview modal en “Documentos requeridos”

### Decisiones

- Solo documentos **cliente** marcados como completos en el checklist: botón que abre modal con `URL.createObjectURL` tras `archivosRepo.getArchivoBlob(id)` (mismo patrón que la revisión documental).
- Si hubiera más de un registro con el mismo `tipo_documento` en `archivosResumen`, el preview usa el de **`created_at` más reciente** (`getLatestDocByTipo`: `filter` + `sort`), reutilizado en el preview y en `canOpen` del panel.
- Imagen → `<img>`; PDF → `<iframe>`; otros tipos → mensaje en modal.

### Impacto técnico

- `src/app/mesa-control/[id]/page.tsx`

## 2026-04-07 - Validación MIME en subida `cliente_*` (solo UI)

### Decisiones

- La comprobación vive en el **handler `onFile`** del `FileUploadButton` del panel “Documentos del cliente”, **antes** de `archivosRepo.replaceArchivo`, sin tocar el repo ni IndexedDB.
- Se respeta el criterio pedido: `file.type` debe contener `"image"` o ser exactamente `application/pdf`.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`.

## 2026-04-07 - Panel “Documentos requeridos”: solo `cliente_*`

### Decisiones

- El checklist completo sigue viniendo de `getChecklistDocumentos`; en las páginas asesor y mesa-control el panel filtra por `ownerRole === "cliente"` **y** que `etapasRequeridas` incluya la etapa mostrada (mesa: `etapaActualDisplay`; asesor: `1`).
- Progreso del panel: `completosCliente / (faltantesCliente + completosCliente)`.

### Impacto técnico

- `src/app/asesor/expediente/[id]/page.tsx`
- `src/app/mesa-control/[id]/page.tsx`

## 2026-04-07 - Rechazo: siempre limpiar `fechaCita` en persistencia

### Decisiones

- **`onChangeSummary`**: si `estado === "rechazado"`, `fechaCita` del summary es siempre `null` (no solo etapa 3 “sin cita” ni implícito etapa 4). Así `handleChangeSummary` en mesa-control incluye `{ fechaCita: null }` y el inbox queda alineado.
- **Timeline al rechazar** (rama genérica): se deja de copiar cita en etapas 3/9 al marcar rechazado; la etapa actual queda sin `fechaCita` en estado local.
- **Sync desde props**: si `initialSubestado === "rechazado"`, la etapa actual no asigna `initialFechaCita` al nodo del timeline (evita UI con cita si el padre aún enviara fecha obsoleta).

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`.

## 2026-04-07 - Catálogo de documentos (expediente-archivos)

### Decisiones

- **Sin cambio de arquitectura**: el “paquete documental” actual sigue siendo `DOCUMENTO_TIPOS` (4 tipos) y es el que consume `deriveResumenDocumental` y la UI existente.
- **Catálogo extendido**: se define `TIPO_DOCUMENTO_CATALOGO` + `DOCUMENTO_CATALOGO` con:
  - **ownerRole** (`cliente`/`asesor`/`sistema`)
  - **obligatorio/opcional**
  - **etapasRequeridas** (ids del flujo operativo)
- **Uso previsto**: nuevas pantallas/validaciones pueden listar requisitos por etapa/rol con `listDocumentosCatalogoForStage` sin tocar la lógica actual.

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`.

## 2026-04-07 - Checklist documental por etapa (sin romper paquete actual)

### Decisiones

- **Capa adicional**: se agrega `getChecklistDocumentos(expedienteId, etapaActual)` como validación por etapa usando `DOCUMENTO_CATALOGO` + `listResumenByExpediente` (IndexedDB).
- **Compatibilidad**: la checklist solo considera como “requeribles hoy” los tipos base (`DOCUMENTO_TIPOS`) porque el repo IndexedDB actual valida/guarda únicamente esos tipos. Los tipos extendidos (cliente/asesor) quedan como catálogo opcional para evolución sin romper UI/unique keys actuales.
- **Criterio de completo**: un documento requerido cuenta como completo solo si su `estatus_revision === "validado"`.

### Impacto técnico

- `src/domain/expediente-archivos/checklist.ts`
- `src/domain/expediente-archivos/derive-resumen-documental.test.ts`
- `src/domain/expediente-archivos/index.ts`

## 2026-04-07 - Entidad datos generales del cliente (mock)

### Decisiones

- **Nueva entidad**: `expediente_cliente_datos` se persiste fuera de `ExpedienteMock.operativo` y fuera de `expediente-archivos` para permitir evolución, estado propio y auditoría.
- **Persistencia**: repo mock en `localStorage` (key `expediente_cliente_datos`) con upsert por `expedienteId`.
- **Sincronización**: evento `expediente_cliente_datos_updated` con `{ expedienteId }` para refresco reactivo de UI (futuro).

### Impacto técnico

- `src/domain/expediente-cliente-datos/*`

## 2026-03-23 - Biométricos: cita en etapa 4 y rechazo con liberación de slot

### Decisiones

- **Slots vigentes**: ocupación = inbox etapa 3 o 4 con `fechaCita` y `subestado !== "rechazado"` (`inboxItemCountsAsBiometricOccupied`). Rechazo mesa en etapa 4 → `updateOperativo` con etapa 3, rechazado, `fechaCita: null` vía `onChangeSummary` (etapa 3 rechazada sin cita en timeline fuerza `null`).
- **Rechazo etapa 4**: mismo modal **Rechazar**; rama especial en `handleConfirmarRechazo` que limpia etapa 4, marca etapa 3 rechazada y mueve `operativoEtapaId` a 3.
- **UI etapa 4**: bloque de cita en detalle y resumen superior incluyen etapa 4 cuando hay `fechaCita`.

### Impacto técnico

- `src/lib/agendaBiometricosMock.ts`, `agenda-biometricos-mock.test.ts`, `SeguimientoOperativoMock.tsx`, `AgendaBiometricosCard.tsx`, `asesor/expediente/[id]/page.tsx`.

## 2026-03-23 - Agenda biométricos mock (asesor → etapa 4)

### Decisiones

- **Fuente de verdad de ocupación**: lectura de `mesa_control_inbox` para expedientes en etapas 3 o 4 con `fechaCita` (sin segundo almacén dedicado). Fechas solo-YYYY-MM-DD legacy expanden a todos los slots del día como ocupados para no duplicar huecos.
- **Persistencia del agendado**: `MockExpedientesRepo.updateOperativo` (misma vía que mesa); evento `mesa_control_inbox_updated` para refresco en pestaña.
- **Mesa**: `citaEditable` solo en etapa 9 (firma); biométricos 3–4 los agenda el asesor.

### Impacto técnico

- `src/lib/agendaBiometricosMock.ts`, `src/lib/agenda-biometricos-mock.test.ts`, `src/components/asesor/AgendaBiometricosCard.tsx`, `src/app/asesor/expediente/[id]/page.tsx`, `src/components/seguimiento/SeguimientoOperativoMock.tsx`, `package.json` (script `test`).

## 2026-03-23 - UX mesa: sin toggle de rol ni “Marcar En proceso”

### Decisiones

- El switch Asesor/Mesa era ruido en mesa-control: el contexto ya viene del login mock (`localStorage.mock_role`); no se expone UI para cambiar rol en caliente.
- **Marcar En proceso** era redundante frente a `en_proceso` al enviar a mesa, al aprobar (siguiente etapa) y al regresar etapa; quitar el botón no altera esas rutas.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`.

## 2026-03-23 - Regresar etapa operativa (mesa)

### Decisiones

- El timeline sigue siendo **solo selección**; el retroceso real es explícito con **Regresar a etapa anterior**, mismas guardas que aprobar (`panelOperativoEditable`).
- La **representación visual** de etapas futuras respecto a `operativoEtapaId` usa `getStageVisualStatus`: al bajar la etapa real, la etapa dejada atrás deja de mostrarse como “completada” sin borrar entradas del `timeline` innecesariamente.
- Sobre el objeto `timeline` de la etapa que se abandona (si no era `rechazado`): `estado: pendiente` y se limpian motivo/comentario de rechazo, conservando notas/citas; si era `rechazado`, se conserva el registro (solo `ultimaActualizacion`). La etapa destino se reutiliza con `en_proceso` + `ultimaActualizacion`.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`.

## 2026-03-23 - Ciclo de vida de blob URL en preview mesa-control

### Decisiones

- No revocar el `blob:` de la preview en un `useEffect` cuyo cleanup dependa de `preview.url`: en React 18 Strict Mode el cleanup puede ejecutarse mientras el estado sigue referenciando la misma URL, dejando la miniatura y la pestaña nueva sin recurso válido.
- La revocación queda **solo** en transiciones explícitas: al sustituir preview en `openPreview` y al cerrar en `closePreview` (sustituye “cambio de documento” + cierre manual).
- Abrir en nueva pestaña **no** revoca; se usa el mismo string URL; si `window.open` devuelve `null`, se intenta navegación equivalente con un `<a>` programático (`noopener noreferrer`).

### Impacto técnico

- `src/app/mesa-control/[id]/page.tsx`.

## 2026-03-23 - Timeline vs etapa real y comentario de rechazo

### Decisiones

- El timeline en mesa-control es **navegación de detalle**: `selectedStageId` no debe mutar `operativoEtapaId` ni disparar `updateOperativo`; la persistencia sigue vía `onChangeSummary` alineado **solo** al estado de `operativoEtapaId` en `timeline`.
- Las acciones **Marcar en proceso / Aprobar / Rechazar** actúan exclusivamente sobre la etapa operativa real; si el usuario inspecciona una etapa pasada, el panel entra en modo lectura (botones e inputs deshabilitados + aviso).
- La **cita** (etapas 3 y 9) solo es editable si la etapa operativa real es 3 o 9 **y** la selección coincide con esa etapa; si se selecciona 3/9 como histórico mientras el expediente está en otra etapa, la cita se muestra en solo lectura.
- El rechazo operativo separa **motivo categórico** (`motivoRechazo`) y **texto libre** (`comentarioRechazo`); no se reutiliza `notasInternas` como sustituto del comentario de rechazo.
- La sincronización prop → estado del componente **no** depende de `initialUpdatedAt` para no resetear `selectedStageId` en cada persistencia que solo actualice timestamp.

### Impacto técnico

- `src/components/seguimiento/SeguimientoOperativoMock.tsx`, `src/app/mesa-control/[id]/page.tsx`, `src/app/asesor/expediente/[id]/page.tsx`, `src/domain/expedientes/mock.repo.ts`, `src/lib/mesaControlInboxMock.ts`.

## 2026-03-19 - Resubido y resumen documental derivado

### Decisiones

- Revisión documental mesa-control `[id]`: la UI ya no expone `Ver`/`Validar`/`Rechazar` por fila; la fila solo selecciona. “Pendiente revisión” persiste como `subido` o `resubido` usando el último estatus pendiente guardado en estado local (`pendienteKindById`) para no perder la señal `correccion_enviada` al revertir desde `validado`.
- `mesa-control/[id]` (bloque Revisión documental): se elimina patrón `select + Guardar` por acción directa. `Validar` persiste inmediato con `updateRevision`; `Rechazar` abre editor inline y exige comentario no vacío para guardar.
- Se agrega acción masiva `Validar todos los pendientes` (solo `subido`/`resubido`) con `Promise.allSettled`, feedback resumido y actualización por listeners existentes (`expediente_archivos_updated`).
- Preview documental pasa a panel lateral sticky en desktop (2 columnas). `Ver` actualiza panel, la tarjeta activa se resalta; mobile mantiene flujo apilado sin cambiar contratos de datos.
- Bandeja `mesa-control/page`: solo presentación y derivación en pantalla; `loadCasos`, listeners y `deriveResumenDocumental` intactos. KPI “Nuevos por revisar” = etapas 1–2 con subestado pendiente o en proceso (misma noción que el tercer nivel del sort). “Bloqueados / rechazados” = unión visual de rechazo operativo o `correccion_requerida` (un expediente cuenta una vez).
- `submittedToMesa` en seguimiento: un `useEffect` dependiente solo de `initialSubmittedToMesa` alinea estado local con el padre al cambiar la prop; el optimistic `true` tras “Enviar a mesa” no se revierte porque la prop no cambia hasta que persiste el inbox (sigue en `false` y el efecto no se re-ejecuta).
- Filtro rápido “Corrección enviada” en dashboard asesor: misma categoría que `deriveResumenDocumental` / columna Documentación; contador en el chip desde `kpis.correccionEnviada` sin añadir quinta tarjeta KPI.

- Refuerzo visual solo en capa UI: bandeja prioriza lectura de correcciones reenviadas; en expediente, conteos se derivan de `archivosResumen` en pantalla (sin tocar dominio ni repos).
- En UI de mesa (expediente), `subido` y `resubido` no son valores del `<select>`: mesa solo confirma **validado** o **rechazado**; el estado automático se lee en el badge.
- El rechazo **operativo** de etapa (modal “Rechazar” en seguimiento) sigue separado del rechazo **documental** (`estatus_revision === rechazado` + `comentario_mesa` en archivos). No se usa el subestado del expediente para correcciones documentales.
- `resubido` indica “corrección enviada por asesor, pendiente de nueva revisión en mesa”. Si el asesor vuelve a subir mientras sigue `resubido`, se mantiene `resubido` para no perder la señal de “corrección en tránsito” hasta que mesa valide o rechace de nuevo.
- `deriveResumenDocumental` aplica el orden acordado: faltantes → rechazados → resubidos → subidos → todos validados.
- Bandeja mesa-control ordena primero `correccion_enviada`, luego `correccion_requerida`, luego `updatedAt` descendente; fila resaltada en tono sky para `correccion_enviada`.

### Impacto técnico

- `src/domain/expediente-archivos/types.ts`, `mock-indexeddb.repo.ts`, tests del helper.
- `src/components/seguimiento/SeguimientoOperativoMock.tsx` (badges y criterio de rechazo en paquete pre-envío).
- `src/app/mesa-control/page.tsx`, `[id]/page.tsx`.
- `package.json`: script `test` con `tsx --test`; devDependency `tsx`.

## 2026-03-18 - Cierre fase documental mock

### Decisiones

- Revisión documental mesa-control `[id]`: la UI ya no expone `Ver`/`Validar`/`Rechazar` por fila; la fila solo selecciona. “Pendiente revisión” persiste como `subido` o `resubido` usando el último estatus pendiente guardado en estado local (`pendienteKindById`) para no perder la señal `correccion_enviada` al revertir desde `validado`.
- `mesa-control/[id]` (bloque Revisión documental): se elimina patrón `select + Guardar` por acción directa. `Validar` persiste inmediato con `updateRevision`; `Rechazar` abre editor inline y exige comentario no vacío para guardar.
- Se agrega acción masiva `Validar todos los pendientes` (solo `subido`/`resubido`) con `Promise.allSettled`, feedback resumido y actualización por listeners existentes (`expediente_archivos_updated`).
- Preview documental pasa a panel lateral sticky en desktop (2 columnas). `Ver` actualiza panel, la tarjeta activa se resalta; mobile mantiene flujo apilado sin cambiar contratos de datos.
- Se define para el mock que "revision documental completa" en Integracion significa: los 4 tipos requeridos (`ine`, `estado_cuenta`, `nss`, `direccion`) en estatus `validado`.
- La obligatoriedad de comentario al rechazar se implementa en doble capa:
  - UI mesa-control (validacion antes de guardar).
  - Repositorio IndexedDB (`updateRevision`) como guardia de dominio local.
- El reemplazo de archivo se mantiene con id deterministico `expedienteId::tipo_documento` para garantizar un unico archivo activo por tipo.
- El reemplazo conserva tipo, sobrescribe blob/metadata y reinicia revision a `subido` con `comentario_mesa = null`.
- Se conserva la arquitectura mock/local (sin Supabase, sin backend, sin localStorage para binarios).

### Impacto tecnico

- `src/domain/expediente-archivos/mock-indexeddb.repo.ts`: guardia de comentario obligatorio al rechazar.
- `src/app/mesa-control/[id]/page.tsx`: validacion y manejo de error al guardar revision rechazada sin comentario.
- `src/components/seguimiento/SeguimientoOperativoMock.tsx`:
  - bloqueo de avance en etapa 1 si documentos no estan todos `validado`;
  - bloqueo de envio desde asesor cuando haya faltantes o rechazados;
  - visibilidad de estatus documental para asesor tambien despues de enviado a mesa.

## 2026-05-21 - Exportacion admin a Excel (CSV)

- Objetivo: permitir descarga de la informacion visible en la vista admin sin alterar flujos existentes.
- Decision: se implemento descarga en formato CSV con BOM UTF-8 para compatibilidad con Excel.
- Alcance:
  - Boton "Descargar CSV (dia)" en la seccion "Vista del dia".
  - Boton "Descargar CSV (tabla)" en la seccion "Todas las precalificaciones".
  - Exporta datos visibles, no modifica DB ni permisos, y mantiene consultas de solo lectura.
- Ajuste posterior:
  - Cuando hay filtros "Desde/Hasta", el boton exporta todo el rango filtrado y no solo las filas de la pagina actual.
  - El texto del boton cambia a "Descargar CSV (rango)" para reflejar el comportamiento.
- Riesgo mitigado: no se tocaron rutas de asesor/revisor ni logica de creacion/edicion.
