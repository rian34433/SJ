/**
 * Google Apps Script — Surat Jalan Backend
 * Version: 2.2
 * Perbaikan: lock hasLock(), auth token, row gap, security token, performa
 *
 * PETUNJUK DEPLOY:
 * 1. Buka script.google.com, buat proyek baru, paste kode ini ke Code.gs
 * 2. Jalankan fungsi setup() sekali untuk inisialisasi sheet
 * 3. Deploy sebagai Web App → Execute as: Me, Who has access: Anyone
 * 4. Set token via menu Run → setAuthToken() dulu, baru deploy
 * 5. Copy URL Web App ke SCRIPT_URL di script.js
 */

// ============================================================
// KONFIGURASI — Edit sesuai kebutuhan
// ============================================================

const HEADERS = {
  R_STOCK: ['ID', 'NAMA', 'TANGGAL', 'NOTA', 'TEBAL', 'UKURAN', 'HARGA_BELI', 'HARGA_JUAL', 'MASUK', 'KELUAR', 'SISA'],
  STOCK: ['TEBAL', 'UKURAN', 'HARGA', 'MASUK', 'KELUAR', 'SISA'],
  LOG_SJ: ['ID', 'TIMESTAMP', 'TANGGAL', 'NO_SJ', 'NAMA_TOKO', 'ALIAS', 'ALAMAT', 'SUPIR', 'NO_KENDARAAN', 'JENIS_KACA', 'UKURAN', 'HARGA_BELI', 'HARGA_JUAL', 'BOX', 'LBR', 'GRAND_TOTAL', 'CONT', 'SEAL'],
  N_TOKO: ['NAMA', 'ALAMAT']
};

// --- TELEGRAM DEFAULT (fallback) ---
// Akan dipakai cuma kalo PropertiesService kosong.
// Setelah migrate, komen atau hapus 2 baris ini biar aman.
var _TG_TOKEN    = '8252191596:AAHWjsvQw-CEj6QEqGUgbO29hvEHjIdPgbE';
var _TG_CHAT_ID  = '928803181';
// ------------------------------------

// Nama properti di PropertiesService
var PROPS = PropertiesService.getScriptProperties();
var AUTH_TOKEN_KEY        = 'AUTH_TOKEN';
var TELEGRAM_BOT_TOKEN_KEY  = 'TELEGRAM_BOT_TOKEN';
var TELEGRAM_CHAT_ID_KEY    = 'TELEGRAM_CHAT_ID';

// Helper baca konfigurasi (PropertiesService dulu, fallback ke var)
function getTelegramToken()  { return PROPS.getProperty(TELEGRAM_BOT_TOKEN_KEY) || _TG_TOKEN || null; }
function getTelegramChatId() { return PROPS.getProperty(TELEGRAM_CHAT_ID_KEY)   || _TG_CHAT_ID || null; }
function getAuthToken()      { return PROPS.getProperty(AUTH_TOKEN_KEY); }

// ============================================================
// SETUP — Jalankan sekali dari editor
// ============================================================

/**
 * Migrasi token dari var hardcode ke PropertiesService.
 * Aman dipanggil berulang — cuma nulis kalo kosong.
 */
function migrateConfig() {
  if (!PROPS.getProperty(TELEGRAM_BOT_TOKEN_KEY) && _TG_TOKEN) {
    PROPS.setProperty(TELEGRAM_BOT_TOKEN_KEY, _TG_TOKEN);
    Logger.log('TELEGRAM_BOT_TOKEN migrated to PropertiesService');
  }
  if (!PROPS.getProperty(TELEGRAM_CHAT_ID_KEY) && _TG_CHAT_ID) {
    PROPS.setProperty(TELEGRAM_CHAT_ID_KEY, _TG_CHAT_ID);
    Logger.log('TELEGRAM_CHAT_ID migrated to PropertiesService');
  }
  if (!PROPS.getProperty(AUTH_TOKEN_KEY)) {
    Logger.log('⚠️ AUTH_TOKEN belum diset! Jalankan setAuthToken("password123") dari editor.');
  }
}

function setup() {
  migrateConfig();
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllSheets(doc);
  formatAllSheets(doc);
}

