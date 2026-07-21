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
| Dos operadores Mesa avanzan etapa | Medio | Optimistic lock `updated_at` / `version` en RPC |
| Dos operadores realizan movimiento manual | Alto | `SELECT FOR UPDATE` + `p_etapa_esperada`; conflicto estable sin evento parcial |
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
| Duplicado activo mismo NSS | Medio operativo | UNIQUE parcial `ciclo_estado = activo` |
| Cliente nuevo trámite bloqueado | Medio | Cerrar ciclo anterior → nuevo expediente + `expediente_anterior_id` |

---

## 11. Origen interno/externo

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Asesor elige origen incorrecto | Alto | Origen desde perfil admin, no formulario |
| `enviarAMesa` fuerza interno (bug mock) | Medio | Corregir en P2 repo supabase |

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
