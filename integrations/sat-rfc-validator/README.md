# SAT RFC validator

Worker aislado para la validación fiscal pre-Mesa.

## Seguridad de rollout

- `SAT_VALIDATOR_MODE=fixture` es el default y **no navega al SAT ni usa CapSolver**.
- `SAT_VALIDATOR_MODE=live` habilita Playwright + CapSolver.
- `POST /validate` exige `x-concasa-worker-secret` igual a `SAT_VALIDATOR_SECRET`.
- Concurrencia default: 1 (`SAT_MAX_CONCURRENCY`).
- Un resultado SAT no reconocido se devuelve como `semantic=retry`; nunca como inválido.
- Captcha rechazado por el SAT → `status=captcha_failed`, `semantic=retry` (nunca `invalid`).
- No loguear RFC, CURP, nombres, texto del Estado de Cuenta ni respuesta HTML completa.
- Con `DEBUG_SAT=1` sí se puede loguear el texto OCR del captcha (no es PII) y guardar screenshots en `debug-sat/`.

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `SAT_VALIDATOR_MODE` | `fixture` | `fixture` \| `live` |
| `SAT_VALIDATOR_SECRET` | — | Secret del header `x-concasa-worker-secret` |
| `SAT_MAX_CONCURRENCY` | `1` | Cola interna |
| `CAPSOLVER_API_KEY` | — | Requerido en `live` |
| `CAPTCHA_PROVIDER` | `capsolver` | Proveedor OCR (`capsolver`; `2captcha` reservado) |
| `CAPTCHA_CASE` | `upper` | `upper` \| `asis` \| `lower` (post-OCR, pre-pattern) |
| `CAPSOLVER_MODULE` | `common` | `common` \| `none` (`none` = no enviar `module`) |
| `CAPTCHA_PREPROCESS` | `basic` | `raw` \| `basic` \| `threshold` |
| `CAPTCHA_PATTERN` | `^[A-Za-z0-9]{5}$` | Regex del texto OCR antes de enviar al SAT |
| `CAPTCHA_MAX_SOLVE_ATTEMPTS` | `5` | Máx. llamadas CapSolver por fase de captcha |
| `CAPTCHA_MAX_SUBMIT_ATTEMPTS` | `3` | Máx. envíos al SAT por fase de captcha |
| `DEBUG_SAT` | off | `1`/`true`: screenshots, OCR text, mensajes de error SAT visibles |
| `SMOKE_BASE_URL` | `http://127.0.0.1:3002` | Base URL del worker para `smoke-e2e` |
| `SMOKE_RFC` | — | RFC válido real (solo smoke; no loguear completo) |
| `SMOKE_CURP` | — | CURP válida real (solo smoke) |
| `SMOKE_RFC_INVALID` | — | RFC inválido opcional para 1 corrida de control |

CapSolver `ImageToTextTask`: `module=common` por defecto (`CAPSOLVER_MODULE=none` lo omite); `websiteURL` = ValidaRFC o ConsultaIdCSIAT. OCR se normaliza con `CAPTCHA_CASE` (default `upper`).

## Endpoints

- `GET /health` → `{ ok, mode }`
- `POST /validate` → body `{ rfc, curp, fixtureScenario? }`; respuesta incluye `rfc.captcha` / `curp.captcha` (`solveAttempts`, `submitAttempts`, `refreshes`) en live

En modo fixture se pueden probar `all_valid`, `rfc_unknown`, `curp_unknown`, `rfc_invalid_certified` y `curp_invalid_certified` sin tráfico externo.

## Setup

```bash
cd integrations/sat-rfc-validator
npm install
npx playwright install chromium
```

## Tests

```bash
npm test
```

## Benchmark de captcha (local, solo ValidaRFC)

No consulta RFC reales: mide si CapSolver + preprocess producen texto que el SAT acepta.

Crea `integrations/sat-rfc-validator/.env` (gitignored) con:

```bash
CAPSOLVER_API_KEY=tu_key
```

```bash
cd integrations/sat-rfc-validator
npm run benchmark:captcha
# o:
node scripts/benchmark-captcha.js 20 all
# un solo modo:
node scripts/benchmark-captcha.js 20 basic
```

Imágenes enviadas: `debug-sat/benchmark/`. Espera 3–5 s entre intentos.
Si hay 3 fallos seguidos de carga/timeout del SAT, el script se detiene e imprime la tabla parcial (exit 2).

## Smoke E2E local (caso real vía HTTP)

Prueba el flujo completo (captcha RFC → consulta RFC → captcha CURP → consulta CURP) pegándole a `POST /validate` (mismo contrato que el CRM usará con este worker CapSolver). **No** escribe en CRM ni en DB.

En `.env` (gitignored):

```bash
CAPSOLVER_API_KEY=
SAT_VALIDATOR_SECRET=local-smoke-secret
SMOKE_RFC=
SMOKE_CURP=
SMOKE_RFC_INVALID=
# SMOKE_BASE_URL=http://127.0.0.1:3002
```

`npm start` usa `node --env-file-if-exists=.env` (Node ≥20.6; en esta máquina v20.20.1). Al arrancar imprime `mode` y si `CAPSOLVER_API_KEY` / `SAT_VALIDATOR_SECRET` están `present`/`absent` (nunca el valor).

Terminal 1 — levantar worker:

```bash
cd integrations/sat-rfc-validator
SAT_VALIDATOR_MODE=live DEBUG_SAT=true PORT=3002 npm start
```


Terminal 2 — smoke (N=5 default):

```bash
cd integrations/sat-rfc-validator
npm run smoke:e2e
# o: node scripts/smoke-e2e.js 5
```

Si hay 3 fallos seguidos de carga/timeout del SAT (o 503 `TECHNICAL_FAILURE`), se detiene e imprime resumen parcial (exit 2).
