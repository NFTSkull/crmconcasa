# Runbook — Smoke E2E en producción (2 fases)

**Última actualización:** 2026-06-30  
**Entorno:** https://crmconcasa.vercel.app  
**Commit validado:** `4ee29526f5cccc8505550b1d65eb82b95a436067`  
**Veredicto actual:** `LISTO CON PENDIENTES MENORES`  
**Estado operativo:** `LISTO PARA OPERACIÓN REAL CONTROLADA`

---

## 1. Estado actual

### Producción

| Campo | Valor |
|-------|--------|
| URL | https://crmconcasa.vercel.app |
| Supabase Cloud | `fvtqbxukqlajezyyvwzy.supabase.co` |
| Commit en `main` / prod | `4ee29526f5cccc8505550b1d65eb82b95a436067` |
| Mensaje commit | `feat(documentos): restrict uploads to PDF files` |

### Veredicto y alcance

El sistema está **LISTO PARA OPERACIÓN REAL CONTROLADA** en el tramo:

- Asesor crea expediente
- Editor aprueba con monto
- Asesor integra datos generales y documentos (solo PDF)
- Asesor envía a Mesa
- Mesa valida, toma y avanza integración
- Agenda biométrica: configuración visible y cita agendable
- Avance operativo hasta **etapa 5** (post-cita biométrica registrada)

El smoke **completo hasta firmas (etapa 10)** se divide en **dos fases** porque la regla de negocio bloquea el avance **5→6** mientras la cita biométrica sea futura.

### División del smoke

```txt
Fase 1: creación → editor → integración → Mesa → biométricos agendado → etapa 5
Fase 2: post-cita biométrica → retención → firmas → etapa 10
```

---

## 2. Usuarios por rol

Usar solo cuentas de prueba ya creadas. **No documentar contraseñas** en este runbook.

| Rol | Email | `app_role` (Cloud) |
|-----|--------|---------------------|
| Asesor | `jesus.acosta@concasa.mx` | `asesor` |
| Editor | `editor@concasa.mx` | `editor` |
| Mesa admin / Cynthia | `mesa@concasa.mx` | `mesa_admin` |
| Mesa interno | `mesa.interno01@concasa.mx` | `mesa_interno` |

**Autenticación en smoke automatizado:** magic link vía Supabase Admin API (`generate_link` + `verify`) con service role del operador. En smoke manual: login normal con credenciales de prueba.

---

## 3. Orden real del flujo

El guion “A datos → B docs → C editor” del checklist original **no coincide** con el gate de producción.

```txt
El formulario de Datos Generales y Documentos se habilita después de aprobación del editor.

Orden real:
Asesor crea expediente
→ Editor aprueba (monto > 0)
→ Asesor llena datos y sube PDFs
→ Asesor envía a Mesa
→ Mesa valida datos + documentos (acordeones “Ver”)
→ Mesa avanza integración 1→2
→ Mesa avanza 2→3→4
→ Asesor agenda biométricos (etapa 4)
→ Mesa avanza 4→5
→ [BLOQUEO ESPERADO] 5→6 si la cita aún no ocurrió
```

**Gate técnico:** `puedeIntegrar` exige `editor_decisions.decision = aprobado` y `monto_aprobado > 0`.

---

## 4. Reglas estrictas del smoke

- **No** tocar código, commit, push ni deploy manual.
- **No** `db push`, migraciones, schema, RLS ni RPCs.
- **No** usar datos reales de clientes ni borrar expedientes reales.
- **No** borrar usuarios reales (solo iniciar sesión).
- Usar marcador smoke claramente identificable.
- Limpiar al final si el flujo lo permite.

### Marcador smoke recomendado

```txt
Nombre: SMOKE E2E PRODUCCION YYYYMMDD
NSS:    99060MMDD001          (11 dígitos, único en Cloud)
Correo: smoke.e2e.YYYYMMDD@ejemplo.mx
Celular cliente:     819960MMDD1
Teléfono empresa:    819960MMDD2
Referencia 1 celular: 819960MMDD3
Referencia 2 celular: 819960MMDD4
```

Verificar NSS libre antes de crear:

```sql
SET ROLE postgres;
SELECT count(*) FROM cliente_datos WHERE datos->>'nss' = '<NSS_PLANIFICADO>';
-- Debe ser 0
```

### Pre-limpieza (si aplica)

Antes de cada corrida, verificar que no quede residuo del fixture histórico `b3029485-fcb3-4923-b946-b92cc96d2626` ni nombres `Prod Smoke%` / `SMOKE E2E%`.

---

## 5. Fase 1 — Integración hasta biométricos (etapa 5)

