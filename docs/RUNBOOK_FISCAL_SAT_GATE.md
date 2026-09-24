# Runbook — Gate fiscal SAT (P228) a producción

**Rama / commit local:** `feat/fiscal-sat-gate-worker-capsolver`  
**Migración:** `supabase/migrations/228_fiscal_sat_gate_server_write.sql` (transacción `BEGIN`…`COMMIT`: completa o nada)  
**Rollback:** `supabase/rollback/228_fiscal_sat_gate_server_write_ROLLBACK.sql` (idem, transaccional)  
**Prod Supabase:** `fvtqbxukqlajezyyvwzy` (solo cuando el operador autorice apply)  
**CRM:** Vercel `crmconcasa`  
**Worker:** Railway — proyecto `fulfilling-bravery`, servicio **nuevo** (no tocar `mejoravit-scraper`)

**Orden obligatorio:** push de la **rama** (no `main`) → Railway worker → respaldo defs + mig 228 (manual) → merge a `main` + env Vercel + deploy CRM → smoke con envíos reales → piloto → worker a `main` → apagar temp → (opcional) encendido global → borrar rama remota.

Si el CRM se despliega **antes** de la mig 228, la route detecta RPC ausente (`42883` / `PGRST202`) y hace **fail-open** a `enviar_a_mesa` (comportamiento actual) con warning en logs. Cualquier otro error del gate es **fail-closed**.

---

## Estrategia de git / push

| Paso | Qué | A dónde |
|------|-----|---------|
| 1 | Subir `feat/fiscal-sat-gate-worker-capsolver` | Remote como **rama** (no merge a `main`) |
| 2 | Railway despliega el worker desde esa rama | Root: `integrations/sat-rfc-validator` |
| 3 | Operador aplica mig **228** en prod (manual) | SQL en transacción |
| 4 | Merge de la rama a `main` + deploy Vercel | **Solo después** de la 228 verificada |
| 5 | Railway: cambiar branch del worker a `main` | Re-verificar `/health` |
| 6 | Cuando todo estable: borrar rama remota | `feat/fiscal-sat-gate-worker-capsolver` |

**Integración Supabase ↔ GitHub (lectura Management API + repo, 2026-09-24):** no hay evidencia de auto-apply de migraciones a **producción** al hacer push/merge. El historial de migraciones Cloud se aplica con autorización explícita (`docs/DEPLOY_TARGETS.md`). No hay workflow de GitHub Actions que haga `db push` a prod. Los preview branches de Supabase son independientes; **no** sustituyen el apply manual de la 228 en `fvtqbxukqlajezyyvwzy`.

- **Push de la rama:** no aplica la 228 en prod. Puede generar **Vercel Preview** (ver nota abajo).
- **Merge a `main`:** despliega el CRM en Vercel; **no** corre sola la 228 en prod. La mig sigue siendo paso §b (operador).

### Nota — Vercel Preview al push de la rama

El push de `feat/fiscal-sat-gate-worker-capsolver` suele crear un **preview deployment** de Vercel. Ese preview **apunta a la base de producción** (mismas `NEXT_PUBLIC_SUPABASE_*`). **No compartir esa URL** ni usarla para pruebas: cualquier acción real pega en prod. Usar solo el deploy de Production tras el merge (§c), o entornos explícitamente aislados.

No mergear a `main` antes de que la 228 esté aplicada y verificada en producción.

---

## a. Railway — servicio nuevo del worker CapSolver

### Qué hacer

1. **Push** de `feat/fiscal-sat-gate-worker-capsolver` al remote (rama, no `main`) para que Railway pueda construir. Recordar la nota de Vercel Preview arriba.
2. En Railway (proyecto `fulfilling-bravery`): crear un servicio **nuevo** conectado a ese repo/rama.  
   **No** modificar, redeployar ni cambiar variables de `mejoravit-scraper`.
3. Configuración del servicio:

| Setting | Valor |
|---------|--------|
| **Root Directory** | `integrations/sat-rfc-validator` |
| **Builder** | Dockerfile (archivo `integrations/sat-rfc-validator/Dockerfile`) |
| Branch | `feat/fiscal-sat-gate-worker-capsolver` (hasta §c.5) |

