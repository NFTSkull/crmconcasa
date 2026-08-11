# B1.5 — Equivalencia TypeScript → SQL (`/asesor` inbox)

Fuente UI: `src/app/asesor/page.tsx` + helpers citados.
RPCs: `asesor_list_expedientes_page`, `asesor_inbox_summary` (mig. **161**).
Helpers calibrados: `asesor_inbox_categoria_correccion`, `asesor_inbox_pendiente_agendar_biometricos` (mig. **167**).
**UI `/asesor`:** cableada en B1 UI (sin `listForAsesor`, sin fallback).

## Universo base

| TS | SQL |
|---|---|
| `listForAsesor` → `deleted_at IS NULL` ∧ `asesor_id = auth.uid()` | Igual; rol `asesor` activo; `organization_id` del perfil |

## `resultadoReal` ← `deriveResultadoRealExpediente`

| Orden TS | Condición | Valor |
|---|---|---|
| 1 | `ciclo_estado = cancelado` | `cancelado` |
| 2 | `submitted_to_mesa` ∧ `subestado = rechazado` ∧ (`ciclo` null\|activo) | `rechazado_mesa` |
| 3 | `submitted_to_mesa` | `en_tramite` |
| 4 | `editor_decisions.decision = no_cumple` | `no_cumple_editor` |
| 5 | `decision = aprobado` | `aprobado_editor` |
| 6 | else (`pendiente` / ausente) | `pendiente_editor` |

## `categoria_correccion` ← `deriveResumenExpedienteCorreccion` (P167)

Orden canónico (TS + SQL `asesor_inbox_categoria_correccion`):

| Orden | Condición | Valor |
|---|---|---|
| 1 | `cliente_datos.estado = rechazado` | `correccion_requerida` |
| 2 | `retencion_envios.estado = correccion_requerida` | `correccion_requerida` |
| 3 | última versión de algún doc corregible en `rechazado` (`cliente_*` integración/complementarios, legado `ine|estado_cuenta|nss|direccion`, acuse principal) | `correccion_requerida` |
| 4 | última versión de algún doc corregible en `resubido` | `correccion_enviada` |
| 5 | pack legado `DOCUMENTO_TIPOS` (faltantes / subido / validado) | ver abajo |
| 6 | `clienteDatosCorreccionEnviadaPendiente` (solo si UI pasa fechas) | `correccion_enviada` |

`DOCUMENTO_TIPOS` legado = `ine`, `estado_cuenta`, `nss`, `direccion`. Última versión activa por tipo (`deleted_at IS NULL`, `created_at DESC, id DESC`).

| Doc pack legado | Valor |
|---|---|
| falta alguno o `faltante` | `faltantes` |
| alguno `rechazado` | `correccion_requerida` |
| alguno `resubido` | `correccion_enviada` |
| alguno `subido` | `pendiente_revision_documental` |
| todos `validado` | `documentos_validados` |
| else | `pendiente_revision_documental` |

**P167:** el corpus productivo usa `cliente_*`; rechazo solo documental ya entra al KPI «Necesita corrección» (antes dependía casi solo de `cliente_datos.rechazado`). Contador = expedientes distintos con ≥1 corrección abierta (no N filas por N ítems).

Semántica UI compartida: `src/domain/expedientes/asesor-pendientes.ts` (`getAdvisorPrimaryPendingAction`, `listAsesorCorreccionesAbiertas`).

## Chips / KPIs (`kpis` + `quickFilterChips`) — universo **sin** filtros de búsqueda

| KPI/chip | TS | SQL |
|---|---|---|
| `total` | `totalCount` = filas asesor | `count(*)` deleted null |
| `enTramite` | `resultadoReal=en_tramite` ∧ categoría ∉ {correccion_requerida, correccion_enviada} | igual |
| `correccionRequerida` (label UI «Necesita corrección») | categoría = correccion_requerida | igual |
| `correccionEnviada` | categoría = correccion_enviada | igual |
| `rechazadosMesa` | resultadoReal = rechazado_mesa | igual |
| `cancelados` | resultadoReal = cancelado | igual |
| `aprobadosEditor` / `noCumple` | resultadoReal editor | igual (objeto kpis; no tarjetas) |
| `agendarBiometricos` | `isAsesorPendienteAgendarBiometricos` | submitted ∧ último notif ≠ booked ∧ último bio ≠ booked ∧ (etapa=3 ∨ (etapa∈{4,5} ∧ último bio = cancelled)) |
| `agendarFirma` | `isAsesorPendienteAgendarFirma` + `canShowAsesorFirmasSupabaseCard` | etapa 9: último firmas ≠ booked; etapa 10: último firmas = cancelled |
| `subirAcuse` | etapa≥8 ∧ panel retención ∧ ¬acuse principal listo | `submitted` ∧ etapa≥8 ∧ ¬ existe `retencion_acuse_con_sello`\|`retencion_carta_sin_sello` con estatus ∈ {subido,resubido,validado} |

Prioridad de tarea primaria: corrección abierta → Subir/Corregir Acuse → Agendar/Reagendar bio → Agendar/Reagendar firma.

En modo Supabase los hints de agenda **ignoran** `fecha_cita` del expediente (solo bookings).

Actualización: `/asesor` refetch al focus/visibility (debounce ≥8s); sin polling agresivo.

## Filtros listado (`expedientesFiltrados`) → `asesor_list_expedientes_page`

Aplicados **antes** de paginar; `total_count` = universo filtrado.

| Filtro UI | TS | SQL |
|---|---|---|
| `buscar` | `matchesAsesorListadoBusqueda` | ILIKE nombre/programa/nss; dígitos en nss/tel |
| `decision` | `decision ?? pendiente` | `coalesce(ed.decision,'pendiente')` |
| `estatusOperativo` | `subestado ?? pendiente` | `coalesce(subestado,'pendiente')` |
| `resultadoReal` | igualdad | helper resultado |
| `etapaExacta` | `etapaActual = N` | `etapa_actual = N` |
| `programa` | label UI trim | `programa_ui = p_programa` |
| `fechaDesde`/`Hasta` | `createdAt` día local 00:00–23:59:59.999 | `created_at` en `[desde 00:00, hasta 23:59:59.999]` America/Monterrey |
| quick ≠ todos | excluye `ciclo=cerrado` | igual |
| quick `en_tramite` | resultado + sin corrección | igual |
| quick `correccion_*` / `rechazados_mesa` / `cancelados` | por categoría/resultado | igual |
| quick `agendar_*` / `subir_acuse` | predicados tarea | igual |

## Orden y página

| TS (cliente) | SQL |
|---|---|
| `createdAt DESC` luego slice | `ORDER BY created_at DESC, id DESC` + `LIMIT/OFFSET` |
| `PAGE_SIZE` UI hoy = 50 | RPC default **25**, máx 100; UI B1 usa **25** |

## Notificaciones (`buildDashboardNotifications(..., "asesor", {max:50})`)

Por expediente se elige el candidato de **menor prioridad** (1=más urgente). Payload summary: top 50 filas mínimas (`expediente_id`, `cliente_nombre`, `kind`, `tipo_label`, `mensaje`, `fecha`, `prioridad`, `href`).

## `programasUnicos`

Distinct labels UI de todos los expedientes del asesor (`deleted_at` null), orden alfabético.
