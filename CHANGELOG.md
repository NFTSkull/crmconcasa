# Changelog

## 2026-06-15

- **P3B.2 — Bandeja `/asesor` read-only Supabase:** `ExpedientesRepo.listForAsesor()`; `SupabaseExpedientesRepo` con RLS + filtro `asesor_id`; `/asesor` usa `useExpedientesRepo()`; errores visibles; mock intacto.

- **P3C — Crear expediente real desde `/asesor/nueva`:** RPC `create_expediente` (migración 025); `ExpedientesRepo.createExpediente()`; mock `localStorage` intacto; validación con reglas existentes; sin `listForAsesor` Supabase (P3B.2).

- **P3B.1 — Admin listado read-only Supabase:** `NEXT_PUBLIC_DATA_MODE=supabase` + factory `ExpedientesRepo`; `SupabaseExpedientesRepo.listForAdmin()` con RLS; mapper `expedientes`+`editor_decisions`+asesor → `ExpedienteMock`; mock sigue default.

- **P3A — Auth Supabase mínima:** login/logout real con `NEXT_PUBLIC_USE_SUPABASE_AUTH=true`; lectura de `profiles` (incl. validación `active`); mapeo `app_role`→rol mock UI; puente `mock_user`/`mock_role`/`mock_email`; fallback a login mock si flag off o Supabase no configurado. Sin datos operativos ni migraciones.

- **P2C-21 — Backfill agenda_config firmas:** función `backfill_agenda_config_firmas()` idempotente por organización; deploy producción sin fila `kind=firmas`; 7 pruebas SQL.

- **P2C-20 — Avance Mesa 9→10:** extiende `avanzar_etapa_operativa` post-cita firmas; gates `fecha_cita` + booking `firmas` activo (`booked`); solo `mesa_admin`/`super_admin`; 14 pruebas SQL.

- **P2C-19 — Cancel/reagendar firmas:** RPCs `cancel_firmas` y `reagendar_firmas` (asesor/mesa_admin, etapas 9/10, sin avance etapa); 44 pruebas SQL. Pendiente: avance 9→10.

- **P2C-18 — Agenda firmas backend base:** reglas `agenda_config` firmas + RPC `book_firmas` (asesor/mesa_admin, etapa 9, sin avance etapa); 37 pruebas SQL. Pendiente: cancel/reagendar y 9→10.

- **P2C-17 — Avance Mesa 8→9:** extiende `avanzar_etapa_operativa` post-retención validada; gates `cliente_datos` validado + `retencion_envios` enviado + docs `validado` por opción A/B; sin modificar retención/documentos/`fecha_cita`/bookings; 38 pruebas SQL.

- **P2C-16 — Retención etapa 8:** RPC `enviar_retencion_mesa` (asesor, opción A/B, reenvío controlado); hook `update_documento_revision` rechazo `retencion_*` → `correccion_requerida`; sin avance 8→9 ni Storage; 36 pruebas SQL.

- **P2C-15 — Avance Mesa 7→8:** extiende `avanzar_etapa_operativa` Notificación→Acuse/Aviso retención; gates conservadores Mesa + `en_proceso`; sin flujo de retención; sin tocar `fecha_cita`/bookings/docs/`cliente_datos`/`editor_decisions`; 23 pruebas SQL. Sin UI/Storage.

- **P2C-14 — Avance Mesa 6→7:** extiende `avanzar_etapa_operativa` Inscripción→Notificación; gates conservadores Mesa + `en_proceso`; sin tocar `fecha_cita`/bookings/docs/retención/firmas; 22 pruebas SQL. Sin UI/Storage.

- **P2C-13 — Avance Mesa 5→6:** extiende `avanzar_etapa_operativa` post-biométricos; exige `fecha_cita` + booking biométrico activo + **`fecha_cita <= now()`** (sin confirmar asistencia formal); conserva cita/booking; 25 pruebas SQL. Sin UI/Storage.

- **P2C-12 — Avance Mesa 2→3 y 3→4:** extiende `avanzar_etapa_operativa` para transiciones operativas hacia biométricos; gates comunes Mesa + `en_proceso`; sin tocar `fecha_cita`/bookings/docs; 27 pruebas SQL. Sin UI/Storage.

- **P2C-11 — Reglas `agenda_config` biométricos:** `book_biometricos` y `reagendar_biometricos` validan config estricta; normalización legacy `minLeadDays`→`min_lead_hours` vía trigger + migración; sin modo permisivo de sedes/horarios; 36 pruebas SQL. Sin UI/Storage.

- **P2C-10 — RPC `save_cliente_datos`:** asesor dueño guarda RFC, teléfono normalizado, referencias e imágenes (metadata/rutas) en `cliente_datos`; validación RFC México; índice UNIQUE parcial por org en `telefono_normalizado` + pre-check RPC; teléfonos de referencias validados en RPC; `action_log` `cliente_datos.save`; 42 pruebas SQL. Sin UI/Storage binario.

- **P2B.1 — Rol productivo `editor` (sin `revisor`):** login mock sin opción Revisor; `normalizeLegacyMockRole`; redirect `/revisor/*`→`/editor`; sesión mesa usa `mesa_control`; docs y e2e alineados. Supabase sin cambios.

- **Fase A1 — Estabilización piloto mock:** `clearMockData` limpia `expediente_retencion_opcion_v1` y `expediente_retencion_envio_mesa_v1`; ESLint ignora `diff_artifacts/`; asesor no puede cambiar opción A/B mientras el bloque Acuse/Aviso está enviado en revisión (Mesa sigue usando opción enviada como canónica).

- **B1 — Avance Mesa 4→5 biométricos:** `resolveFechaCitaBiometricosOperativa` alinea bloqueo con `mesa_control_inbox.fechaCita` y fallback a `agenda_bookings_v1`; backfill al cargar detalle Mesa en etapa 4; Mesa puede aprobar 4→5 cuando el asesor ya agendó cita.