**Chromium / Playwright:** el `Dockerfile` usa la imagen oficial  
`FROM mcr.microsoft.com/playwright:v1.55.0-noble`, que **ya incluye Chromium** y dependencias del sistema. No hace falta nixpacks ni `npx playwright install` en el deploy de Railway si se construye con ese Dockerfile.

4. Variables de entorno:

| Variable | Valor |
|----------|--------|
| `SAT_VALIDATOR_MODE` | `live` |
| `SAT_VALIDATOR_SECRET` | secreto largo aleatorio **nuevo** (mismo que pondrás en Vercel) |
| `CAPSOLVER_API_KEY` | **La misma** que tiene hoy `mejoravit-scraper` en Railway. Copiar el valor desde ese servicio; **no** crear key nueva; **no** editar el servicio `mejoravit-scraper`. |
| `CAPTCHA_CASE` | `upper` |
| `CAPSOLVER_MODULE` | `common` |
| `SAT_MAX_CONCURRENCY` | `1` |
| `PORT` | el que asigne Railway (health en `/health`) |

5. Deploy y anotar la URL pública HTTPS (sin slash final), p. ej. `https://sat-rfc-validator-xxxx.up.railway.app`.

### Verificar OK

```bash
curl -sS "$SAT_VALIDATOR_URL/health"
# Esperado: {"ok":true,"mode":"live", ...}
```

**Saldo CapSolver (obligatorio):** ambos servicios (`mejoravit-scraper` y este worker) comparten la misma API key y el **mismo saldo**. En el dashboard de CapSolver, activar una **alerta de saldo bajo** (threshold conservador) para no quedarse sin OCR a mitad de operación.

### Si falla

| Síntoma | Acción |
|---------|--------|
| `/health` no responde | Revisar Root Directory = `integrations/sat-rfc-validator`, Dockerfile, logs Railway, `PORT` |
| Build sin Chromium / Playwright crash | Confirmar que el builder usa el `Dockerfile` (imagen `playwright:v1.55.0-noble`), no un builder genérico sin browsers |
| `mode` ≠ `live` | Corregir `SAT_VALIDATOR_MODE=live` y redeploy |
| CapSolver auth errors | Verificar que se **copió** la key de `mejoravit-scraper` (sin tipografiar mal); no regenerar key en CapSolver |
| Saldo agotado | Recargar CapSolver; ambos servicios se recuperan con el mismo saldo |
| No avanzar | **No** toques prod CRM ni Supabase hasta tener health live |

---

## b. Supabase producción — migración 228

La migración y el rollback van en **una sola transacción** (`BEGIN` … `COMMIT`). Si cualquier sentencia falla, no queda estado a medias: **se aplica completa o no se aplica**.

### Antes de apply — respaldo local de defs

En SQL editor (solo lectura) o `psql` de prod, guardar en el laptop (no en el repo):

```bash
# Ejemplo local (fecha ISO); NO committear estos archivos
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
# Pegar salida de:
```

```sql
-- Guardar resultado en: backups/prod-enviar_a_mesa-$STAMP.sql
SELECT pg_get_functiondef('public.enviar_a_mesa(uuid)'::regprocedure);

-- Guardar resultado en: backups/prod-asesor_registrar_validacion_identidad-$STAMP.sql
SELECT pg_get_functiondef(
  'public.asesor_registrar_validacion_identidad(uuid,text,text,text,jsonb,uuid,integer,text,text)'::regprocedure
);
```

Conservar también a mano el archivo `supabase/rollback/228_fiscal_sat_gate_server_write_ROLLBACK.sql` de la misma versión del commit desplegado.

### Qué hacer

1. Operador corre **todo** el archivo `228_fiscal_sat_gate_server_write.sql` en `fvtqbxukqlajezyyvwzy` (incluye `BEGIN`/`COMMIT`).  
2. **No** correr el rollback salvo incidente (ver §h).  
3. Solo después de verificación OK → autorizar merge a `main` y deploy Vercel (§c).

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
| Error a mitad (rollback automático de la TX) | Estado pre-228 intacto. Corregir script; reintentar el archivo completo. No merge/deploy CRM |
| `auth_can_core = true` | Revisar GRANT/REVOKE; no continuar |
| settings_upd = true | `REVOKE ALL ON app_settings FROM authenticated; GRANT SELECT …` |
| Gate enabled true por error | Apagado de emergencia §g inmediatamente |
| Necesitas restaurar defs | Usar archivos de respaldo `$STAMP` y/o el ROLLBACK transaccional §h |