**Objetivo:** Validar el tramo operativo crítico sin esperar la fecha de cita.

### 5.1 Crear expediente smoke (Asesor)

1. Login: `jesus.acosta@concasa.mx`
2. Ir a `/asesor/nueva`
3. Programa: Mejoravit (u otro válido)
4. Nombre: `SMOKE E2E PRODUCCION YYYYMMDD`
5. Teléfono y NSS según marcador (únicos)
6. Botón **Enviar**
7. Confirmar en `/asesor` y anotar `expediente_id`

**Esperado:** expediente ligado a `asesor_id` del asesor logueado; etapa 1; `submitted_to_mesa = false`.

### 5.2 Aprobar con editor

1. Login: `editor@concasa.mx`
2. Ir a `/editor/{expediente_id}` (o buscar en bandeja)
3. Seleccionar **Aprobado**
4. Monto aprobado: valor numérico > 0 (ej. `250000`)
5. **Guardar decisión**

**Esperado:** `editor_decisions.decision = aprobado`, `monto_aprobado > 0`.

### 5.3 Capturar datos generales válidos (Asesor)

1. Volver a `/asesor/expediente/{id}`
2. Confirmar instrucciones visibles
3. Llenar los 19 campos con formato válido (CURP, RFC, CP 5 dígitos, teléfonos únicos)
4. **Guardar datos**

**Esperado:** `cliente_datos.estado = completo`; sin errores consola/network críticos.

### 5.4 Probar errores de validación (opcional pero recomendado)

Antes del guardado final válido, probar que el formulario rechaza:

| Caso | Entrada ejemplo | Mensaje esperado |
|------|-----------------|------------------|
| Teléfonos duplicados | Celular = ref1 celular | No puede repetirse con celular del cliente |
| NSS inválido | `123` | NSS debe tener 11 dígitos |
| CURP inválida | `INVALIDA` | CURP no tiene formato válido |
| RFC inválido | `INVALIDO` | RFC no tiene formato válido |
| Correo inválido | `x` | Correo no tiene formato válido |
| CP inválido | `64` | CP debe tener 5 dígitos |

### 5.5 Subir documentos (Asesor)

Documentos obligatorios (5):

- `nss`
- `cliente_ine_frente`
- `cliente_ine_reverso`
- `cliente_comprobante_domicilio`
- `cliente_estado_cuenta`

| Prueba | Archivo | Esperado |
|--------|---------|----------|
| Rechazo JPG | `.jpg` en primer slot | Mensaje “Solo PDF”; **no** sube a Storage |
| Rechazo PNG | `.png` en primer slot | Mensaje “Solo PDF”; **no** sube a Storage |
| Aceptación PDF | `.pdf` en cada tipo | Visible en UI; fila en `expediente_documentos` + objeto Storage |

### 5.6 Enviar a Mesa (Asesor)

1. Con editor aprobado, datos completos y 5 PDFs subidos
2. Clic **Enviar a Mesa**

**Esperado:**

- `submitted_to_mesa = true`
- `fecha_envio_mesa` NOT NULL
- `subestado = en_validacion_mesa`
- Visible en bandeja Mesa

### 5.7 Mesa toma expediente (Mesa interno)

1. Login: `mesa.interno01@concasa.mx`
2. `/mesa-control` — revisar filtros: Disponibles, Mi bandeja, En trabajo, Todo Mesa
3. Localizar smoke; **Tomar expediente**
4. Abrir detalle

**Esperado:** `mesa_expediente_ops.estado_mesa = trabajando`; datos, PDFs y seguimiento visibles.

### 5.8 Validar integración en Mesa (acordeones)

> **Importante:** Los botones **Validar datos** / **Validar** por documento están dentro de acordeones colapsados. Expandir **Ver** antes de validar.

1. Acordeón **Datos generales del cliente** → **Validar datos**
2. Acordeón **Documentos e imágenes del cliente** → **Validar** en cada uno de los 5 obligatorios  
   (o usar flujo masivo si la UI lo ofrece en esa sección)
3. Panel **Decisión Mesa — Integración** → confirmar checklist en verde
4. **Aceptar integración y avanzar a Registro** (1→2)
5. **Aceptar y avanzar a Listo cita biométricos** (2→3)
6. **Aceptar y avanzar a Cita biométricos** (3→4)

**Esperado:** 5 documentos `estatus_revision = validado`; `cliente_datos.estado = validado`; `etapa_actual = 4`.

### 5.9 Cynthia valida agenda (Mesa admin)

1. Login: `mesa@concasa.mx`
2. `/mesa-control` — confirmar paneles **Agenda de biométricos** y **Agenda de firmas**
3. Verificar sedes, horarios y cupos sin alterar configuración masiva de producción