- **Retención etapa 8 — rechazo post-validación:** Mesa puede rechazar documentos Acuse/Aviso ya validados; el formulario de rechazo ya no se resetea al abrir; asesor ve nota de Mesa y solo puede reemplazar documentos rechazados.

## 2026-05-27

- **B0D6.4 — Opción A/B alineada en Mesa:** `retencionOpcionMesaEfectiva` (envío prima sobre selección local); checklist etapa 8 ya no mezcla docs de la opción no elegida al avanzar.

- **B0D6.3 — Vista previa Acuse/Aviso en Mesa:** botón “Ver documento” en etapa 8 abre modal con imagen/PDF vía `getArchivoBlob` (sin cambiar estatus de revisión).

- **B0D6.2 — Validar/rechazar Acuse/Aviso en Mesa:** acciones inline en etapa 8 (Validar/Rechazar con nota obligatoria); al rechazar `retencion_*` persiste `correccion_requerida` en `expediente_retencion_envio_mesa_v1`; asesor ve estado y nota por documento y puede reenviar el bloque.

- **B0D6.1 — Bloqueo 8→9 y envío retención:** `getBloqueosRetencionAvanceEtapa8Mesa` exige `retencion_enviado_a_mesa` (key `expediente_retencion_envio_mesa_v1`); Mesa y `handleAprobarYSiguiente` consultan el repo de envío.

- **B0D6 — Envío Acuse/Aviso retención a Mesa:** botón en asesor (etapa 8) con persistencia `expediente_retencion_envio_mesa_v1`; Mesa ve señal de envío/corrección sin tocar `submittedToMesa` ni cambiar etapa.

- **B0D5 — Agenda biométricos en asesor (etapa 4):** Mesa Control ya no monta `AgendaBiometricosCard`; solo el asesor agenda en etapa 4. Mesa conserva bloque de consulta de cita y configuración Cynthia en bandeja.

- **B0D4 — Etapa al enviar a Mesa:** el envío desde asesor ya no fuerza etapa 2; permanece en Integración (1) con `en_validacion_mesa` hasta que Mesa apruebe y avance. Corregidos `etapaActualParaOperativo`, payload de `onEnviarAMesa` y timeline post-envío.

- **B0D3B — Acuse / Aviso de retención (mesa):** sección en detalle expediente etapa 8, carga `retencion_opcion`, revisión `retencion_*` vía panel existente, bloqueo 8→9 con `getBloqueosRetencionAvanceEtapa8Mesa` en `getBloqueosAvanceMesa`.

- **B0D3A — Acuse / Aviso de retención (asesor):** selector Opción A/B (`retencion_opcion` en `localStorage` `expediente_retencion_opcion_v1`), uploads `retencion_*` en IndexedDB (etapa 8), helper `deriveRetencionAcuseAvisoFaltantes` y panel en seguimiento operativo del asesor. Bloqueo 8→9 en mesa pendiente (B0D3B).

- **B0D2 — Documentos cliente opcionales:** catálogo `cliente_semanas_cotizadas` y `cliente_historial_laboral` (`obligatorio: "opcional"`). Carga en asesor con etiqueta “(opcional)”; no bloquean envío a mesa ni el checklist de 6 obligatorios. Mesa los muestra en revisión documental solo si fueron subidos (`buildClienteItemsRevisionDocumental`).

## 2026-05-26

- **B0C2 — Mesa-control contador Validados:** el resumen “Validados / Pendientes / Correcciones” en revisión documental cuenta los mismos documentos `cliente_*` del checklist lateral (no el paquete legacy `DOCUMENTO_TIPOS` de 4 tipos).

## 2026-05-14

- **Modo 100% mock (sin Supabase):** se retira el acoplamiento directo a Supabase en sesión, repositorios y utilidades de display de asesor. `useSessionRepo` usa `MockSessionRepo`, `usePrecalificacionesRepo` queda solo mock, se elimina realtime de revisor por canal Postgres y se borran archivos/dependencia de Supabase para simplificar despliegue y evitar errores por variables de entorno faltantes.

## 2026-05-07

- **Mesa-control (etapas finales) / documentos cliente permanentes:** el checklist visual de “Documentos requeridos” y “Revisión de documentos” deja de depender de `etapaActualDisplay` (que en etapas 9–12 devolvía 0/0 porque el catálogo cliente está requerido en 1–2). Ahora usa un checklist documental fijo de cliente con etapa base 2, preservando visibilidad de los 6 `cliente_*` en cualquier etapa operativa.

- **Configuración de agendas (Cynthia):** el panel de `/mesa-control` ahora centraliza biométricos y firmas en una sola sección “Configuración de agendas”, guardando en `agenda_config_v1` (biométricos) y `agenda_firmas_config_v1` (firmas), con eventos `agenda_config_updated` y `agenda_firmas_config_updated`.

- **Agenda de firma para asesor (etapa 9→10):** se agrega módulo “Agendar cita de firma” en expediente de asesor; consume configuración de firmas, muestra cupos restantes por ubicación/fecha/slot y al confirmar persiste en `agenda_firmas_bookings_v1` y avanza operativo a etapa 10.

- **Firmas con cupos configurados:** `agenda_firmas_bookings_v1` deja de ser captura libre de fecha/hora; ahora valida contra `agenda_firmas_config_v1`, bloquea slots llenos, cancela booking activo previo del expediente y evita duplicados activos.

- **Mesa-control detalle (visibilidad de citas):** el expediente en mesa-control muestra resumen explícito de cita de biométricos y cita de firma (ubicación, fecha/hora, quién agendó, estado), leyendo desde bookings activos por expediente.

