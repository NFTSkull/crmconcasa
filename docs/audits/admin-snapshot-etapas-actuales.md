# Auditoría — Snapshot etapas Admin (feat/admin-snapshot-etapas-actuales)

Fecha: 2026-08-03

## Fuente actual

1. **UI:** `src/app/admin/page.tsx` — sección «Estado actual de los expedientes enviados a Mesa»; cards desde `byEtapa`.
2. **Carga:** `load()` → `repo.getMesaCohortByEtapa(filtersBase)` junto con summary/listados; `filtersBase` incluye `bounds` del periodo.
3. **RPC:** `admin_get_mesa_cohort_by_etapa(p_from, p_to_exclusive, p_asesor_id, p_estado)` (mig. 091).
4. **Drilldown:** `admin_list_mesa_envios_page` + filtro UI `etapaActual` (paso visual → internas).

## Fecha que restringe

`expedientes.fecha_envio_mesa` en `[p_from, p_to_exclusive)` **y** `submitted_to_mesa = TRUE`.

## Por qué suman solo los enviados del periodo

El cohort SQL exige envío a Mesa dentro del rango del preset (Hoy/semana/mes/personalizado). Las tarjetas clasifican ese subset por `etapa_actual`, no el stock global.

## Universo nuevo (post-cambio + hotfix 148)

- Expedientes con `deleted_at IS NULL`.
- Sin filtro de **periodo** (Hoy/semana/mes).
- **Integración (1):** exige `submitted_to_mesa = TRUE` AND `fecha_envio_mesa IS NOT NULL` (igual KPI sin rango). Pre-Mesa fuera de total/tarjetas/drilldown.
- Etapas ≥2: sin filtro adicional de envío.
- Filtros opcionales: asesor, estado, búsqueda.
- RPCs: `admin_expedientes_snapshot_etapas` + `admin_list_expedientes_snapshot_page` (mig. 147; filtro Integración mig. 148).
- Dedup: identidad `expedientes.id`; reingreso manual = mismo id; sin exclusión inventada padre/hijo.
- Mapeo etapas 1–12 interno; legacy 4 absorbida en paso visual 3.