**Esperado:** `canManageAgendaConfig` true; config en `agenda_config` (`biometricos`, `firmas`).

### 5.10 Agendar biométricos (Asesor)

1. Login asesor → `/asesor/expediente/{id}` (etapa 4)
2. Card biométricos visible
3. Elegir sede, fecha con cupo, horario disponible
4. **Agendar cita biométrica** (confirmar diálogo)

**Esperado:**

- Fila en `agenda_bookings` con `kind = biometricos`, `status = booked`
- No permite segundo booking activo para el mismo expediente

Anotar: `booking_id`, `booking_date`, `booking_time`, `location_id`.

### 5.11 Avanzar 4→5 (Mesa interno)

1. En detalle Mesa → **Aceptar cita biométrica y avanzar**

**Esperado:** `etapa_actual = 5`, `subestado = en_proceso`.

### 5.12 Confirmar bloqueo 5→6 (cita futura)

1. En etapa 5, localizar **Aceptar post-cita biométrica y avanzar**
2. Si la cita es **futura**, el botón debe estar **deshabilitado**

**Bloqueo esperado (no es bug):**

```txt
La cita biométrica aún no ha ocurrido. Espera a la fecha programada antes de avanzar.
```

Módulo de referencia: `deriveBloqueosAvanceOperativo5a6` en `mesa-avance-integracion.ts`.

**Fin Fase 1:** etapa 5 con cita biométrica activa. **No limpiar** si se planea Fase 2 en la fecha de cita.

---

## 6. Fase 2 — Día de cita / post-cita (pendiente de ejecutar)

**Cuándo ejecutar:** el día en que `fecha_cita` biométrica ≤ ahora, o usando un slot de prueba en el pasado si Mesa admin lo configura explícitamente para smoke.

**Precondiciones:**

- Mismo `expediente_id` de Fase 1 (o recrear siguiendo Fase 1 hasta etapa 5)
- `agenda_bookings` biométricos `status = booked`
- Cita ya ocurrida según regla SQL/UI

### 6.1 Avance 5→6 post-cita biométrica

1. Mesa interno → detalle expediente etapa 5
2. **Aceptar post-cita biométrica y avanzar**

**Esperado:** `etapa_actual = 6`.

### 6.2 Avances 6→7→8

1. **Aceptar y avanzar a Notificación** (6→7)
2. **Aceptar y avanzar a Acuse / Aviso de retención** (7→8)

**Esperado:** `etapa_actual = 8`.

### 6.3 Retención etapa 8 (Asesor + Mesa)

**Asesor:**

1. Seleccionar opción retención (ej. **sin sello**)
2. **Guardar opción**
3. Subir PDFs requeridos por la opción elegida
4. **Enviar a Mesa** (bloque retención)

**Mesa:**

1. Expandir acordeón Acuse / Aviso de retención
2. **Validar** cada documento de retención
3. **Aceptar retención y avanzar a Firma** (8→9)

**Esperado:** `etapa_actual = 9`; documentos retención `validado`.

### 6.4 Agenda de firmas

1. Cynthia: confirmar disponibilidad firmas en `/mesa-control` (sin cambios masivos)
2. Asesor en etapa 9: card firmas visible
3. **Agendar cita de firma** con cupo disponible

**Esperado:** `agenda_bookings` con `kind = firmas`, `status = booked`; sin doble booking activo firmas.

### 6.5 Avance 9→10

1. Mesa → **Aceptar cita de firma y avanzar**

**Esperado:** `etapa_actual = 10`.

### 6.6 Bloqueos esperados (validar explícitamente)

| Escenario | Quién | Esperado |
|-----------|-------|----------|
| Avanzar 4→5 sin cita activa | Mesa | Botón deshabilitado / bloqueo en UI |
| Avanzar 5→6 con cita futura | Mesa | Botón deshabilitado |
| Avanzar 9→10 sin cita firmas | Mesa | Botón deshabilitado |
| Segundo booking biométricos activo | Asesor | RPC/UI rechaza |
| Segundo booking firmas activo | Asesor | RPC/UI rechaza |
| Avanzar etapa operativa | Asesor / Editor | Sin permiso donde no corresponde |
| Configurar agenda | Mesa interno | Sin panel de edición |

### 6.7 Limpieza final (Fase 2)

Ejecutar checklist de la sección 7 tras completar o abortar Fase 2.

---

## 7. Limpieza — checklist

Ejecutar **dry-run** (listar IDs y paths) antes de borrar.