- **Agenda biométricos (configuración Cynthia / mesa_control_admin):** se integra panel en `/mesa-control` para administrar ubicaciones, días, horarios, cupos y estado activo/inactivo por ubicación/slot. La persistencia usa `localStorage.agenda_config_v1` mediante `MockAgendaBiometricosLocalStorageRepo.writeConfig`, que dispara `agenda_config_updated`.

- **Agenda biométricos (consumo y refresco):** `AgendaBiometricosCard` ahora escucha `agenda_config_updated` y refresca configuración en caliente; solo ofrece ubicaciones activas y mantiene el cálculo de disponibilidad/cupos con `agenda_config_v1` + `agenda_bookings_v1`.

- **Roles mesa en expediente (etapa 3–4):** en mesa-control detalle, el bloque de biométricos se habilita para roles de mesa (`mesa_control_admin`, `mesa_control_interno`, `mesa_control_externo`, legacy `mesa_control`) y mantiene agenda de firmas restringida a admin.

- **Guard de avance mesa (alineación catálogo cliente):** `getBloqueosAvanceMesa` ya no bloquea por obligatorios `ownerRole: "sistema"` (legacy) cuando la UI de mesa trabaja con documentos `cliente_*`. Ahora evalúa faltantes solo del subconjunto `ownerRole: "cliente"` del mismo checklist de etapa, manteniendo criterio estricto de `validado` para avance.

- **Mesa-control avance de etapa (2 → 3):** se corrige el flujo de “Aprobar y pasar a siguiente” en expediente. El handler ya no se queda en transición local de `en_validacion_mesa` a `en_proceso` en la misma etapa; ahora evalúa bloqueos reales y avanza de etapa cuando cumple requisitos. Se agrega validación explícita de bloqueos: Datos Generales en estado `validado` y documentos obligatorios validados por checklist. Si falta algo, muestra mensaje claro de bloqueo (no falla silenciosamente).

- **Datos Generales (mesa-control ↔ asesor):** se completa el flujo de validación/rechazo en mock `localStorage` (`expediente_cliente_datos`). Nuevo estado `validado` y metadata de auditoría (`validatedAt/validatedBy`, `rejectedAt/rejectedBy`, además de `updatedAt/updatedBy`). En mesa-control, “Rechazar datos” ahora usa modal con comentario obligatorio; “Validar datos” guarda `estado: validado`, limpia rechazo previo y actualiza UI al instante. En asesor, se muestran mensajes explícitos para `validado` y `rechazado` con motivo/metadata.

- **Mesa-control documentos 0/0 tras envío:** la fuente de archivos se mantiene en IndexedDB (`concasa-crm-files`), pero el checklist de mesa se calculaba con etapa operativa 2 y el catálogo tenía documentos cliente/base solo en etapa 1; resultado: 0/0 y lista vacía. Se amplían `etapasRequeridas` de documentos obligatorios base + `cliente_*` a `[1, 2]` y en `mesa-control/[id]` el checklist usa `pendienteRevisionCuentaComoCompleto: true` para contar archivos `subido/resubido` como presentes en panel de documentos.

- **Flujo “Enviar a mesa” (mock/localStorage):** se elimina el falso positivo de UI en asesor: `SeguimientoOperativoMock` ahora marca “Enviado a mesa de control” **solo después** de persistir vía callback (`onEnviarAMesa`), y no cambia estado si la persistencia falla o retorna `false`.

- **Expediente asesor (`onEnviarAMesa`):** el callback devuelve `boolean` para bloquear envío cuando fallan validaciones previas (datos generales incompletos, sesión inválida, checklist cliente con faltantes). Tras `repo.enviarAMesa`, se verifica `repo.getById(...).operativo.submittedToMesa` y se sincroniza `operativo` local inmediatamente.

- **Repo mock expedientes:** `enviarAMesa` actualiza/crea registro único en `mesa_control_inbox` (sin duplicados por expediente) y persiste campos operativos de envío (`submittedToMesa`, `fechaEnvioMesa`, `updatedAt`, `estadoEnvio`, `subestado`, `etapaActual`) con `origenMesa`/`tipoMesa` forzados a **interno** en este bloque. También guarda `asesorId`/`asesorEmail` en la entrada.

- **Fallback de origen en lectura/acceso mesa:** si un expediente enviado no trae origen explícito, se trata como `interno` (`MockExpedientesRepo.toExpedienteMock`, `mesaControlAccess`, y filtro de pestaña “Internos” en bandeja).

- **Limpieza de logs de diagnóstico:** se retiraron `console.log` temporales de diagnóstico en flujo de envío y bandejas para evitar ruido en consola.

## 2026-04-21

- **Login mock / roles:** el selector de perfil ya no muestra `admin` ni `mesa_control` (legacy); etiquetas Mesa: “Mesa Control - Admin (Cynthia)”, “Interno”, “Externo”. Sin cambios en claves persistidas ni en permisos.

- **Admin dashboard (mock):** `src/lib/adminDashboardStats.ts` con `computeAdminOperativoKpis`, `computeAdminFunnelExclusive` y `computeAdminFunnelByEtapa` sobre `ExpedienteMock[]`; integración en `src/app/admin/page.tsx` (vista global) sin duplicar fetch (`expedientesMock` + `mockList` derivado). Tabla principal sigue en `filteredList`. Enlace de edición corregido a `/admin/:id`. Pruebas: `adminDashboardStats.test.ts`.

- **Admin métricas por asesor (mock):** `computeAdminMetricsByAsesor` agrupa por `base.asesorId` (vacío → `(sin asesor)`): totales, enviados a mesa, biométricos (3–5 con mesa), firma (9–10 con mesa), firmados (≥11), rechazos operativo/editor y conversión `firmados / enviados a mesa` (`null` si cero envíos). Tabla en `src/app/admin/page.tsx` leyendo solo `expedientesMock`. Prueba en `adminDashboardStats.test.ts`.