---

## c. Vercel — merge a main + env + deploy CRM

### Qué hacer

1. **Solo si §b está OK:** merge de `feat/fiscal-sat-gate-worker-capsolver` → `main` (PR o merge autorizado).
2. En el proyecto Vercel de CRM, agregar (Production):

| Variable | Valor |
|----------|--------|
| `SAT_VALIDATOR_URL` | URL del servicio Railway (§a), sin `/` final |
| `SAT_VALIDATOR_SECRET` | **el mismo** que en Railway (no la CapSolver key) |
| `SUPABASE_SERVICE_ROLE_KEY` | ya debe existir (server-only; nunca `NEXT_PUBLIC_*`) |

3. Deploy del CRM desde `main` (incluye route `enviar-mesa-fiscal`). Preferible **después** de la 228; si por error el CRM llegara antes, el fail-open cubre RPC ausente.

### c.5 Railway — apuntar worker a `main`

Después del merge:

1. En el servicio nuevo del worker: cambiar **Branch** de `feat/fiscal-sat-gate-worker-capsolver` → `main`.
2. Redeploy (si Railway no lo hace solo).
3. Verificar de nuevo:

```bash
curl -sS "$SAT_VALIDATOR_URL/health"
# Esperado: {"ok":true,"mode":"live", ...}
```

### Verificar OK (Vercel)

- Deploy verde en Vercel Production.
- Logs: sin spam de `SUPABASE_NOT_CONFIGURED` / `SAT_WORKER_NOT_CONFIGURED` en envíos con gate OFF (worker no se llama).

### Si falla

| Síntoma | Acción |
|---------|--------|
| Build fail | No promover; revert deploy Vercel |
| Worker URL mal | Corregir env y redeploy; no tocar Supabase |
| Secret mismatch | Alinear Railway ↔ Vercel `SAT_VALIDATOR_SECRET`; redeploy |
| `/health` falla tras cambiar a `main` | Revisar que `main` contiene `integrations/sat-rfc-validator`; revert branch del servicio a la feat si hace falta |

---

## d. Smoke con gate OFF — envíos reales (no expediente de prueba)

**No** fabricar un envío de prueba a Mesa: un `enviar_a_mesa` exitoso marca `submitted_to_mesa`, entra a la bandeja de Mesa, y si el expediente es `programa=mejoravit` y el feature P189 está ON, encola snapshot + 3 PDFs Infonavit **internos** (outbox CRM para Mesa; no es un portal/API externo de Infonavit, pero sí trabajo real de Mesa).

### Qué hacer

1. Confirmar settings (§b): `enabled=false`, piloto `[]`.
2. Tras el deploy Production: observar los **primeros envíos reales** de asesores (operación normal).
3. Query de control (última hora):

```sql
SELECT created_at, actor_id, entity_id, action, payload
FROM public.action_log
WHERE action ILIKE '%enviar_a_mesa%'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC
LIMIT 50;
```

4. Revisar logs de Vercel Production: sin errores nuevos del gate/worker; sin ráfagas de `FISCAL_*` / `SAT_WORKER_*` cuando el gate no aplica.

### Verificar OK

- Aparecen `expediente.enviar_a_mesa` (o acción equivalente) de asesores reales.
- Expedientes correspondientes con `submitted_to_mesa = true`.
- Logs Vercel limpios respecto al gate con flag OFF.

### Si falla

| Síntoma | Acción |
|---------|--------|
| Errores fiscales / CTA con gate OFF | Revisar piloto accidental; `SELECT value FROM app_settings WHERE key='fiscal_sat_gate_pilot_asesores'` |
| Warning fail-open mig ausente | La 228 no está en prod → §b |
| Caída general de envíos | Rollback CRM (§h); no “arreglar” con expedientes de prueba a Mesa |

---

## e. Piloto — asesor real de confianza

El operador elige el **profile id** de un asesor real de confianza. Piloto = `expedientes.asesor_id` (dueño).

### SQL agregar al piloto

```sql
-- Reemplazar <PROFILE_UUID> por el profile id del asesor real elegido.
UPDATE public.app_settings
SET value = coalesce(value, '[]'::jsonb) || jsonb_build_array('<PROFILE_UUID>'::text),
    updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores'
  AND NOT (value @> jsonb_build_array('<PROFILE_UUID>'::text));

SELECT value FROM public.app_settings WHERE key = 'fiscal_sat_gate_pilot_asesores';
```

