# ConCasa CRM — Riesgos de producción

**Fase:** P1  
**Última actualización:** 2026-06-15

---

## 1. RLS mal configurado

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Asesor ve expedientes ajenos | Crítico — PII | Tests RLS automatizados; policy review P6; deny-by-default P1 |
| Mesa externo ve internos | Crítico | Policy `origen_mesa = externo` + tests negativos |
| Storage URL filtrada sin auth | Crítico | Signed URL corta; policy bucket; no URLs públicas |
| Service role en cliente | Crítico | Nunca exponer `service_role` en Next.js client |

**Checklist P6:** matriz rol × tabla × operación documentada y testeada.

---

## 2. Pérdida de archivos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Blob solo en IndexedDB (mock) | Alto en demo | No migrar mock a prod (decisión piloto) |
| Upload sin metadata Postgres | Alto | Transacción: Storage + INSERT documento |
| Replace sin versionado | Medio | `version` + `documento_revisiones` |
| Delete accidental | Medio | Soft delete `deleted_at`; purge async |

---

## 3. Concurrencia

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Dos asesores agendan biométricos Monterrey el mismo día (14/15) | Alto (16/15) | P208: `pg_advisory_xact_lock` org+kind+fecha+sede + occupancy ≤15 en assert/claim |
| Expediente 3–8 supera 45 días sin docs frescos y avanza/agenda | Alto (trámite con docs caducos) | P211: assert + trigger; book falla antes de consumir cupo P208; release sticky ≥9 |
| Dos operadores Mesa avanzan etapa | Medio | Optimistic lock `updated_at` / `version` en RPC |
| Dos operadores realizan movimiento manual | Alto | `SELECT FOR UPDATE` + `p_etapa_esperada`; conflicto estable sin evento parcial |
| Operador escribe «RECHAZO» en motivo de movimiento manual | Alto (falso rechazo operativo) | P093 B1: copy + advertencia UI + atajo a rechazo canónico; no inferir rechazo por texto; RPC de movimiento sin efectos de rechazo |
| Editar/subir/validar docs sin reactivar rechazo operativo | Alto (Mesa bloqueada; UX «ya corregimos») | P204-C: banner persistente + CTA único `reactivar_expediente_rechazado`; no auto-reactivar; `mesa_mover` sigue exigiendo subestado elegible |
| Panel de avance Mesa desaparece con `subestado=rechazado` | Alto (operador no puede continuar aunque gates PASS) | P204-D: paneles visibles; avance/manual reactivan atómicamente |
| Confundir rechazo operativo con cancelación de trámite / cita cancelada | Alto | P094: señales disjuntas (`subestado=rechazado` vs `ciclo=cancelado`); chip agrupado con subvistas; no inferir por texto |
| Rechazo operativo (`activo`+`rechazado`) sigue en chip Disponibles | Alto (Mesa toma/trabaja un expediente ya rechazado) | P195 + P199: rechazo **sin** episodio pending sigue fuera; P198 pending puede entrar porque Mesa ya tiene respuesta |
| Corrección reenviada no aparece en Disponibles | Alto | P207: `CORRECTION_PENDING_REVIEW` siempre entra (assignment no oculta) |
| Disponibles llena de etapas 3–12 / actualizaciones espontáneas | Alto (cola ruidosa) | P207: solo Nuevos 1–2 o PENDING; ADVISOR_UPDATE fuera |
| Trabajo accionable asignado desaparece de Disponibles | Medio | P207: assignment no filtra; badge «Trabajando por…» |
| Contar cancelado/rechazado_mesa en chips de tarea asesor (Agendar biométricos/firma, Subir acuse) | Medio (operación falsa) | P191: `asesor_inbox_es_accionable` vía `resultado_real`; lista=summary |
| Ocultar correcciones P130 ya enviadas (docs `cliente_*` en `subido`, no `resubido`) | Alto (Mesa no revisa; asesor no ve «Corrección enviada») | Hotfix 192: predicado lote `pendiente_revision`+`submitted_at`; no usar etapa ni heurística documental como gate |
| Mezclar corrección solicitada por Mesa con actualización espontánea del asesor | Medio (prioridad operativa invertida) | P196: una solicitud Mesa solo clasifica el **primer** lote P130 posterior; lotes siguientes = ADVISOR_UPDATE salvo nueva solicitud. P192/Disponibles intactos |
| Detalle asesor muestra rechazo histórico como tarea | Alto (asesor reenvía o se confunde) | P197-B3 + P201: banner/chip = `estado_efectivo` (P198); `subestado=rechazado` no gobierna si el episodio ya respondió |
| Chip Necesita por categoria documental stale | Alto (asesor cree que debe corregir algo ya enviado) | P201+P202: sin OR categoria; P202 badges gobernados por estado_efectivo |
| Counts Mesa async race / 0 falso en chips | Medio (UX confunde vacío con cero) | P203: countsQueryKey+gen; chips «…»; no inventar desde 25 tarjetas |
| Counts Mesa ~3s por re-ejecutar list+counts | Alto (UI estable tarda; chips «…») | P205-B1: `mesa_bandeja_counts_fast` sin pipeline list; paridad exacta |
| WAITING por lote/solicitud pre-ciclo o ya cerrada | Alto (asesor en Necesita sin tarea real) | P202: ciclo + solicitud vigente; `solicitud_posterior` filtrada |
| Cola Correcciones con lotes raw pendientes ya trabajados o re-rechazados | Alto (trabajo fantasma; badge Nuevo en Mesa) | P198: `mesa_cambio_revision_estado_efectivo`; 0 UPDATE de lotes |
| Tarjeta genérica «sin detalle» cuando existe evidencia canónica | Medio (Mesa no sabe qué revisar) | P194: `preview_changes` + recover read-time lotes vacíos; no inventar campos (`PARTIAL`/`NO_DIFF`); bandeja sin valores sensibles |
| Reagenda CRM OK pero Drive no muestra la cita nueva | Alto (asesor no ve la cita en Sheet; UI mentía “correctamente”) | P200: worker no marca `dead` por E/F en reagenda (histórico REAGENDADO + create destino); UI PENDING/SYNCED/FAILED; cron 130 intacto |
| Reagenda borra la fila anterior en Sheet | Alto (se pierde histórico) | Contrato P121/P200: OLD = REAGENDADO + UUID viejo; NEW = fila destino |
| Doble booking mismo slot | Medio | UNIQUE parcial agenda + transacción |
| Doble envío mesa | Bajo | Idempotency key + estado `submitted_to_mesa` |

