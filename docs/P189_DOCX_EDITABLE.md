# P189 — Word editable (Mesa, on-demand)

LOCAL. Sin Cloud. Sin migration. Sin Storage DOCX.

## Flujo

```
snapshot P189 (submission_version exacta)
  → adaptB3SnapshotToB1
  → buildInfonavitPrintModel
  → generateInfonavitDocx
  → download attachment
```

El PDF oficial no cambia: fill → flatten → Storage. Word es un artefacto adicional generado en memoria.

## Contrato HTTP

`POST /api/mesa/infonavit-docx` (`runtime = nodejs`)

Body Zod:

```json
{
  "expedienteId": "uuid",
  "documentType": "infonavit_carta_bajo_protesta | infonavit_presupuesto_mejoramiento | infonavit_solicitud_inscripcion",
  "submissionVersion": 0
}
```

Auth: `Authorization: Bearer <access_token>` de la sesión Mesa.

Respuesta OK: bytes DOCX.

- `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `Content-Disposition: attachment; filename="… editable.docx"`
- Filenames sin PII: `Carta Bajo Protesta editable.docx`, `Presupuesto de Mejoramiento editable.docx`, `Solicitud de Inscripción editable.docx`

## Autorización

Más estricta que el read model PDF en el rol: solo `mesa_admin | mesa_interno | mesa_externo | super_admin` activo.

1. Sesión válida.
2. Rol Mesa.
3. Visibilidad vía RPC `get_expediente_infonavit_pdf_estado` (JWT, RLS).
4. Documento activo `done`.
5. `submissionVersion` **exacta** (409 `version_mismatch` si no coincide; no se usa otra versión).
6. Snapshot `SELECT` server-side con service role (la tabla no es SELECT para el browser).
7. Generación en memoria. 0 write Storage / outbox / `expediente_documentos`.

Asesor: 403. Sin UI Word.

Códigos públicos sin PII: `unauthenticated` 401, `forbidden` 403, `invalid_request` 400, `not_done` 409, `version_mismatch` 409, `snapshot_missing` 404/409.

## UI

Misma sección «Documentos INFONAVIT» en detalle Mesa, por documento listo:

- Vista previa
- Descargar PDF
- Descargar Word editable (solo `status=done` + snapshot/versión activa)

Estados: normal / «Generando Word…» / error breve. Sin página, modal, wizard ni UI asesor.

## Fuera de este bloque

No regenerar históricos. No push/PR/deploy. No migration nueva.
