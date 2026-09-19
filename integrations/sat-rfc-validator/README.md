# SAT RFC validator

Worker aislado para la validación fiscal pre-Mesa.

## Seguridad de rollout

- `SAT_VALIDATOR_MODE=fixture` es el default y **no navega al SAT ni usa CapSolver**.
- `SAT_VALIDATOR_MODE=live` habilita Playwright + CapSolver.
- `POST /validate` exige `x-concasa-worker-secret` igual a `SAT_VALIDATOR_SECRET`.
- Concurrencia default: 1 (`SAT_MAX_CONCURRENCY`).
- Un resultado SAT no reconocido se devuelve como `semantic=retry`; nunca como inválido.
- No loguear RFC, CURP, texto del Estado de Cuenta ni respuesta HTML completa.

## Endpoints

- `GET /health` → `{ ok, mode }`
- `POST /validate` → `{ rfc, curp, fixtureScenario? }`

En modo fixture se pueden probar `all_valid`, `rfc_unknown`, `curp_unknown`, `rfc_invalid_certified` y `curp_invalid_certified` sin tráfico externo.
