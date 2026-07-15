# ConCasa CRM — Arquitectura de producción

**Fase:** P1 (schema + docs, sin conectar UI)  
**Última actualización:** 2026-06-15

---

## 1. Visión general

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Next.js    │────▶│  Repos (capa     │────▶│  Supabase           │
│  App Router │     │  dominio)        │     │  Auth / Postgres /  │
│  (UI)       │     │  mock | supabase │     │  Storage            │
└─────────────┘     └──────────────────┘     └─────────────────────┘
                              │
                    NEXT_PUBLIC_DATA_MODE
                    mock (default) | supabase
```

La UI **no** debe importar Supabase directamente. Consume interfaces en `src/domain/*/repo.ts` y factories (P3).

---

## 2. Mock actual vs producción

| Capa | Mock | Producción |
|------|------|------------|
| **Sesión** | `MockSessionRepo`, `mock_user` | `SupabaseSessionRepo` → Auth session |
| **Expedientes** | `MockExpedientesRepo`, 3 keys LS | `SupabaseExpedientesRepo` → `expedientes` + joins |
| **Decisiones editor** | `decisions_mock` | `editor_decisions` |
| **Cliente datos** | `expediente_cliente_datos` LS | `cliente_datos` |
| **Archivos metadata** | IndexedDB `concasa-crm-files` | `expediente_documentos` |
| **Archivos binarios** | Blob en IndexedDB | Bucket `expediente-documentos` |
| **Retención** | LS keys `expediente_retencion_*` | `retencion_opciones`, `retencion_envios` |
| **Agenda** | LS `agenda_*_v1` | `agenda_config`, `agenda_bookings` |
| **Sync UI** | `CustomEvent` + `storage` | Realtime / refetch post-mutation |
| **Permisos Mesa** | `mesaControlAccess.ts` | RLS + `profiles.tipo_mesa` |

**Inventario mock:** ver `src/lib/dev/clearMockData.ts` → `MOCK_LOCAL_STORAGE_KEYS`, `MOCK_INDEXEDDB_NAMES`.

---

## 3. Feature flag (P3)

```env
NEXT_PUBLIC_DATA_MODE=mock   # default — demo/piloto local
NEXT_PUBLIC_DATA_MODE=supabase
```

Factory ejemplo (futuro):

```typescript
// src/domain/expedientes/getExpedientesRepo.ts
export function getExpedientesRepo(): ExpedientesRepo {
  return process.env.NEXT_PUBLIC_DATA_MODE === "supabase"
    ? new SupabaseExpedientesRepo()
    : new MockExpedientesRepo();
}
```

**Regla:** mock permanece como demo comercial y suite CI; producción usa `supabase`.

---

## 4. Supabase Auth

- Usuarios en `auth.users`; perfil extendido en `public.profiles`.
- Claim / columna `app_role` en `profiles` (no confiar en rol enviado por cliente).
- Login mock (`/login`) se reemplaza en **P4**; rutas legacy `/revisor/*` redirigen a `/editor` (P2B.1).
- Mesa interno/externo: `profiles.tipo_mesa` + RLS filtra `expedientes.origen_mesa`.

---

## 5. Postgres (schema P1)

Migración inicial: `supabase/migrations/001_core_schema.sql`

- **Single org** arranque: seed `organizations` con ConCasa.
- **`organization_id`** en tablas operativas desde P1 (multi-sucursal futuro).
- **RLS enabled, deny-by-default** (sin policies en P1; policies en P2/P6).
- Triggers `updated_at` en tablas mutables.

---

## 6. Supabase Storage (P5)

| Bucket | Uso |
|--------|-----|
| `expediente-documentos` | PDF/imagenes; path `{org_id}/{expediente_id}/{tipo}/v{version}/{uuid}` |

- Metadata en `expediente_documentos.storage_path`.
- Descarga vía **signed URL** (TTL corto).
- RLS Storage alineada a policies de expediente (P6).

---

## 7. RLS (fases)

| Fase | Alcance |
|------|---------|
| P1 | RLS ON, **sin policies** (deny all vía API anon) |
| P2 | Policies lectura asesor (propio), editor (all read) |
| P6 | Mesa interno/externo, documentos, mutations vía RPC |
| P8 | Revisión security + tests RLS automatizados |

**Mesa externo:** SELECT solo `origen_mesa = 'externo'` AND asignación visible; **nunca** internos.

---

## 8. Auditoría

| Tabla | Uso |
|-------|-----|
| `action_log` | Mutaciones de negocio (patch JSON, actor, entidad). Escritura vía trigger/RPC. |
| `audit_events` | Eventos compliance (inmutable). |
| `documento_revisiones` | Historial estatus documental. |

Mock hoy: sin persistencia; producción: **obligatorio** en cada RPC de mutación (P6).

### 8.1 Movimiento manual de Mesa

- `expediente_movimientos_mesa` conserva el evento append-only sin PII y se lee por RLS con `can_see_expediente`.
- `mesa_mover_etapa_operativa` usa `SECURITY DEFINER`, `search_path=''`, referencias calificadas, lock de fila y etapa esperada.
- La RPC no reutiliza funciones de transición normal: la separación evita que la excepción Mesa relaje gates globales.
- Las RPC `mesa_*_firmas` reutilizan únicamente la validación canónica de disponibilidad/cupo; no cambian etapa y no amplían las RPC compartidas del asesor.

---

## 9. Estrategia de migración P1–P9

| Fase | Entregable | Mock intacto |
|------|------------|--------------|
| **P1** | Docs + `001_core_schema.sql` | ✅ |
| **P2** | Repos Supabase paralelos + interfaces formales | ✅ |
| **P3** | `DATA_MODE` factory | ✅ |
| **P4** | Auth real; deprecar `mock_user` en prod | mock en dev |
| **P5** | Storage upload/download | ✅ |
| **P6** | Mesa 100% supabase + RLS + action_log | ✅ |
| **P7** | Admin KPIs SQL / vistas | ✅ |
| **P8** | Piloto usuarios reales (DB limpia) | demo mock |
| **P9** | Cutover producción; runbook rollback | branch demo |

**Rama recomendada:** `production-backend` (schema + repos + docs). `main` conserva mock estable hasta merge P3+.

---

## 10. Organización y origen

- `organizations`: tenant ConCasa (único seed inicial).
- `profiles.tipo_asesor_origen`: `interno` | `externo` — copiado a `expedientes.origen_mesa` en CREATE.
- Admin asigna origen; asesor **no** elige en formulario de alta.

---

## 11. Relación entre expedientes

```sql
expedientes.expediente_anterior_id → expedientes.id  -- nuevo trámite mismo cliente
expedientes.ciclo_estado           -- activo | cerrado | cancelado
```

Cierre: etapa 12 + regla de negocio o acción admin → `ciclo_estado = cerrado`.

---

## 12. Qué NO hacer en P1

- Conectar UI a Supabase.
- Aplicar migración a proyecto remoto.
- Eliminar mock / cambiar rutas.
- Implementar policies RLS completas sin tests.
