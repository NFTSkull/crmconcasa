# Devlog

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