| Artefacto | Acción | Notas |
|-----------|--------|-------|
| Expediente smoke | `DELETE` puntual por `id` + nombre smoke | Solo filas smoke |
| `cliente_datos` | `DELETE` por `expediente_id` | |
| `expediente_documentos` | `DELETE` filas + paths Storage | Service role Storage API |
| Objetos Storage | `DELETE` cada `storage_path` | Bucket `expediente-documentos` |
| `agenda_bookings` | `DELETE` por `expediente_id` | biométricos + firmas |
| `mesa_expediente_ops` | `DELETE` por `expediente_id` | |
| `editor_decisions` | `DELETE` por `expediente_id` | |
| `action_log` | **No borrar** | Auditoría inmutable por diseño |

**Verificación post-limpieza:**

```sql
SET ROLE postgres;
SELECT count(*) FROM expedientes WHERE cliente_nombre ILIKE '%SMOKE E2E%';
SELECT count(*) FROM cliente_datos WHERE datos->>'nss' = '<NSS_USADO>';
SELECT count(*) FROM expediente_documentos ed
  JOIN expedientes e ON e.id = ed.expediente_id
  WHERE e.cliente_nombre ILIKE '%SMOKE E2E%';
SELECT count(*) FROM agenda_bookings ab
  JOIN expedientes e ON e.id = ab.expediente_id
  WHERE e.cliente_nombre ILIKE '%SMOKE E2E%';
-- Todos deben ser 0
```

---

## 8. Pendientes menores (no bloquean operación controlada)

1. **Route guard UX:** asesor y editor pueden abrir el shell `/mesa-control` por URL; RLS no muestra datos ajenos. Recomendación: guard de ruta por rol.
2. **Acordeones Mesa:** validación de datos/documentos requiere expandir **Ver** en cada sección; el panel de cierre integración no sustituye los botones Validar.
3. **Firmas 9–10:** pendiente de smoke Fase 2.
4. **Retención etapa 8:** pendiente de smoke Fase 2.
5. **Orden documental vs guion:** documentar siempre “editor antes de datos” en capacitación de asesores.

---

## 9. Resultado del smoke ya ejecutado (2026-06-30)

Smoke integral Fase 1 ejecutado en producción con el commit validado.

| Campo | Valor |
|-------|--------|
| Expediente smoke | `a3c6886c-8f03-4d5c-9def-9b537501ef53` |
| Nombre | `SMOKE E2E PRODUCCION 20260630` |
| Booking biométricos | `9b06c875-fadd-44b2-b13f-a0ecdbd7afe6` |
| Fecha/hora cita | `2026-07-02` 09:00 (Monterrey) |
| Etapa alcanzada | **5** (`en_proceso`) |
| Envío Mesa | OK (`submitted_to_mesa = true`) |
| Mesa tomó expediente | OK |
| 5 PDFs integración | OK (JPG/PNG rechazados) |
| Editor aprobó | OK (`250000`) |
| Bloqueo 5→6 con cita futura | Confirmado (comportamiento esperado) |
| Fase 2 (retención/firmas) | **No ejecutada** |
| Limpieza final | **Completa** |
| Residuos post-limpieza | **Ninguno** |

### Fixture histórico pre-smoke

| Check | Resultado |
|-------|-----------|
| `b3029485-fcb3-4923-b946-b92cc96d2626` residuos | 0 docs / 0 cliente_datos smoke |
| `Prod Smoke%` global | 0 |

---

## 10. Referencias rápidas

| Recurso | Ubicación |
|---------|-----------|
| Docs obligatorios asesor | `integration-docs-completos.ts` — 5 tipos envío |
| Gate editor → integración | `asesorPuedeIntegrarTrasMontoRevisor` |
| Bloqueo 5→6 | `deriveBloqueosAvanceOperativo5a6` |
| Bloqueo 4→5 (sin booking) | `deriveBloqueosAvanceOperativo4a5` |
| Mesa filtros ops | `data-testid="mesa-ops-filter-{sin_asignar\|mi_bandeja\|en_trabajo\|todo_mesa}"` |
| Tomar / liberar | `data-testid="mesa-ops-tomar-expediente"` |

---

## 11. Criterios de cierre

| Fase | Criterio PASS |
|------|----------------|
| **Fase 1** | Etapa 5 + booking biométricos activo + bloqueo 5→6 demostrado + sin residuos si se limpia |
| **Fase 2** | Etapa 10 + booking firmas activo + retención validada + limpieza completa |
| **Operación controlada** | Fase 1 PASS es suficiente para abrir trámite real con supervisión Mesa en integración y biométricos |

**Veredicto vigente:** `LISTO CON PENDIENTES MENORES` → **LISTO PARA OPERACIÓN REAL CONTROLADA** en tramo integración + biométricos agendados.
