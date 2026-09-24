# Runbook — Gate fiscal SAT (P228) a producción

**Rama / commit local:** `feat/fiscal-sat-gate-worker-capsolver`  
**Migración:** `supabase/migrations/228_fiscal_sat_gate_server_write.sql`  
**Rollback:** `supabase/rollback/228_fiscal_sat_gate_server_write_ROLLBACK.sql`  
**Prod Supabase:** `fvtqbxukqlajezyyvwzy` (solo cuando el operador autorice apply)  
**CRM:** Vercel `crmconcasa`  
**Worker:** Railway — servicio **nuevo** (no tocar `mejoravit-scraper`)

**Orden obligatorio:** Railway worker → Supabase mig 228 → env Vercel → deploy CRM → smoke gate OFF → piloto → apagar temp → (opcional) encendido global.

Si el CRM se despliega **antes** de la mig 228, la route detecta RPC ausente (`42883` / `PGRST202`) y hace **fail-open** a `enviar_a_mesa` (comportamiento actual) con warning en logs. Cualquier otro error del gate es **fail-closed**.

---

## a. Railway — servicio nuevo del worker CapSolver

### Qué hacer

1. Crear un servicio **nuevo** a partir de `integrations/sat-rfc-validator` (Dockerfile del repo).  
   **No** modificar ni redeployar `mejoravit-scraper`.
2. Variables de entorno (valores **nuevos**, no reutilizar los del temp e2e):

| Variable | Valor |
|----------|--------|
| `SAT_VALIDATOR_MODE` | `live` |
| `SAT_VALIDATOR_SECRET` | secreto largo aleatorio (mismo que pondrás en Vercel) |
| `CAPSOLVER_API_KEY` | API key **nueva** de CapSolver |
| `CAPTCHA_CASE` | `upper` |
| `CAPSOLVER_MODULE` | `common` |
| `SAT_MAX_CONCURRENCY` | `1` |
| `PORT` | el que asigne Railway (health en `/health`) |

3. Deploy y anotar la URL pública HTTPS (sin slash final), p. ej. `https://sat-rfc-validator-xxxx.up.railway.app`.

### Verificar OK

```bash
curl -sS "$SAT_VALIDATOR_URL/health"
# Esperado: {"ok":true,"mode":"live", ...}
```

### Si falla

| Síntoma | Acción |
|---------|--------|
| `/health` no responde | Revisar deploy, logs Railway, `PORT`, firewall |
| `mode` ≠ `live` | Corregir `SAT_VALIDATOR_MODE=live` y redeploy |
| CapSolver errors en logs | Validar `CAPSOLVER_API_KEY`, saldo CapSolver, `CAPSOLVER_MODULE=common` |
| No avanzar | **No** toques prod CRM ni Supabase hasta tener health live |

---

## b. Supabase producción — migración 228

### Qué hacer

1. Operador corre **solo** `228_fiscal_sat_gate_server_write.sql` en `fvtqbxukqlajezyyvwzy` (SQL editor / CLI autorizado).  
2. **No** correr el rollback salvo incidente (ver §h).

### Queries de verificación post-apply

```sql
-- Gate apagado + piloto vacío
SELECT key, value
FROM public.app_settings
WHERE key IN ('fiscal_sat_gate_enabled', 'fiscal_sat_gate_pilot_asesores');
-- Esperado:
-- fiscal_sat_gate_enabled → false
-- fiscal_sat_gate_pilot_asesores → []

-- authenticated NO ejecuta el núcleo
SELECT has_function_privilege(
  'authenticated',
  'public.enviar_a_mesa_core(uuid,uuid,app_role)',
  'EXECUTE'
) AS auth_can_core;
-- Esperado: false

-- authenticated sin escritura en settings / validaciones
SELECT
  has_table_privilege('authenticated', 'public.app_settings', 'INSERT') AS settings_ins,
  has_table_privilege('authenticated', 'public.app_settings', 'UPDATE') AS settings_upd,
  has_table_privilege('authenticated', 'public.app_settings', 'DELETE') AS settings_del,
  has_table_privilege('authenticated', 'public.cliente_validaciones_identidad', 'INSERT') AS val_ins,
  has_table_privilege('authenticated', 'public.cliente_validaciones_identidad', 'UPDATE') AS val_upd,
  has_table_privilege('authenticated', 'public.cliente_validaciones_identidad', 'DELETE') AS val_del;
-- Esperado: todo false

-- RPCs gate existen
SELECT proname FROM pg_proc
WHERE proname IN (
  'fiscal_sat_gate_applies_to_expediente',
  'fiscal_sat_gate_allows_envio',
  'server_registrar_validacion_fiscal_sat',
  'admin_aprobar_envio_mesa_sin_fiscal',
  'enviar_a_mesa_core'
)
ORDER BY 1;
```