- **Admin tiempos del proceso (mock):** `computeAdminTimeMetrics` en `adminDashboardStats.ts` usa solo `createdAt`, `updatedAt`, `etapaActual` y `submittedToMesa` (informativo en ranking): promedio creación→última actualización para `etapaActual >= 11`, antigüedad media por etapa actual, cuello de botella (máxima media con n ≥ 3) y top 10 por intervalo. Sección “Tiempos del proceso” en `admin/page.tsx`. Pruebas en `adminDashboardStats.test.ts`.

- **UX mock Cynthia / mesa admin:** login guarda `mock_user` (`email`, `role`, `name`) y sincroniza `mock_role`/`mock_email`; helpers en `mockUser.ts` y limpieza en `clearMockData`. Sesión mock reconoce `mesa_control_admin` / interno / externo. Bandeja mesa-control: pestañas Todos/Internos/Externos (admin), KPIs extra (validación mesa, total), tarjetas de expedientes; detalle con bloque héroe (cliente, asesor, origen), `AgendaBiometricosCard` en etapas 3–4 y `AgendaFirmasCard` solo en etapa 9 (admin). Agenda biométricos: chips de horario con disponible/lleno, mensaje de éxito y botones deshabilitados al guardar. Prueba `mockUser.test.ts`.

- **Firma (etapas 9–10) / anti-bypass mock:** `updateOperativo` exige `mock_role === "mesa_control_admin"` y una reserva `booked` en `agenda_firmas_bookings_v1` cuyo `date`+`time` coincide en slot con `fechaCita` (misma clave que biométricos). Helper `agendaFirmasBookingsGuard.ts`, escritura `tryWriteFirmasBooking` en `agendaFirmasMock.ts`, tarjeta `AgendaFirmasCard` solo montada en `mesa-control/[id]` para admin en etapas 9–10. `SeguimientoOperativoMock`: cita editable solo admin en etapa 9 con `datetime-local`; etapa 10 muestra cita en solo lectura. `clearMockData` borra `agenda_firmas_bookings_v1`. Prueba: `agendaFirmasBookingsGuard.test.ts`.

- **`origenMesa` al enviar a mesa:** catálogo mock `asesores_tipo_mesa_v1` (`src/lib/asesorTipoMesaMock.ts`) con `getTipoAsesorForEmail` / `origenMesaDesdeEmailAsesor`; `enviarAMesa` en `mock.repo.ts` resuelve siempre `origenMesa` (payload explícito o, por defecto, desde `asesorId` de la precalificación → sin `null` en nuevos envíos; default **interno** si no hay entrada). `clearMockData` borra también esa clave.

- **Mesa de control / acceso por rol:** nuevo módulo `src/lib/mesaControlAccess.ts` con `canUserAccessExpediente` y `filterExpedientesByRole` según `mock_role` (`mesa_control_admin`, `mesa_control_interno`, `mesa_control_externo`, legacy `mesa_control`). `ExpedienteMock.base` incluye `origenMesa` (desde inbox); `enviarAMesa` persiste `origenMesa` opcional en `mesa_control_inbox`. Bandeja (`mesa-control/page.tsx`) filtra con el helper; detalle (`mesa-control/[id]/page.tsx`) bloquea acceso por URL si el rol no corresponde al origen. Pruebas: `src/lib/mesaControlAccess.test.ts`.

## 2026-04-20

- **Agenda biométricos / bookings**: al confirmar cita desde `AgendaBiometricosCard` se escribe `agenda_bookings_v1` (cancela `booked` previas del mismo expediente y crea una nueva con `status: "booked"`); si falla `updateOperativo`, se revierte el snapshot de bookings. En rechazo operativo (`subestado: rechazado`) desde mesa-control se cancelan las reservas activas del expediente. Núcleo en dominio: `planBookBiometricosSlot` / `cancelActiveBookingsForExpediente`; helpers cliente en `agendaBiometricosMock`. La tarjeta del asesor escucha `agenda_bookings_updated` para refrescar opciones e hints.

## 2026-04-09

