/**
 * ConCasa CRM — Google Apps Script (CITAS 2026)
 * Trigger instalable onEdit → Edge Function agenda-sheet-webhook.
 * Secretos SOLO en PropertiesService. Sin service_role. Sin private keys.
 *
 * Propiedades requeridas:
 * - WEBHOOK_URL
 * - WEBHOOK_SECRET
 * - SPREADSHEET_ID (= 1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA)
 * - SYNC_ENABLED (= true|false)
 *
 * Columnas técnicas O:U (nunca H:N — H:N se PRESERVA):
 * O=ESTADO CRM, P=CRM_BOOKING_ID, Q=CRM_EXPEDIENTE_ID,
 * R=CRM_SLOT_KEY, S=CRM_SYNC_SOURCE, T=CRM_SYNC_UPDATED_AT, U=CRM_SYNC_VERSION
 */

var TECH_COLS = { start: 15, end: 21 }; // O..U (1-based)
var PRESERVE_END = 14; // A:N — no escribir desde Apps Script técnico
var NSS_COL = 2; // B
var ESTADO_COL = 15; // O
var BOOKING_ID_COL = 16; // P

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("ConCasa")
    .addItem("Sincronizar fila seleccionada", "menuSyncSelectedRow")
    .addItem("Cancelar cita seleccionada", "menuCancelSelectedRow")
    .addItem("Reintentar sincronización", "menuRetrySync")
    .addItem("Ver estado de integración", "menuShowStatus")
    .addToUi();
}

function getProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    url: p.getProperty("WEBHOOK_URL") || "",
    secret: p.getProperty("WEBHOOK_SECRET") || "",
    spreadsheetId: p.getProperty("SPREADSHEET_ID") || "",
    enabled: (p.getProperty("SYNC_ENABLED") || "false").toLowerCase() === "true",
  };
}

function installableOnEdit(e) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "Otro proceso de sincronización está en curso.",
      "ConCasa",
      5,
    );
    return;
  }
  try {
    handleEdit_(e);
  } finally {
    lock.releaseLock();
  }
}

function handleEdit_(e) {
  if (!e || !e.range) return;
  var props = getProps_();
  if (!props.enabled) return;

  var ss = e.source;
  if (!ss) return;
  if (props.spreadsheetId && ss.getId() !== props.spreadsheetId) return;

  var sheet = e.range.getSheet();
  var sheetId = sheet.getSheetId();
  var title = sheet.getName();

  // Ignorar columnas técnicas O:U (escrituras del worker/webhook no re-disparan)
  var col = e.range.getColumn();
  var lastCol = e.range.getLastColumn();
  if (col >= TECH_COLS.start) return;
  // Cualquier edición que solo toque O:U ya se filtró; si el rango cruza
  // hacia técnicas desde A:N, igual no procesamos celdas técnicas.

  // Columna A (hora física): reconciliar inventario de filas vacías / conflicto si ocupada.
  // Columnas B+ (NSS/nombre/asesor): ocupación Sheet → inventario (sin PII en payload).
  // La condición siguiente casi nunca aplica a rangos contiguos; se conserva por legado.
  if (lastCol < NSS_COL && col > NSS_COL) return;

  var TIME_COL = 1; // A
  var OPS_RESULT_COL_START = 5; // E (BIOMETRICOS / NOTIFICACION firmas)
  var OPS_RESULT_COL_END = 9; // I (COMPLETO / notas auxiliares)
  var startRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  // Pegado múltiple: una fila a la vez, tope 20
  var max = Math.min(numRows, 20);
  var touchesTimeCol = col <= TIME_COL && lastCol >= TIME_COL;
  var touchesOpsResultCols =
    col <= OPS_RESULT_COL_END && lastCol >= OPS_RESULT_COL_START;
  for (var i = 0; i < max; i++) {
    var row = startRow + i;
    var horaVal = String(sheet.getRange(row, TIME_COL).getDisplayValue() || "").trim();
    var nssVal = String(sheet.getRange(row, NSS_COL).getDisplayValue() || "").trim();
    var nombreVal = String(sheet.getRange(row, 3).getDisplayValue() || "").trim();
    var asesorVal = String(sheet.getRange(row, 4).getDisplayValue() || "").trim();
    // Advertencia local: ocupación sin horario no puede consumir cupo.
    if (!horaVal && (nssVal || nombreVal || asesorVal)) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "Captura la cita en una fila que tenga horario asignado.",
        "ConCasa",
        8,
      );
    }
    // Si ya hay booking_id en P:
    // - edición de A → notificar (ocupied_slot_time_changed)
    // - edición de E–I (resultado operativo Bernardo) → notificar sin PII
    // - resto B–D/J–N → no re-crear (evita loop)
    var bookingId = String(
      sheet.getRange(row, BOOKING_ID_COL).getDisplayValue() || "",
    ).trim();
    if (bookingId && !touchesTimeCol && !touchesOpsResultCols) continue;
    // Estado en O solo lectura local (diagnóstico); no escribe Apps Script aquí
    // Payload SIN PII: solo ids de hoja/fila + timestamp + firma vía header.
    postWebhook_({
      spreadsheetId: ss.getId(),
      sheetId: sheetId,
      sheetTitle: title,
      rowNumber: row,
      source: "sheets_onedit",
      editedAt: new Date().toISOString(),
      idempotencyKey: ss.getId() + ":" + sheetId + ":" + row + ":" + Date.now(),
    });
  }
}

function postWebhook_(payload) {
  var props = getProps_();
  if (!props.url || !props.secret) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "Faltan WEBHOOK_URL / WEBHOOK_SECRET en PropertiesService.",
      "ConCasa",
      8,
    );
    return;
  }
  var res = UrlFetchApp.fetch(props.url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-concasa-webhook-secret": props.secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(res.getContentText() || "{}");
  } catch (err) {
    body = {};
  }
  var msg =
    (body && body.message) ||
    (code >= 200 && code < 300
      ? "Sincronizado"
      : "No fue posible sincronizar. No se creó ninguna cita.");
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, "ConCasa", 8);
}

function menuSyncSelectedRow() {
  var range = SpreadsheetApp.getActiveRange();
  if (!range) return;
  var sheet = range.getSheet();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  postWebhook_({
    spreadsheetId: ss.getId(),
    sheetId: sheet.getSheetId(),
    sheetTitle: sheet.getName(),
    rowNumber: range.getRow(),
    source: "sheets_menu",
    idempotencyKey: ss.getId() + ":" + sheet.getSheetId() + ":" + range.getRow(),
  });
}

function menuCancelSelectedRow() {
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "La cancelación desde Sheets está deshabilitada hasta autorizar RPC segura. Cancela desde el CRM.",
    "ConCasa",
    10,
  );
}

function menuRetrySync() {
  menuSyncSelectedRow();
}

function menuShowStatus() {
  var props = getProps_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "SYNC_ENABLED=" +
      props.enabled +
      " · spreadsheet=" +
      (props.spreadsheetId ? "ok" : "faltante") +
      " · webhook=" +
      (props.url ? "ok" : "faltante") +
      " · tech=O:U preserve=A:N",
    "ConCasa",
    10,
  );
}