### Casos

| Caso | Cómo | Notas |
|------|------|--------|
| **Pass** | Validar con **envíos reales** del asesor piloto (sus expedientes listos) | Llegan a Mesa si VALIDADO; es operación real |
| **RFC inválido** | Expediente de **prueba** (nunca debe llegar a Mesa) | Esperado: `INVALIDO`; `submitted_to_mesa=false` |
| **Revisión manual** | Expediente de **prueba** (timeout/captcha/worker) | Esperado: `REVISION_MANUAL` + CTA; **no** Mesa |
| **Aprobación super_admin** | Solo sobre un expediente **real** que haya quedado en `REVISION_MANUAL` de verdad | `admin_aprobar_envio_mesa_sin_fiscal` como `super_admin`; **nunca** aprobar un expediente de prueba “inventado” |
| **Reingreso** | Flujo reingreso real/piloto | Sin gate fiscal (igual que hoy) |

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
| Gate no aplica | UUID = `expedientes.asesor_id` del dueño |
| Worker timeout sin `REVISION_MANUAL` | Service role + `server_registrar…`; no forzar Mesa |
| Tentación de “probar pass” con dummy a Mesa | No: contaminaría bandeja Mesa / outbox P189 |

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
2. Confirmar que el CRM apunta solo al servicio **nuevo** (§a / §c.5), no al temp.

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

Smoke: un expediente de asesor **fuera** del piloto tampoco envía sin VALIDADO/APROBADO_ADMIN.

### Apagado de emergencia

```sql
UPDATE public.app_settings
SET value = 'false'::jsonb, updated_at = now()
WHERE key = 'fiscal_sat_gate_enabled';

UPDATE public.app_settings
SET value = '[]'::jsonb, updated_at = now()
WHERE key = 'fiscal_sat_gate_pilot_asesores';
```

Verificar: `enabled=false`, piloto `[]`, envíos reales vuelven a comportarse como pre-gate.

---

## h. Rollback completo (orden inverso)

Ejecutar solo lo necesario según qué se haya desplegado.

### 1) Apagar gate (inmediato, sin rollback SQL)

Ver §g apagado de emergencia.  
**Verificar:** envíos sin worker.

### 2) Revertir deploy CRM (Vercel)

- Rollback al deployment anterior en `main`.  
**Verificar:** UI envía a Mesa; sin errores nuevos.

### 3) Rollback SQL mig 228 (Supabase)

Correr **todo** `228_…_ROLLBACK.sql` (transacción `BEGIN`/`COMMIT`) **solo con autorización**.

Restaura:

- `enviar_a_mesa` → cuerpo canónico `20260904120000`
- `asesor_registrar_validacion_identidad` → cuerpo p208
- DROP helpers gate / core / server_registrar / admin_aprobar
- Grants como en prod pre-228

Contrastar con los archivos de respaldo `$STAMP` del §b si hace falta.

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
- **No** tocar `mejoravit-scraper` ni rotar la CapSolver key compartida solo por este rollback.  

### 5) Borrar rama remota (cuando todo estable o tras abortar el rollout)

```bash
# Tras confirmar Production estable (o tras rollback completo):
git push <remote> --delete feat/fiscal-sat-gate-worker-capsolver
```

También se puede cerrar/archivar el PR. No borrar la rama local de respaldo hasta que el operador lo indique.

### Si el rollback SQL falla

No improvisar. Restaurar defs desde los archivos `$STAMP` del §b; abrir incidente. **No** dejar `enviar_a_mesa_core` a medias con GRANT a `authenticated`.

---

## Referencias

- Producto / API: `docs/FISCAL_SAT_GATE.md`, `docs/API_CONTRATOS.md` §5  
- Tests SQL: `supabase/tests/rpc_fiscal_sat_gate_p228.sql` (nunca en prod)  
- Worker: `integrations/sat-rfc-validator/README.md`  
- Dockerfile Chromium: `integrations/sat-rfc-validator/Dockerfile` → `mcr.microsoft.com/playwright:v1.55.0-noble`  
- Deploy: `docs/DEPLOY_TARGETS.md` (migraciones solo con autorización explícita)