- **`clearMockData`**: también elimina `agenda_biometricos_config` del `localStorage` (pruebas desde cero con la misma utilidad que el resto de mocks).
- **Agenda biométricos (integración cerrada)**: la disponibilidad y validación de slots ya no dependen de `mesa_control_inbox` ni de horarios fijos 9–17. La fuente de verdad pasa a ser **exclusivamente** `agenda_config_v1` (config por día/ubicación/cupo) y `agenda_bookings_v1` (reservas), con una función central `getAgendaBiometricosDisponibilidad`. `validateSlotForBooking` y `getNextAvailableSlotHints` delegan a esa fuente única. `AgendaBiometricosCard` incluye selección de ubicación y si no existe `agenda_config_v1` muestra mensaje y no permite agendar.
- **Operativo mock / etapa vs `en_validacion_mesa`**: la validación documental por mesa corresponde siempre a **etapa operativa 2** (`etapaActual`). `enviarAMesa` persiste `etapaActual: 2`; `toExpedienteMock` y `updateOperativo` corrigen filas viejas (`null` o `1`) con `etapaActualParaOperativo`. Se elimina el guard que bloqueaba `patch.etapaActual` en validación mesa. `SeguimientoOperativoMock`: timeline optimista y refetch con etapa 2; “Aprobar y pasar a siguiente” con `en_validacion_mesa` pasa a `en_proceso` en la misma etapa (2) sin saltar a la 3. Pruebas: `etapa-validacion-mesa.test.ts`.
- **Mock `enviarAMesa`**: persiste `fechaEnvioMesa` (ISO, mismo instante que `updatedAt` del envío) en la fila de `mesa_control_inbox`; el tipo `RawOperativoInbox` y el inbox tipado ya contemplan el campo; `updateOperativo` conserva el valor vía spread de la entrada existente.
- **Mesa de control / bandeja**: tras `listForMesa`, orden por `subestado` y, a igual prioridad, por fecha de urgencia: `fechaEnvioMesa` (si viene en `mesa_control_inbox`), luego `createdAt` del expediente, luego `updatedAt` operativo; solo UI (lectura de inbox en cliente para el campo opcional), sin cambios en `listForMesa` ni filtros.
- **Dashboard asesor / columna Documentación**: deja de usar solo `deriveResumenDocumental` (paquete de 4 tipos base) para la celda; usa `deriveEstadoDocumentacionColumnaAsesor` sobre el resumen completo y los mismos obligatorios por etapa que el checklist (`listDocumentosCatalogoForStage`), con prioridad: falta/rechazado → «Faltantes»; `subido`/`resubido` sin validar → «Pendiente de aprobación»; todo `validado` → «Completos». KPIs y filtros rápidos «Corrección *» siguen con `deriveResumenDocumental` derivado del resumen cacheado.
- **Columna Documentación / equivalencias base ↔ cliente**: `deriveEstadoDocumentacionColumnaAsesor` agrupa `ine` con `cliente_ine_frente` y `cliente_ine_reverso`, `estado_cuenta` con `cliente_estado_cuenta`, `direccion` con `cliente_comprobante_domicilio`; el estatus efectivo del grupo es el mejor entre filas del grupo (validado &gt; subido/resubido &gt; rechazado &gt; faltante). NSS no tiene tipo `cliente_*` en catálogo; los grupos se deduplican para no contar INE tres veces.
- **Columna Documentación / NSS no bloqueante**: el tipo `nss` se excluye del conjunto que alimenta la columna (`DOCUMENTOS_NO_BLOQUEANTES_PARA_COLUMNA_DOCUMENTACION`); el catálogo y el resto de validaciones no cambian. Con documentos principales subidos y NSS ausente o en faltante, la columna puede mostrar «Pendiente de aprobación» en lugar de «Faltantes».
- **Dev / limpieza mocks**: `src/lib/dev/clearMockData.ts` borra las claves `localStorage` de precalificaciones, decisiones, inbox mesa, datos cliente y sesión mock; elimina IndexedDB `concasa-crm-files` y resetea la promesa de conexión en `mock-indexeddb.repo.ts`. En `NODE_ENV === "development"`, `DevClearMockGlobal` expone `window.clearMockData()` (devuelve `Promise`; en consola usar `await clearMockData()`).
- **UI badge `en_validacion_mesa`**: en `subestadoOperativoBadgeClass`, alto contraste (`bg-blue-600 text-white border-blue-600`) para legibilidad en tablas.
- **Dashboard asesor / columna Estatus op.**: la fila del listado guarda `operativo` completo desde `ExpedienteMock` y la columna y el filtro usan `p.operativo?.subestado` (ya no el campo plano `subestadoOperativo`). Log temporal `[diag dashboard asesor]` con `id` y `subestado`.
- **Mock inbox / merge por `updatedAt`**: `mergeMesaControlInboxByLatestUpdated` en `mesaControlInboxMock.ts` evita que una fila duplicada antigua pise la reciente al armar el `Map` (antes `forEach` + `set` dejaba la última del array; con `unshift` del nuevo registro, una copia vieja al final podía borrar `subestado: en_validacion_mesa` y el dashboard mostraba “Pendiente”). `MockExpedientesRepo.buildInboxMap` usa esta fusión. Pruebas en `mesaControlInboxMock.test.ts` (incluido en `npm test`). Log temporal único `[diag subestado final]` en `toExpedienteMock`; limpieza de otros `console.log` de diagnóstico en `mock.repo.ts`.

## 2026-04-08

- **Mock expedientes / merge subestado en dashboard**: en `toExpedienteMock`, el subestado del expediente sale de `op?.subestado ?? "pendiente"` antes de `normalizeSubestado` (fallback si no hay fila inbox o `subestado` ausente); `normalizeSubestado` hace `trim` en strings para no perder `en_validacion_mesa` por espacios en JSON. Log temporal `[diag subestado final]` con `precalId` y `subestadoFinal: op?.subestado`; el merge log incluye `subestadoDesdeInbox` y `subestadoNormalizado`.
- **UI subestado operativo**: `src/lib/subestadoOperativoUi.ts` con `subestadoOperativoLabel` / `subestadoOperativoBadgeClass` (trim; texto “En validación por mesa” + badge sky para `en_validacion_mesa`); dashboards asesor, mesa-control y admin usan el helper; expediente mesa-control importa la misma etiqueta.
- **Operativo mock / envío a mesa**: nuevo subestado `en_validacion_mesa` en `OperativoSubestado`; `enviarAMesa` persiste etapa 1 con `submittedToMesa: true` y `subestado: "en_validacion_mesa"` (no `pendiente` ni `en_proceso`). Etiquetas en seguimiento, mesa-control, dashboard asesor y admin; `en_proceso` sigue al operar/avanzar mesa.
- **Asesor expediente / enviar a mesa (padre)**: tras `getChecklistDocumentos`, el bloqueo ya no usa `checklist.completos` (incluía faltantes legacy `ine`/`nss`/etc.); solo `filterChecklistDocumentoItemsPorOwnerRole(checklist.faltantes, "cliente")` con log `[asesor] bloqueo enviar a mesa: faltantes cliente`.
- **Seguimiento operativo (asesor)**: el envío a mesa ya no usa `DOCUMENTO_TIPOS` (ine / estado_cuenta / nss / direccion) para habilitar el botón ni para guards en `onClick`; solo checklist etapa 1 + `filterChecklistDocumentoItemsPorOwnerRole(..., "cliente")` vía `faltantesCliente` (`null` mientras carga). Eliminados `docsMissing` / `docsRejected` / `docsNoValidados`, el bloque legacy de paquete de 4 en UI, y el extra de mesa que exigía los 4 tipos `validado` al avanzar etapa 1 (sigue el `getChecklistDocumentos` previo en `handleAprobarYSiguiente`).
- **Mock expedientes / diagnóstico `submittedToMesa`**: logs `[diag enviado a mesa]`, `[diag merge operativo]` y `[diag expediente final]` en `MockExpedientesRepo` para trazar persistencia inbox ↔ merge ↔ `getById`.
- **Asesor / enviar a mesa**: antes de `repo.enviarAMesa`, la página persiste los datos generales del cliente con `MockExpedienteClienteDatosLocalStorageRepo.save` usando el estado local del formulario (`datos: clienteDatos`), sin depender del clic en **Guardar borrador**; se actualiza `clienteDatosMeta` y se registra `[diag autosave antes de enviar]` en consola.

