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

## Variables para modo live

Para `SAT_VALIDATOR_MODE=live`:

- `CAPSOLVER_API_KEY`: requerido.
- `SAT_REQUIRE_PROXY=1`: recomendado/esperado para SAT.
- `PROXY_URL`: endpoint HTTP(S) del proveedor, por ejemplo `gate.proveedor.com:7000`.
- `PROXY_USERNAME`: usuario exacto generado por el proveedor. Debe apuntar a México y a una sesión sticky cuando el proveedor lo soporte.
- `PROXY_PASSWORD`: contraseña del proxy.
- `PROXY_COUNTRY=mx`, `PROXY_STATE`, `PROXY_USER_PREFIX`, `PROXY_PASS`: compatibilidad legacy; preferir usuario/contraseña explícitos del proveedor.

El mismo objeto proxy se aplica al browser Playwright completo, así RFC y CURP comparten la misma sesión del proveedor durante una validación.

`GET /health` en live responde 503 mientras falte CapSolver o el proxy requerido. No exponer valores de credenciales en logs.

### Requisito del proxy

Usar proxy residencial o ISP mexicano con HTTP(S) y sesión sticky. Evitar datacenter compartido para el E2E de certificación: el objetivo es mantener una IP mexicana estable durante RFC + CURP y reducir bloqueos/reputación adversa.