function setTelegramConfig() {
  // ↑↑↑ HAPUS parameter — tinggal Run dari dropdown aja ↑↑↑
  // Isi token bot Telegram Anda di baris bawah:
  var token = '8252191596:AAHWjsvQw-CEj6QEqGUgbO29hvEHjIdPgbE';   // <— GANTI kalo beda
  var chatId = '928803181';                                          // <— GANTI kalo beda

  if (!token || token === 'TOKEN_BOT_ANDA') throw new Error('Isi token dulu di baris 3 fungsi ini!');
  if (!chatId || chatId === 'CHAT_ID_ANDA') throw new Error('Isi chatId dulu di baris 4 fungsi ini!');

  PROPS.setProperty(TELEGRAM_BOT_TOKEN_KEY, token);
  PROPS.setProperty(TELEGRAM_CHAT_ID_KEY, chatId);
  Logger.log('✓ Telegram config saved to PropertiesService');
}

function setAuthToken() {
  // ↑↑↑ HAPUS parameter — tinggal Run dari dropdown aja ↑↑↑
  // Ganti password di baris bawah:
  var token = 'password123';   // <— GANTI terserah Anda

  if (!token || token.length < 6) throw new Error('Token minimal 6 karakter');
  PROPS.setProperty(AUTH_TOKEN_KEY, token);
  Logger.log('✓ Auth token disimpan. Kirim sbg ?token=' + token + ' di URL Web App.');
}

// ============================================================
// VALIDASI TOKEN — Proteksi endpoint
// ============================================================

function isAuthorized(e) {
  var expected = getAuthToken();
  if (!expected) return false; // token belum diset — blokir semua
  return e && e.parameter && e.parameter.token === expected;
}

function unauthorizedResponse() {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'error', message: 'Unauthorized' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function lockErrorResponse() {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'error', message: 'Server sibuk, coba lagi' })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// DO GET — Baca data
// ============================================================