## 2026-04-07

- **Asesor / enviar a mesa (histórico 04-07)**: validación de completitud con `getClienteDatosCamposFaltantes` y persistencia antes de checklist/`enviarAMesa` (desde 2026-04-08 el envío usa `clienteDatosRepo.save` inline; ver entrada 2026-04-08). El botón manual sigue siendo **Guardar borrador** (outline).
- **Asesor / post-envío a mesa (UI)**: en `SeguimientoOperativoMock`, el panel “Enviado a mesa de control” ya no lista los 4 tipos `DOCUMENTO_TIPOS` (mostraba “Faltante” aun con archivos en `cliente_*`); se conservan solo título, mensaje y bloque Etapa / Actualización.
- **Mesa-control (revisión documental, UI)**: la lista lateral de “Revisión de documentos” deja de iterar `DOCUMENTO_TIPOS` (4 tipos base); muestra los ítems de checklist con `ownerRole === "cliente"` vía `filterChecklistDocumentoItemsPorOwnerRole`, alineada con filas `cliente_*` en `archivosResumen` para no marcar “Faltante” cuando el archivo real está en otro tipo del catálogo. `selectedTipo` pasa a `TipoDocumentoCatalogo`; la auto-selección inicial usa el mismo orden cliente del checklist.
- **Operativo mock / envío a mesa**: `enviarAMesa` deja `subestado: "pendiente"` en etapa 1 (espera revisión mesa); `en_proceso` lo aplica mesa al avanzar vía timeline → `updateOperativo` / `handleAprobarYSiguiente`. `SeguimientoOperativoMock` alinea UI optimista y payload con `pendiente`.
- **Checklist / envío asesor**: `deriveChecklistDocumentosFromResumen` y `getChecklistDocumentos` aceptan `pendienteRevisionCuentaComoCompleto`; en integración, `subido`/`resubido` cuentan como documento presente (mesa sigue exigiendo `validado` al avanzar etapa). `SeguimientoOperativoMock` recalcula checklist tras cada sync IndexedDB (`archivosChecklistNonce`) y registra `archivosResumen` / checklist en consola.
- **Asesor / envío a mesa**: el botón "Enviar a mesa de control" queda deshabilitado (`opacity-50`, `cursor-not-allowed`) si el checklist etapa 1 tiene faltantes de documentos con `ownerRole === "cliente"` (`getChecklistDocumentos` + `filterChecklistDocumentoItemsPorOwnerRole`); guard en `onClick` con el mismo criterio. Corrige el caso en que el paquete legacy estaba oculto y no se validaban documentos en `SeguimientoOperativoMock`.
- **Mock expedientes / bandeja mesa**: `getInboxKey` coacciona `id` e `idPrecal` con `String(...)` (ya no exige `typeof === "string"`, evitando filas de `mesa_control_inbox` ignoradas). `enviarAMesa` y `updateOperativo` normalizan `idStr` y persisten `id`/`idPrecal` como string; `getById` compara con `String(id).trim()`. `readPrecalificaciones` acepta `id` numérico en JSON y lo normaliza a string. Logs `[diag precal creada]`, `[diag enviarAMesa input]`, `[diag inbox guardado]`, `[diag precal ids]` / `[diag inbox ids]` en `listForMesa`.
- **Sincronización asesor → mesa (expediente abierto)**: tras persistir `enviarAMesa`, se emite `expediente_enviado_a_mesa` con `detail.expedienteId`; la página `mesa-control/[id]` escucha el evento y vuelve a cargar datos cliente (`loadClienteDatos`) y resumen de archivos (`loadArchivos`) cuando el id coincide con la ruta.
- **Mesa-control (carga inicial datos cliente)**: `loadClienteDatos` usa el `id` de la ruta (`routeExpedienteId`), no `expediente?.id`, para que al abrir el expediente en mesa los datos de `localStorage` se lean en cuanto hay URL; carga inicial unificada con `loadArchivos` en un solo `useEffect` dependiente de `routeExpedienteId`. Comparaciones de eventos y persistencia asesor/mesa normalizan ids con `String(...)`. Logs temporales de diagnóstico en consola al cargar datos cliente.
- **Asesor / precalificación**: el asesor solo puede capturar datos generales del cliente, subir documentos de integración y enviar a mesa si `editorDecision` cumple aprobación con `monto_aprobado` numérico &gt; 0 (`asesorPuedeIntegrarTrasMontoRevisor`). Página expediente asesor pasa `asesorIntegracionHabilitada` a `SeguimientoOperativoMock`; fallback temporal en el componente sigue leyendo `decisions_mock` si la prop no viene.
- **Mesa-control (expediente)**: `latestByTipo` memoizado (`Map` por `tipo_documento`, mismo criterio de fecha que `rowMasRecientePorTipoDocumento`) para preview de documentos requeridos sin recomputar por cada ítem.
- **Expediente-archivos (consulta por tipo)**: `findRowPorTipoDocumento`, `rowsPorTipoDocumento`, `rowMasRecientePorTipoDocumento`; UI deja de usar `.find`/`.filter` manuales por `tipo_documento`.
- **Expediente-archivos (filtros)**: `filterItemsPorOwnerRoleCatalogo` como base de `filterResumenPorOwnerRole`; `filterChecklistDocumentoItemsPorOwnerRole` en checklist; paneles “Documentos requeridos” (mesa/asesor) dejan de duplicar `ownerRole` en UI.
- **Expediente-archivos (orden y filtros)**: `MAP_INDICE_TIPO_DOCUMENTO_CATALOGO`, `compareTipoDocumentoCatalogo`, `ordenarPorTipoDocumentoCatalogo`, `isTipoPaqueteDocumental`, `filterResumenPaqueteDocumental` y `filterResumenPorOwnerRole`; checklist ordena `faltantes` / `completosLista` por índice de catálogo; mesa-control usa resumen filtrado al paquete de 4 para KPIs y “validar todos los pendientes”.
- **Mock IndexedDB `listResumenByExpediente`**: el array devuelto cubre **todo** `TIPO_DOCUMENTO_CATALOGO` en orden fijo (4 base → `cliente_*` → `asesor_*`); las primeras 4 entradas coinciden con el comportamiento anterior; `deriveResumenDocumental` sigue basándose solo en los 4 tipos base.
- **Expediente-archivos (tipado)**: `ExpedienteArchivoResumen.tipo_documento` pasa a `TipoDocumentoCatalogo`; `getLatestDocByTipo` compara sin cast; mock IndexedDB devuelve el tipo almacenado sin forzarlo; helper `labelTipoDocumentoCatalogo` para etiquetas del catálogo completo; `afterRevisionPersist` acepta catálogo y solo navega “siguiente pendiente” si el tipo pertenece al paquete de 4 (`DOCUMENTO_TIPOS`).
- **Subida documentos `cliente_*` (UI)**: validación antes de llamar al repo: solo `image/*` o `application/pdf`; si no cumple, `alert` y no se guarda. Opcionalmente se muestra el `mime_type` del archivo ya subido.
- **Seguimiento operativo (mock)**: en **cualquier rechazo** operativo, el summary envía `fechaCita: null` para que `updateOperativo` limpie la cita en inbox (misma regla que ya aplicaba al flujo etapa 4 → 3); al cargar expediente rechazado, la etapa actual no rehidrata cita desde `initialFechaCita`.
- **Expediente-archivos (catálogo)**: definido un catálogo extendido de `TipoDocumento` (cliente/asesor) con obligatoriedad y etapas requeridas, sin alterar el “paquete documental” actual de 4 tipos (`DOCUMENTO_TIPOS`) ni la lógica de resumen/validación existente.
- **Expediente-archivos (checklist)**: nueva función `getChecklistDocumentos(expedienteId, etapaActual)` que valida contra los obligatorios del `DOCUMENTO_CATALOGO` (etapa → tipos base soportados hoy) usando `listResumenByExpediente` (IndexedDB), devolviendo faltantes y completos.
- **UI “Documentos requeridos”**: en asesor y mesa-control el panel lista solo ítems con `ownerRole === "cliente"` y etapa actual en `etapasRequeridas` (mesa: `etapaActualDisplay`; asesor: etapa `1`); el progreso usa solo esos faltantes/completos.
- **Mesa-control (documentos requeridos)**: cada ítem **completo** (cliente) es clicable; abre modal con vista previa (`blob:`) usando `getArchivoBlob`: imagen en `<img>`, PDF en `<iframe>`.
- **Expediente cliente (datos generales, mock)**: nueva entidad `expediente_cliente_datos` con modelo `ExpedienteClienteDatos`, repo mock con persistencia en `localStorage`, y evento `expediente_cliente_datos_updated` para sincronización.