### Si falla

| Síntoma | Acción |
|---------|--------|
| Apply a medias | **No** deploy CRM. Correr rollback §h o restaurar defs; reintentar 228 en ventana controlada |
| `auth_can_core = true` | Revisar GRANT/REVOKE de la mig; no continuar |
| settings_upd = true | `REVOKE ALL ON app_settings FROM authenticated; GRANT SELECT …` como en la mig |
| Gate enabled true por error | Apagado de emergencia §g inmediatamente |

---

## c. Vercel — env + deploy CRM

### Qué hacer

1. En el proyecto Vercel de CRM, agregar (Production):

| Variable | Valor |
|----------|--------|
| `SAT_VALIDATOR_URL` | URL del servicio Railway (§a), sin `/` final |
| `SAT_VALIDATOR_SECRET` | **el mismo** que en Railway |
| `SUPABASE_SERVICE_ROLE_KEY` | ya debe existir (server-only; nunca `NEXT_PUBLIC_*`) |

2. Deploy del CRM con el commit que incluye la route `enviar-mesa-fiscal` (después de §b preferible; si CRM llega antes, fail-open cubre ausencia de 228).

### Verificar OK

- Deploy verde en Vercel.
- Logs: sin spam de `SUPABASE_NOT_CONFIGURED` / `SAT_WORKER_NOT_CONFIGURED` en envíos con gate OFF (worker no se llama).

### Si falla

| Síntoma | Acción |
|---------|--------|
| Build fail | No promover; revert deploy Vercel |
| Worker URL mal | Corregir env y redeploy; no tocar Supabase |
| Secret mismatch | Alinear Railway ↔ Vercel; redeploy |

---

## d. Smoke con gate apagado

### Qué hacer

1. Confirmar settings (§b): `enabled=false`, piloto `[]`.
2. Con un asesor de prueba: flujo normal integración → **Enviar a Mesa**.
3. Esperado: envío **igual que hoy** (sin CapSolver, sin `REVISION_MANUAL`).

### Verificar OK

```sql
SELECT submitted_to_mesa, fecha_envio_mesa
FROM public.expedientes WHERE id = '<EXP_ID>';
-- submitted_to_mesa = true

SELECT * FROM public.action_log
WHERE entity_id = '<EXP_ID>'
  AND action ILIKE '%enviar_a_mesa%'
ORDER BY created_at DESC LIMIT 5;
```

En logs Vercel: **no** debería aparecer llamada al worker SAT (gate no aplica).

### Si falla

| Síntoma | Acción |
|---------|--------|
| Error fiscal / CTA Reintentar con gate OFF | Revisar piloto accidental; `SELECT value FROM app_settings WHERE key='fiscal_sat_gate_pilot_asesores'` |
| Warning fail-open mig ausente | La 228 no está en prod → volver a §b |
| Envío roto igual que sin este release | Rollback CRM (§h); investigar fuera del gate |

---

## e. Piloto — agregar asesor de prueba y casos

### SQL agregar profile del asesor de prueba

```sql
-- Reemplazar <PROFILE_UUID> por el id de profiles del asesor de prueba (dueño del expediente).
UPDATE public.app_settings
SET value = coalesce(value, '[]'::jsonb) || jsonb_build_array('<PROFILE_UUID>'::text),
    updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores'
  AND NOT (value @> jsonb_build_array('<PROFILE_UUID>'::text));

SELECT value FROM public.app_settings WHERE key = 'fiscal_sat_gate_pilot_asesores';
```

Piloto usa **`expedientes.asesor_id`** (dueño), no el actor delegado.

### Casos a probar

| Caso | Pasos | Esperado |
|------|--------|----------|
| Pass | Expediente listo + EDC/CURP/RFC coherentes → Enviar | Worker live → `VALIDADO` → `submitted_to_mesa=true` |
| RFC inválido | RFC que SAT marque inválido | `INVALIDO`; **no** Mesa; sin envío |
| Revisión manual | Forzar retry/captcha/timeout / worker caído | `REVISION_MANUAL` + CTA «Reintentar validación»; **no** Mesa |
| Aprobación super_admin | Con `REVISION_MANUAL` vigente: `admin_aprobar_envio_mesa_sin_fiscal(exp, motivo≥10)` como `super_admin` | `APROBADO_ADMIN` + envío; `mesa_admin` debe fallar |
| Reingreso | Expediente ya en mesa / flujo reingreso | `asesor_enviar_reingreso_a_mesa` **sin** gate fiscal (igual que hoy) |