function doGet(e) {
  if (!isAuthorized(e)) return unauthorizedResponse();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return lockErrorResponse();

  try {
    var action = e.parameter.action;
    var doc = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'get_stock') {
      var sheet = getSheetSafe(doc, 'R_STOCK');
      var data = getData(sheet);
      return jsonResponse({ status: 'success', data: data });
    } else if (action === 'get_logs') {
      var sheet = getSheetSafe(doc, 'LOG_SJ');
      var data = getData(sheet);
      return jsonResponse({ status: 'success', data: data });
    } else if (action === 'get_toko') {
      var sheet = getSheetSafe(doc, 'N_TOKO');
      var data = getData(sheet);
      return jsonResponse({ status: 'success', data: data });
    }

    return jsonResponse({ status: 'error', message: 'Invalid action' });

  } catch (e) {
    return jsonResponse({ status: 'error', message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getData(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  return rows.map(function(row) {
    var obj = {};
    headers.forEach(function(header, i) { obj[header] = row[i]; });
    return obj;
  }).filter(function(row) {
    // Skip baris kosong akibat row gap
    return headers.some(function(h) { return row[h] !== '' && row[h] !== undefined && row[h] !== null; });
  });
}

// ============================================================
// DO POST — Tulis data
// ============================================================

function doPost(e) {
  if (!isAuthorized(e)) return unauthorizedResponse();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return lockErrorResponse();

  try {
    var action = e.parameter.action;
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var postData = JSON.parse(e.postData.contents);

    if (action === 'sync_batch') {
      return handleSyncBatch(doc, postData);
    } else if (action === 'save_stock') {
      saveStockInternal(doc, postData.data);
      return jsonResponse({ status: 'success' });
    } else if (action === 'save_aggregated_stock') {
      saveAggregatedStockInternal(doc, postData.data);
      return jsonResponse({ status: 'success' });
    } else if (action === 'save_log') {
      saveLogInternal(doc, postData.data);
      return jsonResponse({ status: 'success' });
    } else if (action === 'save_toko') {
      saveTokoInternal(doc, postData.data);
      return jsonResponse({ status: 'success' });
    } else if (action === 'delete_stock_entries') {
      var ids = postData.ids;
      if (ids && Array.isArray(ids)) {
        var count = deleteStockEntriesInternal(doc, ids);
        return jsonResponse({ status: 'success', count: count });
      }
      return jsonResponse({ status: 'error', message: 'Invalid IDs' });
    } else if (action === 'clear_data') {
      return handleClearData(doc, postData.target);
    } else if (action === 'delete_log') {
      var id = postData.id;
      if (deleteLogInternal(doc, id)) {
        return jsonResponse({ status: 'success' });
      } else {
        return jsonResponse({ status: 'error', message: 'Log not found' });
      }
    }

    return jsonResponse({ status: 'error', message: 'Invalid action' });

  } catch (e) {
    return jsonResponse({ status: 'error', message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// HANDLERS
// ============================================================

function handleSyncBatch(doc, postData) {
  var mode = postData.mode || 'full';

  if (mode === 'incremental') {
    var stats = {};
    if (postData.stock) stats.stock = updateStockInternal(doc, postData.stock);
    if (postData.aggregatedStock) stats.aggregatedStock = updateAggregatedStockInternal(doc, postData.aggregatedStock);
    if (postData.logs) stats.logs = updateLogInternal(doc, postData.logs);
    if (postData.toko) stats.toko = updateTokoInternal(doc, postData.toko);

    // Format sekali di akhir, bukan tiap fungsi
    formatAllSheets(doc);

    var report = generateSyncReport(stats);
    sendTelegramMessage(report);
    Logger.log(report);
    return jsonResponse({ status: 'success', message: 'Batch incremental sync completed', report: report });
  }

  // Full sync
  if (postData.stock) saveStockInternal(doc, postData.stock);
  if (postData.aggregatedStock) saveAggregatedStockInternal(doc, postData.aggregatedStock);
  if (postData.logs) saveLogInternal(doc, postData.logs);
  if (postData.toko) saveTokoInternal(doc, postData.toko);
  formatAllSheets(doc);
  return jsonResponse({ status: 'success', message: 'Batch full sync completed' });
}

function handleClearData(doc, target) {
  if (target === 'logs') {
    var sheet = getSheetSafe(doc, 'LOG_SJ');
    clearSheetData(sheet);
    return jsonResponse({ status: 'success', message: 'LOG_SJ cleared' });
  } else if (target === 'stock') {
    ['R_STOCK', 'STOCK'].forEach(function(name) {
      var s = getSheetSafe(doc, name);
      clearSheetData(s);
    });
    return jsonResponse({ status: 'success', message: 'Stock cleared' });
  }
  return jsonResponse({ status: 'error', message: 'Unknown target: ' + target });
}

function clearSheetData(sheet) {
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
}

// ============================================================
// SAVE (full replacement)
// ============================================================

function saveStockInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'R_STOCK');
  clearSheetData(sheet);
  if (!data || data.length === 0) return;

  var rows = data.map(function(item) {
    return [
      item.id, item.nama, item.tanggal || '', item.nota,
      item.tebal, item.ukuran, item.harga, item.hargaJual,
      item.masuk, item.keluar, item.sisa
    ];
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function saveAggregatedStockInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'STOCK');
  clearSheetData(sheet);
  if (!data || data.length === 0) return;

  var rows = data.map(function(item) {
    return [item.tebal, item.ukuran, item.harga, item.masuk, item.keluar, item.sisa];
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function saveLogInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'LOG_SJ');
  clearSheetData(sheet);
  if (!data || data.length === 0) return;

  var rows = data.map(function(item) {
    return flattenLogRow(item);
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function saveTokoInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'N_TOKO');
  clearSheetData(sheet);
  if (!data || data.length === 0) return;

  var rows = data.map(function(item) { return [item.nama, item.alamat]; });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

// ============================================================
// UPDATE (incremental — update by ID, tambah baru)
// ============================================================

function updateStockInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'R_STOCK');
  var numCols = HEADERS.R_STOCK.length;

  var existing = readAllRows(sheet, numCols);
  var idMap = buildIdMap(existing);
  var added = 0, updated = 0;

  data.forEach(function(item) {
    var row = [
      item.id, item.nama, item.tanggal || '', item.nota,
      item.tebal, item.ukuran, item.harga, item.hargaJual,
      item.masuk, item.keluar, item.sisa
    ];
    var key = String(item.id);
    if (idMap.has(key)) {
      existing[idMap.get(key)] = row;
      updated++;
    } else {
      existing.push(row);
      added++;
    }
  });

  writeAllRows(sheet, existing, numCols);
  return { added: added, updated: updated, total: existing.length };
}

function updateAggregatedStockInternal(doc, data) {
  // Aggregated stock = full replace
  saveAggregatedStockInternal(doc, data);
  return { added: 0, updated: data ? data.length : 0, total: data ? data.length : 0 };
}

function updateLogInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'LOG_SJ');
  if (!data || !Array.isArray(data) || data.length === 0) {
    return { added: 0, updated: 0, total: 0 };
  }

  var numCols = HEADERS.LOG_SJ.length;
  var existing = readAllRows(sheet, numCols);
  var idMap = buildIdMap(existing);
  var added = 0, updated = 0;

  data.forEach(function(item) {
    var row = flattenLogRow(item);
    var key = String(item.id);
    if (idMap.has(key)) {
      existing[idMap.get(key)] = row;
      updated++;
    } else {
      existing.push(row);
      added++;
    }
  });

  writeAllRows(sheet, existing, numCols);
  return { added: added, updated: updated, total: existing.length };
}

function updateTokoInternal(doc, data) {
  var sheet = getSheetSafe(doc, 'N_TOKO');
  if (!data || !Array.isArray(data) || data.length === 0) {
    return { added: 0, updated: 0, total: 0 };
  }

  var existing = readAllRows(sheet, 2);
  var nameMap = new Map();
  existing.forEach(function(row, idx) {
    if (row[0]) nameMap.set(String(row[0]).toLowerCase(), idx);
  });

  var added = 0, updated = 0;
  data.forEach(function(item) {
    var row = [item.nama, item.alamat];
    var key = String(item.nama).toLowerCase();
    if (nameMap.has(key)) {
      existing[nameMap.get(key)] = row;
      updated++;
    } else {
      existing.push(row);
      added++;
    }
  });

  writeAllRows(sheet, existing, 2);
  return { added: added, updated: updated, total: existing.length };
}

// ============================================================
// DELETE
// ============================================================

function deleteLogInternal(doc, id) {
  var sheet = getSheetSafe(doc, 'LOG_SJ');
  if (!sheet || sheet.getLastRow() < 2) return false;

  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var target = String(id);

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === target) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function deleteStockEntriesInternal(doc, ids) {
  var sheet = getSheetSafe(doc, 'R_STOCK');
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var idsToDelete = new Set(ids.map(String));
  var lastRow = sheet.getLastRow();
  var numCols = sheet.getLastColumn();

  var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  var deletedCount = 0;

  var newValues = values.filter(function(row) {
    if (idsToDelete.has(String(row[0]))) {
      deletedCount++;
      return false;
    }
    return true;
  });

  if (deletedCount > 0) {
    // Hapus semua baris dulu
    if (lastRow - 1 > 0) {
      sheet.getRange(2, 1, lastRow - 1, numCols).clearContent();
    }
    // Tulis ulang data yg tersisa
    if (newValues.length > 0) {
      sheet.getRange(2, 1, newValues.length, numCols).setValues(newValues);
    }
  }

  return deletedCount;
}

// ============================================================
// HELPERS — Sheet & Data
// ============================================================

function getSheetSafe(doc, name) {
  var sheet = doc.getSheetByName(name);
  if (!sheet) sheet = doc.insertSheet(name);
  return sheet;
}

function ensureAllSheets(doc) {
  var names = Object.keys(HEADERS);
  names.forEach(function(name) { getSheetSafe(doc, name); });
}

/**
 * Baca semua baris data dari sheet (skip header).
 * Normalisasi ke numCols biar gak ada jagged array.
 */
function readAllRows(sheet, numCols) {
  if (sheet.getLastRow() < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), numCols);
  var raw = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  return raw.map(function(row) { return normalizeRow(row, numCols); });
}

/**
 * Tulis ulang seluruh data ke sheet.
 * Hapus baris lama, tulis baru — gak nyisain row gap.
 */
function writeAllRows(sheet, data, numCols) {
  setHeaders(sheet, numCols);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  if (data.length > 0) {
    var normalized = data.map(function(row) { return normalizeRow(row, numCols); });
    sheet.getRange(2, 1, normalized.length, numCols).setValues(normalized);
  }
}

function setHeaders(sheet, numCols) {
  // Cari nama sheet dari HEADERS
  var sheetName = sheet.getName();
  var headers = HEADERS[sheetName];
  if (headers) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function buildIdMap(rows) {
  var map = new Map();
  rows.forEach(function(row, idx) {
    if (row[0]) map.set(String(row[0]), idx);
  });
  return map;
}

function normalizeRow(row, targetLen) {
  if (row.length === targetLen) return row;
  if (row.length > targetLen) return row.slice(0, targetLen);

  var copy = row.slice();
  while (copy.length < targetLen) copy.push('');
  return copy;
}

// ============================================================
// HELPERS — Log flattening
// ============================================================

function flattenLogRow(item) {
  var d = item.data || {};

  var tanggal = d.tanggal || '';
  var noSJ = d.nomorSJ || '';
  var namaToko = d.namaToko || '';
  var alias = d.alias || '';
  var alamat = d.alamat || '';
  var supir = d.supir || '';
  var noKendaraan = d.noKendaraan || '';

  var jenisKaca = '', ukuran = '', hargaBeli = '', hargaJual = '';
  var box = '', lbr = '', grandTotal = '', cont = '', seal = '';

  var kacaData = d.kacaData || {};

  if (kacaData.rows && Array.isArray(kacaData.rows)) {
    jenisKaca = kacaData.rows.map(function(r) { return (r.jenisKaca || '') + (r.pwd ? ' ' + r.pwd : ''); }).join('\n');
    ukuran = kacaData.rows.map(function(r) { return r.ukuran || ''; }).join('\n');
    hargaBeli = kacaData.rows.map(function(r) { return r.hargaBeli || ''; }).join('\n');
    hargaJual = kacaData.rows.map(function(r) { return r.hargaJual || ''; }).join('\n');
    box = kacaData.rows.map(function(r) { return r.box || ''; }).join('\n');
    lbr = kacaData.rows.map(function(r) { return r.lbr || ''; }).join('\n');
    grandTotal = kacaData.footer ? (kacaData.footer.grandTotal || '') : '';
    cont = kacaData.footer ? (kacaData.footer.cont || '') : '';
    seal = kacaData.footer ? (kacaData.footer.seal || '') : '';
  } else if (d.items && Array.isArray(d.items)) {
    jenisKaca = d.items.map(function(i) { return i.jenis || i.tebal || ''; }).join('\n');
    ukuran = d.items.map(function(i) { return i.ukuran || ''; }).join('\n');
    hargaBeli = d.items.map(function(i) { return i.hargaBeli || ''; }).join('\n');
    hargaJual = d.items.map(function(i) { return i.harga || ''; }).join('\n');
    box = d.items.map(function(i) { return i.box || ''; }).join('\n');
    lbr = d.items.map(function(i) { return i.lbr || ''; }).join('\n');
    grandTotal = d.grandTotal || '';
    cont = d.cont || '';
    seal = d.seal || '';
  }

  return [
    item.id, item.timestamp,
    tanggal, noSJ, namaToko, alias, alamat, supir, noKendaraan,
    jenisKaca, ukuran, hargaBeli, hargaJual, box, lbr,
    grandTotal, cont, seal
  ];
}

// ============================================================
// FORMATTING — Panggil sekali di akhir batch
// ============================================================

function formatAllSheets(doc) {
  formatStockSheets(doc);
  formatLogSJSheet(doc);
  formatTokoSheet(doc);
}

function formatStockSheets(doc) {
  ['R_STOCK', 'STOCK'].forEach(function(sheetName) {
    var sheet = getSheetSafe(doc, sheetName);
    if (!sheet) return;

    ensureHeaders(sheet, sheetName);
    if (sheet.getLastColumn() < 1) return;

    styleHeader(sheet);
    sheet.setFrozenRows(1);

    if (sheet.getLastRow() > 1) {
      styleDataRange(sheet);
      if (sheetName === 'R_STOCK') {
        // Tanggal (col 3)
        sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy');
        // Angka (col 7-11)
        sheet.getRange(2, 7, sheet.getLastRow() - 1, 5).setNumberFormat('#,##0');
      } else if (sheetName === 'STOCK') {
        // Angka (col 3-6)
        sheet.getRange(2, 3, sheet.getLastRow() - 1, 4).setNumberFormat('#,##0');
      }
    }
  });
}

function formatLogSJSheet(doc) {
  var sheet = getSheetSafe(doc, 'LOG_SJ');
  if (!sheet) return;

  ensureHeaders(sheet, 'LOG_SJ');
  if (sheet.getLastColumn() < 1) return;

  styleHeader(sheet);
  sheet.setFrozenRows(1);

  if (sheet.getLastRow() > 1) {
    styleDataRange(sheet);

    // Tanggal (col 3)
    sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy');
    // Center: cols 1-4
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).setHorizontalAlignment('center');
    // Left: col 5
    sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).setHorizontalAlignment('left');
    // Right: cols 12-16
    sheet.getRange(2, 12, sheet.getLastRow() - 1, 5).setHorizontalAlignment('right');
  }
}

function formatTokoSheet(doc) {
  var sheet = getSheetSafe(doc, 'N_TOKO');
  if (!sheet) return;

  ensureHeaders(sheet, 'N_TOKO');
  if (sheet.getLastColumn() < 1) return;

  styleHeader(sheet);
  sheet.setFrozenRows(1);

  var fullRange = sheet.getDataRange();
  fullRange.setBorder(true, true, true, true, true, true, '#d9d9d9', SpreadsheetApp.BorderStyle.SOLID);
  fullRange.setFontFamily('Calibri').setFontSize(11);
  fullRange.setVerticalAlignment('middle');
}

function ensureHeaders(sheet, sheetName) {
  var h = HEADERS[sheetName];
  if (h) {
    sheet.getRange(1, 1, 1, h.length).setValues([h]);
  }
}

function styleHeader(sheet) {
  var r = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  r.setBackground('#4a86e8')
   .setFontColor('white')
   .setFontWeight('bold')
   .setHorizontalAlignment('center')
   .setVerticalAlignment('middle');
}

function styleDataRange(sheet) {
  var r = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
  r.setBorder(true, true, true, true, true, true, '#d9d9d9', SpreadsheetApp.BorderStyle.SOLID)
   .setFontFamily('Calibri')
   .setFontSize(11)
   .setVerticalAlignment('middle');
}

// ============================================================
// TELEGRAM NOTIFICATION
// ============================================================

function sendTelegramMessage(message) {
  var token = getTelegramToken();
  var chatId = getTelegramChatId();
  if (!token || !chatId) return;

  try {
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    var payload = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    };
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log('Telegram Error: ' + e.toString());
  }
}

// ============================================================
// SYNC REPORT
// ============================================================

function generateSyncReport(stats) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var date = Utilities.formatDate(now, tz, 'dd/MM/yy');
  var time = Utilities.formatDate(now, tz, 'HH:mm');
  var timestamp = '[' + date + '][' + time + '] SURAT JALAN:';

  var lines = [];
  lines.push(timestamp);
  lines.push('');

  // LOG_SJ
  lines.push(formatLine('LOG_SJ',     formatStat(stats.logs, 'Data baru', 'diperbarui')));
  // STOCK (Aggregated)
  lines.push(formatLine('STOCK',      stats.aggregatedStock ? '✅ ' + stats.aggregatedStock.total + ' baris' : '⚠️ Tidak disinkronkan'));
  // R_STOCK
  lines.push(formatLine('R_STOCK',    formatStat(stats.stock, 'Transaksi baru', 'diperbarui')));
  // TOKO
  lines.push(formatLine('TOKO',       formatStat(stats.toko, 'Toko baru', 'diperbarui')));

  return lines.join('\n');
}

function formatStat(stat, labelNew, labelUpdated) {
  if (!stat) return '⚠️ Tidak disinkronkan';
  if (stat.added > 0 || stat.updated > 0) {
    return '✅ ' + stat.added + ' ' + labelNew + ', ' + stat.updated + ' ' + labelUpdated;
  }
  return '➖ Tidak ada perubahan data';
}

function formatLine(label, message) {
  // Padding label biar titik dua sejajar (label terpanjang = 8 chars)
  var padded = label;
  while (padded.length < 8) padded += ' ';
  return '<code>' + padded + '</code> : ' + message;
}

// ============================================================
// END
// ============================================================