## 2026-03-23

- **Biométricos (mock)**: cita visible también en **etapa 4** (resumen + panel de detalle mesa). **Rechazar** en etapa 4 invalida la cita: vuelve a etapa 3 `rechazado`, limpia `fechaCita` en inbox (libera slot) y el asesor ve de nuevo la agenda con aviso de rechazo. Ocupación de slots excluye `subestado === rechazado`. Al reagendar/agendar desde asesor se limpian `motivoRechazo` / `comentarioRechazo`.
- **Agenda biométricos (mock)**: citas desde **asesor** solo en etapa real 3 (enviado a mesa); slots lun–vie 9:00–17:00 cada 30 min; ocupación cruzada vía `mesa_control_inbox` (etapas 3–4 + `fechaCita`); al agendar/reagendar se llama `updateOperativo` (`etapaActual: 4`, `en_proceso`, `fechaCita` ISO). Capa `src/lib/agendaBiometricosMock.ts`, UI `AgendaBiometricosCard` en panel lateral del expediente asesor. Mesa ya no edita cita de etapa 3 (solo etapa 9 firma).
- **Seguimiento operativo (mock, UX mesa)**: eliminado el toggle **Rol (mock)** y el botón **Marcar En proceso**; el rol sigue fijándose solo con `mock_role` en localStorage. Acciones de mesa: **Aprobar y pasar a siguiente**, **Regresar a etapa anterior**, **Rechazar** (en ese orden); panel y cabecera algo más compactos.
- **Seguimiento operativo (mesa mock)**: botón **Regresar a etapa anterior** (outline) bajo “Aprobar y pasar a siguiente”; baja `operativoEtapaId` en 1, pone la etapa destino en `en_proceso`, alinea `selectedStageId`, persiste vía `onChangeSummary` / `updateOperativo`; deshabilitado en etapa 1 o en vista histórica del timeline.
- **Mesa-control (preview documental)**: al abrir la imagen/PDF en nueva pestaña se reutiliza el mismo `blob:` URL del panel; se elimina el `useEffect` que revocaba en cleanup al cambiar `preview.url` (evita pestaña/preview en blanco en dev/Strict Mode). `openPreviewBlobInNewTab` mantiene `window.open(..., noopener,noreferrer)` y añade fallback con `<a target="_blank">` si el popup está bloqueado.
- **Seguimiento operativo (mock)**: separación de `operativoEtapaId` (etapa real) vs `selectedStageId` (solo UI); el click en el timeline ya no altera ni persiste la etapa real.
- **Mesa-control**: acciones rápidas y edición (cita 3/9, notas, etc.) solo con etapa seleccionada = etapa operativa; vista histórica en solo lectura con aviso.
- **Aprobar y pasar a siguiente**: la etapa siguiente queda en `en_proceso` en timeline y en persistencia; `selectedStageId` avanza con la nueva etapa.
- **Rechazo operativo**: campo persistido `comentarioRechazo` (separado de `motivoRechazo`) en inbox mock y `ExpedienteMock.operativo`.
- **Dominio mock**: `MockExpedientesRepo.updateOperativo` / `toExpedienteMock` / `enviarAMesa` actualizados para `comentarioRechazo`.