### Verificar OK

```sql
SELECT tipo, estado, vigente, input_fingerprint IS NOT NULL AS has_fp, created_at
FROM public.cliente_validaciones_identidad
WHERE expediente_id = '<EXP_ID>' AND tipo = 'rfc_validacion_sat'
ORDER BY created_at DESC;
```

### Si falla

| Síntoma | Acción |
|---------|--------|
| Gate no aplica al piloto | Confirmar UUID = `expedientes.asesor_id`, no otro profile |
| Worker timeout → sin REVISION_MANUAL | Revisar service role + RPC `server_registrar…`; no forzar Mesa |
| super_admin no aprueba | Rol real en `profiles.app_role`; motivo ≥ 10 |

### Quitar del piloto

```sql
UPDATE public.app_settings
SET value = (
      SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      FROM jsonb_array_elements_text(value) AS t(x)
      WHERE x <> '<PROFILE_UUID>'
    ),
    updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores';
```

---

## f. Apagar / eliminar servicio temporal e2e

### Qué hacer

1. En Railway: pausar o **eliminar** `sat-rfc-validator-real-e2e-temp-production`.
2. Confirmar que el CRM apunta solo al servicio **nuevo** (§a), no al temp.

### Verificar OK

- Temp: sin tráfico / removed.
- `curl $SAT_VALIDATOR_URL/health` del servicio nuevo sigue `mode=live`.

### Si falla

Si el CRM aún tiene la URL del temp: actualizar Vercel `SAT_VALIDATOR_URL` y redeploy.

---

## g. Encendido global y apagado de emergencia

### Encendido global (solo tras piloto OK)

```sql
UPDATE public.app_settings
SET value = 'true'::jsonb, updated_at = now()
WHERE key = 'fiscal_sat_gate_enabled';

SELECT value FROM public.app_settings WHERE key = 'fiscal_sat_gate_enabled';
-- Esperado: true
```

Smoke rápido: un expediente de asesor **no** piloto tampoco debe enviar sin VALIDADO/APROBADO_ADMIN.

### Apagado de emergencia

```sql
UPDATE public.app_settings
SET value = 'false'::jsonb, updated_at = now()
WHERE key = 'fiscal_sat_gate_enabled';

UPDATE public.app_settings
SET value = '[]'::jsonb, updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores';
```

Verificar: `enabled=false`, piloto `[]`, un envío normal a Mesa vuelve a comportarse como pre-gate.

---

## h. Rollback completo (orden inverso)

Ejecutar solo lo necesario según qué se haya desplegado.

### 1) Apagar gate (inmediato, sin rollback SQL)

Ver §g apagado de emergencia.  
**Verificar:** envíos sin worker.

### 2) Revertir deploy CRM (Vercel)

- Rollback al deployment anterior (sin route fiscal / sin dependencia del worker).  
- O quitar `SAT_VALIDATOR_*` si se deja código fail-open.  
**Verificar:** UI envía a Mesa; sin errores nuevos.

### 3) Rollback SQL mig 228 (Supabase)

Correr `supabase/rollback/228_fiscal_sat_gate_server_write_ROLLBACK.sql` en prod **solo con autorización**.

Restaura:

- `enviar_a_mesa` → cuerpo canónico `20260904120000`
- `asesor_registrar_validacion_identidad` → cuerpo p208
- DROP helpers gate / core / server_registrar / admin_aprobar
- Grants como en prod pre-228

**Verificar:**

```sql
SELECT pg_get_functiondef('public.enviar_a_mesa(uuid)'::regprocedure)
  NOT ILIKE '%fiscal_sat_gate%' AS enviar_sin_gate;

SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'enviar_a_mesa_core'
) AS still_has_core;
-- Esperado: enviar_sin_gate true, still_has_core false
```

### 4) Railway worker

- Pausar/eliminar el servicio nuevo del worker.  
- Temp e2e ya debió eliminarse en §f.  
**Verificar:** no quedan URLs worker en Vercel apuntando a servicios muertos (o fall-open/cerrado según diseño del código desplegado).

### Si el rollback SQL falla

No improvisar. Restaurar defs desde backup / snapshot; abrir incidente. **No** dejar `enviar_a_mesa_core` a medias con GRANT a `authenticated`.

---

## Referencias

- Producto / API: `docs/FISCAL_SAT_GATE.md`, `docs/API_CONTRATOS.md` §5  
- Tests SQL: `supabase/tests/rpc_fiscal_sat_gate_p228.sql` (nunca en prod)  
- Worker: `integrations/sat-rfc-validator/README.md`