---

## 4. Roles y legacy

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| `revisor` vs `editor` divergente | Medio | **P2B.1:** mock normaliza `revisor`→`editor`; `/revisor/*` redirect; sin rol en Supabase |
| `mock_role` en producción | Crítico | Eliminar en P4 prod; solo Supabase JWT |
| Mesa usa `useSessionRepo` colapsado | Medio | Perfil real con `tipo_mesa` |

---

## 5. Migración mock

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Importar LS/IndexedDB a prod | Alto | **Piloto limpio** — no migrar |
| Doble fuente precal (memoria vs LS) | Medio en mock | Unificar antes P2; no aplica prod |
| Feature flag mal configurado | Alto | Default `mock`; prod env explícito |

---

## 6. Auditoría

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Mutación sin `action_log` | Alto compliance | Trigger/RPC obligatorio P6 |
| `audit_events` mutable | Alto | REVOKE UPDATE/DELETE |
| Cliente falsifica actor | Crítico | Actor = `auth.uid()` server-side |
| Movimiento manual borra evidencia | Crítico | RPC acotada a etapa/subestado/updated_at + suite de preservación y tabla append-only |

---

## 7. Rutas legacy

| Ruta | Riesgo | Acción |
|------|--------|--------|
| `/revisor/*` | Confusión rol | Redirect → `/editor`; documentar deprecación |
| `/admin/[id]` | Duplicidad | Evaluar consolidación P7 |
| Login mock selector rol | Bypass auth | Solo dev; deshabilitar en prod |

---

## 8. Rollback

| Escenario | Acción |
|-----------|--------|
| P3 flag supabase roto | `DATA_MODE=mock` instant rollback UI |
| Migración SQL errónea | Restaurar snapshot DB pre-migración |
| P9 cutover fallido | Mantener branch mock; DNS/env revert |

**Requisito P8:** backup automático Postgres + Storage antes piloto.

---

## 8b. Citas Mesa fecha/Excel vs P089 (P095)

| Riesgo | Mitigación |
|--------|------------|
| Desfase ±1 día por UTC / TZ navegador | “Hoy” y navegación con `America/Monterrey` (`zonedYmdParts`); nunca `toISOString` para YMD. |
| Export incompleto / mezclado con P089 | Export = día + filtros sobre memoria; **no** checkboxes; **no** límite 100 de bulk. |
| Romper P089 (selección/Drive/avance) | No tocar `mesa-bulk-actions*`; al cambiar fecha limpiar selección; botón export RO. |
| NSS como número / `NNS` | Columna `NSS` texto sanitizado; nunca `NNS`. |
| Subida accidental a Storage | Descarga local solamente; sin RPC/Storage. |
| Estilos Excel vs `xlsx` | Residual: best-effort; extra dep solo si el bloque UI lo exige; sin macros. |
| Ampliar a Asesor/Admin/RPC/Cloud | Fuera de P095. |

