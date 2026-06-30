/**
 * Lever × Google Sheets automation (Apps Script web app).
 *
 * Receives analysis runs from Lever (POST JSON) and maintains a single sheet
 * with the latest data on top:
 *   - Writes/repairs the header row from the payload.
 *   - UPSERTS by a stable key (date|channel|entityId): existing rows are updated
 *     in place; new rows are inserted directly under the header (newest-first).
 *   - A time-driven trigger keeps the sheet sorted newest-first and trims to a
 *     retention cap so the tab never grows unbounded.
 *
 * Setup:
 *   1. Extensions → Apps Script in your target spreadsheet; paste this file.
 *   2. Project Settings → Script Properties: set SHEET_TOKEN (a shared secret)
 *      and optionally SHEET_NAME (default "Lever") / RETENTION_ROWS (default 5000).
 *   3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone.
 *   4. Put the web app URL in Lever's LEVER_SHEETS_WEBHOOK_URL and the same
 *      secret in LEVER_SHEETS_TOKEN.
 *   5. Run installTrigger() once to schedule daily maintenance.
 */

var KEY_COLUMNS = ["date", "channel", "entityId"];

function props_() {
  return PropertiesService.getScriptProperties();
}

function sheetName_() {
  return props_().getProperty("SHEET_NAME") || "Lever";
}

function retention_() {
  return Number(props_().getProperty("RETENTION_ROWS") || "5000");
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = sheetName_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function tz_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || "UTC";
}

/**
 * Normalize a key cell to a stable string. Sheets auto-coerces an incoming
 * date string like "2024-01-15" into a Date on write, and getValues() reads it
 * back as a Date object — so without this an existing row's key ("Wed Jan 15
 * 2024…") would never match the incoming string key and the upsert would
 * silently re-append. Dates are re-formatted to YYYY-MM-DD in the sheet's
 * timezone so both sides agree.
 */
function normalizeKeyCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz_(), "yyyy-MM-dd");
  }
  return v === undefined || v === null ? "" : String(v);
}

function rowKey_(header, values) {
  return KEY_COLUMNS.map(function (col) {
    return normalizeKeyCell_(values[header.indexOf(col)]);
  }).join("|");
}

/** GET → health probe. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, sheet: sheetName_() })
  ).setMimeType(ContentService.MimeType.JSON);
}

/** POST → upsert a payload of { header, rows, token }. */
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "invalid JSON" });
  }

  var expected = props_().getProperty("SHEET_TOKEN");
  if (expected && !safeEqual_(String(body.token || ""), expected)) {
    return json_({ ok: false, error: "unauthorized" });
  }
  if (!body.header || !body.rows) {
    return json_({ ok: false, error: "missing header/rows" });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return upsert_(body.header, body.rows);
  } finally {
    lock.releaseLock();
  }
}

function upsert_(header, rows) {
  var sheet = getSheet_();

  // Ensure header row.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }

  // Index existing keys → sheet row number.
  var lastRow = sheet.getLastRow();
  var index = {};
  if (lastRow > 1) {
    var existing = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      index[rowKey_(header, existing[i])] = i + 2; // 1-based, after header
    }
  }

  var appended = 0;
  var updated = 0;
  var toInsert = [];
  for (var r = 0; r < rows.length; r++) {
    var values = header.map(function (col) {
      var v = rows[r][col];
      return v === undefined || v === null ? "" : v;
    });
    var key = rowKey_(header, values);
    if (index[key]) {
      sheet.getRange(index[key], 1, 1, header.length).setValues([values]);
      updated++;
    } else {
      toInsert.push(values);
      appended++;
    }
  }

  // Insert new rows directly under the header so latest data is on top.
  if (toInsert.length > 0) {
    sheet.insertRowsAfter(1, toInsert.length);
    sheet.getRange(2, 1, toInsert.length, header.length).setValues(toInsert);
  }

  sortNewestFirst_();
  trim_();
  return json_({ ok: true, appended: appended, updated: updated });
}

/** Sort data rows by date desc, then projectedImpactUsd desc. */
function sortNewestFirst_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 3) return;
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var dateCol = header.indexOf("date") + 1;
  var impactCol = header.indexOf("projectedImpactUsd") + 1;
  var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
  var specs = [];
  if (dateCol > 0) specs.push({ column: dateCol, ascending: false });
  if (impactCol > 0) specs.push({ column: impactCol, ascending: false });
  if (specs.length) range.sort(specs);
}

/** Trim to the retention cap (oldest rows fall off the bottom). */
function trim_() {
  var sheet = getSheet_();
  var cap = retention_();
  var dataRows = sheet.getLastRow() - 1;
  if (dataRows > cap) {
    sheet.deleteRows(cap + 2, dataRows - cap);
  }
}

/** Scheduled maintenance: re-sort + trim even when no push arrived. */
function dailyMaintenance() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sortNewestFirst_();
    trim_();
  } finally {
    lock.releaseLock();
  }
}

/** Run once to schedule dailyMaintenance at ~06:00. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "dailyMaintenance") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyMaintenance").timeBased().atHour(6).everyDays(1).create();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Comparison whose cost does not depend on the attacker-controlled input, so the
 * public web app's token check cannot leak the secret's length or a matching
 * prefix through response timing. `expected` is the server-held secret: we fold
 * the length difference into the accumulator and always scan exactly
 * `expected.length` chars (never the candidate's length), so a longer/shorter
 * guess can't change the loop's iteration count. (V8 offers no true constant-time
 * string primitive; this neutralizes the input-length and prefix-match signals,
 * which is the relevant threat for a network-facing token check.)
 */
function safeEqual_(candidate, expected) {
  var diff = candidate.length ^ expected.length;
  for (var i = 0; i < expected.length; i++) {
    diff |= (candidate.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