## 2026-03-19

- Mesa-control (expediente): revisión documental con lista seleccionable (sin botones por fila), panel derecho con decisión (Pendiente/Validado/Rechazo con comentario), guardado automático en validado y pendiente vía `subido`/`resubido` según último pendiente conocido, lightbox al ampliar preview; sin cambios en repos ni eventos.
- Mesa-control (expediente): bloque **Revisión de documentos** optimizado a acciones rápidas por archivo (`Ver`, `Descargar`, `Validar`, `Rechazar`), rechazo inline con comentario obligatorio, botón `Validar todos los pendientes`, feedback por documento (`Guardando/Validado/Rechazado/Error`) y preview en layout 2 columnas con panel derecho sticky (desktop). Sin cambios en repos, dominio, eventos ni reglas.
- Mesa-control (bandeja): KPIs operativos (correcciones enviadas, nuevos 1–2, citas hoy, bloqueados/rechazados), chips rápidos, filtros adicionales en bloque secundario, tabla compacta (cliente + meta teléfono/asesor), prioridad visual por fila, orden por capas (corrección enviada → requerida → nuevos 1–2 → cita hoy → resto por fecha), fila completa navega a expediente (teclado + guard en controles interactivos). Sin cambios en repos, eventos ni dominio.
- `SeguimientoOperativoMock`: sincronización defensiva de `submittedToMesa` cuando cambia la prop `initialSubmittedToMesa` (refetch del padre / inbox), sin pisar el envío optimista mientras la prop sigue en `false`.
- Dashboard asesor: chip rápido **Corrección enviada (n)** filtra por `correccion_enviada` y usa el contador `kpis.correccionEnviada`.
- Dashboard asesor: vista compacta (4 KPIs visibles, filtros rápidos + avanzados colapsables, tabla operativa reducida); métricas editor/corrección enviada siguen calculadas en `kpis` sin mostrarse arriba.
- Dashboard asesor: columna **Documentación** y KPIs **Corrección requerida** / **Corrección enviada** vía `deriveResumenDocumental` + IndexedDB; listener `expediente_archivos_updated`. Rechazo documental no altera `resultadoReal` ni KPI “Rechazados por mesa”.
- Panel asesor (enviado a mesa): comentario de rechazo documental completo en caja roja (sin `truncate`).
- UX mesa-control: bandeja refuerza filas con `correccion_enviada` (borde, fondo, badge + texto “Documentos corregidos por revisar”); expediente muestra resumen numérico de pendientes / correcciones enviadas / validados y jerarquía visual en filas y badges (resubido más urgente que subido).
- Mesa-control (expediente): el select de revisión documental solo permite elegir **Validado** o **Rechazado**; `subido` y `resubido` son solo estados automáticos (badge + placeholder “Elegir decisión…”).
- Estatus documental `resubido`: reemplazo tras rechazo documental (sin duplicar expediente ni reenvío de paquete).
- `replaceArchivo` en IndexedDB: si el archivo previo estaba `rechazado` o `resubido`, el nuevo queda en `resubido`; en otro caso `subido`. Limpia `comentario_mesa`, mantiene id `expedienteId::tipo_documento`, actualiza `created_at` y dispara `expediente_archivos_updated`.
- Helper `deriveResumenDocumental` + categorías (`faltantes`, `pendiente_revision_documental`, `correccion_requerida`, `correccion_enviada`, `documentos_validados`) para bandeja mesa-control (orden y badge/columna).
- UI asesor: badge azul “Corrección enviada” en `resubido`; mesa expediente: badge “Resubido” y opción en el select de revisión.
- Pruebas: `src/domain/expediente-archivos/derive-resumen-documental.test.ts` (node:test + tsx).

## 2026-03-18

- Se reforzo el flujo documental mock asesor -> mesa -> asesor para exigir consistencia operativa sin backend real.
- En mesa-control, rechazar un documento ahora obliga comentario de mesa al guardar revision.
- En seguimiento operativo, la etapa 1 (Integracion) no puede avanzar si los 4 documentos no estan en estatus `validado`.
- En asesor, al estar enviado a mesa se mantiene una vista compacta de estatus documental (faltante/subido/validado/rechazado, comentario y acciones de ver/descargar).
- Se mantiene la persistencia local en IndexedDB y sincronizacion via evento `expediente_archivos_updated`.