## 9. Notificación documento vs agenda (P092)

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Usar tipo documental `notificacion` (colisión con `agenda_bookings.kind`) | Alto — rompe agenda/P070 | Tipo obligatorio `cliente_notificacion`; contrato + tests; docs de separación |
| Listar Notificación en Documentos complementarios | Medio — UX duplicada | Fuera de `INTEGRATION_DOC_TIPOS_MESA_UPLOAD`; sección dedicada |
| Compartir estado React con Pagaré | Medio — reemplazos cruzados | Componentes/estado independientes; paths Storage distintos |
| Soft-delete / register falla → Storage huérfano | Medio | Cleanup best-effort del objeto nuevo (patrón Pagaré) |
| Históricos soft-delete no visibles en UI | Bajo (aceptado) | Solo vigente; sin historial de versiones en UI |
| Hacer obligatorio o gate de avance | Alto operativo | `obligatorio: false`, `esGateAvance: false`; no tocar `avanzar_etapa_operativa` |
| Ampliar MIME de acta/SAT/semanas | Medio | MIME imagen solo para tipos Pagaré/Notificación en B1 |
| Modificar agenda / P070 / monto P090 | Alto | Fuera de alcance explícito |

---

## 10. NSS y duplicados

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Duplicado activo mismo NSS | Medio operativo | UNIQUE parcial `ciclo_estado = activo` + lock post-Mesa |
| Cliente nuevo trámite bloqueado | Medio | Cerrar ciclo anterior → nuevo expediente + `expediente_anterior_id` |
| Teléfono repetido entre expedientes (P098) | Ninguno (permitido) | Sin UNIQUE en `telefono_normalizado`; identidad = `expediente_id` |

---

## 11. Origen interno/externo

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Asesor elige origen incorrecto | Alto | Origen desde perfil admin, no formulario |
| `enviarAMesa` fuerza interno (bug mock) | Medio | Corregir en P2 repo supabase |

## 11b. P189 documentos vs cobro Mejoravit

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| PDF usa `monto_aprobado` editorial en vez de Monto Mejoravit | Alto (documento INFONAVIT incorrecto) | mappingVersion=2 FINAL: P189 usa `resolve_monto_operativo_mejoravit`; cobro intacto con el mismo resolver |
| Parser de nombre/dirección inventa apellidos o colonia | Medio | Conservador: <3 tokens → nombre completo en NOMBRE(S); colonia corta ante C.P./CP/CP5/INT/LOTE/MZ/entidad (mig **190** SQL↔TS); domicilio crudo siempre en `direccionCompleta` |
| SQL snapshot y TS preview pintan colonia distinta | Alto (históricos vs live) | mig **190**: misma función SQL canónica; 18 fixtures SQL↔TS; no overlay permanente |
| Regenerar snapshot in-place | Alto (rompe inmutabilidad/auditoría) | Snapshots UPDATE/DELETE blocked; regeneración = nueva `submission_version` (fuera de este hotfix) |
| Worker Cloud sin adapter v2 | Medio (campos extra no pintan hasta deploy Edge) | SQL snapshot trae nombres partidos, vivienda parseada, propuesta y `ciudadCierre`; deploy worker posterior |
| Guardar DOCX en Storage / segundo mapping | Alto (PII extra + PDF≠Word) | On-demand Mesa-only; mismo snapshot/versión; 0 companion; service_role solo server |
| Asesor descarga Word o PII en filename | Alto | Rol Mesa allowlist + RPC visibilidad; filenames genéricos; 403 asesor |

---

## 12. Checklist salida a piloto (P8)

- [ ] RLS tests green (asesor, mesa interno, mesa externo, editor, admin)
- [ ] Storage signed URL tests
- [ ] Flujo E2E: integración → biométricos 4→5 → retención 8→9
- [ ] `action_log` en todas las mutaciones críticas
- [ ] Sin `mock_user` en build producción
- [ ] DB seed solo org ConCasa + usuarios piloto
- [ ] Runbook rollback documentado
- [ ] Monitoreo errores RPC (Sentry/etc.)
- [ ] Backup restore probado

---

## 13. Deuda mock conocida (no llevar a prod)

1. Doble persistencia `MockPrecalificacionesRepo` (memoria) vs `precalificaciones_mock`.
2. Permisos 100% client-side.
3. Sin validación Zod en API routes.
4. Eventos DOM como bus de sync.

Ver auditoría histórica: `docs/AUDITORIA_CRM.md` (parcialmente desactualizada).
