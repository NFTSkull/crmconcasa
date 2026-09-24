# Gate fiscal SAT (P228)

**Despliegue a producción:** `docs/RUNBOOK_FISCAL_SAT_GATE.md`.

## Interruptor

- `app_settings.fiscal_sat_gate_enabled` (bool, default `false`)
- `app_settings.fiscal_sat_gate_pilot_asesores` (JSON array de **profile ids del asesor dueño**, default `[]`)

El gate **aplica** si `enabled = true` **o** si `expedientes.asesor_id` (dueño del expediente) está en la lista piloto.

No se usa el actor que hace clic ni líderes/equipo: un delegado P208 hereda el gate del **dueño**.

## Piloto — agregar / quitar

```sql
-- Agregar dueño
UPDATE public.app_settings
SET value = coalesce(value, '[]'::jsonb) || jsonb_build_array('<PROFILE_UUID_DUENO>'::text),
    updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores'
  AND NOT (value @> jsonb_build_array('<PROFILE_UUID_DUENO>'::text));

-- Quitar dueño
UPDATE public.app_settings
SET value = (
      SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      FROM jsonb_array_elements_text(value) AS t(x)
      WHERE x <> '<PROFILE_UUID_DUENO>'
    ),
    updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores';
```

## Fuera de alcance (sin gate)

- `asesor_enviar_reingreso_a_mesa`
- `reactivar_expediente_rechazado`
- `enviar_retencion_mesa`

## Rollback

`supabase/rollback/228_fiscal_sat_gate_server_write_ROLLBACK.sql` restaura `enviar_a_mesa` (mig. 20260904120000) y `asesor_registrar_validacion_identidad` (p208).
