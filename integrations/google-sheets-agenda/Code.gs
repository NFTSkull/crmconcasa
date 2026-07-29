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
 */

var TECH_COLS = { start: 8, end: 14 }; // H..N (1-based)
var NSS_COL = 2; // B

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

  // Ignorar columnas técnicas H:N
  var col = e.range.getColumn();
  var lastCol = e.range.getLastColumn();
  if (col >= TECH_COLS.start) return;

  // Ignorar si la edición no toca NSS (B) ni nombre/asesor en filas de cita
  if (lastCol < NSS_COL && col > NSS_COL) return;

  var startRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  // Pegado múltiple: una fila a la vez, tope 20
  var max = Math.min(numRows, 20);
  for (var i = 0; i < max; i++) {
    var row = startRow + i;
    // Si ya hay booking_id en I, no re-crear
    var bookingId = String(sheet.getRange(row, 9).getDisplayValue() || "").trim();
    if (bookingId) continue;
    postWebhook_({
      spreadsheetId: ss.getId(),
      sheetId: sheetId,
      sheetTitle: title,
      rowNumber: row,
      source: "sheets_onedit",
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
      (props.url ? "ok" : "faltante"),
    "ConCasa",
    10,
  );
}
