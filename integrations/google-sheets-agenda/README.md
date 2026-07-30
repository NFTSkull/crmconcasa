# Integración Google Sheets ↔ Agenda ConCasa CRM

Spreadsheet: `1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA` («CITAS 2026»).  
Zona de integración: `America/Mexico_City`.  
Fuente de verdad: **Supabase** (`agenda_bookings`). Sheets nunca escribe directo a la tabla.

## Estado de esta fase

Implementación **local** lista. **No** se ha:

- editado la hoja real;
- desplegado Apps Script;
- desplegado Edge Functions;
- aplicado la migración 129 en Cloud;
- configurado secretos reales;
- ejecutado smoke.

## Arquitectura

1. CRM reserva → trigger outbox `agenda_sheet_sync_outbox` → worker Edge escribe fila libre.
2. Sheets edita NSS → Apps Script `installableOnEdit` → Edge `agenda-sheet-webhook` relee fila → RPC `agenda_sheet_book_by_nss` → escribe canónicos.
3. Cupos CRM: `(org, kind, date, time, location)` + capacity. Filas repetidas = `slot_ordinal` en `agenda_sheet_slot_links`.

## 1. Cuenta de servicio Google

1. Google Cloud Console → crear proyecto (o reutilizar).
2. Crear Service Account.
3. Descargar JSON (private key). **Nunca** commitear.
4. Anotar `client_email`.

## 2. Habilitar Google Sheets API

APIs & Services → Enable **Google Sheets API**.

## 3. Compartir la hoja

Compartir el Spreadsheet con el correo de la service account (Editor).  
No automatizar el share desde código.

## 4. Secretos Supabase (Edge)

Configurar (Dashboard / CLI secrets), sin subir a Git:

- `GOOGLE_SHEETS_SPREADSHEET_ID=1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL=...`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...` (con `\n`)
- `GOOGLE_SHEETS_WEBHOOK_SECRET=...` (largo, aleatorio)
- `GOOGLE_SHEETS_SYNC_ENABLED=true|false`
- `GOOGLE_SHEETS_ORGANIZATION_ID=<uuid org ConCasa>`
- `GOOGLE_SHEETS_YEAR=2026`
- `GOOGLE_SHEETS_TAB_MAP_JSON={"2026-07-29":{"sheetId":1288978311,"title":"29 JULIO"},...}`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (automáticos en Edge)

## 5. Desplegar Edge Functions

```bash
npx supabase functions deploy agenda-sheet-webhook --no-verify-jwt
npx supabase functions deploy agenda-sheet-sync-worker --no-verify-jwt
```

Worker auth:
- Env: `GOOGLE_SHEETS_WORKER_SECRET` (preferido) o `GOOGLE_SHEETS_WEBHOOK_SECRET`
- Header: `x-concasa-worker-secret`
- Método: `POST` body `{}`
- `GOOGLE_SHEETS_SYNC_ENABLED=false` → `200 {processed:0,disabled:true}` (no-op)

Cron oficial (mig. 130): job `agenda-sheet-sync-worker-every-minute` cada minuto.
Vault (sin valores en Git): `agenda_sheet_project_url`, `agenda_sheet_worker_secret`.

## 5bis. Pestañas nuevas

`GOOGLE_SHEETS_TAB_MAP_JSON` sigue siendo preferente. Si falta `map[booking_date]`, el worker lista metadatos del Spreadsheet y resuelve exactamente una pestaña cuya fecha parseada coincida (título exacto al escribir; espacios solo para parsear). Estados: `resolved_from_tab_map`, `resolved_from_live_metadata`, `missing_sheet_for_date`, `ambiguous_sheet_for_date`. No crea pestañas.

## 6. Instalar Apps Script

1. Extensiones → Apps Script en la hoja.
2. Pegar `Code.gs` y `appsscript.json` desde `integrations/google-sheets-agenda/`.
3. No pegar claves en el código.

## 7. Trigger instalable

En Apps Script: Triggers → Add trigger → `installableOnEdit` → From spreadsheet → On edit.  
No depender solo de `onEdit` simple (limitaciones de auth/`UrlFetch`).

## 8. PropertiesService

Script Properties:

- `WEBHOOK_URL` = URL de `agenda-sheet-webhook`
- `WEBHOOK_SECRET` = mismo que `GOOGLE_SHEETS_WEBHOOK_SECRET`
- `SPREADSHEET_ID` = id canónico
- `SYNC_ENABLED` = `true`

## 9. Dry-run

Usar `buildAgendaSheetsDryRunReport` (`src/domain/agenda-sheets/dry-run.ts`) con tabs leídas offline.  
No escribe Sheets ni Supabase. Generar reporte de mismatches antes de cualquier backfill.

## 10. Conflictos

Toasts / mensajes canónicos:

- Este espacio ya fue reservado en el CRM.
- El NSS no corresponde a un expediente disponible para esta cita.
- La cita ya existe en otra fila u horario.
- No fue posible sincronizar. No se creó ninguna cita.

## 11. Apagar integración

`GOOGLE_SHEETS_SYNC_ENABLED=false` (+ `SYNC_ENABLED=false` en Apps Script).  
CRM y bookings siguen intactos; no se borran mappings ni filas.

## 12. Rollback sin borrar bookings

1. Desactivar sync.
2. No dropear tablas 129 en caliente si hay datos.
3. Opcional: dejar de procesar outbox (eventos quedan pending/dead).

## 13. Reintentar pendientes

Invocar `agenda-sheet-sync-worker` o menú ConCasa → Reintentar sincronización (fila).  
Máx 5 intentos; luego `dead`.

## 14. No cancelar borrando celdas

Borrar NSS/nombre/asesor **no** cancela. Restaurar canónicos / mensaje de menú Cancelar (hoy deshabilitado → cancelar en CRM).

## Columnas técnicas (O:U — H:N se PRESERVA)

Auditoría read-only confirmó datos reales en H:I (fechas, notas, papelería).
**Nunca escribir H:N.** Rango técnico seguro: **O:U**.

| Col | Uso |
|-----|-----|
| O | ESTADO CRM |
| P | CRM_BOOKING_ID |
| Q | CRM_EXPEDIENTE_ID |
| R | CRM_SLOT_KEY (kind\|date\|time\|sede\|ordinal) |
| S | CRM_SYNC_SOURCE |
| T | CRM_SYNC_UPDATED_AT |
| U | CRM_SYNC_VERSION |

Antes de activar sync: dry-run debe confirmar O:U vacías (o solo encabezados/contrato ConCasa). Si O:U tiene datos inesperados → abortar pestaña.

Contrato TS: `src/domain/agenda-sheets/tech-columns.ts` (espejo Edge en `_shared/agenda-sheets/tech-columns.ts`).

## Apps Script — republicación requerida

Cambios en `Code.gs` (onEdit de columna A + conflicto si P existe) **no** se aplican al desplegar Edge Functions. Tras merge/Cloud hay que **volver a desplegar el proyecto Apps Script** en la hoja CITAS 2026 (copiar `Code.gs` o push clasp) y verificar el trigger instalable `installableOnEdit`.

## Migración

`supabase/migrations/129_google_sheets_agenda_sync.sql` (no usar 128).
