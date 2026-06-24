"use strict";
// ===== SURAT JALAN JS =====
// ===== PERFORMANCE: Production DEBUG flag + DOM Cache + Utilities =====
let DEBUG = (localStorage && localStorage.getItem('DEBUG_MODE') === 'true') || false;

// --- DOM Cache: hindari querySelector berulang ---
const _dom = {};
function $(id) {
  if (!_dom[id]) {
    const el = document.getElementById(id);
    if (el) _dom[id] = el;
  }
  return _dom[id];
}
function $$(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

// --- Smart console: skip evaluation of args saat production ---
(function initDebug() {
  if (!DEBUG) {
    const _noop = function(){};
    window._log = _noop;
    window._debug = _noop;
    window._info = _noop;
    console.log = _noop;
    console.debug = _noop;
    console.info = _noop;
  } else {
    window._log = console.log.bind(console, '[LOG]');
    window._debug = console.debug.bind(console, '[DEBUG]');
    window._info = console.info.bind(console, '[INFO]');
  }

  // Sync checkbox state after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncDebugCheckbox);
  } else {
    syncDebugCheckbox();
  }
})();

function toggleDebugMode() {
  DEBUG = !DEBUG;
  localStorage.setItem('DEBUG_MODE', DEBUG);

  // Re-init stubs tanpa reload
  if (DEBUG) {
    window._log = console.debug.bind(console, '[LOG]');
    window._debug = console.debug.bind(console, '[DEBUG]');
    window._info = console.info.bind(console, '[INFO]');
  } else {
    const _noop = function(){};
    window._log = _noop;
    window._debug = _noop;
    window._info = _noop;
  }

  // Sync checkbox
  syncDebugCheckbox();

  // Show status biar user tau berubah
  showStatus('DEBUG ' + (DEBUG ? 'ON' : 'OFF'), 'saving');
  setTimeout(() => {
    const sb = document.getElementById('statusBar');
    if (sb) sb.style.display = 'none';
  }, 2000);
}

function syncDebugCheckbox() {
  const cb = document.getElementById('debugCheckbox');
  if (cb) {
    cb.checked = DEBUG;
  }
}

// --- RAF-based style batching: kumpulkan perubahan style lalu flush per frame ---
const _styleBatch = [];
function _applyStyle(el, prop, val) {
  _styleBatch.push({ el, prop, val });
  if (_styleBatch.length === 1) {
    requestAnimationFrame(() => {
      for (let i = 0; i < _styleBatch.length; i++) {
        const s = _styleBatch[i];
        s.el.style[s.prop] = s.val;
      }
      _styleBatch.length = 0;
    });
  }
}
// ==============================================

// --- Render Scheduler: kumpulkan permintaan render, flush sekali per frame ---
const _renderQueue = new Set();
let _renderScheduled = false;
function _scheduleRender(fn) {
  _renderQueue.add(fn);
  if (!_renderScheduled) {
    _renderScheduled = true;
    requestAnimationFrame(() => {
      _renderScheduled = false;
      _renderQueue.forEach(f => { try { f(); } catch(_) {} });
      _renderQueue.clear();
    });
  }
}
// Render batch: panggil update functions hanya sekali per frame
let _needsStokTable = false, _needsTotalSisa = false;
let _needsNamaList = false, _needsJenisList = false, _needsUkuranList = false;
let _needsKacaSuggest = false;
function _batchRender() {
  if (_needsStokTable) { _needsStokTable = false; try { updateStokTable(true); } catch(_) {} }
  if (_needsTotalSisa) { _needsTotalSisa = false; try { updateTotalSisa(); } catch(_) {} }
  if (_needsNamaList) { _needsNamaList = false; try { updateNamaTokoList(); } catch(_) {} }
  if (_needsJenisList) { _needsJenisList = false; try { updateJenisKacaList(); } catch(_) {} }
  if (_needsUkuranList) { _needsUkuranList = false; try { updateUkuranKacaList(); } catch(_) {} }
  if (_needsKacaSuggest) { _needsKacaSuggest = false; try { updateKacaSuggestionsFromLogs(); } catch(_) {} }
}
function _markRender(flags) {
  // flags: bitmask — 1:stokTable, 2:totalSisa, 4:namaList, 8:jenisList, 16:ukuranList, 32:kacaSuggest
  if (flags & 1) _needsStokTable = true;
  if (flags & 2) _needsTotalSisa = true;
  if (flags & 4) _needsNamaList = true;
  if (flags & 8) _needsJenisList = true;
  if (flags & 16) _needsUkuranList = true;
  if (flags & 32) _needsKacaSuggest = true;
  _scheduleRender(_batchRender);
}
// ==============================================

        // Function to record stok transactions from surat jalan
        // Helper function to force update harga for a ukuran input
        function forceUpdateHargaForUkuran(ukuranInput) {
            if (!ukuranInput || !ukuranInput.value.trim()) return;
            
            // Respect lock mechanism
            if (ukuranInput.getAttribute('data-price-locked') === 'true') {
                _log('[Force Update] Skipped due to price lock');
                return;
            }
            
            const ukuranValue = ukuranInput.value.trim();
            _log(`[Force Update] Processing for value: "${ukuranValue}"`);
            
            const ukuranList = document.getElementById('datalistUkuran');
            if (!ukuranList) return;
            
            // Find all matching options
            const matchingOptions = Array.from(ukuranList.options).filter(opt => {
                const optValue = opt.value.trim();
                return optValue === ukuranValue;
            });
            
            if (matchingOptions.length > 0) {
                // FIRST: Check if current data-selected-harga is still valid
                // This preserves user's selection if it's still available
                const currentHarga = ukuranInput.getAttribute('data-selected-harga') || '';
                if (currentHarga) {
                    const matchingByDataHarga = matchingOptions.find(opt => {
                        const optHarga = opt.getAttribute('data-harga');
                        return optHarga === currentHarga;
                    });
                    if (matchingByDataHarga) {
                        // Current selection is still valid, keep it and return
                        _log('[Force Update] Current selection still valid, skipping update');
                        return;
                    }
                }
                
                // If current selection is not valid or not set, find the best match
                let selectedOption = null;
                
                // If multiple options, try to match by harga-jual
                if (matchingOptions.length > 1) {
                    const row = ukuranInput.closest('tr');
                    const hargaJualInput = row ? row.querySelector('.harga-jual') : null;
                    const currentHargaJual = hargaJualInput ? hargaJualInput.value.trim().replace(/[^\d]/g, '') : '';
                    
                    if (currentHargaJual) {
                        const matchingByHarga = matchingOptions.find(opt => {
                            const optHarga = opt.getAttribute('data-harga');
                            if (!optHarga) return false;
                            const hargaValues = optHarga.split(',').map(h => h.trim().replace(/[^\d]/g, ''));
                            return hargaValues.includes(currentHargaJual);
                        });
                        if (matchingByHarga) {
                            selectedOption = matchingByHarga;
                            _log('[Force Update] Matched by existing price value');
                        }
                    }
                    
                    // If still no match, try current data-selected-harga (even if not exact match)
                    if (!selectedOption && currentHarga) {
                        const matchingByDataHarga = matchingOptions.find(opt => {
                            const optHarga = opt.getAttribute('data-harga');
                            return optHarga === currentHarga;
                        });
                        if (matchingByDataHarga) {
                            selectedOption = matchingByDataHarga;
                             _log('[Force Update] Matched by previous selected price');
                        }
                    }
                }
                
                // If still no match, use first option
                if (!selectedOption) {
                    selectedOption = matchingOptions[0];
                    _log('[Force Update] Fallback to first match');
                }
                
                // Update data-selected-harga only if we found a different option
                const hargaAttr = selectedOption.getAttribute('data-harga');
                if (hargaAttr) {
                    _log(`[Force Update] Selected price: ${hargaAttr}`);
                    // Always update attributes
                    ukuranInput.setAttribute('data-selected-harga', hargaAttr);
                    const row = ukuranInput.closest('tr');
                    let hargaJualInput = null;
                    if (row) {
                        row.setAttribute('data-selected-harga', hargaAttr);
                        hargaJualInput = row.querySelector('.harga-jual');
                    }
                    
                    // Also update harga-jual placeholder if it exists
                    if (hargaJualInput) {
                        const hargaValues = hargaAttr.split(',').map(h => h.trim()).filter(h => h);
                        if (hargaValues.length > 0) {
                            const firstHarga = parseFloat(hargaValues[0]);
                            if (!isNaN(firstHarga) && firstHarga > 0) {
                                // Only update placeholder if field is empty
                                if (!hargaJualInput.value.trim()) {
                                    const newPlaceholder = `Rp ${firstHarga.toLocaleString('id-ID')}`;
                                    if (hargaJualInput.placeholder !== newPlaceholder) {
                                        hargaJualInput.placeholder = newPlaceholder;
                                        _log(`[Force Update] Updated placeholder to: ${newPlaceholder}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        async function recordStokTransactionsFromSuratJalan() {
            try {
                // Force update all harga before processing
                const allUkuranInputs = document.querySelectorAll('#kacaTableBody tr .ukuran');
                allUkuranInputs.forEach(ukuranInput => {
                    forceUpdateHargaForUkuran(ukuranInput);
                });
                
                // Get nama toko from input field
                const namaTokoInput = document.getElementById('namaToko');
                const namaToko = namaTokoInput ? namaTokoInput.value.trim() : '';
                
                if (!namaToko) {
                    console.warn('Nama toko tidak diisi, transaksi stok tidak dicatat');
                    return;
                }

                // Get nomor SJ from input field
                const nomorSJInput = document.getElementById('nomorSJ');
                const nomorSJ = nomorSJInput ? nomorSJInput.value.trim() : '';
                
                // Get date from input field
                const tanggalInput = document.getElementById('tanggal');
                const tanggalValue = tanggalInput ? tanggalInput.value : '';
                
                let formattedDate;
                if (tanggalValue) {
                    // If we have a date from input, use it
                    if (typeof formatDate === 'function') {
                        formattedDate = formatDate(tanggalValue);
                    } else {
                        // Manual formatting if formatDate not available
                        // Assume input type="date" returns YYYY-MM-DD
                        const parts = tanggalValue.split('-');
                        if (parts.length === 3) {
                            formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                        } else {
                            // Fallback to today if format unexpected
                            const today = new Date();
                            const day = String(today.getDate()).padStart(2, '0');
                            const month = String(today.getMonth() + 1).padStart(2, '0');
                            const year = today.getFullYear();
                            formattedDate = `${day}/${month}/${year}`;
                        }
                    }
                } else {
                    // Fallback to today if no input
                    const today = new Date();
                    if (typeof formatDate === 'function') {
                        formattedDate = formatDate(today.toISOString().split('T')[0]);
                    } else {
                        const day = String(today.getDate()).padStart(2, '0');
                        const month = String(today.getMonth() + 1).padStart(2, '0');
                        const year = today.getFullYear();
                        formattedDate = `${day}/${month}/${year}`;
                    }
                }
                
                // Ensure stokData is loaded FIRST before checking for old transactions
                if (typeof window.stokData === 'undefined' || !Array.isArray(window.stokData)) {
                    // Try to load data if loadData function exists
                    if (typeof loadData === 'function') {
                        await loadData();
                    } else {
                        window.stokData = [];
                    }
                }
                
                // IDENTIFY EXISTING TRANSACTIONS (Improved Logic: Match by ID, fallback to Nota only if needed)
                const currentLogEntryId = lastLogEntryId;
                const originalNomorSJ = originalNomorSJForDeletion || (editingLogEntry && editingLogEntry.entry ? editingLogEntry.entry.data?.nomorSJ || '' : '');
                
                let existingTransactions = [];
                
                if (currentLogEntryId) {
                    // Find existing transactions for this log ID
                    existingTransactions = window.stokData.filter(entry => entry.logEntryId === currentLogEntryId);
                    
                    // Fallback: If no transactions found by logEntryId, try by originalNomorSJ (legacy data)
                    if (existingTransactions.length === 0 && originalNomorSJ) {
                        existingTransactions = window.stokData.filter(entry => {
                            const entryNota = entry.nota ? entry.nota.trim() : '';
                            const targetNota = originalNomorSJ.trim();
                            return entryNota === targetNota && !entry.logEntryId; 
                        });
                        _log(`Legacy fallback: Found ${existingTransactions.length} transactions by nota ${originalNomorSJ}`);
                    } else {
                        _log(`Found ${existingTransactions.length} existing transactions for log ${currentLogEntryId}`);
                    }
                } else if (originalNomorSJ) {
                    // This block is for cases where lastLogEntryId might be missing
                    existingTransactions = window.stokData.filter(entry => {
                        const entryNota = entry.nota ? entry.nota.trim() : '';
                        const targetNota = originalNomorSJ.trim();
                        return entryNota === targetNota && !entry.logEntryId; 
                    });
                    _log(`Found ${existingTransactions.length} existing transactions for nota ${originalNomorSJ}`);
                }
                
                // Sort by ID to ensure consistent index-based fallback if needed
                existingTransactions.sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
                
                // Clear originalNomorSJForDeletion after use
                originalNomorSJForDeletion = null;
                
                // Get all kaca rows
                const kacaRows = document.querySelectorAll('#kacaTableBody tr');
                const transactionsToSave = [];
                const processedIds = new Set();
                
                // Process each row from the form
                for (let index = 0; index < kacaRows.length; index++) {
                    const row = kacaRows[index];
                    // Cache querySelector results for better performance
                    const jenisKacaInput = row.querySelector('.jenis-kaca');
                    const ukuranInput = row.querySelector('.ukuran');
                    const hargaJualInput = row.querySelector('.harga-jual');
                    const totalLbrInput = row.querySelector('input.total-lbr-input');
                    
                    const jenisKaca = jenisKacaInput?.value?.trim() || '';
                    const ukuran = ukuranInput?.value?.trim() || '';
                    const hargaJualValue = hargaJualInput?.value?.trim() || '';
                    const totalLbrValue = totalLbrInput?.value?.trim() || '';
                    
                    // Skip if no jenis kaca or ukuran
                    if (!jenisKaca || !ukuran) continue;
                    
                    // Parse total LBR
                    let totalLbr = 0;
                    if (totalLbrValue) {
                        const match = totalLbrValue.match(/^(\d+(?:\.\d+)?)/);
                        if (match) {
                            totalLbr = parseFloat(match[1]);
                        }
                    }
                    
                    // Skip if total LBR is 0 or invalid
                    if (!totalLbr || totalLbr <= 0) continue;
                    
                    // Parse harga jual
                    let hargaJual = 0;
                    if (hargaJualValue) {
                        const hargaMatch = hargaJualValue.toString().replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
                        hargaJual = parseFloat(hargaMatch) || 0;
                    }
                    
                    // Get harga beli from stok data (if available)
                    let hargaBeli = 0;
                    if (ukuranInput) {
                        forceUpdateHargaForUkuran(ukuranInput);
                    }
                    const selectedHarga = ukuranInput ? ukuranInput.getAttribute('data-selected-harga') : null;
                    
                    if (selectedHarga) {
                        const hargaValues = selectedHarga.split(',').map(h => parseFloat(h.trim())).filter(h => !isNaN(h) && h > 0);
                        if (hargaValues.length > 0) {
                            hargaBeli = hargaValues[0];
                        }
                    }
                    
                    if (selectedHarga && window.stokData && window.stokData.length > 0) {
                        const hargaValues = selectedHarga.split(',').map(h => parseFloat(h.trim())).filter(h => !isNaN(h) && h > 0);
                        if (hargaValues.length > 0) {
                            const targetHarga = hargaValues[0];
                            const matchingStok = window.stokData.find(entry => 
                                entry.tebal === jenisKaca && 
                                entry.ukuran === ukuran &&
                                entry.harga === targetHarga &&
                                entry.masuk > 0
                            );
                            if (matchingStok && matchingStok.harga) {
                                hargaBeli = matchingStok.harga;
                            }
                        }
                    } else if (!hargaBeli && window.stokData && window.stokData.length > 0) {
                        const matchingStok = window.stokData.find(entry => 
                            entry.tebal === jenisKaca && 
                            entry.ukuran === ukuran &&
                            entry.masuk > 0
                        );
                        if (matchingStok && matchingStok.harga) {
                            hargaBeli = matchingStok.harga;
                        }
                    }
                    
                    const notaValue = nomorSJ || `SJ-${formattedDate.replace(/\//g, '')}-${index + 1}`;
                    
                    // Determine ID: Match by data-transaction-id if available
                    let transactionId = null;
                    let existingEntry = null;
                    let isUpdate = false;
                    
                    const rowTransactionId = row.getAttribute('data-transaction-id');
                    if (rowTransactionId) {
                        // Priority 1: Match by ID stored in row
                        existingEntry = existingTransactions.find(t => String(t.id) === String(rowTransactionId));
                        if (existingEntry) {
                            transactionId = existingEntry.id;
                            isUpdate = true;
                        }
                    } 
                    
                    if (!isUpdate && index < existingTransactions.length) {
                        // Priority 2: Fallback to index-based match for legacy rows without stored ID
                        existingEntry = existingTransactions[index];
                        transactionId = existingEntry.id;
                        isUpdate = true;
                    }
                    
                    if (!isUpdate) {
                        // Priority 3: New transaction — use UUID to avoid collision
                        transactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                            ? crypto.randomUUID()
                            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + index);
                    }
                    
                    // Update row with transaction ID so it can be used for subsequent saves/edits
                    row.setAttribute('data-transaction-id', transactionId);
                    
                    // Create transaction entry
                    const transaction = {
                        id: transactionId,
                        nama: namaToko,
                        tanggal: formattedDate,
                        nota: notaValue,
                        tebal: jenisKaca,
                        ukuran: ukuran,
                        harga: hargaBeli > 0 ? hargaBeli : undefined,
                        hargaJual: hargaJual > 0 ? hargaJual : undefined,
                        masuk: 0,
                        keluar: totalLbr,
                        logEntryId: lastLogEntryId || null,
                        lastModified: new Date().toISOString()
                    };
                    
                    // Add history if updating
                    if (isUpdate && existingEntry) {
                        const history = existingEntry.history || [];
                        const changes = [];
                        
                        if (existingEntry.tebal !== transaction.tebal) changes.push(`tebal: ${existingEntry.tebal} -> ${transaction.tebal}`);
                        if (existingEntry.ukuran !== transaction.ukuran) changes.push(`ukuran: ${existingEntry.ukuran} -> ${transaction.ukuran}`);
                        if (existingEntry.keluar !== transaction.keluar) changes.push(`keluar: ${existingEntry.keluar} -> ${transaction.keluar}`);
                        if (existingEntry.hargaJual !== transaction.hargaJual) changes.push(`hargaJual: ${existingEntry.hargaJual} -> ${transaction.hargaJual}`);
                        
                        if (changes.length > 0) {
                            history.push({
                                date: new Date().toISOString(),
                                action: 'update',
                                changes: changes.join(', ')
                            });
                            transaction.history = history;
                        } else {
                            transaction.history = history; // Preserve history
                        }
                    } else {
                        transaction.history = [{ date: new Date().toISOString(), action: 'created' }];
                    }
                    
                    transactionsToSave.push({ data: transaction, isUpdate: isUpdate });
                    processedIds.add(transactionId);
                }
                
                // SAVE (Update or Insert)
                if (transactionsToSave.length > 0) {
                    for (const item of transactionsToSave) {
                        const transaction = item.data;
                        try {
                            if (item.isUpdate) {
                                // Update existing
                                const idx = window.stokData.findIndex(e => e.id === transaction.id);
                                if (idx !== -1) window.stokData[idx] = transaction;
                                
                                if (typeof updateEntry === 'function') {
                                    await updateEntry(transaction);
                                }
                                _log(`Updated transaction ID ${transaction.id}`);
                            } else {
                                // Add new
                                if (Array.isArray(window.stokData)) {
                                    window.stokData.unshift(transaction);
                                }
                                
                                if (typeof addEntry === 'function') {
                                    await addEntry(transaction);
                                }
                                _log(`Created transaction ID ${transaction.id}`);
                            }
                        } catch (error) {
                            console.error('Error saving transaction:', transaction, error);
                        }
                    }
                }
                
                // DELETE EXTRA (Existing transactions that are no longer in the form)
                const transactionsToDelete = existingTransactions.filter(t => !processedIds.has(t.id));
                if (transactionsToDelete.length > 0) {
                    _log(`Deleting ${transactionsToDelete.length} extra transactions (items removed from form)`);
                    for (const transaction of transactionsToDelete) {
                        try {
                            let deleteFunc = null;
                            if (typeof window.deleteEntryFromDB === 'function') deleteFunc = window.deleteEntryFromDB;
                            else if (typeof deleteEntryFromDB === 'function') deleteFunc = deleteEntryFromDB;
                            
                            if (deleteFunc) await deleteFunc(transaction.id);
                            
                            const index = window.stokData.findIndex(e => e.id === transaction.id);
                            if (index !== -1) window.stokData.splice(index, 1);
                            
                        } catch (error) {
                            console.error(`Error deleting transaction ID ${transaction.id}:`, error);
                        }
                    }
                }
                    
                // Sync stokData local variable with window.stokData
                if (typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
                    if (typeof stokData !== 'undefined') {
                        // Update local stokData to match window.stokData (hindari spread penuh)
                        stokData = window.stokData;
                    }
                }
                    
                // Invalidate cache after stokData mutation
                markStockCacheDirty();

                // Batch update UI — semua dalam satu frame
                _markRender(1|2|4|8|16);

                _log(`Processed ${transactionsToSave.length} stok transactions (Updated: ${transactionsToSave.filter(t => t.isUpdate).length}, Created: ${transactionsToSave.filter(t => !t.isUpdate).length})`);
                
            } catch (error) {
                console.error('Error recording stok transactions from surat jalan:', error);
            }
        }

        // Process stok transactions from imported log entries
        async function processStokFromImportedLogs(importedEntries) {
            try {
                if (!importedEntries || importedEntries.length === 0) {
                    return;
                }

                // Ensure stokData is loaded
                if (typeof window.stokData === 'undefined' || !Array.isArray(window.stokData)) {
                    if (typeof loadData === 'function') {
                        await loadData();
                    } else {
                        window.stokData = [];
                    }
                }

                const transactions = [];
                
                // Process each imported entry
                for (const entry of importedEntries) {
                    const entryData = entry.data || {};
                    const kacaData = entryData.kacaData || {};
                    const rows = Array.isArray(kacaData) ? kacaData : (kacaData.rows || []);
                    
                    if (!rows || rows.length === 0) continue;
                    
                    const namaToko = entryData.namaToko || '';
                    const nomorSJ = entryData.nomorSJ || '';
                    const tanggal = entryData.tanggal || '';
                    
                    if (!namaToko) continue;
                    
                    // Format date if needed
                    let formattedDate = tanggal;
                    if (tanggal && !tanggal.includes('/')) {
                        // Try to parse ISO date or other formats
                        try {
                            const dateObj = new Date(tanggal);
                            if (!isNaN(dateObj.getTime())) {
                                if (typeof formatDate === 'function') {
                                    formattedDate = formatDate(tanggal);
                                } else {
                                    const day = String(dateObj.getDate()).padStart(2, '0');
                                    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                                    const year = dateObj.getFullYear();
                                    formattedDate = `${day}/${month}/${year}`;
                                }
                            }
                        } catch (e) {
                            // Use original date if parsing fails
                        }
                    }
                    
                    // Process each kaca row
                    rows.forEach((row, index) => {
                        const jenisKaca = (row.jenisKaca || '').trim();
                        const ukuran = (row.ukuran || '').trim();
                        const totalLbr = parseFloat(row.totalLbr) || 0;
                        const hargaJual = parseFloat(row.hargaJual || row.harga || 0) || 0;
                        
                        // Skip if no jenis kaca, ukuran, or totalLbr
                        if (!jenisKaca || !ukuran || !totalLbr || totalLbr <= 0) return;
                        
                        // Try to find harga beli from stok data
                        let hargaBeli = 0;
                        if (window.stokData && window.stokData.length > 0) {
                            const matchingStok = window.stokData.find(s => 
                                s.tebal === jenisKaca && 
                                s.ukuran === ukuran &&
                                s.masuk > 0
                            );
                            if (matchingStok && matchingStok.harga) {
                                hargaBeli = matchingStok.harga;
                            }
                        }
                        
                        // Use nomor SJ as nota, fallback to default format
                        const notaValue = nomorSJ || `SJ-${formattedDate.replace(/\//g, '')}-${index + 1}`;
                        
                        // Create transaction entry
                        const transaction = {
                            id: (typeof crypto !== 'undefined' && crypto.randomUUID)
                                ? crypto.randomUUID()
                                : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + index), // Unique ID
                            nama: namaToko,
                            tanggal: formattedDate,
                            nota: notaValue,
                            tebal: jenisKaca,
                            ukuran: ukuran,
                            harga: hargaBeli > 0 ? hargaBeli : undefined,
                            hargaJual: hargaJual > 0 ? hargaJual : undefined,
                            masuk: 0,
                            keluar: totalLbr,
                            logEntryId: entry.id || null // Link to log entry
                        };
                        
                        transactions.push(transaction);
                    });
                }
                
                // Record all transactions
                if (transactions.length > 0) {
                    // Add each transaction to stokData and IndexedDB
                    for (const transaction of transactions) {
                        try {
                            // Check if transaction already exists
                            // First check by logEntryId (most precise)
                            let existingIndex = -1;
                            if (transaction.logEntryId) {
                                existingIndex = window.stokData.findIndex(t => 
                                    t.logEntryId === transaction.logEntryId && 
                                    t.tebal === transaction.tebal &&
                                    t.ukuran === transaction.ukuran
                                );
                            }
                            
                            // If not found by logEntryId, check by nota, tanggal, nama, tebal, ukuran (for old data without logEntryId)
                            if (existingIndex === -1) {
                                existingIndex = window.stokData.findIndex(t => 
                                    !t.logEntryId && // Only match old entries without logEntryId
                                    t.nota === transaction.nota &&
                                    t.tanggal === transaction.tanggal &&
                                    t.nama === transaction.nama &&
                                    t.tebal === transaction.tebal &&
                                    t.ukuran === transaction.ukuran &&
                                    t.keluar === transaction.keluar
                                );
                            }
                            
                            if (existingIndex === -1) {
                                // Add new transaction to stokData array
                                if (Array.isArray(window.stokData)) {
                                    window.stokData.unshift(transaction);
                                }
                                
                                // Add to IndexedDB if addEntry function is available
                                if (typeof addEntry === 'function') {
                                    await addEntry(transaction);
                                }
                            } else {
                                // Update existing transaction (preserve original ID)
                                const existingId = window.stokData[existingIndex].id;
                                transaction.id = existingId;
                                window.stokData[existingIndex] = transaction;
                                if (typeof updateEntry === 'function') {
                                    await updateEntry(transaction);
                                }
                            }
                        } catch (error) {
                            console.error('Error recording transaction from imported log:', transaction, error);
                        }
                    }
                    
                    // Sync stokData local variable with window.stokData
                    if (typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
                        if (typeof stokData !== 'undefined') {
                            stokData = window.stokData;
                        }
                    }
                    
                    // Invalidate cache after stokData mutation
                    markStockCacheDirty();

                    // Batch update UI
                    _markRender(1|2|4|8|16);

                    _log(`✅ Processed ${transactions.length} stok transactions from ${importedEntries.length} imported log entries`);
                }
            } catch (error) {
                console.error('Error processing stok from imported logs:', error);
            }
        }

        // Quick print from header (uses current print settings, opens modal silently to generate data, then prints)
        function handleQuickPrint() {
            // Quick print — langsung print tanpa menampilkan modal print setting
            try {
                loadFontSizePreference();
                loadFontWeightPreference();
                loadFontFamilyPreference();
                loadColumnSpacingFromStorage();
                // Siapkan data print tanpa modal
                refreshPrintDataDirect();
                // Auto-save log sebelum print
                saveCurrentInputToLog();
                // Langsung print via iframe tersembunyi
                printNow();
                // Sync latar belakang
                if (typeof syncManager !== 'undefined') {
                    setTimeout(function() {
                        syncManager.syncAll().catch(function() {});
                    }, 500);
                }
            } catch (e) {
                console.error('Quick print error:', e);
                showPrintModal();
            }
        }
        // Utilitas database toko bersama untuk autocomplete dan auto-fill
        function buildTokoMapFromArray(arrayOfToko) {
            const nameToAddress = {};
            if (Array.isArray(arrayOfToko)) {
                arrayOfToko.forEach(entry => {
                    if (entry && entry.nama) {
                        nameToAddress[entry.nama.toLowerCase()] = entry.alamat || '';
                    }
                });
            }
            return nameToAddress;
        }

        function getDatabaseToko() {
            let map = {};
            try {
                const saved = storageManager.load('databaseToko');
                if (saved && typeof saved === 'object') {
                    map = saved;
                }
            } catch (_) {}
            // Hanya gunakan data dari storage tanpa default bawaan
            return map;
        }

        // Tidak lagi memaksa sync dari seed; gunakan storage manager
        function persistDatabaseTokoFromLengkap() {
            try {
                const map = buildTokoMapFromArray(databaseTokoLengkap);
                storageManager.save('databaseToko', map);
            } catch (_) {}
        }

        // Fungsi untuk mengisi alamat otomatis berdasarkan nama toko
        document.getElementById('namaToko').addEventListener('input', function() {
            const rawInput = this.value || '';
            const namaTokoLower = rawInput.toLowerCase();
            const alamatField = document.getElementById('alamat');
            const autocompleteDropdown = document.getElementById('autocompleteDropdown');
            
            // Tampilkan autocomplete jika ada input (case-insensitive, cari di nama/alamat)
            if (namaTokoLower.length > 0) {
                showAutocomplete(namaTokoLower);
            } else {
                hideAutocomplete();
            }
            
            // Auto-fill alamat berdasarkan data dari localStorage (map nama->alamat)
            const map = getDatabaseToko();
            const addressFromMap = map[namaTokoLower];
            if (addressFromMap) {
                alamatField.value = addressFromMap;
                alamatField.style.backgroundColor = '#f8f9fa';
                autoResizeTextarea(alamatField);
            } else {
                alamatField.value = '';
                alamatField.style.backgroundColor = '#fff';
                alamatField.style.height = '80px';
            }
        });

        // Fungsi untuk format tanggal Indonesia
        document.getElementById('tanggal').addEventListener('change', function() {
            const date = new Date(this.value);
            const options = { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            };
            
            // Format tanggal Indonesia
            const tanggalIndonesia = date.toLocaleDateString('id-ID', options);
            _log('Tanggal yang dipilih:', tanggalIndonesia);
        });

        // Format angka ke format ribuan saat diketik
        function formatRupiahInput(input) {
            // Hapus semua karakter selain angka
            let value = input.value.replace(/[^\d]/g, '');
            
            // Jika kosong, biarkan kosong
            if (!value) {
                input.value = '';
                return;
            }
            
            // Format ke ribuan
            input.value = new Intl.NumberFormat('id-ID').format(value);
        }

        // Helper untuk parse nilai rupiah kembali ke number
        function parseRupiah(value) {
            if (!value) return 0;
            return parseFloat(value.replace(/\./g, '').replace(/,/g, '.'));
        }

        // Handle form submission
        document.getElementById('tokoForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const namaToko = document.getElementById('namaToko').value;
            const alamat = document.getElementById('alamat').value;
            const tanggal = document.getElementById('tanggal').value;
            const nomorSJ = document.getElementById('nomorSJ').value;
            const supir = document.getElementById('supir').value;
            const noKendaraan = document.getElementById('noKendaraan').value;
            
            if (!namaToko || !tanggal || !nomorSJ || !supir || !noKendaraan) {
                alert('Mohon lengkapi semua field yang wajib diisi!');
                return;
            }
            
            // Format tanggal untuk output
            const date = new Date(tanggal);
            const options = { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            };
            const tanggalFormatted = date.toLocaleDateString('id-ID', options);
            
            // Output data
            const output = `
Data yang diinput:
Nama Toko: ${namaToko}
Alamat: ${alamat || 'Tidak ada alamat'}
Tanggal: ${tanggalFormatted}
No. SJ: ${nomorSJ}
Nama Supir: ${supir}
No. Kendaraan: ${noKendaraan}
            `;
            
            alert(output);
            _log(output);
        });

        // Set tanggal default ke hari ini
        document.getElementById('tanggal').valueAsDate = new Date();

        // Enhanced storage manager with multiple fallback options
        class StorageManager {
            constructor() {
                this.storageKey = 'sj_app_data';
                this.fallbackData = {};
            }
            
            // Try multiple storage methods in order of preference
            save(key, data) {
                try {
                    // Method 1: localStorage (preferred)
                    localStorage.setItem(key, JSON.stringify(data));
                    return true;
                } catch (e) {
                    console.warn(`⚠️ localStorage failed for ${key}, trying alternatives...`);
                    
                    try {
                        // Method 2: sessionStorage (fallback)
                        sessionStorage.setItem(key, JSON.stringify(data));
                        _log(`✅ Data saved to sessionStorage: ${key}`);
                        return true;
                    } catch (e2) {
                        console.warn(`⚠️ sessionStorage failed for ${key}, using memory fallback`);
                        
                        // Method 3: In-memory storage (last resort)
                        this.fallbackData[key] = data;
                        _log(`✅ Data saved to memory fallback: ${key}`);
                        return true;
                    }
                }
            }
            
            load(key) {
                try {
                    // Method 1: localStorage
                    const data = localStorage.getItem(key);
                    if (data) {
                        return JSON.parse(data);
                    }
                } catch (e) {
                    console.warn(`⚠️ localStorage read failed for ${key}`);
                }
                
                try {
                    // Method 2: sessionStorage
                    const data = sessionStorage.getItem(key);
                    if (data) {
                        _log(`✅ Data loaded from sessionStorage: ${key}`);
                        return JSON.parse(data);
                    }
                } catch (e) {
                    console.warn(`⚠️ sessionStorage read failed for ${key}`);
                }
                
                // Method 3: In-memory fallback
                if (this.fallbackData[key]) {
                    _log(`✅ Data loaded from memory fallback: ${key}`);
                    return this.fallbackData[key];
                }
                
                _log(`ℹ️ No data found for key: ${key}`);
                return null;
            }
            
            // Export data for backup/download
            async exportData() {
                const allData = {};
                const keys = ['databaseToko', 'databaseTokoLengkap', 'printTextPositions', 
                             'inputLogHistory', 'lastNomorSJ', 'printFontSize', 'printFontFamily', 
                             'printFontWeight', 'printColumnSpacing', 'columnSpacingConfig',
                             'isPriceGroupingEnabled'];
                
                keys.forEach(key => {
                    const data = this.load(key);
                    if (data !== null) {
                        allData[key] = data;
                    }
                });
                
                // Try to get inputLogHistory from IndexedDB if available (prioritize IndexedDB)
                try {
                    // Try to access IndexedDB directly
                    const idbLogHistory = await new Promise((resolve, reject) => {
                        try {
                            const req = window.indexedDB.open('sj-logs-db', 1);
                            req.onsuccess = () => {
                                const db = req.result;
                                const tx = db.transaction('kv', 'readonly');
                                const store = tx.objectStore('kv');
                                const getReq = store.get('inputLogHistory');
                                getReq.onsuccess = () => {
                                    db.close();
                                    resolve(getReq.result ? getReq.result.value : undefined);
                                };
                                getReq.onerror = () => {
                                    db.close();
                                    reject(getReq.error);
                                };
                            };
                            req.onerror = () => reject(req.error);
                        } catch (e) {
                            reject(e);
                        }
                    });
                    
                    if (Array.isArray(idbLogHistory) && idbLogHistory.length > 0) {
                        allData['inputLogHistory'] = idbLogHistory;
                        _log('✅ Input log included in backup from IndexedDB:', idbLogHistory.length, 'entries');
                    } else if (allData['inputLogHistory'] && Array.isArray(allData['inputLogHistory'])) {
                        _log('✅ Input log included in backup from localStorage:', allData['inputLogHistory'].length, 'entries');
                    } else if (typeof window !== 'undefined' && window.inputLogHistory && Array.isArray(window.inputLogHistory)) {
                        allData['inputLogHistory'] = window.inputLogHistory;
                        _log('✅ Input log included in backup from window.inputLogHistory:', window.inputLogHistory.length, 'entries');
                    }
                } catch (e) {
                    console.warn('⚠️ Failed to export input log from IndexedDB, trying alternatives:', e);
                    // Fallback to localStorage or window variable
                    if (allData['inputLogHistory'] && Array.isArray(allData['inputLogHistory'])) {
                        _log('✅ Input log included in backup from localStorage:', allData['inputLogHistory'].length, 'entries');
                    } else if (typeof window !== 'undefined' && window.inputLogHistory && Array.isArray(window.inputLogHistory)) {
                        allData['inputLogHistory'] = window.inputLogHistory;
                        _log('✅ Input log included in backup from window.inputLogHistory:', window.inputLogHistory.length, 'entries');
                    }
                }
                
                // Export riwayat stok from IndexedDB
                try {
                    if (typeof window.loadData === 'function') {
                        const stokDataArray = await window.loadData();
                        if (Array.isArray(stokDataArray) && stokDataArray.length > 0) {
                            allData['stokData'] = stokDataArray;
                            _log('✅ Riwayat stok included in backup:', stokDataArray.length, 'entries');
                        }
                    } else if (typeof loadData === 'function') {
                        const stokDataArray = await loadData();
                        if (Array.isArray(stokDataArray) && stokDataArray.length > 0) {
                            allData['stokData'] = stokDataArray;
                            _log('✅ Riwayat stok included in backup:', stokDataArray.length, 'entries');
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ Failed to export riwayat stok:', e);
                }
                
                return JSON.stringify(allData, null, 2);
            }
            
            // Import data from backup
            async importData(jsonData) {
                try {
                    const data = JSON.parse(jsonData);
                    
                    // Import riwayat stok to IndexedDB if present
                    if (data.stokData && Array.isArray(data.stokData)) {
                        try {
                            const storeName = typeof STORE_NAME !== 'undefined' ? STORE_NAME : 'stokData';
                            
                            // Clear existing stokData first
                            const currentInitDB = window.initDB || (typeof initDB === 'function' ? initDB : null);
                            if (currentInitDB) {
                                await currentInitDB();
                                const currentDB = window.db || (typeof db !== 'undefined' ? db : null);
                                if (currentDB) {
                                    const transaction = currentDB.transaction([storeName], 'readwrite');
                                    const store = transaction.objectStore(storeName);
                                    await new Promise((resolve, reject) => {
                                        const clearRequest = store.clear();
                                        clearRequest.onsuccess = () => resolve();
                                        clearRequest.onerror = () => reject(clearRequest.error);
                                    });
                                    
                                    // Add all stokData entries using put to avoid ID conflicts
                                    for (const entry of data.stokData) {
                                        await new Promise((resolve, reject) => {
                                            const request = store.put(entry);
                                            request.onsuccess = () => resolve();
                                            request.onerror = () => reject(request.error);
                                        });
                                    }
                                    
                                    // Update global stokData array
                                    if (typeof window !== 'undefined') {
                                        window.stokData = data.stokData;
                                    }
                                    
                                    // Update tables if functions are available
                                    _markRender(1|2);

                                    _log('✅ Riwayat stok imported successfully:', data.stokData.length, 'entries');
                                }
                            } else if (typeof window.addEntry === 'function' || typeof addEntry === 'function') {
                                // Fallback: use addEntry function if available
                                const currentAddEntry = window.addEntry || addEntry;
                                for (const entry of data.stokData) {
                                    await currentAddEntry(entry);
                                }
                                
                                // Update global stokData array
                                if (typeof window !== 'undefined') {
                                    window.stokData = data.stokData;
                                }
                                
                                // Update tables if functions are available
                                _markRender(1|2);
                                _log('✅ Riwayat stok imported via addEntry:', data.stokData.length, 'entries');
                            }
                            
                            // Remove stokData from data object to avoid saving to localStorage
                            delete data.stokData;
                        } catch (e) {
                            console.warn('⚠️ Failed to import riwayat stok:', e);
                        }
                    }
                    
                    // Import other data to localStorage
                    Object.keys(data).forEach(key => {
                        this.save(key, data[key]);
                    });
                    
                    // Update inputLogHistory and render log if present
                    if (data.inputLogHistory && Array.isArray(data.inputLogHistory)) {
                        try {
                            // Save to IndexedDB if available
                            try {
                                const db = await new Promise((resolve, reject) => {
                                    const req = window.indexedDB.open('sj-logs-db', 1);
                                    req.onupgradeneeded = () => {
                                        const db = req.result;
                                        if (!db.objectStoreNames.contains('kv')) {
                                            db.createObjectStore('kv', { keyPath: 'key' });
                                        }
                                    };
                                    req.onsuccess = () => resolve(req.result);
                                    req.onerror = () => reject(req.error);
                                });
                                
                                await new Promise((resolve, reject) => {
                                    const tx = db.transaction('kv', 'readwrite');
                                    tx.oncomplete = resolve;
                                    tx.onerror = () => reject(tx.error);
                                    tx.objectStore('kv').put({ key: 'inputLogHistory', value: data.inputLogHistory });
                                });
                                db.close();
                                _log('✅ Input log saved to IndexedDB:', data.inputLogHistory.length, 'entries');
                            } catch (e) {
                                console.warn('⚠️ Failed to save input log to IndexedDB:', e);
                            }
                            
                            // Update global inputLogHistory variable
                            if (typeof window !== 'undefined') {
                                if (typeof inputLogHistory !== 'undefined') {
                                    inputLogHistory = data.inputLogHistory;
                                }
                                window.inputLogHistory = data.inputLogHistory;
                            }
                            
                            // Render the log
                            if (typeof renderInputLog === 'function') {
                                renderInputLog();
                                _log('✅ Input log rendered after restore');
                            }
                            
                            // Update suggestions
                            if (typeof updateKacaSuggestionsFromLogs === 'function') {
                                updateKacaSuggestionsFromLogs();
                            }
                            
                            // Update nomor SJ warning
                            if (typeof window.refreshNomorSJWarningNow === 'function') {
                                window.refreshNomorSJWarningNow();
                            }
                            
                            _log('✅ Input log imported and rendered:', data.inputLogHistory.length, 'entries');
                        } catch (e) {
                            console.warn('⚠️ Failed to render input log after restore:', e);
                        }
                    }
                    
                    // Update lastNomorSJ if present
                    if (data.lastNomorSJ !== undefined) {
                        try {
                            if (typeof window !== 'undefined' && typeof lastNomorSJ !== 'undefined') {
                                lastNomorSJ = data.lastNomorSJ;
                                window.lastNomorSJ = data.lastNomorSJ;
                            }
                        } catch (e) {
                            console.warn('⚠️ Failed to update lastNomorSJ:', e);
                        }
                    }
                    
                    _log('✅ Data imported successfully');
                    return true;
                } catch (e) {
                    console.error('❌ Failed to import data:', e);
                    return false;
                }
            }
        }
        
        // Initialize storage manager
        const storageManager = new StorageManager();

        let isPriceGroupingEnabled = storageManager.load('isPriceGroupingEnabled') !== null ? storageManager.load('isPriceGroupingEnabled') : true;

        function togglePriceGrouping() {
            isPriceGroupingEnabled = !isPriceGroupingEnabled;
            storageManager.save('isPriceGroupingEnabled', isPriceGroupingEnabled);
            updateToggleUI();
            _markRender(2);
        }

        function updateToggleUI() {
            const toggleBtn = document.getElementById('hargaToggle');
            if (toggleBtn) {
                if (isPriceGroupingEnabled) {
                    toggleBtn.style.color = 'white';
                    toggleBtn.title = "Perhitungan per Harga: AKTIF (Klik untuk gabungkan)";
                } else {
                    toggleBtn.style.color = 'black';
                    toggleBtn.title = "Perhitungan per Harga: NONAKTIF (Klik untuk pisahkan per harga)";
                }
            }
        }
        
        // Call updateToggleUI on initial load after DOM is ready
        document.addEventListener('DOMContentLoaded', () => {
            updateToggleUI();
        });
        
        // Backup and Restore functionality
        document.addEventListener('DOMContentLoaded', function() {
            const backupBtn = document.getElementById('backupBtn');
            const restoreBtn = document.getElementById('restoreBtn');
            const restoreFile = document.getElementById('restoreFile');
            
            if (backupBtn) {
                backupBtn.addEventListener('click', async function() {
                    try {
                        const data = await storageManager.exportData();
                        const blob = new Blob([data], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `SJ_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        
                        alert('✅ Data berhasil di-backup');
                    } catch (error) {
                        console.error('❌ Backup failed:', error);
                        alert('❌ Gagal melakukan backup data!');
                    }
                });
            }
            
            if (restoreBtn) {
                restoreBtn.addEventListener('click', function() {
                    restoreFile.click();
                });
            }
            
            if (restoreFile) {
                restoreFile.addEventListener('change', function(e) {
                    const file = e.target.files[0];
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = async function(e) {
                        try {
                            const success = await storageManager.importData(e.target.result);
                            if (success) {
                                alert('✅ Data berhasil di-restore');
                                location.reload();
                            } else {
                                alert('❌ Gagal melakukan restore data!');
                            }
                        } catch (error) {
                            console.error('❌ Restore failed:', error);
                            alert('❌ File backup tidak valid!');
                        }
                    };
                    reader.readAsText(file);
                });
            }
        });

        // Database toko lengkap dikelola via localStorage (tanpa seed bawaan)
        const databaseTokoLengkap = [];
        // Load dari storage dengan fallback
        (function loadDatabaseTokoLengkapFromStorage(){
            try {
                const saved = storageManager.load('databaseTokoLengkap');
                if (Array.isArray(saved) && saved.length > 0) {
                    databaseTokoLengkap.splice(0, databaseTokoLengkap.length, ...saved);
                    // Sinkronkan map autocomplete dari data yang di-load agar tanpa default bawaan
                    try { persistDatabaseTokoFromLengkap(); } catch (_) {}
                }
            } catch (_) {}
        })();

        function persistDatabaseTokoLengkapArray() {
            storageManager.save('databaseTokoLengkap', databaseTokoLengkap);
        }
        // Hapus inisialisasi otomatis dari seed; hanya gunakan data localStorage yang ada

        // Fungsi untuk menampilkan popup daftar toko
        function showTokoList() {
            const popup = document.getElementById('popupOverlay');
            const tokoList = document.getElementById('tokoList');
            
            // Generate daftar toko dari array yang tersimpan (di-load dari localStorage)
            tokoList.innerHTML = '';
            if (!Array.isArray(databaseTokoLengkap) || databaseTokoLengkap.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'no-results';
                empty.textContent = 'Belum ada toko yang tersedia';
                tokoList.appendChild(empty);
            } else {
                databaseTokoLengkap.forEach((toko, index) => {
                    const tokoItem = document.createElement('div');
                    tokoItem.className = 'toko-item';
                    tokoItem.innerHTML = `
                        <div class="toko-nama">🏪 ${escapeHtml(toko.nama)}</div>
                        <div class="toko-alamat">📍 ${escapeHtml(toko.alamat)}</div>
                        <div class="action-buttons">
                            <button class="btn-edit" onclick="editToko(${index})">✏️ Edit</button>
                            <button class="btn-delete" onclick="deleteToko(${index})">🗑️ Hapus</button>
                        </div>
                    `;
                    tokoList.appendChild(tokoItem);
                });
            }
            
            popup.style.display = 'flex';
            document.body.style.overflow = 'hidden'; // Prevent scrolling
        }

        // Fungsi untuk menyembunyikan popup
        function hideTokoList() {
            const popup = document.getElementById('popupOverlay');
            popup.style.display = 'none';
            document.body.style.overflow = 'auto'; // Restore scrolling
        }

        // Close popup when clicking outside
        document.getElementById('popupOverlay').addEventListener('click', function(e) {
            if (e.target === this) {
                hideTokoList();
            }
        });

        // Close popup with Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                hideTokoList();
                hideModal();
                hideQuickAddModal();
                hidePrintModal();
            }
            // Handle Ctrl+P or Cmd+P to trigger Print Sekarang
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                if (typeof handleQuickPrint === 'function') {
                    handleQuickPrint();
                }
            }
        });

        // Refresh page helper
        function refreshPage() {
            try {
                window.location.reload();
            } catch (_) {
                // Fallback: navigate to same URL
                window.location.href = window.location.href;
            }
        }

        // Fungsi untuk menampilkan modal tambah toko
        function showAddModal() {
            const modal = document.getElementById('modalOverlay');
            const modalTitle = document.getElementById('modalTitle');
            const saveBtn = document.getElementById('saveBtn');
            const editIndex = document.getElementById('editIndex');
            
            modalTitle.textContent = '➕ Tambah Toko Baru';
            saveBtn.textContent = 'Simpan';
            editIndex.value = '';
            
            // Reset form
            document.getElementById('modalNamaToko').value = '';
            document.getElementById('modalAlamat').value = '';
            
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        // Fungsi untuk menampilkan quick add modal
        function showQuickAddModal() {
            const modal = document.getElementById('quickAddModalOverlay');
            const modalContent = modal.querySelector('.modal.quick-add');

            // Reset form
            document.getElementById('quickAddNamaToko').value = '';
            document.getElementById('quickAddAlamat').value = '';

            // Reset ke tab pertama
            showQuickAddTab();

            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // Trigger open animation
            if (modalContent) {
                modalContent.classList.remove('modal-closing');
                modalContent.offsetHeight; // force reflow
                modalContent.classList.add('modal-open');
            }
        }

        // Fungsi untuk menampilkan tab tambah toko
        function showQuickAddTab() {
            const addTab = document.getElementById('quickAddTab');
            const listTab = document.getElementById('quickListTab');
            if (addTab) addTab.classList.add('active');
            if (listTab) listTab.classList.remove('active');
            // Update tab buttons safely tanpa bergantung pada event
            const buttons = Array.from(document.querySelectorAll('.tab-btn'));
            buttons.forEach(btn => btn.classList.remove('active'));
            const addBtn = buttons.find(b => /Tambah Baru/i.test(b.textContent || ''));
            if (addBtn) addBtn.classList.add('active');
        }

        // Fungsi untuk menampilkan tab daftar toko
        function showQuickListTab() {
            const addTab = document.getElementById('quickAddTab');
            const listTab = document.getElementById('quickListTab');
            if (addTab) addTab.classList.remove('active');
            if (listTab) listTab.classList.add('active');
            // Update tab buttons safely tanpa bergantung pada event
            const buttons = Array.from(document.querySelectorAll('.tab-btn'));
            buttons.forEach(btn => btn.classList.remove('active'));
            const listBtn = buttons.find(b => /Lihat Daftar/i.test(b.textContent || ''));
            if (listBtn) listBtn.classList.add('active');
            // Generate daftar toko
            generateQuickTokoList();
        }

        // Fungsi untuk menyembunyikan quick add modal
        function hideQuickAddModal() {
            const modal = document.getElementById('quickAddModalOverlay');
            const modalContent = modal.querySelector('.modal.quick-add');
            if (modalContent) {
                modalContent.classList.remove('modal-open');
                modalContent.classList.add('modal-closing');
                setTimeout(() => {
                    if (modalContent.classList.contains('modal-closing')) {
                        modal.style.display = 'none';
                        modalContent.classList.remove('modal-closing');
                        document.body.style.overflow = 'auto';
                    }
                }, 250);
            } else {
                modal.style.display = 'none';
                document.body.style.overflow = 'auto';
            }
        }

        // Fungsi untuk menampilkan modal edit toko
        function editToko(index) {
            const modal = document.getElementById('modalOverlay');
            const modalTitle = document.getElementById('modalTitle');
            const saveBtn = document.getElementById('saveBtn');
            const editIndex = document.getElementById('editIndex');
            const toko = databaseTokoLengkap[index];
            
            modalTitle.textContent = '✏️ Edit Toko';
            saveBtn.textContent = 'Update';
            editIndex.value = index;
            
            // Isi form dengan data yang ada
            document.getElementById('modalNamaToko').value = toko.nama;
            document.getElementById('modalAlamat').value = toko.alamat;
            
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        // Fungsi untuk menghapus toko
        function deleteToko(index) {
            if (confirm('Apakah Anda yakin ingin menghapus toko ini?')) {
                databaseTokoLengkap.splice(index, 1);
                // Sinkronkan database autocomplete dan daftar lengkap yang tersimpan
                persistDatabaseTokoFromLengkap();
                persistDatabaseTokoLengkapArray();
                
                // Refresh popup jika sedang terbuka
                if (document.getElementById('popupOverlay').style.display === 'flex') {
                    showTokoList();
                }
                // Refresh quick list tab jika sedang terbuka
                const quickModal = document.getElementById('quickAddModalOverlay');
                const quickListTab = document.getElementById('quickListTab');
                if (quickModal && quickModal.style.display === 'flex' && quickListTab && quickListTab.classList.contains('active')) {
                    generateQuickTokoList();
                }

                alert('Toko berhasil dihapus!');
            }
        }

        // Fungsi untuk menyembunyikan modal
        function hideModal() {
            const modal = document.getElementById('modalOverlay');
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }

        // Handle form modal submission
        document.getElementById('modalForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const namaToko = document.getElementById('modalNamaToko').value.trim();
            const alamat = document.getElementById('modalAlamat').value.trim();
            const editIndex = document.getElementById('editIndex').value;
            
            if (!namaToko || !alamat) {
                alert('Mohon lengkapi semua field!');
                return;
            }
            
            if (editIndex === '') {
                // Tambah toko baru
                const newToko = {
                    nama: namaToko,
                    alamat: alamat
                };
                
                databaseTokoLengkap.push(newToko);
                // Sinkronkan database autocomplete dan daftar lengkap yang tersimpan
                persistDatabaseTokoFromLengkap();
                persistDatabaseTokoLengkapArray();
                
                alert('Toko berhasil ditambahkan!');
            } else {
                // Edit toko yang ada
                const index = parseInt(editIndex, 10);
                const oldNama = databaseTokoLengkap[index].nama;
                
                // Update database lengkap
                databaseTokoLengkap[index] = {
                    nama: namaToko,
                    alamat: alamat
                };
                // Sinkronkan database autocomplete dan daftar lengkap yang tersimpan
                persistDatabaseTokoFromLengkap();
                persistDatabaseTokoLengkapArray();
                
                alert('Toko berhasil diupdate!');
            }
            
            hideModal();
            
            // Refresh popup jika sedang terbuka
            if (document.getElementById('popupOverlay').style.display === 'flex') {
                showTokoList();
            }

            // Refresh quick list tab jika sedang terbuka
            const quickModal = document.getElementById('quickAddModalOverlay');
            const quickListTab = document.getElementById('quickListTab');
            if (quickModal && quickModal.style.display === 'flex' && quickListTab && quickListTab.classList.contains('active')) {
                generateQuickTokoList();
            }
        });

        // Close modal when clicking outside
        document.getElementById('modalOverlay').addEventListener('click', function(e) {
            if (e.target === this) {
                hideModal();
            }
        });

        // Close quick add modal when clicking outside
        document.getElementById('quickAddModalOverlay').addEventListener('click', function(e) {
            if (e.target === this) {
                hideQuickAddModal();
            }
        });

        // Handle quick add form submission
        document.getElementById('quickAddForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Normalisasi: simpan Nama apa adanya (preserve case) untuk tampilan,
            // namun lakukan pencarian/duplikasi dengan lower-case key
            const namaInput = document.getElementById('quickAddNamaToko').value.trim();
            const alamatInput = document.getElementById('quickAddAlamat').value.trim();
            const namaKey = namaInput.toLowerCase();
            
            if (!namaInput || !alamatInput) {
                alert('Mohon lengkapi semua field yang wajib diisi!');
                return;
            }
            
            // Tambah toko baru
            const newToko = {
                nama: namaInput,
                alamat: alamatInput
            };
            
            // Cek duplikasi berdasarkan lower-case key
            const existingIndex = databaseTokoLengkap.findIndex(t => (t.nama || '').toLowerCase() === namaKey);
            if (existingIndex >= 0) {
                // Update yang lama untuk menjaga satu sumber truth
                databaseTokoLengkap[existingIndex] = newToko;
            } else {
                databaseTokoLengkap.push(newToko);
            }
            // Sinkronkan database autocomplete dan daftar lengkap yang tersimpan
            persistDatabaseTokoFromLengkap();
            persistDatabaseTokoLengkapArray();
            // Segarkan daftar cepat bila tab "Lihat Daftar" dibuka setelahnya
            try { generateQuickTokoList(); } catch (_) {}
            
            // Auto-fill form utama
            const alamatField = document.getElementById('alamat');
            document.getElementById('namaToko').value = namaInput;
            alamatField.value = alamatInput;
            alamatField.style.backgroundColor = '#f8f9fa';
            
            // Auto-resize textarea
            autoResizeTextarea(alamatField);
            
            alert('Toko berhasil ditambahkan dan form telah diisi otomatis!');
            hideQuickAddModal();
        });

        // Fungsi untuk auto-resize textarea
        function autoResizeTextarea(textarea) {
            // Reset height untuk mendapatkan scrollHeight yang akurat
            textarea.style.height = 'auto';
            
            // Set height berdasarkan konten
            const newHeight = Math.max(80, textarea.scrollHeight);
            textarea.style.height = newHeight + 'px';
        }

        // Fungsi untuk generate baris default tabel kaca
        // Removed generateDefaultKacaRows (not used anymore)

        // Global helper for caching datalist
        let _globalCachedUkuranList = null;
        function getGlobalUkuranList() {
            if (!_globalCachedUkuranList) {
                _globalCachedUkuranList = document.getElementById('datalistUkuran');
            }
            return _globalCachedUkuranList;
        }

        // Global function for update harga ukuran logic
        function updateHargaUkuranLogic(inputElement, forceUpdate = false, explicitSize = null, explicitPrice = null) {
            const originalValue = inputElement.value.trim();
            
            _log(`[Price Update] Processing update for value: "${originalValue}", force: ${forceUpdate}`);
            
            // Check for price suffix from unique options (e.g. "10x10 (Rp 5.000)")
            const priceMatch = originalValue.match(/(.*)\s+\(Rp\s+[\d\.,]+\)$/);
            let cleanValue = originalValue;
            let hasPriceSuffix = false;
            
            if (priceMatch) {
                cleanValue = priceMatch[1].trim();
                hasPriceSuffix = true;
                _log(`[Price Update] Detected price suffix. Clean value: "${cleanValue}"`);
            }

            const currentHarga = inputElement.getAttribute('data-selected-harga') || '';
            
            // Use passed explicit values or get from attributes
            const lockSize = explicitSize || inputElement.getAttribute('data-explicit-size');
            const lockPrice = explicitPrice || inputElement.getAttribute('data-explicit-price');
            
            // Get current harga from harga-jual input field for better matching
            const row = inputElement.closest('tr');
            const hargaJualInput = row ? row.querySelector('.harga-jual') : null;
            const currentHargaJual = hargaJualInput ? hargaJualInput.value.trim().replace(/[^\d]/g, '') : '';
            
            // State management on element
            const lastUkuranValue = inputElement._lastUkuranValue || '';
            const lastSelectedHarga = inputElement._lastSelectedHarga || '';
            
            // Update if value changed OR if harga might have changed (same ukuran, different harga)
            // Also force update if explicitly requested
            if (!forceUpdate && cleanValue === lastUkuranValue && cleanValue && currentHarga === lastSelectedHarga && !hasPriceSuffix) {
                _log('[Price Update] Skipping update - no changes detected');
                return;
            }
            
            // If user clears input, clear explicit locks
            if (!cleanValue) {
                inputElement.removeAttribute('data-explicit-size');
                inputElement.removeAttribute('data-explicit-price');
            }

            // Check if we have an explicit lock and the size hasn't changed
            // This ensures that if the user selected a specific price, we stick to it
            // even if the input value is just the size (without suffix)
            let lockedPrice = null;
            if (lockSize && lockPrice && cleanValue === lockSize) {
                 _log(`[Price Update] Using explicit lock for size "${lockSize}" with price "${lockPrice}"`);
                 lockedPrice = lockPrice;
                 // Ensure attributes are set if they were passed as args
                 if (explicitSize) inputElement.setAttribute('data-explicit-size', explicitSize);
                 if (explicitPrice) inputElement.setAttribute('data-explicit-price', explicitPrice);
            } else if (cleanValue !== lockSize && lockSize) {
                 // Size changed, clear lock
                 _log('[Price Update] Size changed, clearing explicit lock');
                 inputElement.removeAttribute('data-explicit-size');
                 inputElement.removeAttribute('data-explicit-price');
            }
            
            inputElement._lastUkuranValue = cleanValue;
            
            if (cleanValue) {
                const ukuranList = getGlobalUkuranList();
                if (ukuranList) {
                    // Find all matching options (same ukuran might have different harga)
                    const matchingOptions = Array.from(ukuranList.options).filter(opt => {
                        const optValue = opt.value.trim();
                        const optDisplay = opt.textContent.trim();
                        
                        // If input has suffix, we look for exact match first
                        if (hasPriceSuffix) {
                            return optValue === originalValue;
                        }
                        
                        // Otherwise match base value
                        // We need to handle options that might have suffixes
                        const optValueClean = optValue.replace(/\s+\(Rp\s+[\d\.,]+\)$/, '');
                        return optValueClean === cleanValue || optDisplay.startsWith(cleanValue);
                    });
                    
                    // If multiple options found, use smart matching
                    let selectedOption = null;
                    if (matchingOptions.length > 0) {
                        _log(`[Price Update] Found ${matchingOptions.length} matching options`);
                        
                        // PRIORITY 1: Explicit Locked Price
                        if (lockedPrice) {
                            selectedOption = matchingOptions.find(opt => {
                                const optHarga = opt.getAttribute('data-harga');
                                return optHarga === lockedPrice;
                            });
                            if (selectedOption) _log('[Price Update] Matched by explicit lock');
                        }

                        // PRIORITY 2: Exact string match (e.g. user typed suffix)
                        if (!selectedOption) {
                            selectedOption = matchingOptions.find(opt => {
                                const optValue = opt.value.trim();
                                return optValue === originalValue;
                            });
                        }
                        
                        // PRIORITY 3: Match clean value (size)
                        if (!selectedOption) {
                            // Filter options that match the clean size
                            const sizeMatches = matchingOptions.filter(opt => {
                                 const optValueClean = opt.value.trim().replace(/\s+\(Rp\s+[\d\.,]+\)$/, '');
                                 return optValueClean === cleanValue;
                            });

                            if (sizeMatches.length > 0) {
                                // If we have multiple prices for this size
                                if (sizeMatches.length > 1) {
                                    // Try to match with current harga-jual value if available
                                    if (currentHargaJual) {
                                        const matchingByHarga = sizeMatches.find(opt => {
                                            const optHarga = opt.getAttribute('data-harga');
                                            if (!optHarga) return false;
                                            const hargaValues = optHarga.split(',').map(h => h.trim().replace(/[^\d]/g, ''));
                                            return hargaValues.includes(currentHargaJual);
                                        });
                                        if (matchingByHarga) {
                                            selectedOption = matchingByHarga;
                                            _log('[Price Update] Matched by existing price value');
                                        }
                                    }
                                    
                                    // If no price match, default to the first one (or previous selection if valid)
                                    if (!selectedOption && currentHarga) {
                                         const matchingByDataHarga = sizeMatches.find(opt => opt.getAttribute('data-harga') === currentHarga);
                                         if (matchingByDataHarga) selectedOption = matchingByDataHarga;
                                    }
                                    
                                    if (!selectedOption) selectedOption = sizeMatches[0];
                                } else {
                                    selectedOption = sizeMatches[0];
                                }
                            }
                        }
                    }
                    
                    if (selectedOption) {
                        const hargaAttr = selectedOption.getAttribute('data-harga');
                        _log(`[Price Update] Selected price: ${hargaAttr}`);
                        
                        if (hargaAttr) {
                            // Always update attributes
                            inputElement.setAttribute('data-selected-harga', hargaAttr);
                            // Also save to row for easy access
                            if (row) {
                                row.setAttribute('data-selected-harga', hargaAttr);
                            }
                            inputElement._lastSelectedHarga = hargaAttr;

                            // SET EXPLICIT LOCK if we have a suffix or user is selecting or explicit lock was passed
                            // This ensures subsequent updates (e.g. blur) stick to this price
                            if (hasPriceSuffix || forceUpdate || explicitPrice) {
                                inputElement.setAttribute('data-explicit-size', cleanValue);
                                inputElement.setAttribute('data-explicit-price', hargaAttr);
                                _log(`[Price Update] Set explicit lock: Size=${cleanValue}, Price=${hargaAttr}`);
                            }
                            
                            // Also update harga-beli field with formatted value
                            const hargaBeliInput = row ? row.querySelector('.harga-beli') : null;
                            if (hargaBeliInput) {
                                // Check if harga beli is manually set (e.g. loaded from log)
                                // If so, do not overwrite it unless explicit permission given (which we don't really use for load)
                                // But here we want to respect the flag we set in loadKacaDataFromLog
                                if (hargaBeliInput.hasAttribute('data-manual-harga-beli')) {
                                    _log('[Price Update] Skipping harga-beli update due to manual protection flag');
                                } else {
                                    const hargaValues = hargaAttr.split(',').map(h => h.trim()).filter(h => h);
                                    if (hargaValues.length > 0) {
                                        const firstHarga = parseFloat(hargaValues[0]);
                                        if (!isNaN(firstHarga) && firstHarga > 0) {
                                            // Update harga beli field (read-only)
                                            const formattedPrice = firstHarga.toLocaleString('id-ID');
                                            if (hargaBeliInput.value !== formattedPrice) {
                                                const oldPrice = hargaBeliInput.value;
                                                hargaBeliInput.value = formattedPrice;
                                                _log(`[Price Update] Updated harga-beli to: ${formattedPrice}`);
                                                
                                                // Log price change
                                                if (typeof logPriceChange === 'function') {
                                                    logPriceChange(oldPrice, formattedPrice, 'system_update', cleanValue);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // Also update harga-jual field placeholder
                            if (hargaJualInput) {
                                const hargaValues = hargaAttr.split(',').map(h => h.trim()).filter(h => h);
                                if (hargaValues.length > 0) {
                                    const firstHarga = parseFloat(hargaValues[0]);
                                    if (!isNaN(firstHarga) && firstHarga > 0) {
                                        // Always update placeholder to reflect current selection
                                        const newPlaceholder = `Rp ${firstHarga.toLocaleString('id-ID')}`;
                                        if (hargaJualInput.placeholder !== newPlaceholder) {
                                            // Optional: Don't change placeholder of jual, keep it static "Jual" or suggestive?
                                            // User request: "Beri placeholder yang jelas (contoh: 'Harga Jual')"
                                            // So we should probably keep it static or suggestive.
                                            // Let's stick to user request "Harga Jual" (or just "Jual" as I put in HTML)
                                            // But maybe suggestive placeholder is better?
                                            // User said: "Beri placeholder yang jelas (contoh: "Harga Jual")"
                                            // So I will NOT override it with price.
                                            // hargaJualInput.placeholder = newPlaceholder; 
                                        }
                                    }
                                }
                            }
                            
                            // Clean input value if it had a suffix to show only size
                            if (hasPriceSuffix) {
                                inputElement.value = cleanValue;
                                // Update tracking to prevent loops if needed, though handled at start
                                if (inputElement._lastUkuranValue !== cleanValue) {
                                    inputElement._lastUkuranValue = cleanValue;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fungsi untuk menambah baris baru
        function addKacaRow() {
            try {
                const tbody = document.getElementById('kacaTableBody');
                if (!tbody) {
                    console.error('kacaTableBody element not found');
                    return;
                }
                
                const newRow = document.createElement('tr');
                newRow.classList.add('kaca-row-new');
                const rowId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + (Math.floor(Math.random() * 1000000)).toString(36));

                // Remove animation class after it plays so subsequent add always animates
                setTimeout(() => newRow.classList.remove('kaca-row-new'), 500);

                newRow.innerHTML = `
                    <td>
                        <input type="text" placeholder="Jenis Kaca" class="jenis-kaca" list="datalistJenisKaca" autocomplete="off" autocapitalize="none" spellcheck="false">
                    </td>
                    <td class="pwd-input">
                        <input type="text" placeholder="PWD" class="pwd" maxlength="3">
                    </td>
                    <td class="no-do-input">
                        <input type="text" placeholder="No DO" class="no-do">
                    </td>
                    <td>
                        <input type="text" placeholder="Ukuran" class="ukuran" list="datalistUkuran" autocomplete="off" autocapitalize="none" spellcheck="false">
                    </td>
                    <td class="harga-input">
                        <div class="harga-input-container">
                            <input type="text" placeholder="Beli" class="harga-beli" readonly tabindex="-1">
                            <input type="text" placeholder="Jual" class="harga-jual">
                        </div>
                    </td>
                    <td class="box-input">
                        <input type="text" placeholder="0 BOX" class="box">
                    </td>
                    <td class="lbr-input">
                        <input type="text" placeholder="0 LBR" class="lbr">
                    </td>
                    <td class="total-lbr">
                        <input type="text" placeholder="0 LBR" class="total-lbr-input" readonly>
                    </td>
                `;
                
                tbody.appendChild(newRow);
                
                // Update grand total setelah tambah baris
                setTimeout(() => {
                    updateGrandTotal();
                }, 100);
                
                // Trigger print data refresh if modal is open
                const printModal = document.getElementById('printModalOverlay');
                if (printModal && printModal.style.display === 'flex') {
                    setTimeout(() => {
                        if (typeof refreshPrintData === 'function') {
                            refreshPrintData();
                        }
                    }, 100);
                }
                
            } catch (error) {
                console.error('Error adding glass row:', error);
            }
        }

        // Fungsi untuk menghapus baris
        function removeKacaRow() {
            try {
                const tbody = document.getElementById('kacaTableBody');
                if (!tbody) {
                    console.error('kacaTableBody element not found');
                    return;
                }

                const rows = tbody.querySelectorAll('tr');

                if (rows.length > 1) {
                    const rowToRemove = rows[rows.length - 1];

                    // Animate out then remove
                    rowToRemove.classList.add('kaca-row-removing');
                    setTimeout(() => {
                        if (rowToRemove.parentNode) {
                            tbody.removeChild(rowToRemove);
                        }
                        updateGrandTotal();
                        // Trigger print data refresh if modal is open
                        const printModal = document.getElementById('printModalOverlay');
                        if (printModal && printModal.style.display === 'flex') {
                            if (typeof refreshPrintData === 'function') {
                                refreshPrintData();
                            }
                        }
                    }, 250);
                } else {
                    alert('Minimal harus ada 1 baris!');
                }
            } catch (error) {
                console.error('Error removing glass row:', error);
            }
        }

        // Fungsi untuk menghitung total LBR
        // Debounced updateGrandTotal for better performance (global cache)
        if (!window._debouncedUpdateGrandTotal) {
            window._debouncedUpdateGrandTotal = (function() {
                let timeout;
                return function() {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => {
                        updateGrandTotal();
                    }, 150);
                };
            })();
        }
        const debouncedUpdateGrandTotal = window._debouncedUpdateGrandTotal;
        
        // Cache printModal element for better performance (global cache)
        if (!window._getPrintModal) {
            let cachedPrintModal = null;
            window._getPrintModal = () => {
                if (!cachedPrintModal) {
                    cachedPrintModal = document.getElementById('printModalOverlay');
                }
                return cachedPrintModal;
            };
        }
        const getPrintModal = window._getPrintModal;
        
        function calculateTotalLbr(input) {
            try {
                if (!input) {
                    console.error('Input parameter is null or undefined');
                    return;
                }
                
                const row = input.closest('tr');
                if (!row) {
                    console.error('Row element not found');
                    return;
                }
                
                const boxInput = row.querySelector('input.box');
                const lbrInput = row.querySelector('input.lbr');
                const totalInput = row.querySelector('input.total-lbr-input');
                
                if (!boxInput || !lbrInput || !totalInput) {
                    console.error('Input elements not found:', { boxInput, lbrInput, totalInput });
                    return;
                }
                
                // Extract angka dari input BOX (misal: "2 BOX" -> 2)
                const boxValue = boxInput.value || '';
                const boxMatch = boxValue.trim().match(/^(\d+(?:\.\d+)?)/);
                const box = boxMatch ? parseFloat(boxMatch[1]) : 0;
                
                // Extract angka dari input LBR (misal: "100 LBR" -> 100)
                const lbrValue = lbrInput.value || '';
                const lbrMatch = lbrValue.trim().match(/^(\d+(?:\.\d+)?)/);
                const lbr = lbrMatch ? parseFloat(lbrMatch[1]) : 0;
                
                // Jika kolom BOX tidak diisi, maka TOTAL LBR = LBR
                // Jika kolom BOX diisi, maka TOTAL LBR = BOX * LBR
                const total = (box === 0 || !boxValue.trim()) ? lbr : box * lbr;
                
                // Format total dengan satuan LBR
                totalInput.value = Math.round(total) + " LBR";
                
                // Update grand total with debouncing for better performance
                debouncedUpdateGrandTotal();
                
                // Trigger print data refresh if modal is open (using cached element)
                const printModal = getPrintModal();
                if (printModal && printModal.style.display === 'flex') {
                    setTimeout(() => {
                        if (typeof refreshPrintData === 'function') {
                            refreshPrintData();
                        }
                    }, 100);
                }
            } catch (error) {
                console.error('Error calculating total LBR:', error);
            }
        }

        // Fungsi untuk menghitung total keseluruhan
        function calculateGrandTotal() {
            const totalInputs = document.querySelectorAll('input.total-lbr-input:not(.grand-total-input)');
            let grandTotal = 0;
            
            totalInputs.forEach(input => {
                // Extract angka dari format "100 LBR"
                const value = input.value;
                if (value !== undefined && value !== null) {
                    const trimmedValue = String(value).trim();
                    const match = trimmedValue.match(/^(\d+(?:\.\d+)?)/);
                    const number = match ? parseFloat(match[1]) : 0;
                    grandTotal += number;
                }
            });
            
            return grandTotal;
        }

        // Fungsi untuk update grand total
        // Cache grandTotalInput for better performance (global cache)
        if (!window._getGrandTotalInput) {
            let cachedGrandTotalInput = null;
            window._getGrandTotalInput = () => {
                if (!cachedGrandTotalInput) {
                    cachedGrandTotalInput = document.querySelector('.grand-total-input');
                }
                return cachedGrandTotalInput;
            };
        }
        const getGrandTotalInput = window._getGrandTotalInput;
        
        function updateGrandTotal() {
            try {
                const grandTotal = calculateGrandTotal();
                const grandTotalInput = getGrandTotalInput();
                
                if (grandTotalInput) {
                    grandTotalInput.value = grandTotal + " LBR";
                } else {
                    console.warn('Grand total input element not found');
                }
                
                // Trigger print data refresh if modal is open (using cached element)
                const printModal = getPrintModal();
                if (printModal && printModal.style.display === 'flex') {
                    setTimeout(() => {
                        if (typeof refreshPrintData === 'function') {
                            refreshPrintData();
                        }
                    }, 100);
                }
            } catch (error) {
                console.error('Error updating grand total:', error);
            }
        }

        // Event listener untuk input changes
        document.addEventListener('input', function(e) {
            if (e.target.classList.contains('box') || e.target.classList.contains('lbr')) {
                calculateTotalLbr(e.target);
            }
        });

        // Event listener untuk blur (ketika input kehilangan focus)
        document.addEventListener('blur', function(e) {
            if (e.target.classList.contains('box')) {
                autoAddBoxUnit(e.target);
            } else if (e.target.classList.contains('lbr')) {
                autoAddLbrUnit(e.target);
            }
        }, true);

        // ===== EVENT DELEGATION for kacaTable (menggantikan per-row listeners di addKacaRow) =====
        (function initKacaTableDelegation() {
            const tbody = document.getElementById('kacaTableBody');
            if (!tbody) return;

            // Global flag untuk mencegah update berantai pada ukuran input
            let _isSelectingFromDatalist = false;

            // Debounced helper untuk update harga
            const _debouncedUpdateHarga = (function() {
                let timeout;
                return function(input) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => {
                        updateHargaUkuranLogic(input, true);
                    }, 300);
                };
            })();

            // Focus: update dropdown berdasarkan jenis kaca atau dari logs
            tbody.addEventListener('focusin', function(e) {
                const target = e.target;

                // Jenis kaca → update suggestions
                if (target.classList.contains('jenis-kaca')) {
                    if (typeof updateKacaSuggestionsFromLogs === 'function') {
                        updateKacaSuggestionsFromLogs();
                    }
                    return;
                }

                // Ukuran → update dropdown berdasarkan jenis kaca di baris yang sama
                if (target.classList.contains('ukuran')) {
                    if (_isSelectingFromDatalist) return;

                    const row = target.closest('tr');
                    const jenisInput = row ? row.querySelector('input.jenis-kaca') : null;
                    const jenisValue = jenisInput ? jenisInput.value.trim() : '';
                    if (jenisValue && typeof updateUkuranByJenisKaca === 'function') {
                        updateUkuranByJenisKaca(jenisValue, target);
                    } else if (typeof updateKacaSuggestionsFromLogs === 'function') {
                        updateKacaSuggestionsFromLogs();
                    }
                }
            });

            // Change: trigger update harga, ukuran dropdown, hitung total
            tbody.addEventListener('change', function(e) {
                const target = e.target;

                // Jenis kaca berubah → update ukuran dropdown
                if (target.classList.contains('jenis-kaca')) {
                    const row = target.closest('tr');
                    const ukuranInput = row ? row.querySelector('input.ukuran') : null;
                    const jenisValue = target.value.trim();
                    if (ukuranInput && jenisValue && typeof updateUkuranByJenisKaca === 'function') {
                        updateUkuranByJenisKaca(jenisValue, ukuranInput);
                    }
                    return;
                }

                // Ukuran berubah → update harga
                if (target.classList.contains('ukuran')) {
                    _isSelectingFromDatalist = true;
                    updateHargaUkuranLogic(target, true);
                    setTimeout(() => { _isSelectingFromDatalist = false; }, 1000);
                    return;
                }

                // Box/Lbr/Harga-jual → hitung total
                if (target.classList.contains('box') || target.classList.contains('lbr') || target.classList.contains('harga-jual')) {
                    calculateTotalLbr(target);
                }
            });

            // Input: debounced update harga untuk ukuran, format rupiah, hitung total
            tbody.addEventListener('input', function(e) {
                const target = e.target;

                if (target.classList.contains('ukuran')) {
                    // Clear manual price protection when user changes size
                    const row = target.closest('tr');
                    const hargaBeliInput = row ? row.querySelector('.harga-beli') : null;
                    if (hargaBeliInput && hargaBeliInput.hasAttribute('data-manual-harga-beli')) {
                        hargaBeliInput.removeAttribute('data-manual-harga-beli');
                    }
                    _debouncedUpdateHarga(target);
                    return;
                }

                if (target.classList.contains('harga-jual')) {
                    if (typeof formatRupiahInput === 'function') formatRupiahInput(target);
                    calculateTotalLbr(target);
                    return;
                }

                if (target.classList.contains('box') || target.classList.contains('lbr')) {
                    calculateTotalLbr(target);
                }
            });

            // Blur: auto-add unit untuk box/lbr, dan update harga untuk ukuran
            tbody.addEventListener('focusout', function(e) {
                const target = e.target;

                if (target.classList.contains('ukuran')) {
                    setTimeout(() => { updateHargaUkuranLogic(target, true); }, 150);
                    return;
                }

                if (target.classList.contains('box')) {
                    if (typeof autoAddBoxUnit === 'function') autoAddBoxUnit(target);
                    return;
                }

                if (target.classList.contains('lbr')) {
                    if (typeof autoAddLbrUnit === 'function') autoAddLbrUnit(target);
                }
            });

            // Keyup: Enter/Tab/Arrow pada ukuran → update harga
            tbody.addEventListener('keyup', function(e) {
                const target = e.target;
                if (target.classList.contains('ukuran') &&
                    (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    setTimeout(() => { updateHargaUkuranLogic(target, true); }, 100);
                }
            });
        })();
        // ==================================================================================

        // Event listener untuk keydown (ENTER key)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const target = e.target;
                
                // Auto-add unit jika user menekan ENTER pada input BOX atau LBR
                if (target.classList.contains('box')) {
                    autoAddBoxUnit(target);
                } else if (target.classList.contains('lbr')) {
                    autoAddLbrUnit(target);
                }
                
                // Navigasi form dengan ENTER - hanya untuk form surat jalan (tokoForm)
                // Cek apakah target berada di dalam form surat jalan
                const tokoForm = target.closest('#tokoForm');
                const stokForm = target.closest('#stokForm');
                
                // Skip jika target berada di form stok
                if (stokForm) {
                    return; // Let setupEnterKeyNavigation() handle it
                }
                
                // Hanya proses jika target berada di form surat jalan
                if (tokoForm) {
                    if (target.id === 'namaToko') {
                        e.preventDefault();
                        const tanggalInput = tokoForm.querySelector('#tanggal');
                        if (tanggalInput) tanggalInput.focus();
                    } else if (target.id === 'tanggal' && tokoForm.contains(target)) {
                        e.preventDefault();
                        const nomorSJInput = tokoForm.querySelector('#nomorSJ');
                        if (nomorSJInput) nomorSJInput.focus();
                    } else if (target.id === 'nomorSJ') {
                        e.preventDefault();
                        const supirInput = tokoForm.querySelector('#supir');
                        if (supirInput) supirInput.focus();
                    } else if (target.id === 'supir') {
                        e.preventDefault();
                        const noKendaraanInput = tokoForm.querySelector('#noKendaraan');
                        if (noKendaraanInput) noKendaraanInput.focus();
                    } else if (target.id === 'noKendaraan') {
                        e.preventDefault();
                        // Focus ke input Jenis Kaca di baris pertama
                        const firstJenisKacaInput = document.querySelector('input.jenis-kaca');
                        if (firstJenisKacaInput) {
                            firstJenisKacaInput.focus();
                            firstJenisKacaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                }
                // Note: Form stok navigation is handled by setupEnterKeyNavigation() function
                // which is called separately and only handles fields in the stock form
                // This prevents conflicts between form surat jalan and form stok
                
                // Cek apakah input berada di tabel kaca
                if (target.closest('#kacaTable')) {
                    const currentRow = target.closest('tr');
                    const tbody = document.getElementById('kacaTableBody');
                    const rows = tbody.querySelectorAll('tr');
                    const isLastRow = currentRow === rows[rows.length - 1];
                    
                    // Navigasi antar kolom dalam tabel
                    if (target.classList.contains('jenis-kaca')) {
                        e.preventDefault();
                        const nextInput = currentRow.querySelector('input.pwd');
                        if (nextInput) nextInput.focus();
                    } else if (target.classList.contains('pwd')) {
                        e.preventDefault();
                        const nextInput = currentRow.querySelector('input.no-do');
                        if (nextInput) nextInput.focus();
                    } else if (target.classList.contains('no-do')) {
                        e.preventDefault();
                        const nextInput = currentRow.querySelector('input.ukuran');
                        if (nextInput) nextInput.focus();
                    } else if (target.classList.contains('ukuran')) {
                        e.preventDefault();
                        const nextInput = currentRow.querySelector('input.harga-jual');
                        if (nextInput) nextInput.focus();
                    } else if (target.classList.contains('harga-jual')) {
                        e.preventDefault();
                        const nextInput = currentRow.querySelector('input.box');
                        if (nextInput) nextInput.focus();
                    } else if (target.classList.contains('box')) {
                        e.preventDefault();
                        const nextInput = currentRow.querySelector('input.lbr');
                        if (nextInput) nextInput.focus();
                    } else if (target.classList.contains('lbr')) {
                        // Jika ini adalah baris terakhir dan semua field terisi
                        if (isLastRow && isRowComplete(currentRow)) {
                            e.preventDefault();
                            
                            // Visual feedback - highlight baris saat ini
                            currentRow.style.backgroundColor = '#e8f5e8';
                            setTimeout(() => {
                                currentRow.style.backgroundColor = '';
                            }, 300);
                            
                            addKacaRow();
                            
                            // Focus ke input Jenis Kaca di baris baru
                            setTimeout(() => {
                                const allRows = tbody.querySelectorAll('tr');
                                const newRow = allRows[allRows.length - 1]; // Ambil baris terakhir (yang baru)
                                const jenisKacaInput = newRow.querySelector('input.jenis-kaca');
                                
                                if (jenisKacaInput) {
                                    jenisKacaInput.focus();
                                    
                                    // Tambahan: scroll ke input jika perlu
                                    jenisKacaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                } else {
                                    // Fallback: coba focus ke input pertama
                                    const firstInput = newRow.querySelector('input');
                                    if (firstInput) {
                                        firstInput.focus();
                                    }
                                }
                            }, 200);
                        } else {
                            // Jika bukan baris terakhir, pindah ke baris berikutnya
                            e.preventDefault();
                            const nextRow = currentRow.nextElementSibling;
                            if (nextRow) {
                                const nextJenisKacaInput = nextRow.querySelector('input.jenis-kaca');
                                if (nextJenisKacaInput) {
                                    nextJenisKacaInput.focus();
                                    nextJenisKacaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            }
                        }
                    }
                }
            }
        });

        // Fungsi untuk mengecek apakah baris sudah terisi lengkap
        function isRowComplete(row) {
            const inputs = row.querySelectorAll('input:not([readonly])');
            let filledCount = 0;
            let totalInputs = 0;
            
            inputs.forEach(input => {
                totalInputs++;
                const value = input.value;
                if (value && typeof value === 'string' && value.trim() !== '') {
                    filledCount++;
                }
            });
            
            // Minimal 3 field harus terisi (jenis kaca, box, lbr)
            // Atau jika user menekan ENTER pada field terakhir yang terisi
            const currentInput = document.activeElement;
            const isLastInput = currentInput === row.querySelector('input:last-of-type');
            
            return filledCount >= 3 || (filledCount >= 2 && isLastInput);
        }

        // Fungsi untuk otomatis menambahkan satuan BOX di belakang angka
        function autoAddBoxUnit(input) {
            const value = input.value.trim();
            if (value && !value.toLowerCase().includes('box')) {
                const numberMatch = value.match(/^(\d+(?:\.\d+)?)$/);
                if (numberMatch) {
                    input.value = value + ' BOX';
                    calculateTotalLbr(input);
                }
            }
        }

        // Fungsi untuk otomatis menambahkan satuan LBR di belakang angka
        function autoAddLbrUnit(input) {
            const value = input.value.trim();
            if (value && !value.toLowerCase().includes('lbr')) {
                const numberMatch = value.match(/^(\d+(?:\.\d+)?)$/);
                if (numberMatch) {
                    input.value = value + ' LBR';
                    calculateTotalLbr(input);
                }
            }
        }

        // Fungsi untuk generate daftar toko di quick modal
        function generateQuickTokoList() {
            const quickTokoList = document.getElementById('quickTokoList');
            
            if (databaseTokoLengkap.length === 0) {
                quickTokoList.innerHTML = '<div class="no-results">Belum ada toko yang tersedia</div>';
                return;
            }
            
            let html = '';
            databaseTokoLengkap.forEach((toko, index) => {
                html += `
                    <div class="quick-toko-item" onclick="selectQuickToko('${escapeHtml(toko.nama)}', '${escapeHtml(toko.alamat).replace(/\n/g, '\\n')}')">
                        <div class="quick-toko-name">🏪 ${escapeHtml(toko.nama)}</div>
                        <div class="quick-toko-address">📍 ${escapeHtml(toko.alamat)}</div>
                        <div class="quick-toko-actions">
                            <button type="button" class="btn-edit" onclick="event.stopPropagation(); editToko(${index})">✏️ Edit</button>
                            <button type="button" class="btn-delete" onclick="event.stopPropagation(); deleteToko(${index})">🗑️ Hapus</button>
                        </div>
                    </div>
                `;
            });
            
            quickTokoList.innerHTML = html;
        }

        // Export daftar toko (databaseTokoLengkap) ke JSON yang bisa diunduh
        function exportTokoListToJSON() {
            try {
                const data = Array.isArray(databaseTokoLengkap) ? databaseTokoLengkap : [];
                const dataStr = JSON.stringify(data, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const now = new Date();
                const ts = now.toISOString().slice(0,19).replace(/[:T]/g,'-');
                a.download = `daftar_toko_${ts}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Gagal export daftar toko:', error);
                alert('Gagal export daftar toko.');
            }
        }

        // Import daftar toko dari file JSON
        async function handleImportTokoListFile(event) {
            try {
                const file = event.target.files && event.target.files[0];
                if (!file) return;
                const text = await file.text();
                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch (e) {
                    alert('File JSON tidak valid.');
                    return;
                }
                if (!Array.isArray(parsed)) {
                    alert('Format file tidak valid. Harus berupa array daftar toko.');
                    return;
                }
                // Validasi minimal field
                const sanitized = parsed.map(item => ({
                    nama: String((item && (item.nama ?? item.Nama ?? item.name)) || '').trim(),
                    alamat: String((item && (item.alamat ?? item.Alamat ?? item.address)) || '').trim()
                })).filter(it => it.nama && it.alamat);
                if (sanitized.length === 0) {
                    alert('File tidak berisi data toko yang valid.');
                    return;
                }
                // Gabungkan dengan data existing, hindari duplikat nama (case-insensitive)
                const existingByLower = new Map(
                    (Array.isArray(databaseTokoLengkap) ? databaseTokoLengkap : []).map(it => [String(it.nama || '').toLowerCase(), it])
                );
                sanitized.forEach(it => {
                    const key = it.nama.toLowerCase();
                    existingByLower.set(key, { nama: it.nama, alamat: it.alamat });
                });
                // Mutate the existing const array instead of reassigning
                const merged = Array.from(existingByLower.values());
                databaseTokoLengkap.splice(0, databaseTokoLengkap.length, ...merged);
                // Persist ke localStorage
                persistDatabaseTokoFromLengkap();
                persistDatabaseTokoLengkapArray();
                // Refresh UI jika tab daftar terbuka
                const quickModal = document.getElementById('quickAddModalOverlay');
                const quickListTab = document.getElementById('quickListTab');
                if (quickModal && quickModal.style.display === 'flex' && quickListTab && quickListTab.classList.contains('active')) {
                    generateQuickTokoList();
                }
                alert(`Import berhasil. Total toko: ${databaseTokoLengkap.length}`);
                // Reset input untuk bisa import ulang
                const input = document.getElementById('importTokoFileInput');
                if (input) input.value = '';
            } catch (error) {
                console.error('Gagal import daftar toko:', error);
                alert('Gagal import daftar toko. Pastikan file JSON valid.');
            }
        }

        // Fungsi untuk memilih toko dari quick list
        function selectQuickToko(namaToko, alamat) {
            const alamatField = document.getElementById('alamat');
            // Isi form utama
            document.getElementById('namaToko').value = namaToko;
            alamatField.value = alamat.replace(/\\n/g, '\n');
            alamatField.style.backgroundColor = '#f8f9fa';
            
            // Auto-resize textarea
            autoResizeTextarea(alamatField);
            
            // Tutup modal
            hideQuickAddModal();
            
            // Tampilkan feedback
            alert(`Form telah diisi dengan data ${namaToko}!`);
        }

        function getDisplayNameForKey(lowerKey) {
            try {
                const entry = Array.isArray(databaseTokoLengkap)
                    ? databaseTokoLengkap.find(t => (t.nama || '').toLowerCase() === String(lowerKey || ''))
                    : null;
                if (entry && entry.nama) return entry.nama;
            } catch (_) {}
            // Fallback: Title Case dari lowerKey
            return String(lowerKey || '').replace(/\b\w+/g, s => s.charAt(0).toUpperCase() + s.slice(1));
        }

        // Fungsi untuk menampilkan autocomplete
        function showAutocomplete(searchTerm) {
            const dropdown = document.getElementById('autocompleteDropdown');
            const matches = [];
            const map = getDatabaseToko();
            // Cari toko yang cocok berdasarkan nama ATAU alamat (case-insensitive)
            Object.keys(map).forEach(key => {
                const nameLower = key;
                const addressLower = String(map[key] || '').toLowerCase();
                if (nameLower.includes(searchTerm) || addressLower.includes(searchTerm)) {
                    matches.push({
                        namaKey: key,
                        displayName: getDisplayNameForKey(key),
                        alamat: map[key]
                    });
                }
            });
            
            // Generate HTML untuk dropdown
            if (matches.length > 0) {
                let html = '';
                matches.forEach((toko, index) => {
                    html += `
                        <div class="autocomplete-item" data-index="${index}" onclick="selectToko('${escapeHtml(toko.displayName).replace(/'/g, "&#39;")}', '${escapeHtml(toko.alamat).replace(/\n/g, '\\n').replace(/'/g, "&#39;")}')">
                            <div class="autocomplete-item-icon">🏪</div>
                            <div class="autocomplete-item-text">
                                <div class="autocomplete-item-name">${escapeHtml(toko.displayName)}</div>
                                <div class="autocomplete-item-address">${escapeHtml(toko.alamat.split('\n')[0])}...</div>
                            </div>
                        </div>
                    `;
                });
                dropdown.innerHTML = html;
                dropdown.style.display = 'block';
            } else {
                dropdown.innerHTML = '<div class="no-results">Tidak ada toko yang cocok</div>';
                dropdown.style.display = 'block';
            }
        }

        // Fungsi untuk menyembunyikan autocomplete
        function hideAutocomplete() {
            const dropdown = document.getElementById('autocompleteDropdown');
            dropdown.style.display = 'none';
        }

        // Fungsi untuk memilih toko dari autocomplete
        function selectToko(namaToko, alamat) {
            const alamatField = document.getElementById('alamat');
            document.getElementById('namaToko').value = namaToko;
            alamatField.value = alamat.replace(/\\n/g, '\n');
            alamatField.style.backgroundColor = '#f8f9fa';
            // Auto-resize textarea
            autoResizeTextarea(alamatField);
            hideAutocomplete();
        }

        // Sembunyikan autocomplete saat klik di luar
        document.addEventListener('click', function(e) {
            const autocompleteContainer = document.querySelector('.autocomplete-container');
            if (!autocompleteContainer.contains(e.target)) {
                hideAutocomplete();
            }
        });

        // Keyboard navigation untuk autocomplete
        document.getElementById('namaToko').addEventListener('keydown', function(e) {
            const dropdown = document.getElementById('autocompleteDropdown');
            const items = dropdown.querySelectorAll('.autocomplete-item');
            const selectedItem = dropdown.querySelector('.autocomplete-item.selected');
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (selectedItem) {
                    selectedItem.classList.remove('selected');
                    const nextItem = selectedItem.nextElementSibling;
                    if (nextItem && nextItem.classList.contains('autocomplete-item')) {
                        nextItem.classList.add('selected');
                    } else {
                        items[0]?.classList.add('selected');
                    }
                } else {
                    items[0]?.classList.add('selected');
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (selectedItem) {
                    selectedItem.classList.remove('selected');
                    const prevItem = selectedItem.previousElementSibling;
                    if (prevItem && prevItem.classList.contains('autocomplete-item')) {
                        prevItem.classList.add('selected');
                    } else {
                        items[items.length - 1]?.classList.add('selected');
                    }
                } else {
                    items[items.length - 1]?.classList.add('selected');
                }
            } else if (e.key === 'Enter' && selectedItem) {
                e.preventDefault();
                selectedItem.click();
            } else if (e.key === 'Escape') {
                hideAutocomplete();
            }
        });

        // Fungsi untuk toggle hide/unhide tombol
        function toggleButtons() {
            const mainActionsContainer = document.getElementById('mainActionsContainer');
            const toggleBtn = document.querySelector('.toggle-buttons-btn');
            const isHidden = mainActionsContainer.classList.contains('hidden');
            
            if (isHidden) {
                // Tampilkan tombol
                mainActionsContainer.classList.remove('hidden');
                toggleBtn.innerHTML = '🔽 Sembunyikan Tombol';
                toggleBtn.style.background = 'linear-gradient(135deg, #6f42c1 0%, #5a32a3 100%)';
            } else {
                // Sembunyikan tombol
                mainActionsContainer.classList.add('hidden');
                toggleBtn.innerHTML = '🔼 Tampilkan Tombol';
                toggleBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
            }
        }

        // Set state awal - tombol tersembunyi
        window.addEventListener('load', function() {
            try {
                // Tombol tersembunyi secara default
                const mainActionsContainer = document.getElementById('mainActionsContainer');
                const toggleBtn = document.querySelector('.toggle-buttons-btn');
                
                if (mainActionsContainer && toggleBtn) {
                    mainActionsContainer.classList.add('hidden');
                    toggleBtn.innerHTML = '🔼 Tampilkan Tombol';
                    toggleBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
                }
                
                // Tambahkan 1 baris default jika belum ada
                setTimeout(() => {
                    const tbody = document.getElementById('kacaTableBody');
                    if (tbody && tbody.children.length === 0) {
                        addKacaRow();
                    }
                }, 200);
                
            } catch (error) {
                console.error('Error during page initialization:', error);
            }
        });

        // Backup initialization untuk memastikan glass data ter-load
        document.addEventListener('DOMContentLoaded', function() {
            try {
                // Cek apakah glass data sudah ada, jika belum, tambahkan 1 baris default
                setTimeout(() => {
                    const kacaTableBody = document.getElementById('kacaTableBody');
                    if (kacaTableBody && kacaTableBody.children.length === 0) {
                        _log('Glass data not found, adding one default row...');
                        addKacaRow();
                    }
                }, 500);
            } catch (error) {
                console.error('Error during DOMContentLoaded:', error);
            }
        });

        // Debug function untuk testing glass data
        // Removed debugGlassData (not used anymore)

        // Print Modal Functions
        function adjustLayoutForSinglePage() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;
            const textElements = container.querySelectorAll('.draggable-text-item');
            
            if (textElements.length === 0) return;
            
            // F4 dimensions in pixels (matching container dimensions)
            const a4Width = 813;
            const a4Height = 1247;
            const margin = 0; // 20px margin on each side
            
            // Calculate available space
            const maxWidth = a4Width - (margin * 2);
            const maxHeight = a4Height - (margin * 2);
            
            // Check if elements need adjustment (only if they're outside bounds or too close together)
            let needsAdjustment = false;
            let previousY = -1;
            
            textElements.forEach((element, index) => {
                const currentX = parseInt(element.style.left, 10) || 20;
                const currentY = parseInt(element.style.top, 10) || 20;
                
                // Check if element is outside F4 bounds
                if (currentX < margin || currentX > maxWidth || currentY < margin || currentY > maxHeight) {
                    needsAdjustment = true;
                }
                
                // Check if elements are too close together (less than 30px spacing)
                if (previousY !== -1 && Math.abs(currentY - previousY) < 30) {
                    needsAdjustment = true;
                }
                
                previousY = currentY;
            });
            
            // Never auto-rearrange user positions; only log the state
            _log('No layout auto-adjustment applied; preserving user positions');
        }

        // Add event listeners for real-time column spacing updates
        function addColumnSpacingEventListeners() {
            const columnInputs = [
                'colJenisKaca', 'colPwd', 'colNoDo', 'colUkuran', 'colBox', 'colLbr', 'colTotalLbr'
            ];
            
            columnInputs.forEach(inputId => {
                const input = document.getElementById(inputId);
                if (input) {
                    // Remove existing listeners to prevent duplicates
                    input.removeEventListener('input', updateColumnSpacing);
                    input.removeEventListener('change', updateColumnSpacing);
                    
                    // Add new listeners for real-time updates
                    input.addEventListener('input', debounce(updateColumnSpacing, 300));
                    input.addEventListener('change', updateColumnSpacing);
                }
            });
        }

        // Debounce function to prevent too many updates
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // Update the showPrintModal function to add event listeners
        function showPrintModal() {
            const modal = document.getElementById('printModalOverlay');
            const printModal = modal.querySelector('.print-modal');
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            // Trigger open animation
            if (printModal) {
                printModal.classList.remove('modal-closing');
                printModal.offsetHeight; // force reflow
                printModal.classList.add('modal-open');
            }
            
            // Load font size preference
            loadFontSizePreference();
            loadFontWeightPreference();
            loadFontFamilyPreference();
            
            // Load column spacing preference
            loadColumnSpacingFromStorage();
            
            // Generate print data
            refreshPrintData();
            
            // Add event listeners for column spacing
            setTimeout(() => {
                addColumnSpacingEventListeners();
            }, 100);
            
            // Smart position handling: never auto-adjust; keep user positions as-is
            setTimeout(() => {
                if (Object.keys(savedPositions).length > 0) {
                    preserveUserPositions();
                }
                initDragAndDropForElements();
            }, 100);
            
            // Restore lock button state
            const lockBtn = document.querySelector('.btn-lock-position');
            if (lockBtn) {
                if (positionsLocked) {
                    lockBtn.textContent = '🔓 Unlock Posisi';
                    lockBtn.classList.add('locked');
                } else {
                    lockBtn.textContent = '🔒 Lock Posisi';
                    lockBtn.classList.remove('locked');
                }
            }
        }

        function hidePrintModal() {
            const modal = document.getElementById('printModalOverlay');
            const printModal = modal.querySelector('.print-modal');
            if (printModal) {
                printModal.classList.remove('modal-open');
                printModal.classList.add('modal-closing');
                setTimeout(() => {
                    // Only hide if still closing (not re-opened by showPrintModal)
                    if (printModal.classList.contains('modal-closing')) {
                        modal.style.display = 'none';
                        printModal.classList.remove('modal-closing');
                        document.body.style.overflow = 'auto';
                    }
                }, 250);
            } else {
                modal.style.display = 'none';
                document.body.style.overflow = 'auto';
            }
        }

        function refreshPrintData() {
            refreshPrintDataClean();
        }

        // Untuk quick print — tanpa modal
        function refreshPrintDataDirect() {
            refreshPrintDataClean();
        }

        function validateAndAdjustForSinglePage() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;
            const textElements = container.querySelectorAll('.draggable-text-item');
            
            if (textElements.length === 0) return;
            
            // F4 dimensions in pixels (matching container dimensions)
            const a4Width = 813;
            const a4Height = 1247;
            const margin = 0;
            
            let needsAdjustment = false;
            let previousY = -1;
            
            // Check if any element is beyond F4 boundaries or too close together
            textElements.forEach(element => {
                const x = parseInt(element.style.left, 10) || 0;
                const y = parseInt(element.style.top, 10) || 0;
                
                // Check if element is outside F4 bounds
                if (x < margin || x > (a4Width - margin) || y < margin || y > (a4Height - margin)) {
                    needsAdjustment = true;
                }
                
                // Check if elements are too close together (less than 40px spacing)
                if (previousY !== -1 && Math.abs(y - previousY) < 40) {
                    needsAdjustment = true;
                }
                
                previousY = y;
            });
            
            // If adjustment is needed, apply single page layout
            // Do not auto-adjust; trust user-defined positions
            _log('Validation step skipped auto-adjustments; preserving user positions');
        }

        function debugPositions() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;
            const textElements = container.querySelectorAll('.draggable-text-item');
            
            _log('=== Position Debug ===');
            _log('Container dimensions:', {
                width: container.offsetWidth,
                height: container.offsetHeight,
                scrollLeft: container.scrollLeft,
                scrollTop: container.scrollTop
            });
            
            textElements.forEach((element, index) => {
                const x = parseInt(element.style.left, 10) || 0;
                const y = parseInt(element.style.top, 10) || 0;
                const text = element.querySelector('.text-content')?.textContent || '';
                
                _log(`Element ${index}:`, {
                    text: text.substring(0, 30) + '...',
                    x: x,
                    y: y,
                    computedLeft: element.style.left,
                    computedTop: element.style.top
                });
            });
        }

        function showPositionOverlay() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;
            const textElements = container.querySelectorAll('.draggable-text-item');
            
            // Remove existing overlay
            const existingOverlay = document.querySelector('.position-overlay');
            if (existingOverlay) {
                existingOverlay.remove();
            }
            
            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'position-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 0, 0.1);
                pointer-events: none;
                z-index: 9999;
            `;
            
            textElements.forEach((element, index) => {
                const x = parseInt(element.style.left, 10) || 0;
                const y = parseInt(element.style.top, 10) || 0;
                
                const marker = document.createElement('div');
                marker.style.cssText = `
                    position: absolute;
                    left: ${x}px;
                    top: ${y}px;
                    width: 10px;
                    height: 10px;
                    background: red;
                    border-radius: 50%;
                    z-index: 10000;
                `;
                marker.title = `Element ${index}: x=${x}, y=${y}`;
                overlay.appendChild(marker);
            });
            
            container.appendChild(overlay);
            
            // Remove overlay after 3 seconds
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.remove();
                }
            }, 3000);
        }

        function printNow() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) {
                alert('Tidak ada konten untuk dicetak!');
                return;
            }
            const textElements = container.querySelectorAll('.draggable-text-item');

            if (textElements.length === 0) {
                alert('Tidak ada konten untuk dicetak!');
                return;
            }

            // Show position overlay for debugging (DEBUG only)
            if (DEBUG) showPositionOverlay();

            // Capture positions BEFORE any adjustments
            let positionedTexts = [];
            textElements.forEach(element => {
                const textContent = element.querySelector('.text-content');
                if (textContent && textContent.textContent.trim()) {
                    // Get exact pixel positions from the drag area
                    const x = parseInt(element.style.left, 10) || 0;
                    const y = parseInt(element.style.top, 10) || 0;
                    const type = element.dataset.type || 'data';
                    // Capture both raw text and the exact HTML preview for kaca-data
                    const text = (type === 'kaca-data')
                        ? (element.dataset.rawText || textContent.textContent)
                        : textContent.textContent;
                    const html = (type === 'kaca-data') ? textContent.innerHTML : null;

                    positionedTexts.push({ x, y, text, type, html });
                }
            });

            // Debug positions before printing (DEBUG only)
            if (DEBUG) debugPositions();

            // Buat iframe tersembunyi untuk print — langsung print dialog, tanpa tab/window baru
            var printFrame = document.createElement('iframe');
            printFrame.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;';
            document.body.appendChild(printFrame);
            var printWindow = printFrame.contentWindow;
            var printDoc = printFrame.contentDocument || printFrame.contentWindow.document;
            
            // Sort by Y position first, then X position for consistent layout
            positionedTexts.sort((a, b) => {
                if (a.y !== b.y) return a.y - b.y;
                return a.x - b.x;
            });
            
            // Create HTML with positioned text elements using exact positions
            let positionedHTML = '';
            positionedTexts.forEach((item, index) => {
                // Clamp to F4 canvas to prevent overflow triggering blank extra page
                const pageWidth = 813;
                const pageHeight = 1247;
                const approxTextHeight = Math.max(currentFontSize, 10) + 8; // include ~8px vertical padding
                const safeX = Math.max(0, Math.min(item.x, pageWidth - 1));
                const safeY = Math.max(0, Math.min(item.y, pageHeight - approxTextHeight));
                const style = `position: absolute; left: ${safeX}px; top: ${safeY}px;`;
                let className = 'print-text-item';
                
                // Add styling based on type
                if (item.type === 'header') {
                    className += ' print-header';
                } else if (item.type === 'total') {
                    className += ' print-total';
                } else if (item.type === 'kaca-data') {
                    className += ' print-kaca-data';
                } else if (item.type === 'timestamp') {
                    className += ' print-timestamp';
                }
                
                if (item.type === 'kaca-data') {
                    // Use the exact preview HTML for perfect column alignment; fallback to rebuild
                    const kdHTML = item.html || buildKacaDataFixedColumnsHTML(item.text, currentFontFamily, currentFontSize);
                    positionedHTML += `<div class="${className}" style="${style}">${kdHTML}</div>`;
                } else {
                    positionedHTML += `<div class="${className}" style="${style}">${item.text}</div>`;
                }
                
                // Debug: Log the exact position being used
                _log(`Print element ${index}:`, {
                    text: item.text.substring(0, 30) + '...',
                    x: safeX,
                    y: safeY,
                    style: style
                });
            });
            
            // Build print content without document.write (deprecated)
            const _printHead = printDoc.head;
            const _printBody = printDoc.body;

            // Meta charset
            const _metaCharset = printDoc.createElement('meta');
            _metaCharset.setAttribute('charset', 'UTF-8');
            _printHead.appendChild(_metaCharset);

            // Google Fonts preconnect + stylesheet
            const _preconn1 = printDoc.createElement('link');
            _preconn1.rel = 'preconnect'; _preconn1.href = 'https://fonts.googleapis.com';
            _printHead.appendChild(_preconn1);
            const _preconn2 = printDoc.createElement('link');
            _preconn2.rel = 'preconnect'; _preconn2.href = 'https://fonts.gstatic.com'; _preconn2.crossOrigin = 'anonymous';
            _printHead.appendChild(_preconn2);
            const _fontLink = printDoc.createElement('link');
            _fontLink.rel = 'stylesheet';
            _fontLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@300;400;500;600;700&display=swap';
            _printHead.appendChild(_fontLink);

            // Inline styles via <style> tag
            const _style = printDoc.createElement('style');
            _style.textContent = (`
                        @page {
                            size: 215mm 330mm; /* F4 */
                            margin: 0;
                        }
                        html, body {
                            margin: 0;
                            padding: 0;
                            font-family: ${currentFontFamily};
                            font-size: ${currentFontSize}px;
                            font-weight: ${currentFontWeight};
                            line-height: 1.2;
                            background: white;
                            overflow: hidden;
                        }
                        html, body, * { box-sizing: border-box; }
                        .page {
                            position: fixed;
                            top: 0;
                            left: 0;
                            width: 212mm;   /* more conservative to avoid overflow */
                            height: 327mm;  /* more conservative to avoid overflow */
                            overflow: clip;
                            background: white;
                            margin: 0;
                            padding: 0;
                        }
                        .print-text-item { box-sizing: border-box; }
                        .print-text-item {
                            position: absolute;
                            background: transparent;
                            padding: 4px 8px;
                            border: none;
                            white-space: pre-wrap;
                            max-width: none;
                            font-family: ${currentFontFamily};
                            font-size: ${currentFontSize}px;
                            font-weight: ${currentFontWeight};
                        }
                        .print-header {
                            font-weight: 700;
                        }
                        .print-total {
                            font-weight: 700;
                            color: #000 !important; /* force black for TOTAL */
                            font-size: ${currentFontSize}px;
                        }
                        /* Mirror preview's fixed-columns layout exactly in print */
                        .print-kaca-data { font-size: ${Math.max(currentFontSize - 2, 8)}px; max-width: 600px; width: auto; }
                        .kd-block { display: block; }
                        .kd-row { white-space: nowrap; line-height: 1.2; }
                        .kd-cell { display:inline-block; font-family: 'Roboto Mono', 'Courier New', monospace; white-space: nowrap; overflow: hidden; text-overflow: clip; vertical-align: top; }
                        .kd-cell.left{ text-align:left; } .kd-cell.center{ text-align:center; } .kd-cell.right{ text-align:right; }
                        .kd-text{ display:inline; font-family:${currentFontFamily}; font-size:${currentFontSize}px; }
                        .print-timestamp {
                            font-weight: ${currentFontWeight};
                        }
                        @media print {
                            @page {
                                size: 215mm 330mm; /* F4 */
                                margin: 0;
                            }
                            html, body { 
                                margin: 0; 
                                padding: 0;
                                overflow: hidden;
                                font-size: ${currentFontSize}px;
                                font-weight: ${currentFontWeight};
                                font-family: ${currentFontFamily};
                            }
                            .page {
                                width: 212mm;
                                height: 327mm;
                                position: fixed;
                                top: 0;
                                left: 0;
                                overflow: clip;
                                margin: 0;
                                padding: 0;
                            }
                            .print-text-item {
                                page-break-inside: avoid;
                                page-break-before: avoid;
                                page-break-after: avoid;
                                font-family: ${currentFontFamily};
                                font-size: ${currentFontSize}px;
                                font-weight: ${currentFontWeight};
                                /* Ensure no overflow from padding during print */
                                padding: 0;
                                max-width: 212mm;
                            }
                            .print-kaca-data { max-width: 600px !important; width: auto !important; }
                            * {
                                page-break-inside: avoid;
                                page-break-after: avoid;
                                page-break-before: avoid;
                            }
                            /* Hide browser headers and footers */
                            html, body {
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            /* Force single page */
                            html {
                                height: 100%;
                                overflow: hidden;
                            }
                        }
                    `);
            _printHead.appendChild(_style);

            // Body content
            const _page = printDoc.createElement('div');
            _page.className = 'page';
            _page.innerHTML = positionedHTML;
            _printBody.appendChild(_page);


            // Trigger Sync (Log Surat Jalan) when printing
            if (window.syncManager) {
                _log('🖨️ Print triggered sync...');
                setTimeout(function() {
                    window.syncManager.syncAll().catch(function(err) { console.error('Auto-sync on print failed:', err); });
                }, 500);
            }

            // Print dialog otomatis — setTimeout pendek agar konten sempat di-render
            setTimeout(function() {
                try {
                    printWindow.print();
                    // Use afterprint event if available, fallback to timeout
                    if ('onafterprint' in printWindow) {
                        printWindow.onafterprint = function() {
                            setTimeout(function() {
                                try { document.body.removeChild(printFrame); } catch (_) {}
                            }, 200);
                        };
                    } else {
                        setTimeout(function() {
                            try { document.body.removeChild(printFrame); } catch (_) {}
                        }, 1500);
                    }
                } catch (_) {
                    try { document.body.removeChild(printFrame); } catch (_) {}
                }
            }, 300);
        }

        // Close print modal when clicking outside
        document.getElementById('printModalOverlay').addEventListener('click', function(e) {
            if (e.target === this) {
                hidePrintModal();
            }
        });

        // Drag functionality for print text content
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let currentDraggedElement = null;
        let selectedElement = null;
        let gridEnabled = false; // free movement (no grid)
        let gridSize = 1; // 1px step for arrow keys
        let positionsLocked = false;
        let savedPositions = {};
        let dragStartTime = 0;
        let dragDistance = 0;
        let currentFontSize = 10; // Default font size for print
        let currentFontWeight = 400; // Default font weight (Normal)
        let currentFontFamily = "'Roboto Mono', 'Courier New', monospace"; // Default font family
        let currentColumnSpacing = 12; // Default column spacing for kaca-data
        
        // Individual column spacing configuration
        let columnSpacingConfig = {
            jenisKaca: 15,
            pwd: 8,
            noDo: 12,
            ukuran: 12,
            hargaBeli: 15, // Added default width for Harga Beli
            hargaJual: 15, // Added default width for Harga Jual
            box: 10,
            lbr: 10,
            totalLbr: 12
        };
        
        // Preset configurations
        const spacingPresets = {
            compact: {
                jenisKaca: 12,
                pwd: 6,
                noDo: 8,
                ukuran: 8,
                box: 6,
                lbr: 6,
                totalLbr: 8
            },
            normal: {
                jenisKaca: 15,
                pwd: 8,
                noDo: 12,
                ukuran: 12,
                box: 10,
                lbr: 10,
                totalLbr: 12
            },
            wide: {
                jenisKaca: 20,
                pwd: 12,
                noDo: 16,
                ukuran: 16,
                box: 14,
                lbr: 14,
                totalLbr: 16
            },
            custom: {
                jenisKaca: 18,
                pwd: 10,
                noDo: 14,
                ukuran: 14,
                box: 12,
                lbr: 12,
                totalLbr: 14
            }
        };
        
        // Load saved positions from storage on page load
        function loadSavedPositions() {
            try {
                const saved = storageManager.load('printTextPositions');
                if (saved) {
                    savedPositions = saved;
                } else {
                }
            } catch (error) {
                console.error('❌ Error loading saved positions:', error);
                savedPositions = {};
            }
        }
        
        // Save positions to storage
        function savePositionsToStorage() {
            try {
                storageManager.save('printTextPositions', savedPositions);
                _log('💾 Positions saved to storage:', savedPositions);
            } catch (error) {
                console.error('❌ Error saving positions:', error);
            }
        }

        // Save current positions explicitly (triggered by button)
        function saveCurrentPositions() {
            try {
                const container = document.querySelector('.print-textarea-container');
                if (!container) return;
                const textElements = container.querySelectorAll('.draggable-text-item');
                const latest = {};
                textElements.forEach(el => {
                    const index = parseInt(el.dataset.index, 10);
                    const x = Math.round(parseFloat(el.style.left) || 0);
                    const y = Math.round(parseFloat(el.style.top) || 0);
                    if (!isNaN(index)) {
                        latest[index] = { x, y };
                    }
                });
                savedPositions = latest;
                savePositionsToStorage();
                alert('Posisi saat ini telah disimpan.');
            } catch (error) {
                console.error('Error saving current positions:', error);
                alert('Gagal menyimpan posisi: ' + error.message);
            }
        }

        // Export positions to downloadable JSON file
        function exportPositionsToJSON() {
            try {
                const dataStr = JSON.stringify(savedPositions, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
                a.href = url;
                a.download = `print-positions-${dateStr}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Error exporting positions:', error);
                alert('Gagal export posisi: ' + error.message);
            }
        }

        // Handle import positions JSON file
        async function handleImportPositionsFile(event) {
            try {
                const file = event.target.files && event.target.files[0];
                if (!file) return;
                const text = await file.text();
                const json = JSON.parse(text);
                if (!json || typeof json !== 'object') throw new Error('Format file tidak valid');
                // Basic validation of structure: values should be {x, y}
                const validated = {};
                Object.keys(json).forEach(key => {
                    const val = json[key];
                    if (val && typeof val.x === 'number' && typeof val.y === 'number') {
                        validated[key] = { x: Math.round(val.x), y: Math.round(val.y) };
                    }
                });
                savedPositions = validated;
                savePositionsToStorage();

                // Apply to DOM immediately if elements exist
                const container = document.querySelector('.print-textarea-container');
                if (container) {
                    const elements = container.querySelectorAll('.draggable-text-item');
                    elements.forEach(el => {
                        const index = parseInt(el.dataset.index, 10);
                        const pos = savedPositions[index];
                        if (pos) {
                            el.style.left = pos.x + 'px';
                            el.style.top = pos.y + 'px';
                        }
                    });
                }
                alert('Posisi berhasil diimport dan diterapkan.');
                // Reset input for re-import
                const input = document.getElementById('importPositionsFileInput');
                if (input) input.value = '';
            } catch (error) {
                console.error('Error importing positions:', error);
                alert('Gagal import posisi: ' + error.message);
            }
        }
        
        // Load positions when page loads
        document.addEventListener('DOMContentLoaded', function() {
            loadSavedPositions();
            loadFontSizePreference();
            loadColumnSpacingFromStorage();
        });
        
        // Function to clear saved positions
        function clearSavedPositions() {
            try {
                // Try to remove from localStorage first
                try { localStorage.removeItem('printTextPositions'); } catch (_) {}
                // Try to remove from sessionStorage
                try { sessionStorage.removeItem('printTextPositions'); } catch (_) {}
                // Clear from memory fallback
                if (storageManager.fallbackData['printTextPositions']) {
                    delete storageManager.fallbackData['printTextPositions'];
                }
                savedPositions = {};
                _log('Saved positions cleared');
                alert('Posisi tersimpan telah dihapus! Posisi akan kembali ke default saat modal dibuka kembali.');
            } catch (error) {
                console.error('Error clearing saved positions:', error);
            }
        }

        function snapToGrid(x, y) {
            if (!gridEnabled) return { x: Math.round(x), y: Math.round(y) };
            
            const snappedX = Math.round(x / gridSize) * gridSize;
            const snappedY = Math.round(y / gridSize) * gridSize;
            
            // Add haptic feedback if supported
            if (navigator.vibrate && Math.abs(x - snappedX) < 2 && Math.abs(y - snappedY) < 2) {
                navigator.vibrate(10);
            }
            
            return { x: Math.round(snappedX), y: Math.round(snappedY) };
        }

        function selectElement(element) {
            // Remove selection from previously selected element
            if (selectedElement) {
                selectedElement.classList.remove('selected');
            }
            
            // Select new element
            selectedElement = element;
            if (element) {
                element.classList.add('selected');
                element.focus();
                
                // Add haptic feedback for selection
                if (navigator.vibrate) {
                    navigator.vibrate(20);
                }
                
                // Scroll element into view if needed
                element.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest',
                    inline: 'nearest'
                });
            }
        }

        function moveSelectedElement(direction) {
            if (!selectedElement) return;
            
            const currentX = parseInt(selectedElement.style.left, 10) || 0;
            const currentY = parseInt(selectedElement.style.top, 10) || 0;
            let newX = currentX;
            let newY = currentY;
            
            switch (direction) {
                case 'up':
                    newY = currentY - gridSize;
                    break;
                case 'down':
                    newY = currentY + gridSize;
                    break;
                case 'left':
                    newX = currentX - gridSize;
                    break;
                case 'right':
                    newX = currentX + gridSize;
                    break;
            }
            
            // Constrain to container boundaries with full page range
            const container = selectedElement.closest('.print-textarea-container');
            
            // Use F4 dimensions for boundary calculation
            const containerWidth = 813;  // F4 width in pixels
            const containerHeight = 1247; // F4 height in pixels
            
            const maxX = containerWidth - selectedElement.offsetWidth;
            const maxY = containerHeight - selectedElement.offsetHeight;
            
            // Allow movement across the full page
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            // Snap to grid within container only
            const snapped = snapToGrid(newX, newY);
            selectedElement.style.left = snapped.x + 'px';
            selectedElement.style.top = snapped.y + 'px';
            
            // Save position to localStorage
            const index = parseInt(selectedElement.dataset.index, 10);
            if (!isNaN(index)) {
                savedPositions[index] = { x: Math.round(snapped.x), y: Math.round(snapped.y) };
                savePositionsToStorage();
            }
        }

        function initDragAndDropForElements() {
            const container = document.querySelector('.print-textarea-container');
            
            if (!container) return;
            
            // Remove existing event listeners
            const existingElements = container.querySelectorAll('.draggable-text-item');
            existingElements.forEach(element => {
                element.removeEventListener('mousedown', handleMouseDown);
                element.removeEventListener('click', handleElementClick);
                element.removeEventListener('touchstart', handleTouchStart);
            });
            
            // Add event listeners to all draggable text elements
            const textElements = container.querySelectorAll('.draggable-text-item');
            textElements.forEach(element => {
                element.addEventListener('mousedown', handleMouseDown);
                element.addEventListener('click', handleElementClick);
                element.addEventListener('touchstart', handleTouchStart, { passive: false });
            });
        }

        function handleTouchStart(e) {
            if (positionsLocked) return;
            const touch = e.touches[0];
            const element = e.target && e.target.closest ? e.target.closest('.draggable-text-item') : null;
            if (!element) return;
            
            e.preventDefault();
            
            isDragging = true;
            currentDraggedElement = element;
            dragStartTime = Date.now();
            dragDistance = 0;
            
            currentDraggedElement.classList.add('dragging');
            selectElement(currentDraggedElement);
            
            const rect = currentDraggedElement.getBoundingClientRect();
            const containerRect = currentDraggedElement.closest('.print-textarea-container').getBoundingClientRect();
            
            dragOffsetX = touch.clientX - rect.left;
            dragOffsetY = touch.clientY - rect.top;
            
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleMouseUp);
        }

        function handleElementClick(e) {
            // Select element on click (but not during drag)
            if (!isDragging && !positionsLocked) {
                const el = e.target && e.target.closest ? e.target.closest('.draggable-text-item') : null;
                if (el) selectElement(el);
            }
        }

        function handleMouseDown(e) {
            if (e.button === 0 && !positionsLocked) { // Left mouse button only and not locked
                const el = e.target && e.target.closest ? e.target.closest('.draggable-text-item') : null;
                if (!el) return;
                isDragging = true;
                currentDraggedElement = el;
                dragStartTime = Date.now();
                dragDistance = 0;
                
                // Add dragging class for visual feedback
                currentDraggedElement.classList.add('dragging');
                
                // Select the element being dragged
                selectElement(currentDraggedElement);
                
                const rect = currentDraggedElement.getBoundingClientRect();
                const containerRect = currentDraggedElement.closest('.print-textarea-container').getBoundingClientRect();
                
                // Compute offset relative to element top-left to avoid initial jump
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                
                // Disable transitions during drag to prevent visual jump/glitch
                currentDraggedElement.style.transition = 'none';
                
                // Prevent text selection during drag
                e.preventDefault();
                
                // Add global event listeners
                document.addEventListener('mousemove', handleMouseMove, { passive: false });
                document.addEventListener('mouseup', handleMouseUp);
                document.addEventListener('touchmove', handleTouchMove, { passive: false });
                document.addEventListener('touchend', handleMouseUp);
            }
        }
        
        function handleMouseMove(e) {
            if (!isDragging || !currentDraggedElement) return;

            e.preventDefault();

            // Use requestAnimationFrame for smooth performance
            requestAnimationFrame(() => {
                // Guard: element may have been nulled by handleMouseUp
                if (!currentDraggedElement) return;
                const container = currentDraggedElement.closest('.print-textarea-container');
                if (!container) return;
                const containerRect = container.getBoundingClientRect();
                // Account for scroll so positions map to full F4 canvas
                const newX = e.clientX - containerRect.left + container.scrollLeft - dragOffsetX;
                const newY = e.clientY - containerRect.top + container.scrollTop - dragOffsetY;
                
                // Calculate drag distance for click detection
                const deltaX = e.clientX - (containerRect.left + dragOffsetX);
                const deltaY = e.clientY - (containerRect.top + dragOffsetY);
                dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                
                // Constrain to full F4 canvas boundaries
                const maxX = container.scrollWidth - currentDraggedElement.offsetWidth;
                const maxY = container.scrollHeight - currentDraggedElement.offsetHeight;
                
                const constrainedX = Math.max(0, Math.min(newX, maxX));
                const constrainedY = Math.max(0, Math.min(newY, maxY));
                
                // Snap to grid
                const snapped = snapToGrid(constrainedX, constrainedY);
                
                // Apply position with smooth transition
                currentDraggedElement.style.transition = 'none';
                currentDraggedElement.style.left = snapped.x + 'px';
                currentDraggedElement.style.top = snapped.y + 'px';
            });
        }
        
        function handleTouchMove(e) {
            if (!isDragging || !currentDraggedElement) return;

            e.preventDefault();
            const touch = e.touches[0];
            const container = currentDraggedElement.closest('.print-textarea-container');
            if (!container) return;
            const containerRect = container.getBoundingClientRect();
            
            // Directly compute new position for touch; include scroll offsets
            const newX = touch.clientX - containerRect.left + container.scrollLeft - dragOffsetX;
            const newY = touch.clientY - containerRect.top + container.scrollTop - dragOffsetY;
            
            // Calculate drag distance for click detection
            const deltaX = touch.clientX - (containerRect.left + dragOffsetX);
            const deltaY = touch.clientY - (containerRect.top + dragOffsetY);
            dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            const maxX = container.scrollWidth - currentDraggedElement.offsetWidth;
            const maxY = container.scrollHeight - currentDraggedElement.offsetHeight;
            const constrainedX = Math.max(0, Math.min(newX, maxX));
            const constrainedY = Math.max(0, Math.min(newY, maxY));
            const snapped = snapToGrid(constrainedX, constrainedY);
            
            currentDraggedElement.style.left = snapped.x + 'px';
            currentDraggedElement.style.top = snapped.y + 'px';
        }
        
        function handleMouseUp() {
            if (isDragging && currentDraggedElement) {
                const dragDuration = Date.now() - dragStartTime;
                
                // Remove dragging class
                currentDraggedElement.classList.remove('dragging');
                
                // Restore smooth transitions (not position) after drag ends
                currentDraggedElement.style.transition = 'box-shadow 0.2s ease, border-color 0.2s ease, transform 0.15s ease';
                
                // Check if it was a click (short duration and small distance)
                if (dragDuration < 200 && dragDistance < 5) {
                    // It was a click, not a drag
                    selectElement(currentDraggedElement);
                }
                
                            // Save position to localStorage after drag ends
            if (currentDraggedElement) {
                const index = parseInt(currentDraggedElement.dataset.index, 10);
                if (!isNaN(index)) {
                    const x = Math.round(parseFloat(currentDraggedElement.style.left) || 0);
                    const y = Math.round(parseFloat(currentDraggedElement.style.top) || 0);
                    savedPositions[index] = { x, y };
                    savePositionsToStorage();
                }
            }
                
                isDragging = false;
                currentDraggedElement = null;
                
                // Remove global event listeners
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.removeEventListener('touchmove', handleTouchMove);
                document.removeEventListener('touchend', handleMouseUp);
            }
        }

        // Keyboard navigation for selected elements
        document.addEventListener('keydown', function(e) {
            if (!selectedElement || positionsLocked) return;
            
            let moved = false;
            
            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    moveSelectedElement('up');
                    moved = true;
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    moveSelectedElement('down');
                    moved = true;
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    moveSelectedElement('left');
                    moved = true;
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    moveSelectedElement('right');
                    moved = true;
                    break;
            }
            
            // Visual feedback when moving with keyboard
            if (moved) {
                selectedElement.style.transform = 'scale(1.05)';
                setTimeout(() => {
                    selectedElement.style.transform = 'scale(1)';
                }, 150);
            }
        });

        function lockPositions() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;
            const textElements = container.querySelectorAll('.draggable-text-item');
            const lockBtn = document.querySelector('.btn-lock-position');
            
            if (!positionsLocked) {
                // Save current positions
                savedPositions = {};
                textElements.forEach((element, index) => {
                    const x = Math.round(parseFloat(element.style.left) || 0);
                    const y = Math.round(parseFloat(element.style.top) || 0);
                    savedPositions[index] = { x, y };
                });
                
                // Save to localStorage for persistence
                savePositionsToStorage();
                
                // Lock positions
                positionsLocked = true;
                lockBtn.textContent = '🔓 Unlock Posisi';
                lockBtn.classList.add('locked');
                
                // Disable dragging
                textElements.forEach(element => {
                    element.style.cursor = 'not-allowed';
                    element.classList.add('locked');
                });
                
                alert('Posisi teks telah dikunci dan tersimpan! Posisi akan tetap ada meskipun halaman di-refresh.');
            } else {
                // Unlock positions
                positionsLocked = false;
                lockBtn.textContent = '🔒 Lock Posisi';
                lockBtn.classList.remove('locked');
                
                // Enable dragging
                textElements.forEach(element => {
                    element.style.cursor = 'move';
                    element.classList.remove('locked');
                });
                
                alert('Posisi teks telah dibuka kunci! Anda dapat mengatur ulang posisi.');
            }
        }

        // Function to preserve user positions more effectively
        function preserveUserPositions() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;
            const textElements = container.querySelectorAll('.draggable-text-item');
            
            if (textElements.length === 0) return;
            
            // Save current positions before any adjustments
            const currentPositions = {};
            textElements.forEach((element, index) => {
                const x = parseInt(element.style.left, 10) || 0;
                const y = parseInt(element.style.top, 10) || 0;
                currentPositions[index] = { x, y };
            });
            
            // Only adjust if positions are significantly problematic
            let needsAdjustment = false;
            const a4Width = 813; // F4
            const a4Height = 1247; // F4
            const margin = 0;
            
            Object.values(currentPositions).forEach(pos => {
                if (pos.x < margin || pos.x > (a4Width - margin) || pos.y < margin || pos.y > (a4Height - margin)) {
                    needsAdjustment = true;
                }
            });
            
            if (needsAdjustment) {
                _log('Critical position issues detected - minimal adjustment needed');
                // Apply minimal adjustments only for out-of-bounds elements
                textElements.forEach((element, index) => {
                    const pos = currentPositions[index];
                    let newX = pos.x;
                    let newY = pos.y;
                    
                    // Only adjust if out of bounds
                    if (pos.x < margin) newX = margin;
                    if (pos.x > (a4Width - margin)) newX = a4Width - margin;
                    if (pos.y < margin) newY = margin;
                    if (pos.y > (a4Height - margin)) newY = a4Height - margin;
                    
                    // Apply only if changed
                    if (newX !== pos.x || newY !== pos.y) {
                        element.style.left = newX + 'px';
                        element.style.top = newY + 'px';
                    }
                });
            } else {
                _log('User positions preserved - no adjustments needed');
            }
        }

        // Function to change font size of print elements
        function changeFontSize() {
            const fontSizeSelect = document.getElementById('fontSizeControl');
            const newFontSize = parseInt(fontSizeSelect.value, 10);
            currentFontSize = newFontSize;
            
            // Update font size of all draggable text elements
            const textElements = document.querySelectorAll('.draggable-text-item');
            textElements.forEach(element => {
                element.style.fontSize = newFontSize + 'px';
            });
            
            _log(`📝 Font size changed to ${newFontSize}px`);
            
            // Save font size preference to storage
            try {
                storageManager.save('printFontSize', newFontSize.toString());
                _log('💾 Font size preference saved to storage');
            } catch (error) {
                console.error('❌ Error saving font size preference:', error);
            }
        }

        // Function to change font family (gaya teks)
        function changeFontFamily() {
            const select = document.getElementById('fontFamilyControl');
            if (!select) return;
            const newFontFamily = select.value;
            currentFontFamily = newFontFamily;

            // Apply to all draggable elements, and rebuild kaca-data with fixed columns layout
            const textElements = document.querySelectorAll('.draggable-text-item');
            textElements.forEach(element => {
                const type = element.dataset.type || '';
                // Apply font family to the element itself with !important to override CSS
                element.style.setProperty('font-family', newFontFamily, 'important');
                
                // Also apply font family to the text-content child to ensure it inherits
                const content = element.querySelector('.text-content');
                if (content) {
                    if (type === 'kaca-data' || element.dataset.index === '6') {
                        // For kaca-data, rebuild with fixed columns layout
                        const raw = element.dataset.rawText || content.textContent || '';
                        content.innerHTML = buildKacaDataFixedColumnsHTML(raw, newFontFamily, currentFontSize);
                        // Also set font family on content for kaca-data
                        content.style.setProperty('font-family', newFontFamily, 'important');
                    } else {
                        // For other elements (nama toko, alamat, etc.), apply font family directly with !important
                        content.style.setProperty('font-family', newFontFamily, 'important');
                    }
                }
            });

            try {
                storageManager.save('printFontFamily', newFontFamily);
            } catch (error) {
                console.error('❌ Error saving font family preference:', error);
            }
        }

        // Load saved font family preference
        function loadFontFamilyPreference() {
            try {
                const saved = storageManager.load('printFontFamily');
                const select = document.getElementById('fontFamilyControl');
                if (saved && select) {
                    currentFontFamily = saved;
                    select.value = saved;
                } else if (select) {
                    select.value = currentFontFamily;
                }

                // Apply immediately to existing elements
                changeFontFamily();
            } catch (error) {
                console.error('❌ Error loading font family preference:', error);
            }
        }

        // Function to change font weight (ketebalan teks) of print elements
        function changeFontWeight() {
            const fontWeightSelect = document.getElementById('fontWeightControl');
            const newFontWeight = parseInt(fontWeightSelect.value, 10);
            currentFontWeight = newFontWeight;
            
            // Update font weight of all draggable text elements except special types overriding weight
            const textElements = document.querySelectorAll('.draggable-text-item');
            textElements.forEach(element => {
                const type = element.dataset.type || '';
                // Apply font weight to the element itself
                if (type === 'header' || type === 'total') {
                    // keep bold for header/total
                    element.style.setProperty('font-weight', '700', 'important');
                } else {
                    element.style.setProperty('font-weight', String(newFontWeight), 'important');
                }
                
                // Also apply font weight to the text-content child to ensure it inherits
                const content = element.querySelector('.text-content');
                if (content) {
                    if (type === 'header' || type === 'total') {
                        // keep bold for header/total
                        content.style.setProperty('font-weight', '700', 'important');
                    } else {
                        content.style.setProperty('font-weight', String(newFontWeight), 'important');
                    }
                }
            });
            
            _log(`📝 Font weight changed to ${newFontWeight}`);
            
            // Save font weight preference to storage
            try {
                storageManager.save('printFontWeight', newFontWeight.toString());
                _log('💾 Font weight preference saved to storage');
            } catch (error) {
                console.error('❌ Error saving font weight preference:', error);
            }
        }

        // Function to load saved font weight preference
        function loadFontWeightPreference() {
            try {
                const saved = storageManager.load('printFontWeight');
                if (saved) {
                    const weight = parseInt(saved, 10);
                    currentFontWeight = weight;
                    const select = document.getElementById('fontWeightControl');
                    if (select) {
                        select.value = String(weight);
                    }
                    // apply to existing elements if any
                    const textElements = document.querySelectorAll('.draggable-text-item');
                    textElements.forEach(element => {
                        const type = element.dataset.type || '';
                        // Apply font weight to the element itself
                        if (type === 'header' || type === 'total') {
                            element.style.setProperty('font-weight', '700', 'important');
                        } else {
                            element.style.setProperty('font-weight', String(weight), 'important');
                        }
                        
                        // Also apply font weight to the text-content child
                        const content = element.querySelector('.text-content');
                        if (content) {
                            if (type === 'header' || type === 'total') {
                                content.style.setProperty('font-weight', '700', 'important');
                            } else {
                                content.style.setProperty('font-weight', String(weight), 'important');
                            }
                        }
                    });
                    _log(`📝 Loaded saved font weight: ${weight}`);
                } else {
                    // initialize control with default and apply
                    const select = document.getElementById('fontWeightControl');
                    if (select) select.value = String(currentFontWeight);
                    changeFontWeight();
                }
            } catch (error) {
                console.error('❌ Error loading font weight preference:', error);
            }
        }

        // Function to load saved font size preference
        function loadFontSizePreference() {
            try {
                const savedFontSize = storageManager.load('printFontSize');
                if (savedFontSize) {
                    const fontSize = parseInt(savedFontSize, 10);
                    currentFontSize = fontSize;
                    
                    // Update select element
                    const fontSizeSelect = document.getElementById('fontSizeControl');
                    if (fontSizeSelect) {
                        fontSizeSelect.value = fontSize;
                    }
                    
                }
            } catch (error) {
                console.error('❌ Error loading font size preference:', error);
            }
        }

        // Helper to center-align text within fixed width (monospace)
        function centerPad(value, width) {
            const text = (value ?? '').toString();
            const clipped = text.length > width ? text.slice(0, width) : text;
            const totalPadding = width - clipped.length;
            const leftPadding = Math.floor(totalPadding / 2);
            const rightPadding = totalPadding - leftPadding;
            return ' '.repeat(leftPadding) + clipped + ' '.repeat(rightPadding);
        }

        // Measure actual monospace character width in pixels for a given font size
        function getMonospaceCharWidthPx(fontSizePx) {
            try {
                const probe = document.createElement('span');
                probe.textContent = 'M';
                probe.style.position = 'absolute';
                probe.style.visibility = 'hidden';
                probe.style.whiteSpace = 'pre';
                probe.style.fontFamily = "'Roboto Mono', 'Courier New', monospace";
                probe.style.fontSize = fontSizePx + 'px';
                document.body.appendChild(probe);
                const width = probe.getBoundingClientRect().width || probe.offsetWidth || Math.max(Math.round(fontSizePx * 0.6), 6);
                probe.remove();
                return width;
            } catch (_) {
                return Math.max(Math.round(fontSizePx * 0.6), 6);
            }
        }

        // Build HTML for kaca-data with fixed columns that do not shift across fonts
        function buildKacaDataFixedColumnsHTML(rawText, appliedFontFamily, fontSizePx) {
            try {
                // Normalize line breaks (Windows/Unix) and trailing spaces
                const lines = (rawText || '').replace(/\r\n?/g, '\n').split('\n');
                if (lines.length === 0) return '';

                const widths = columnSpacingConfig; // per-character widths
                const order = ['jenisKaca', 'pwd', 'noDo', 'ukuran', 'box', 'lbr', 'totalLbr'];
                const alignRight = new Set(['box', 'lbr', 'totalLbr']);
                const alignCenter = new Set(['ukuran']);

                // precise monospace char width in px for measurement container
                const charWidthPx = getMonospaceCharWidthPx(fontSizePx);

                const rowsHTML = lines.map(line => {
                    if (line.trim() === '') return '';
                    const cells = [];
                    let cursor = 0;
                    order.forEach(key => {
                        const span = widths[key] || 12;
                        const slice = line.substring(cursor, cursor + span);
                        cursor += span;
                        const text = slice.trim();
                        const alignClass = alignRight.has(key) ? 'right' : alignCenter.has(key) ? 'center' : 'left';
                        const pxWidth = span * charWidthPx;
                        cells.push(`<span class="kd-cell ${alignClass}" style="width:${pxWidth}px">` +
                                   `<span class="kd-text" style="font-family:${appliedFontFamily}; font-size:${fontSizePx}px">${escapeHtml(text)}</span>` +
                                   `</span>`);
                    });
                    return `<div class="kd-row">${cells.join('')}</div>`;
                }).join('');

                return `<div class="kd-block">${rowsHTML}</div>`;
            } catch (e) {
                console.error('buildKacaDataFixedColumnsHTML error', e);
                return rawText;
            }
        }

        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Function to reformat kaca-data text with new column spacing
        function reformatKacaDataWithSpacing(text, newConfig) {
            if (!text || text.trim() === '') return text;

            const lines = text.split('\n');
            const reformattedLines = [];

            const columnOrder = ['jenisKaca', 'pwd', 'noDo', 'ukuran', 'box', 'lbr', 'totalLbr'];
            const rightAlignColumns = new Set(['box', 'lbr', 'totalLbr']);
            const centerAlignColumns = new Set(['ukuran']);

            lines.forEach(line => {
                if (line.trim() === '') {
                    reformattedLines.push('');
                    return;
                }

                // Parse the line based on current spacing (existing rendering)
                const columns = [];
                let remainingLine = line;

                columnOrder.forEach(columnName => {
                    const currentWidth = columnSpacingConfig[columnName] || 12;
                    if (remainingLine.length >= currentWidth) {
                        columns.push(remainingLine.substring(0, currentWidth).trim());
                        remainingLine = remainingLine.substring(currentWidth);
                    } else {
                        columns.push(remainingLine.trim());
                        remainingLine = '';
                    }
                });

                // Reformat per newConfig with proper alignment
                const reformattedLine = columns.map((rawValue, index) => {
                    const columnName = columnOrder[index];
                    const width = newConfig[columnName] || 12;
                    const value = (rawValue ?? '').toString();

                    // Clip to width first
                    let clipped;
                    if (rightAlignColumns.has(columnName)) {
                        // Keep least significant part on the right when clipping
                        clipped = value.length > width ? value.slice(-width) : value;
                        return clipped.padStart(width);
                    } else if (centerAlignColumns.has(columnName)) {
                        return centerPad(value, width);
                    } else {
                        clipped = value.length > width ? value.slice(0, width) : value;
                        return clipped.padEnd(width);
                    }
                }).join('');

                reformattedLines.push(reformattedLine);
            });

            return reformattedLines.join('\n');
        }

        // Function to load saved column spacing preference
        function loadColumnSpacingPreference() {
            try {
                const savedSpacing = storageManager.load('printColumnSpacing');
                if (savedSpacing) {
                    const spacing = parseInt(savedSpacing, 10);
                    currentColumnSpacing = spacing;
                    
                    // Update select element
                    const spacingSelect = document.getElementById('columnSpacingControl');
                    if (spacingSelect) {
                        spacingSelect.value = spacing;
                    }
                    
                    _log(`📊 Loaded saved column spacing: ${spacing}px`);
                }
            } catch (error) {
                console.error('❌ Error loading column spacing preference:', error);
            }
        }

        // Function to update column spacing from individual inputs
        function updateColumnSpacing() {
            const newConfig = {
                jenisKaca: parseInt(document.getElementById('colJenisKaca').value, 10) || 15,
                pwd: parseInt(document.getElementById('colPwd').value, 10) || 8,
                noDo: parseInt(document.getElementById('colNoDo').value, 10) || 12,
                ukuran: parseInt(document.getElementById('colUkuran').value, 10) || 12,
                box: parseInt(document.getElementById('colBox').value, 10) || 10,
                lbr: parseInt(document.getElementById('colLbr').value, 10) || 10,
                totalLbr: parseInt(document.getElementById('colTotalLbr').value, 10) || 12
            };
            
            // Update column spacing configuration
            columnSpacingConfig = { ...newConfig };
            
            // Show visual feedback
            showColumnSpacingFeedback();
            
            // Refresh the print data with new spacing
            refreshPrintData();
            
            // Save to localStorage
            saveColumnSpacingToStorage();
            
            _log('📊 Column spacing updated:', columnSpacingConfig);
        }

        // Function to show visual feedback for column spacing updates
        function showColumnSpacingFeedback() {
            // Add a subtle animation to the print preview area
            const previewArea = document.querySelector('.print-textarea-container');
            if (previewArea) {
                previewArea.style.transition = 'all 0.3s ease';
                previewArea.style.transform = 'scale(1.02)';
                previewArea.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.2)';
                
                setTimeout(() => {
                    previewArea.style.transform = 'scale(1)';
                    previewArea.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.1)';
                }, 300);
            }
            
            // Add visual feedback to the section title
            const sectionTitle = document.querySelector('.controls-section-title');
            if (sectionTitle) {
                sectionTitle.style.color = '#667eea';
                sectionTitle.style.transition = 'color 0.3s ease';
                
                setTimeout(() => {
                    sectionTitle.style.color = '#2c3e50';
                }, 500);
            }
        }

        // Function to apply spacing presets
        function applyPreset(presetName) {
            if (spacingPresets[presetName]) {
                const newConfig = { ...spacingPresets[presetName] };
                columnSpacingConfig = newConfig;
                
                // Update input values
                document.getElementById('colJenisKaca').value = columnSpacingConfig.jenisKaca;
                document.getElementById('colPwd').value = columnSpacingConfig.pwd;
                document.getElementById('colNoDo').value = columnSpacingConfig.noDo;
                document.getElementById('colUkuran').value = columnSpacingConfig.ukuran;
                document.getElementById('colBox').value = columnSpacingConfig.box;
                document.getElementById('colLbr').value = columnSpacingConfig.lbr;
                document.getElementById('colTotalLbr').value = columnSpacingConfig.totalLbr;
                
                // Update preset button states
                document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
                event.target.classList.add('active');
                
                // Show visual feedback
                showColumnSpacingFeedback();
                
                // Refresh the print data with new spacing
                refreshPrintData();
                
                // Save to localStorage
                saveColumnSpacingToStorage();
                
                _log(`📊 Applied ${presetName} preset:`, columnSpacingConfig);
            }
        }

        // Function to save column spacing to storage
        function saveColumnSpacingToStorage() {
            try {
                storageManager.save('columnSpacingConfig', columnSpacingConfig);
                _log('💾 Column spacing saved to storage');
            } catch (error) {
                console.error('❌ Error saving column spacing:', error);
            }
        }

        // Function to load column spacing from storage
        function loadColumnSpacingFromStorage() {
            try {
                const saved = storageManager.load('columnSpacingConfig');
                if (saved) {
                    const loaded = saved;
                    columnSpacingConfig = { ...columnSpacingConfig, ...loaded };
                    
                    // Update input values if they exist
                    if (document.getElementById('colJenisKaca')) {
                        document.getElementById('colJenisKaca').value = columnSpacingConfig.jenisKaca;
                        document.getElementById('colPwd').value = columnSpacingConfig.pwd;
                        document.getElementById('colNoDo').value = columnSpacingConfig.noDo;
                        document.getElementById('colUkuran').value = columnSpacingConfig.ukuran;
                        document.getElementById('colBox').value = columnSpacingConfig.box;
                        document.getElementById('colLbr').value = columnSpacingConfig.lbr;
                        document.getElementById('colTotalLbr').value = columnSpacingConfig.totalLbr;
                    }
                    
                }
            } catch (error) {
                console.error('❌ Error loading column spacing:', error);
            }
        }

        // Function to change column spacing (legacy function for backward compatibility)
        function changeColumnSpacing() {
            const spacingSelect = document.getElementById('columnSpacingControl');
            if (spacingSelect) {
                const newSpacing = parseInt(spacingSelect.value, 10);
                currentColumnSpacing = newSpacing;
                
                // Update all column widths to the same value
                const newConfig = {
                    jenisKaca: newSpacing,
                    pwd: newSpacing,
                    noDo: newSpacing,
                    ukuran: newSpacing,
                    box: newSpacing,
                    lbr: newSpacing,
                    totalLbr: newSpacing
                };
                
                // Update column spacing configuration
                columnSpacingConfig = { ...newConfig };
                
                // Update input values
                updateColumnInputs();
                
                // Refresh the print data with new spacing
                refreshPrintData();
                
                // Save to localStorage
                saveColumnSpacingToStorage();
                
                _log(`📊 Column spacing changed to ${newSpacing}px for all columns`);
            }
        }

        // Function to update column input values
        function updateColumnInputs() {
            const inputs = [
                'colJenisKaca', 'colPwd', 'colNoDo', 'colUkuran', 'colBox', 'colLbr', 'colTotalLbr'
            ];
            
            inputs.forEach(id => {
                const input = document.getElementById(id);
                if (input) {
                    let columnName = id.replace('col', '');
                    // Fix camelCase conversion
                    columnName = columnName.charAt(0).toLowerCase() + columnName.slice(1);
                    
                    input.value = columnSpacingConfig[columnName] || 12;
                }
            });
        }

        // Test function to debug TOTAL LBR issue
        function testKacaData() {
            _log('🧪 Testing Kaca Data Processing...');
            
            // Check if kaca table exists
            const kacaTable = document.getElementById('kacaTable');
            if (!kacaTable) {
                console.error('❌ Kaca table not found!');
                return;
            }
            
            // Check kaca table body
            const kacaTableBody = document.getElementById('kacaTableBody');
            if (!kacaTableBody) {
                console.error('❌ Kaca table body not found!');
                return;
            }
            
            // Check rows
            const rows = kacaTableBody.querySelectorAll('tr');
            _log(`📊 Found ${rows.length} rows in kaca table`);
            
            // Debug each row in detail
            rows.forEach((row, index) => {
                _log(`\n🔍 === ROW ${index + 1} DETAILED ANALYSIS ===`);
                
                // Check row structure
                _log('Row HTML:', row.outerHTML.substring(0, 300) + '...');
                
                // Check all input elements in the row
                const allInputs = row.querySelectorAll('input');
                _log(`Found ${allInputs.length} input elements in row ${index + 1}:`);
                
                allInputs.forEach((input, inputIndex) => {
                    const className = input.className;
                    const value = input.value;
                    const placeholder = input.placeholder;
                    _log(`  Input ${inputIndex + 1}: class="${className}", value="${value}", placeholder="${placeholder}"`);
                });
                
                // Check specific selectors
                const jenisKaca = row.querySelector('.jenis-kaca');
                const pwd = row.querySelector('.pwd');
                const noDo = row.querySelector('.no-do');
                const ukuran = row.querySelector('.ukuran');
                const box = row.querySelector('.box');
                const lbr = row.querySelector('.lbr');
                const totalLbr = row.querySelector('.total-lbr-input');
                
                _log('Selector results:', {
                    jenisKaca: jenisKaca ? `Found: "${jenisKaca.value}"` : 'NOT FOUND',
                    pwd: pwd ? `Found: "${pwd.value}"` : 'NOT FOUND',
                    noDo: noDo ? `Found: "${noDo.value}"` : 'NOT FOUND',
                    ukuran: ukuran ? `Found: "${ukuran.value}"` : 'NOT FOUND',
                    box: box ? `Found: "${box.value}"` : 'NOT FOUND',
                    lbr: lbr ? `Found: "${lbr.value}"` : 'NOT FOUND',
                    totalLbr: totalLbr ? `Found: "${totalLbr.value}"` : 'NOT FOUND'
                });
                
                // Check if totalLbr has the right class
                if (totalLbr) {
                    _log('✅ TOTAL LBR input found with classes:', totalLbr.className);
                    _log('TOTAL LBR value:', `"${totalLbr.value}"`);
                    _log('TOTAL LBR type:', totalLbr.type);
                    _log('TOTAL LBR readonly:', totalLbr.readOnly);
                } else {
                    _log('❌ TOTAL LBR input NOT FOUND!');
                    
                    // Try alternative selectors
                    const alternativeSelectors = [
                        'input[readonly]',
                        '.total-lbr',
                        'input[placeholder*="LBR"]',
                        'td:last-child input'
                    ];
                    
                    alternativeSelectors.forEach(selector => {
                        const alt = row.querySelector(selector);
                        if (alt) {
                            _log(`🔍 Alternative selector "${selector}" found:`, alt);
                        }
                    });
                }
            });
            
            // Check column spacing configuration
            _log('\n📏 Column Spacing Config:', columnSpacingConfig);
            
            // Test refreshPrintData function
            _log('\n🔄 Testing refreshPrintData function...');
            try {
                refreshPrintData();
                _log('✅ refreshPrintData executed successfully');
            } catch (error) {
                console.error('❌ Error in refreshPrintData:', error);
            }
        }

        // Make test function globally available (DEBUG only)
        if (DEBUG) window.testKacaData = testKacaData;

        // Simple function to check TOTAL LBR data quickly
        function quickCheckTotalLBR() {
            _log('🚀 Quick Check TOTAL LBR Data...');
            
            const kacaTableBody = document.getElementById('kacaTableBody');
            if (!kacaTableBody) {
                console.error('❌ Kaca table body not found!');
                return;
            }
            
            const rows = kacaTableBody.querySelectorAll('tr');
            _log(`📊 Found ${rows.length} rows`);
            
            let totalSum = 0;
            
            rows.forEach((row, index) => {
                const totalLbrInput = row.querySelector('.total-lbr-input');
                const totalLbrValue = totalLbrInput ? totalLbrInput.value : 'NOT FOUND';
                
                _log(`Row ${index + 1}: TOTAL LBR = "${totalLbrValue}"`);
                
                if (totalLbrValue && totalLbrValue !== 'NOT FOUND') {
                    const match = totalLbrValue.match(/^(\d+(?:\.\d+)?)/);
                    if (match) {
                        const number = parseFloat(match[1]);
                        totalSum += number;
                        _log(`  ✅ Added ${number} to total`);
                    }
                }
            });
            
            _log(`\n🎯 GRAND TOTAL: ${totalSum} LBR`);
            
            // Check if there are any TOTAL LBR inputs at all
            const allTotalInputs = document.querySelectorAll('.total-lbr-input');
            _log(`\n🔍 Found ${allTotalInputs.length} TOTAL LBR input elements in the entire table`);
            
            allTotalInputs.forEach((input, index) => {
                _log(`  Input ${index + 1}: value="${input.value}", class="${input.className}", readonly=${input.readOnly}`);
            });
        }

        // Make quick check function globally available (DEBUG only)
        if (DEBUG) window.quickCheckTotalLBR = quickCheckTotalLBR;

        // Function to remove header row from kaca data
        function removeHeaderFromKacaData(kacaData) {
            if (!kacaData) return '';
            
            // Split into lines and remove the first line (header)
            const lines = kacaData.split('\n');
            if (lines.length > 1) {
                // Remove first line (header) and any empty lines
                const dataLines = lines.slice(1).filter(line => line.trim() !== '');
                return dataLines.join('\n');
            }
            return '';
        }

        // Function to clean kaca data for printing (no headers, no placeholders)
        function getCleanKacaData() {
            const kacaRows = document.querySelectorAll('#kacaTableBody tr');
            let cleanData = '';
            let totalLbrSum = 0;
            
            kacaRows.forEach((row, index) => {
                const jenisKaca = row.querySelector('.jenis-kaca')?.value || '';
                // Ensure PWD is uppercase for print (Validation as requested)
                const pwdRaw = row.querySelector('.pwd')?.value || '';
                const pwd = pwdRaw.toUpperCase();
                const noDo = row.querySelector('.no-do')?.value || '';
                const ukuran = row.querySelector('.ukuran')?.value || '';
                let box = row.querySelector('.box')?.value || '';
                let lbr = row.querySelector('.lbr')?.value || '';
                
                // Format BOX (e.g. "100" -> "100 BOX")
                if (box && box.trim() && /^\d+(\.\d+)?$/.test(box.trim())) {
                    box = box.trim() + ' BOX';
                }

                // Format LBR (e.g. "100" -> "100 LBR")
                if (lbr && lbr.trim() && /^\d+(\.\d+)?$/.test(lbr.trim())) {
                    lbr = lbr.trim() + ' LBR';
                }
                
                // Try multiple selectors for TOTAL LBR
                let totalLbr = row.querySelector('input.total-lbr-input')?.value || '';
                if (!totalLbr) {
                    const altSelectors = [
                        'input.total-lbr-input',
                        'td.total-lbr input',
                        'td:last-child input',
                        'input[readonly]',
                        'input[placeholder*="LBR"]'
                    ];
                    
                    for (const selector of altSelectors) {
                        const altInput = row.querySelector(selector);
                        if (altInput && altInput.value) {
                            totalLbr = altInput.value;
                            break;
                        }
                    }
                }

                // Fallback: compute TOTAL LBR from BOX and LBR if empty
                if (!totalLbr || !totalLbr.trim()) {
                    const boxNumMatch = (box || '').trim().match(/^(\d+(?:\.\d+)?)/);
                    const lbrNumMatch = (lbr || '').trim().match(/^(\d+(?:\.\d+)?)/);
                    const boxNum = boxNumMatch ? parseFloat(boxNumMatch[1]) : 0;
                    const lbrNum = lbrNumMatch ? parseFloat(lbrNumMatch[1]) : 0;
                    // Jika kolom BOX tidak diisi, maka TOTAL LBR = LBR
                    // Jika kolom BOX diisi, maka TOTAL LBR = BOX * LBR
                    const computed = (boxNum === 0 || !box.trim()) ? lbrNum : boxNum * lbrNum;
                    if (computed > 0) {
                        totalLbr = String(Math.round(computed)) + ' LBR';
                    }
                }
                
                // Get harga jual & beli for print
                const hargaBeli = row.querySelector('.harga-beli')?.value?.trim() || '';
                const hargaJual = row.querySelector('.harga-jual')?.value?.trim() || '';

                // Only add rows that have actual data
                const hasData = jenisKaca.trim() || pwd.trim() || noDo.trim() || ukuran.trim() || box.trim() || lbr.trim() || totalLbr.trim() || hargaBeli.trim() || hargaJual.trim();
                
                if (hasData) {
                    const formattedRow = 
                        jenisKaca.padEnd(columnSpacingConfig.jenisKaca) +
                        pwd.padEnd(columnSpacingConfig.pwd) +
                        noDo.padEnd(columnSpacingConfig.noDo) +
                        // Center align ukuran column
                        centerPad(ukuran, columnSpacingConfig.ukuran) +
                        // Add harga Beli column - REMOVED FROM PRINT as per user request
                        // hargaBeli.padStart(columnSpacingConfig.hargaBeli || 15) +
                        // Right-align numeric columns for better visual alignment
                        box.padStart(columnSpacingConfig.box) +
                        lbr.padStart(columnSpacingConfig.lbr) +
                        totalLbr.padStart(columnSpacingConfig.totalLbr);
                    
                    cleanData += formattedRow + '\n';
                    
                    // Calculate total LBR sum
                    if (totalLbr.trim()) {
                        const match = totalLbr.match(/^(\d+(?:\.\d+)?)/);
                        if (match) {
                            totalLbrSum += parseFloat(match[1]);
                        }
                    }
                }
            });
            
            return { cleanData, totalLbrSum };
        }

        // Get kaca data using clean function (no headers, no placeholders)
        const { cleanData: kacaData, totalLbrSum } = getCleanKacaData();
        
        // New clean version of refreshPrintData (no headers)
        function refreshPrintDataClean() {
            const container = document.querySelector('.print-textarea-container');
            if (!container) return;

            // Clear existing content
            container.innerHTML = '';
            
            // Get form data
            const namaToko = document.getElementById('namaToko').value || 'Nama Toko';
            const alamat = document.getElementById('alamat').value || 'Alamat Toko';
            const tanggal = document.getElementById('tanggal').value || 'Tanggal';
            const nomorSJ = document.getElementById('nomorSJ').value || 'No. SJ';
            const supir = document.getElementById('supir').value || '';
            const noKendaraan = document.getElementById('noKendaraan').value || '';
            
            // Get clean kaca data (no headers, no placeholders)
            const { cleanData: kacaData, totalLbrSum } = getCleanKacaData();
            
            // Debug: Log the final kacaData and totalLbrSum
            _log('Final kacaData (clean, no headers):', kacaData);
            _log('Final totalLbrSum:', totalLbrSum);
            
            // Get footer data
            const cont = document.querySelector('.cont-input')?.value || '';
            const seal = document.querySelector('.seal-input')?.value || '';
            
            // Format date with uppercase month (for print modal)
            let formattedDate = 'Tanggal';
            if (tanggal) {
                const date = new Date(tanggal);
                const day = date.toLocaleDateString('id-ID', { day: '2-digit' });
                const monthUpper = date.toLocaleDateString('id-ID', { month: 'long' }).toUpperCase();
                const year = date.toLocaleDateString('id-ID', { year: 'numeric' });
                formattedDate = `${day} ${monthUpper} ${year}`;
            }
            
            // Create individual draggable text elements
            const textElements = [
                { text: namaToko, x: 20, y: 40, type: 'header' },
                { text: alamat, x: 20, y: 100, type: 'data' },
                { text: formattedDate, x: 20, y: 160, type: 'data' },
                { text: nomorSJ, x: 20, y: 220, type: 'data' },
                { text: supir, x: 20, y: 280, type: 'data' },
                { text: noKendaraan, x: 20, y: 340, type: 'data' },
                { text: kacaData, x: 20, y: 400, type: 'kaca-data' },
                { text: `${totalLbrSum} LBR`, x: 20, y: 500, type: 'total' },
                { text: cont, x: 20, y: 560, type: 'data' },
                { text: seal, x: 20, y: 620, type: 'data' }
            ];
            
            // Create and position each text element
            textElements.forEach((element, index) => {
                const textDiv = document.createElement('div');
                textDiv.className = 'draggable-text-item';
                
                // Create text content div
                const textContentDiv = document.createElement('div');
                textContentDiv.className = 'text-content';
                textContentDiv.textContent = element.text;
                textDiv.appendChild(textContentDiv);
                
                // Use saved positions if available, otherwise use default positions
                let x, y;
                if (savedPositions[index]) {
                    x = Math.round(savedPositions[index].x);
                    y = Math.round(savedPositions[index].y);
                    _log(`📍 Using saved position for element ${index}:`, { x, y, text: element.text.substring(0, 30) + '...' });
                } else {
                    x = element.x;
                    y = element.y;
                    _log(`🆕 Using default position for element ${index}:`, { x, y, text: element.text.substring(0, 30) + '...' });
                }
                
                textDiv.style.left = Math.round(x) + 'px';
                textDiv.style.top = Math.round(y) + 'px';
                textDiv.dataset.index = index;
                textDiv.dataset.type = element.type;
                // Preserve raw text for reliable rebuilds (font change, print)
                textDiv.dataset.rawText = element.text;
                
                // Apply current font family to all text elements
                textDiv.style.fontFamily = currentFontFamily;
                
                // Apply current font weight to all text elements
                if (element.type === 'header' || element.type === 'total') {
                    // Keep bold for header/total
                    textDiv.style.setProperty('font-weight', '700', 'important');
                    textDiv.style.setProperty('font-variation-settings', 'normal', 'important');
                } else {
                    // Apply current font weight for other elements
                    textDiv.style.setProperty('font-weight', String(currentFontWeight), 'important');
                    textDiv.style.setProperty('font-variation-settings', 'normal', 'important');
                }
                
                // Debug: Log creation of kaca-data element (index 6)
                if (index === 6) {
                    _log('🎯 Created kaca-data element (index 6):', {
                        text: element.text.substring(0, 100) + '...',
                        type: element.type,
                        x: x,
                        y: y,
                        className: textDiv.className,
                        dataset: textDiv.dataset
                    });
                }
                
                // Add locked styling if positions are locked
                if (positionsLocked) {
                    textDiv.style.cursor = 'not-allowed';
                    textDiv.classList.add('locked');
                }
                
                // Add special styling for different types
                if (element.type === 'header') {
                    textDiv.style.fontWeight = '700';
                    textDiv.style.fontSize = '16px';
                    textDiv.style.color = '#333';
                    textDiv.style.backgroundColor = '#f8f9fa';
                    // Ensure font family is applied to header (nama toko)
                    textDiv.style.fontFamily = currentFontFamily;
                } else if (element.type === 'total') {
                    textDiv.style.fontWeight = '700';
                    textDiv.style.color = '#28a745';
                    textDiv.style.borderColor = '#28a745';
                    textDiv.style.backgroundColor = '#f8fff9';
                    // Ensure font family is applied to total
                    textDiv.style.fontFamily = currentFontFamily;
                } else if (element.type === 'kaca-data') {
                    textDiv.style.maxWidth = '600px';
                    textDiv.style.width = 'auto';
                    // Preserve newlines and allow wrapping for immediate correct display
                    textDiv.style.whiteSpace = 'pre-wrap';
                    textDiv.style.wordWrap = 'break-word';
                    textDiv.style.fontSize = '12px';
                    textDiv.style.fontFamily = currentFontFamily;
                    textDiv.style.backgroundColor = '#f8f9ff';
                    textDiv.style.padding = '8px 12px';
                    textDiv.style.lineHeight = '1.2';
                    textDiv.style.height = 'auto';
                    textDiv.style.minHeight = 'auto';
                    textDiv.style.border = '2px solid #667eea';
                    textDiv.style.borderRadius = '6px';
                    textDiv.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.15)';
                    
                    // Build fixed-columns HTML so column widths are stable across fonts
                    const kdHtml = buildKacaDataFixedColumnsHTML(element.text, currentFontFamily, currentFontSize);
                    const inner = textDiv.querySelector('.text-content');
                    if (inner) {
                        inner.innerHTML = kdHtml;
                        // Also apply font weight to text-content for kaca-data
                        inner.style.setProperty('font-weight', String(currentFontWeight), 'important');
                        inner.style.setProperty('font-variation-settings', 'normal', 'important');
                        // Also apply to all nested spans in kaca-data
                        const spans = inner.querySelectorAll('span');
                        spans.forEach(span => {
                            span.style.setProperty('font-weight', String(currentFontWeight), 'important');
                        });
                    }

                    // Debug: Log kaca-data element creation
                    _log('🎯 Created kaca-data element with enhanced styling:', {
                        text: element.text.substring(0, 100) + '...',
                        maxWidth: textDiv.style.maxWidth,
                        backgroundColor: textDiv.style.backgroundColor,
                        border: textDiv.style.border
                    });
                } else if (element.type === 'timestamp') {
                    textDiv.style.fontSize = '11px';
                    textDiv.style.color = '#666';
                    textDiv.style.fontStyle = 'italic';
                    textDiv.style.backgroundColor = '#f9f9f9';
                }
                
                // Special handling for address element (index 1)
                if (index === 1) {
                    textDiv.classList.add('address-element');
                    textDiv.style.whiteSpace = 'pre-wrap';
                    textDiv.style.wordWrap = 'break-word';
                    textDiv.style.maxWidth = '300px';
                    textDiv.style.width = 'auto';
                    textDiv.style.height = 'auto';
                    textDiv.style.minHeight = 'auto';
                    textDiv.style.lineHeight = '1.3';
                    textDiv.style.padding = '6px 10px';
                }

                // Apply font weight to text-content for all elements (not just kaca-data)
                const textContentDivForWeight = textDiv.querySelector('.text-content');
                if (textContentDivForWeight && element.type !== 'kaca-data') {
                    // For non-kaca-data elements, apply font weight to text-content
                    if (element.type === 'header' || element.type === 'total') {
                        textContentDivForWeight.style.setProperty('font-weight', '700', 'important');
                        textContentDivForWeight.style.setProperty('font-variation-settings', 'normal', 'important');
                    } else {
                        textContentDivForWeight.style.setProperty('font-weight', String(currentFontWeight), 'important');
                        textContentDivForWeight.style.setProperty('font-variation-settings', 'normal', 'important');
                    }
                }
                
                // Force 8th element (index 7 - total LBR) text color to black in modal preview
                if (index === 7) {
                     textDiv.style.color = '#000';
                     const textContentDivForce = textDiv.querySelector('.text-content');
                     if (textContentDivForce) {
                         textContentDivForce.style.color = '#000';
                     }
                }
                
                // Apply current font size and weight to all elements (weight overridden for header/total)
                textDiv.style.fontSize = currentFontSize + 'px';
                textDiv.style.fontFamily = currentFontFamily;
                if (element.type !== 'header' && element.type !== 'total') {
                    textDiv.style.fontWeight = String(currentFontWeight);
                }
                
                container.appendChild(textDiv);
            });
            
            // Initialize drag and drop for all text elements
            initDragAndDropForElements();
        }

        // Test function to verify no headers in kaca data
        function testNoHeaders() {
            _log('🧪 Testing No Headers in Kaca Data...');
            
            const { cleanData: kacaData, totalLbrSum } = getCleanKacaData();
            
            _log('📊 Clean Kaca Data (should have NO headers):');
            _log('Data length:', kacaData.length);
            _log('Data content:', kacaData);
            
            // Check if any line contains header text
            const lines = kacaData.split('\n');
            const hasHeaders = lines.some(line => 
                line.includes('JENIS KACA') || 
                line.includes('PWD') || 
                line.includes('NO DO') || 
                line.includes('UKURAN') || 
                line.includes('BOX') || 
                line.includes('LBR') || 
                line.includes('TOTAL LBR')
            );
            
            if (hasHeaders) {
                _log('❌ HEADERS FOUND! Kaca data still contains column titles');
            } else {
                _log('✅ NO HEADERS FOUND! Kaca data is clean');
            }
            
            _log('🎯 Total LBR Sum:', totalLbrSum);
            
            return { kacaData, totalLbrSum, hasHeaders };
        }
        
        // Make test function globally available (DEBUG only)
        if (DEBUG) window.testNoHeaders = testNoHeaders;

        // Input Log System
        let inputLogHistory = [];
        // Track last entered No. SJ to warn on duplicates
        let lastNomorSJ = '';
        // Track entry being edited
        let editingLogEntry = null;
        // Track last log entry ID for linking stok transactions
        let lastLogEntryId = null;
        // Track original nomorSJ for stock sync during edits
        let originalNomorSJForDeletion = null;
        try {
            const saved = storageManager.load('lastNomorSJ');
            lastNomorSJ = (saved || '').trim();
        } catch (_) {
            lastNomorSJ = '';
        }

        // Load input log from storage on page load
        function loadInputLogFromStorage() {
            // Jika override sudah jalan, fungsi asli tidak perlu render lagi
            if (window._logLoadedOnce) return;
            try {
                const saved = storageManager.load('inputLogHistory');
                if (saved) {
                    inputLogHistory = saved;
                    renderInputLog();
                    updateSupirDanKendaraanSuggestions();
                } else {
                }
            } catch (error) {
                console.error('❌ Error loading input log:', error);
                inputLogHistory = [];
            }
        }

        // Save input log to storage
        function saveInputLogToStorage() {
            try {
                storageManager.save('inputLogHistory', inputLogHistory);
                _log('💾 Input log saved to storage:', inputLogHistory.length, 'entries');
                // Update suggestion datalists whenever log changes
                updateKacaSuggestionsFromLogs();
                updateSupirDanKendaraanSuggestions();
                if (typeof window.refreshNomorSJWarningNow === 'function') {
                    window.refreshNomorSJWarningNow();
                }
            } catch (error) {
                console.error('❌ Error saving input log:', error);
            }
        }

        // Save current form input to log
        function saveCurrentInputToLog() {
            const namaToko = document.getElementById('namaToko').value.trim();
            const alamat = document.getElementById('alamat').value.trim();
            const alias = (document.getElementById('alias')?.value || '').trim();
            const tanggal = document.getElementById('tanggal').value;
            const nomorSJ = document.getElementById('nomorSJ').value.trim();
            const supir = document.getElementById('supir').value.trim();
            const noKendaraan = document.getElementById('noKendaraan').value.trim();
            
            // Check if required fields are filled
            if (!namaToko || !tanggal || !nomorSJ || !supir || !noKendaraan) {
                alert('Mohon lengkapi semua field yang wajib diisi sebelum menyimpan log!');
                return;
            }
            
            // Get kaca data
            const kacaDataObj = getKacaDataForLog();
            const kacaRows = kacaDataObj.rows || [];
            
            // Validation: Ensure Harga Beli is present for all items
            // This prevents accidental data loss for Harga Beli
            const missingHargaBeli = kacaRows.some(row => !row.hargaBeli || row.hargaBeli.trim() === '');
            if (missingHargaBeli) {
                if (!confirm('Peringatan: Beberapa item tidak memiliki Harga Beli.\n\nApakah Anda yakin ingin menyimpan tanpa Harga Beli?\nKlik OK untuk lanjut, Cancel untuk perbaiki.')) {
                    return;
                }
            }

            // Create log entry
            const logEntry = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                data: {
                    namaToko,
                    alias,
                    alamat,
                    tanggal,
                    nomorSJ,
                    supir,
                    noKendaraan,
                    kacaData: kacaDataObj
                }
            };
            
            // Store log entry ID for linking stok transactions
            lastLogEntryId = logEntry.id;
            
            // Check if we're editing an existing entry
            if (editingLogEntry) {
                // Store original nomorSJ before clearing editingLogEntry (needed for stock transaction deletion)
                originalNomorSJForDeletion = editingLogEntry.entry.data?.nomorSJ || null;
                
                // Preserve the original log entry ID when editing
                logEntry.id = editingLogEntry.entry.id;
                lastLogEntryId = logEntry.id;
                
                // Replace the original entry with the new one
                inputLogHistory[editingLogEntry.index] = logEntry;
                editingLogEntry = null; // Clear editing state
                hideEditingIndicator(); // Hide editing indicator
                _log('✏️ Updated existing log entry, originalNomorSJForDeletion:', originalNomorSJForDeletion);
            } else {
                // Clear originalNomorSJForDeletion if not editing
                originalNomorSJForDeletion = null;
                // Add to beginning of array (newest first)
                inputLogHistory.unshift(logEntry);
                
                // No limit on log entries - keep all data
            }
            
            // Save to localStorage
            saveInputLogToStorage();
            
            // Explicit Backup Mechanism for Harga Beli protection
            try {
                const backupData = {
                    timestamp: new Date().toISOString(),
                    lastEntry: logEntry
                };
                localStorage.setItem('stok_backup_latest_entry', JSON.stringify(backupData));
            } catch (e) {
                console.error('Backup failed:', e);
            }
            
            // Update lastNomorSJ AFTER successful save/print
            try { storageManager.save('lastNomorSJ', nomorSJ); } catch (_) {}
            lastNomorSJ = nomorSJ;
            
            // Render the log
            renderInputLog();
            
            // Optional: toast could be added here if needed
            
            _log('💾 Saved input log entry:', logEntry);

            // Sync with Stock History
            // This ensures stock transactions are updated immediately when log is saved or edited
            return recordStokTransactionsFromSuratJalan().catch(err => {
                console.error('Stock sync failed:', err);
                return null;
            });
        }

        // Helper: check if No. SJ exists in input log
        function isNomorSJInLog(nomor) {
            try {
                const val = (nomor || '').trim();
                if (!val) return false;
                return (inputLogHistory || []).some(entry => ((entry.data?.nomorSJ || '').trim() === val));
            } catch (_) { return false; }
        }

        // Check if a log entry with given ID still exists in inputLogHistory
        function isLogEntryAlive(logEntryId) {
            if (!logEntryId) return false;
            try {
                return (inputLogHistory || []).some(entry => String(entry.id) === String(logEntryId));
            } catch (_) { return false; }
        }

        // Warn if No. SJ duplicates an existing log entry
        document.addEventListener('DOMContentLoaded', function() {
            const nomorSJInput = document.getElementById('nomorSJ');
            const warningEl = document.getElementById('nomorSJWarning');
            if (!nomorSJInput) return;

            let nomorSJWarningTimer = null;
            // Auto-fill default value when focusing No. SJ if empty
            nomorSJInput.addEventListener('focus', function() {
                if (!nomorSJInput.value || nomorSJInput.value.trim() === '') {
                    // Prefill 7-digit default as requested (leading zeros allowed)
                    nomorSJInput.value = '226';
                    // Trigger input event so any bindings/validations refresh
                    nomorSJInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            // Enforce numeric-only and 7 digits length on input
            nomorSJInput.addEventListener('input', function() {
                const digits = (nomorSJInput.value || '').replace(/\D+/g, '').slice(0, 7);
                nomorSJInput.value = digits;
            });
            function applyNomorSJWarningVisibility() {
                const current = nomorSJInput.value.trim();
                const isDuplicate = !!current && isNomorSJInLog(current);
                if (isDuplicate) {
                    warningEl.style.display = 'flex';
                    nomorSJInput.classList.add('has-warning');
                } else {
                    warningEl.style.display = 'none';
                    nomorSJInput.classList.remove('has-warning');
                }
            }

            nomorSJInput.addEventListener('input', function() {
                const current = nomorSJInput.value.trim();
                // Clear immediately when not duplicate; debounce when duplicate
                if (!current || !isNomorSJInLog(current)) {
                    warningEl.style.display = 'none';
                    nomorSJInput.classList.remove('has-warning');
                }
                // Debounce showing warning when equal to last value
                if (nomorSJWarningTimer) clearTimeout(nomorSJWarningTimer);
                nomorSJWarningTimer = setTimeout(() => {
                    applyNomorSJWarningVisibility();
                }, 500);
            });
            // Validate on blur without updating lastNomorSJ to avoid false warnings
            nomorSJInput.addEventListener('blur', function() {
                if (nomorSJWarningTimer) clearTimeout(nomorSJWarningTimer);
                applyNomorSJWarningVisibility();
            });

            // Expose refresh function globally and initialize state on load
            window.refreshNomorSJWarningNow = applyNomorSJWarningVisibility;
            applyNomorSJWarningVisibility();
        });

        // Function to get kaca data for log
        function getKacaDataForLog() {
            const kacaRows = document.querySelectorAll('#kacaTableBody tr');
            const kacaData = [];
            
            kacaRows.forEach((row, index) => {
                const jenisKaca = row.querySelector('.jenis-kaca')?.value || '';
                const pwd = row.querySelector('.pwd')?.value || '';
                const noDo = row.querySelector('.no-do')?.value || '';
                const ukuran = row.querySelector('.ukuran')?.value || '';
                const box = row.querySelector('.box')?.value || '';
                const lbr = row.querySelector('.lbr')?.value || '';
                
                // Try multiple selectors for TOTAL LBR
                let totalLbr = row.querySelector('input.total-lbr-input')?.value || '';
                if (!totalLbr) {
                    const altSelectors = [
                        'input.total-lbr-input',
                        'td.total-lbr input',
                        'td:last-child input',
                        'input[readonly]',
                        'input[placeholder*="LBR"]'
                    ];
                    
                    for (const selector of altSelectors) {
                        const altInput = row.querySelector(selector);
                        if (altInput && altInput.value) {
                            totalLbr = altInput.value;
                            break;
                        }
                    }
                }

                // Fallback: compute TOTAL LBR from BOX and LBR if empty
                if (!totalLbr || !totalLbr.trim()) {
                    const boxNumMatch = (box || '').trim().match(/^(\d+(?:\.\d+)?)/);
                    const lbrNumMatch = (lbr || '').trim().match(/^(\d+(?:\.\d+)?)/);
                    const boxNum = boxNumMatch ? parseFloat(boxNumMatch[1]) : 0;
                    const lbrNum = lbrNumMatch ? parseFloat(lbrNumMatch[1]) : 0;
                    // Jika kolom BOX tidak diisi, maka TOTAL LBR = LBR
                    // Jika kolom BOX diisi, maka TOTAL LBR = BOX * LBR
                    const computed = (boxNum === 0 || !box.trim()) ? lbrNum : boxNum * lbrNum;
                    if (computed > 0) {
                        totalLbr = String(Math.round(computed)) + ' LBR';
                    }
                }
                
                // Get harga jual & beli
                const hargaBeli = row.querySelector('.harga-beli')?.value?.trim() || '';
                const hargaJual = row.querySelector('.harga-jual')?.value?.trim() || '';
                const transactionId = row.getAttribute('data-transaction-id') || '';
                
                // Only add rows that have actual data
                const hasData = jenisKaca.trim() || pwd.trim() || noDo.trim() || ukuran.trim() || box.trim() || lbr.trim() || totalLbr.trim() || hargaJual.trim();
                
                if (hasData) {
                    kacaData.push({
                        jenisKaca: jenisKaca.trim(),
                        pwd: pwd.trim(),
                        noDo: noDo.trim(),
                        ukuran: ukuran.trim(),
                        hargaBeli: hargaBeli.trim(),
                        hargaJual: hargaJual.trim(),
                        box: box.trim(),
                        lbr: lbr.trim(),
                        totalLbr: totalLbr.trim(),
                        stokTransactionId: transactionId // Store transaction ID for sync
                    });
                }
            });
            
            // Get footer data (CONT and SEAL)
            const contInput = document.querySelector('.cont-input');
            const sealInput = document.querySelector('.seal-input');
            const grandTotalInput = document.querySelector('.grand-total-input');
            
            const footerData = {
                cont: contInput ? contInput.value.trim() : '',
                seal: sealInput ? sealInput.value.trim() : '',
                grandTotal: grandTotalInput ? grandTotalInput.value.trim() : ''
            };
            
            return {
                rows: kacaData,
                footer: footerData
            };
        }

        // Current search query state
        let currentLogSearchQuery = '';

        // Helper function to check if input is a date filter
        function isDateFilter(input) {
            // Check for dd/mm/yy, dd/mm, or dd format
            const datePatterns = [
                /^\d{1,2}\/\d{1,2}\/\d{2}$/,  // dd/mm/yy
                /^\d{1,2}\/\d{1,2}$/,          // dd/mm
                /^\d{1,2}$/                     // dd
            ];
            return datePatterns.some(pattern => pattern.test(input));
        }

        // Helper function to parse date filter
        function parseDateFilter(input) {
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth() + 1; // getMonth() returns 0-11
            
            if (input.includes('/')) {
                const parts = input.split('/');
                if (parts.length === 3) {
                    // dd/mm/yy format
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10);
                    const year = parseInt(parts[2], 10) + (parts[2] < 50 ? 2000 : 1900);
                    return { day, month, year };
                } else if (parts.length === 2) {
                    // dd/mm format
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10);
                    return { day, month, year: currentYear };
                }
            } else {
                // dd format
                const day = parseInt(input, 10);
                return { day, month: currentMonth, year: currentYear };
            }
            return null;
        }

        // Helper function to check if entry date matches filter
        function matchesDateFilter(entryDate, filterDate) {
            if (!filterDate) return false;
            
            const entryDay = entryDate.getDate();
            const entryMonth = entryDate.getMonth() + 1;
            const entryYear = entryDate.getFullYear();
            
            return entryDay === filterDate.day && 
                   entryMonth === filterDate.month && 
                   entryYear === filterDate.year;
        }

        // Function to detect duplicate No. SJ entries and show warnings in placeholder
        function updateDuplicateWarnings() {
            const searchInput = document.getElementById('logSearchInput');
            
            if (!searchInput) return;
            
            // Count occurrences of each No. SJ
            const sjCounts = {};
            inputLogHistory.forEach(entry => {
                const sj = (entry.data?.nomorSJ || '').trim();
                if (sj) {
                    sjCounts[sj] = (sjCounts[sj] || 0) + 1;
                }
            });
            
            // Find duplicates (more than 1 occurrence)
            const duplicates = Object.entries(sjCounts)
                .filter(([sj, count]) => count > 1)
                .sort((a, b) => b[1] - a[1]); // Sort by count descending
            
            if (duplicates.length === 0) {
                // No duplicates, normal placeholder
                searchInput.classList.remove('search-with-warning');
                searchInput.placeholder = 'Search';
                return;
            }
            
            // Show warning styling and update placeholder
            searchInput.classList.add('search-with-warning');
            
            // Create simple warning text with duplicate numbers (max 3)
            const maxDisplay = 3;
            const displayDuplicates = duplicates.slice(0, maxDisplay);
            let warningText = '⚠️ ';
            
            displayDuplicates.forEach(([sj, count]) => {
                warningText += `${sj}(${count}) `;
            });
            
            // Add "..." if there are more than 3 duplicates
            if (duplicates.length > maxDisplay) {
                warningText += '...';
            }
            
            searchInput.placeholder = warningText.trim();
        }

        function applyLogSearch() {
            const input = document.getElementById('logSearchInput');
            currentLogSearchQuery = (input && input.value ? input.value : '').trim();
            renderInputLog();
        }

        // Reset log search filter
        function resetLogSearchFilter() {
            const input = document.getElementById('logSearchInput');
            if (input) {
                input.value = '';
                currentLogSearchQuery = '';
                renderInputLog();
            }
        }

        // Render input log entries (respects currentLogSearchQuery)
        function renderInputLog() {
            const container = document.getElementById('inputLogContainer');
            
            if (inputLogHistory.length === 0) {
                container.innerHTML = `
                    <div class="no-log-message">
                        <p>Belum ada log input</p>
                        <p class="log-hint">Log akan tersimpan otomatis saat Anda menekan Print Sekarang</p>
                    </div>
                `;
                return;
            }
            
            // Filter by search query if present
            let filtered = inputLogHistory;
            if (currentLogSearchQuery) {
                const q = currentLogSearchQuery.toLowerCase();
                
                // Check for special sorting commands
                if (q === '=') {
                    // Filter to show only duplicate No. SJ entries
                    const sjCounts = {};
                    inputLogHistory.forEach(entry => {
                        const sj = (entry.data?.nomorSJ || '').trim();
                        if (sj) {
                            sjCounts[sj] = (sjCounts[sj] || 0) + 1;
                        }
                    });
                    
                    const duplicateSJs = Object.keys(sjCounts).filter(sj => sjCounts[sj] > 1);
                    filtered = inputLogHistory.filter(entry => {
                        const sj = (entry.data?.nomorSJ || '').trim();
                        return duplicateSJs.includes(sj);
                    });
                } else if (q === '1-2') {
                    // Sort No SJ from small to large (ascending)
                    filtered = inputLogHistory.slice().sort((a, b) => {
                        const sjA = parseInt(a.data.nomorSJ, 10) || 0;
                        const sjB = parseInt(b.data.nomorSJ, 10) || 0;
                        return sjA - sjB;
                    });
                } else if (q === '2-1') {
                    // Sort No SJ from large to small (descending)
                    filtered = inputLogHistory.slice().sort((a, b) => {
                        const sjA = parseInt(a.data.nomorSJ, 10) || 0;
                        const sjB = parseInt(b.data.nomorSJ, 10) || 0;
                        return sjB - sjA;
                    });
                } else if (isDateFilter(q)) {
                    // Filter by date
                    filtered = inputLogHistory.filter(entry => {
                        try {
                            const entryDate = new Date(entry.data.tanggal);
                            const searchDate = parseDateFilter(q);
                            return matchesDateFilter(entryDate, searchDate);
                        } catch (_) { return false; }
                    });
                } else {
                    // Regular text search
                    filtered = inputLogHistory.filter(entry => {
                        try {
                            const d = entry.data || {};
                            const fields = [
                                d.namaToko,
                                d.alias,
                                d.alamat,
                                d.tanggal,
                                d.nomorSJ,
                                d.supir,
                                d.noKendaraan
                            ].map(v => (v || '').toString().toLowerCase());

                            // Search inside kaca rows too
                            const kaca = d.kacaData || {};
                            const rows = Array.isArray(kaca) ? kaca : (kaca.rows || []);
                            const rowsText = rows.map(r => [r.jenisKaca, r.pwd, r.noDo, r.ukuran, r.box, r.lbr, r.totalLbr]
                                .map(v => (v || '').toString().toLowerCase()).join(' ')).join(' ');

                            return fields.some(text => text.includes(q)) || rowsText.includes(q);
                        } catch (_) { return false; }
                    });
                }
            }

            if (filtered.length === 0) {
                container.innerHTML = `
                    <div class="no-log-message">
                        <p>Tidak ada hasil untuk pencarian tersebut</p>
                        <p class="log-hint">Coba kata kunci lain atau kosongkan pencarian</p>
                    </div>
                `;
                return;
            }

            let html = '';
            filtered.forEach((entry) => {
                const timestamp = new Date(entry.timestamp).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                // Format date for compact display
                const compactDate = new Date(entry.data.tanggal).toLocaleDateString('id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit'
                });
                
                // Format kaca data for display
                const kacaDataDisplay = formatKacaDataForDisplay(entry.data.kacaData);
                
                const logId = entry.id;

                html += `
                    <div class="log-entry scroll-animate-row" onclick="toggleLogDetailsById('${logId}')" title="Klik untuk melihat detail lengkap" style="padding-left: 10px;">
                        <div class="log-entry-header" style="margin-bottom: 0px;">
                            <span class="log-timestamp">${escapeHtml(timestamp)}</span>
                            <span class="log-toggle-icon">📋</span>
                        </div>

                        <!-- Default view (compact single line) -->
                        <div class="log-content-default" id="log-default-${logId}">
                            <div class="log-compact-line">
                                <span class="log-compact-item">
                                    <span class="log-compact-label">🏪</span>
                                    <span class="log-compact-value">${escapeHtml(entry.data.namaToko)}</span>
                                </span>
                                ${entry.data.alias ? `
                                <span class="log-compact-separator">|</span>
                                <span class="log-compact-item">
                                    <span class="log-compact-label">🏷️</span>
                                    <span class="log-compact-value">${escapeHtml(entry.data.alias)}</span>
                                </span>` : ''}
                                <span class="log-compact-separator">|</span>
                                <span class="log-compact-item">
                                    <span class="log-compact-label">📅</span>
                                    <span class="log-compact-value">${escapeHtml(compactDate)}</span>
                                </span>
                                <span class="log-compact-separator">|</span>
                                <span class="log-compact-item">
                                    <span class="log-compact-label">📄</span>
                                    <span class="log-compact-value">${escapeHtml(entry.data.nomorSJ)}</span>
                                </span>
                            </div>
                        </div>

                        <!-- Detailed view (hidden by default) -->
                        <div class="log-content-detailed" id="log-detailed-${logId}" style="display: none;">
                            <div class="log-item">
                                <span class="log-label">Nama Toko</span>
                                <span class="log-sep">:</span>
                                <span class="log-value">${escapeHtml(entry.data.namaToko)}</span>
                            </div>
                            <div class="log-item">
                                <span class="log-label">Alias</span>
                                <span class="log-sep">:</span>
                                <span class="log-value">${escapeHtml(entry.data.alias || '-')}</span>
                            </div>
                            <div class="log-item">
                                <span class="log-label">Tanggal</span>
                                <span class="log-sep">:</span>
                                <span class="log-value">${escapeHtml(formatDateForDisplay(entry.data.tanggal))}</span>
                            </div>
                            <div class="log-item">
                                <span class="log-label">No. SJ</span>
                                <span class="log-sep">:</span>
                                <span class="log-value">${escapeHtml(entry.data.nomorSJ)}</span>
                            </div>
                            <div class="log-item">
                                <span class="log-label">Data Kaca</span>
                                <span class="log-sep">:</span>
                                <span class="log-value">${escapeHtml(kacaDataDisplay)}</span>
                            </div>

                            <!-- Action buttons for detailed view -->
                            <div class="log-actions-detailed" style="padding-top: 4px;">
                                <button type="button" class="btn-load-data" onclick="loadInputFromLogById('${logId}'); event.stopPropagation();" title="Muat data ke form">
                                    🔄 Muat ke Form
                                </button>
                                <button type="button" class="btn-edit-log" onclick="editLogEntryById('${logId}'); event.stopPropagation();" title="Edit log ini">
                                    ✏️ Edit
                                </button>
                                <button type="button" class="btn-delete-log" onclick="deleteLogEntryById('${logId}'); event.stopPropagation();" title="Hapus log ini">
                                    🗑️ Hapus
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            container.innerHTML = html;
            
            // Update duplicate warnings after rendering
            updateDuplicateWarnings();

            // Observe log entries for scroll animation
            observeLogScrollRows();
        }

        // Function to format kaca data for display in log
        function formatKacaDataForDisplay(kacaData) {
            if (!kacaData || !kacaData.rows || kacaData.rows.length === 0) {
                return 'Tidak ada data kaca';
            }
            
            const rows = kacaData.rows;
            const footer = kacaData.footer;
            
            let displayText = '';
            
            if (rows.length === 1) {
                const row = rows[0];
                displayText = `${row.jenisKaca} - ${row.ukuran} - ${row.totalLbr}`;
            } else {
                displayText = `${rows.length} baris data kaca (Total: ${calculateTotalFromKacaData(rows)} LBR)`;
            }
            
            // Add footer information (exclude grand total to avoid duplicate Total LBR)
            if (footer.cont || footer.seal) {
                const footerInfo = [];
                if (footer.cont) footerInfo.push(`CONT: ${footer.cont}`);
                if (footer.seal) footerInfo.push(`SEAL: ${footer.seal}`);
                
                if (footerInfo.length > 0) {
                    displayText += ` | ${footerInfo.join(', ')}`;
                }
            }
            
            return displayText;
        }

        // Function to calculate total from kaca data
        function calculateTotalFromKacaData(kacaData) {
            let total = 0;
            
            // Handle both old format (array) and new format (object with rows)
            const rows = Array.isArray(kacaData) ? kacaData : (kacaData.rows || []);
            
            rows.forEach(row => {
                if (row.totalLbr) {
                    const match = row.totalLbr.match(/^(\d+(?:\.\d+)?)/);
                    if (match) {
                        total += parseFloat(match[1]);
                    }
                }
            });
            
            return Math.round(total);
        }

        // Load input from log entry to form
        function loadInputFromLog(index, isEditing = false) {
            const entry = inputLogHistory[index];
            if (!entry) return;
            
            // If not editing, clear any existing editing state
            if (!isEditing) {
                cancelEditing();
            }
            
            // Fill form fields
            document.getElementById('namaToko').value = entry.data.namaToko;
            const aliasField = document.getElementById('alias');
            if (aliasField) aliasField.value = entry.data.alias || '';
            document.getElementById('alamat').value = entry.data.alamat;
            document.getElementById('tanggal').value = entry.data.tanggal;
            document.getElementById('nomorSJ').value = entry.data.nomorSJ;
            document.getElementById('supir').value = entry.data.supir;
            document.getElementById('noKendaraan').value = entry.data.noKendaraan;
            
            // Load kaca data if available
            if (entry.data.kacaData) {
                // Handle both old format (array) and new format (object with rows)
                const hasData = Array.isArray(entry.data.kacaData) ? 
                    entry.data.kacaData.length > 0 : 
                    (entry.data.kacaData.rows && entry.data.kacaData.rows.length > 0);
                
                if (hasData) {
                    loadKacaDataFromLog(entry.data.kacaData);
                    _log('🔄 Loading kaca data from log entry:', entry.data.kacaData);
                } else {
                    _log('ℹ️ No kaca data found in log entry');
                }
            } else {
                _log('ℹ️ No kacaData field in log entry');
            }
            
            // Auto-resize textarea
            const alamatField = document.getElementById('alamat');
            if (alamatField) {
                autoResizeTextarea(alamatField);
            }
            
            // Show success message
            alert(`LOG dari: ${entry.data.namaToko}`);
            
            _log('🔄 Loaded input from log entry:', entry);
        }

        // Function to load kaca data from log
        function loadKacaDataFromLog(kacaData) {
            const tbody = document.getElementById('kacaTableBody');
            if (!tbody) return;
            
            // Ensure suggestions are up to date before loading
            if (typeof updateKacaSuggestionsFromLogs === 'function') {
                updateKacaSuggestionsFromLogs();
            }

            // Handle both old format (array) and new format (object with rows)
            const rows = Array.isArray(kacaData) ? kacaData : (kacaData.rows || []);
            const footer = kacaData.footer || {};
            
            // Clear existing rows
            tbody.innerHTML = '';
            
            // Add rows based on log data
            rows.forEach((rowData, index) => {
                const newRow = document.createElement('tr');
                const rowId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + (Math.floor(Math.random() * 1000000)).toString(36));
                
                // Build cells without embedding unescaped values
                newRow.innerHTML = `
                    <td>
                        <input type="text" placeholder="Jenis Kaca" class="jenis-kaca" list="datalistJenisKaca" autocomplete="off" autocapitalize="none" spellcheck="false">
                    </td>
                    <td class="pwd-input">
                        <input type="text" placeholder="PWD" class="pwd" maxlength="3">
                    </td>
                    <td class="no-do-input">
                        <input type="text" placeholder="No DO" class="no-do">
                    </td>
                    <td>
                        <input type="text" placeholder="Ukuran" class="ukuran" list="datalistUkuran" autocomplete="off" autocapitalize="none" spellcheck="false">
                    </td>
                    <td class="harga-input">
                        <div class="harga-input-container">
                            <input type="text" placeholder="Beli" class="harga-beli" readonly tabindex="-1">
                            <input type="text" placeholder="Jual" class="harga-jual">
                        </div>
                    </td>
                    <td class="box-input">
                        <input type="text" placeholder="0 BOX" class="box">
                    </td>
                    <td class="lbr-input">
                        <input type="text" placeholder="0 LBR" class="lbr">
                    </td>
                    <td class="total-lbr">
                        <input type="text" placeholder="0 LBR" class="total-lbr-input" readonly>
                    </td>
                `;
                
                // Assign values safely to avoid HTML attribute issues with quotes
                const jenisEl = newRow.querySelector('.jenis-kaca');
                const pwdEl = newRow.querySelector('.pwd');
                const noDoEl = newRow.querySelector('.no-do');
                const ukuranEl = newRow.querySelector('.ukuran');
                const hargaBeliEl = newRow.querySelector('.harga-beli');
                const hargaEl = newRow.querySelector('.harga-jual');
                const boxEl = newRow.querySelector('.box');
                
                // Set transaction ID for sync if available
                if (rowData.stokTransactionId) {
                    newRow.setAttribute('data-transaction-id', rowData.stokTransactionId);
                }
                
                if (jenisEl) jenisEl.value = rowData.jenisKaca || '';
                if (pwdEl) pwdEl.value = rowData.pwd || '';
                if (noDoEl) noDoEl.value = rowData.noDo || '';
                
                if (ukuranEl) {
                    ukuranEl.value = rowData.ukuran || '';
                    // CRITICAL: Set explicit lock for size and price to prevent auto-detection from picking wrong price
                    if (rowData.ukuran && rowData.hargaBeli) {
                        const hBeli = String(rowData.hargaBeli).replace(/[^\d]/g, '');
                        ukuranEl.setAttribute('data-explicit-size', rowData.ukuran);
                        ukuranEl.setAttribute('data-explicit-price', hBeli);
                        ukuranEl.setAttribute('data-selected-harga', hBeli);
                        _log(`[Load Log] Locked size "${rowData.ukuran}" with price "${hBeli}"`);
                    }
                }
                
                // Set harga beli and mark it as manually set to prevent auto-update from overwriting it
                if (hargaBeliEl) {
                    const hBeli = rowData.hargaBeli || '';
                    hargaBeliEl.value = hBeli;
                    if (hBeli) {
                        hargaBeliEl.setAttribute('data-manual-harga-beli', 'true');
                        hargaBeliEl.setAttribute('data-original-value', hBeli);
                    }
                }

                // Set harga jual and mark it as manually set to prevent auto-update from overwriting it
                if (hargaEl) {
                    const loadedHargaJual = rowData.hargaJual || rowData.harga || '';
                    if (loadedHargaJual) {
                        hargaEl.value = loadedHargaJual;
                        // Mark harga jual as manually set to prevent auto-update from overwriting it
                        hargaEl.setAttribute('data-manual-harga', 'true');
                    }
                    // Add event listener to allow user to edit harga jual
                    // When user changes harga jual, remove the flag so it can be updated if needed
                    hargaEl.addEventListener('input', function() {
                        // Remove flag when user manually edits harga jual
                        this.removeAttribute('data-manual-harga');
                    });
                    hargaEl.addEventListener('change', function() {
                        // Remove flag when user manually edits harga jual
                        this.removeAttribute('data-manual-harga');
                    });
                }
                const lbrEl = newRow.querySelector('.lbr');
                const totalEl = newRow.querySelector('.total-lbr-input');
                if (boxEl) boxEl.value = rowData.box || '';
                if (lbrEl) lbrEl.value = rowData.lbr || '';
                if (totalEl) totalEl.value = rowData.totalLbr || '';
                
                // Recalculate row total to ensure correct value after loading
                // Using lbr input as reference; function will read both BOX and LBR
                if (typeof calculateTotalLbr === 'function' && (boxEl || lbrEl)) {
                    const refInput = lbrEl || boxEl;
                    try { calculateTotalLbr(refInput); } catch (_) {}
                }

                // Force sync internal price logic for this row
                if (ukuranEl && rowData.ukuran) {
                    setTimeout(() => {
                        updateHargaUkuranLogic(ukuranEl, true);
                    }, 50);
                }
                
                // Attach event listeners for jenis kaca and ukuran (same as in addKacaRow)
                if (jenisEl) {
                    jenisEl.setAttribute('autocomplete', 'off');
                    jenisEl.setAttribute('autocapitalize', 'none');
                    jenisEl.setAttribute('spellcheck', 'false');
                }

                // Attach event listeners for ukuran with harga tracking (same as in addKacaRow)
                if (ukuranEl) {
                    ukuranEl.setAttribute('autocomplete', 'off');
                    ukuranEl.setAttribute('autocapitalize', 'none');
                    ukuranEl.setAttribute('spellcheck', 'false');

                    // Initial update based on loaded data
                    if (jenisEl && jenisEl.value.trim() && ukuranEl.value.trim()) {
                        updateUkuranByJenisKaca(jenisEl.value.trim(), ukuranEl);
                        setTimeout(() => {
                            if (ukuranEl.value.trim()) {
                                updateHargaUkuranLogic(ukuranEl, true);
                            }
                        }, 200);
                    } else if (ukuranEl.value.trim()) {
                        updateKacaSuggestionsFromLogs();
                        setTimeout(() => {
                            if (ukuranEl.value.trim()) {
                                updateHargaUkuranLogic(ukuranEl, true);
                            }
                        }, 200);
                    }
                }
                
                tbody.appendChild(newRow);
            });
            
            // Load footer data (CONT and SEAL)
            if (footer.cont) {
                const contInput = document.querySelector('.cont-input');
                if (contInput) contInput.value = footer.cont;
            }
            
            if (footer.seal) {
                const sealInput = document.querySelector('.seal-input');
                if (sealInput) sealInput.value = footer.seal;
            }
            
            // Update grand total and refresh print data after rows populated
            setTimeout(() => {
                try { updateGrandTotal(); } catch (_) {}
                const printModal = document.getElementById('printModalOverlay');
                if (printModal && printModal.style.display === 'flex') {
                    try { refreshPrintData(); } catch (_) {}
                }
            }, 150);
            
            _log('🔄 Loaded kaca data from log:', { rows, footer });
        }

        // Export input log to file
        // Removed exportInputLog (not used anymore)

        // Function to format kaca data for CSV export
        // Removed formatKacaDataForCSV (not used anymore)

        // Clear all input logs
        async function clearInputLog() {
            if (confirm('Apakah Anda yakin ingin menghapus semua log input? Tindakan ini tidak dapat dibatalkan.')) {
                try {
                    // Collect all log entry IDs before clearing
                    const logEntryIds = inputLogHistory.map(entry => entry.id).filter(id => id != null);
                    
                    // Clear input logs
                    inputLogHistory = [];
                    saveInputLogToStorage();
                    renderInputLog();
                    
                    // Delete related stok entries
                    if (logEntryIds.length > 0) {
                        // Ensure stokData is loaded
                        if (typeof window.stokData === 'undefined' || !Array.isArray(window.stokData)) {
                            try {
                                if (typeof loadData === 'function') {
                                    await loadData();
                                } else {
                                    window.stokData = [];
                                }
                            } catch (e) {
                                console.warn('Failed to load stokData:', e);
                                window.stokData = [];
                            }
                        }
                        
                        const currentStokData = window.stokData || [];
                        
                        // Find all stok entries linked to these log entries
                        const stokEntriesToDelete = currentStokData.filter(entry =>
                            entry.logEntryId != null && logEntryIds.some(id => String(entry.logEntryId) === String(id))
                        );
                        
                        _log(`🗑️ Found ${stokEntriesToDelete.length} stok entries linked to ${logEntryIds.length} log entries`);
                        
                        // Delete each stok entry from IndexedDB and arrays
                        for (const stokEntry of stokEntriesToDelete) {
                            try {
                                // Remove from arrays
                                if (Array.isArray(window.stokData)) {
                                    const index = window.stokData.findIndex(e => e.id === stokEntry.id);
                                    if (index !== -1) {
                                        window.stokData.splice(index, 1);
                                    }
                                }
                                
                                if (typeof stokData !== 'undefined' && Array.isArray(stokData)) {
                                    stokData = stokData.filter(e => e.id !== stokEntry.id);
                                }
                                
                                // Delete from IndexedDB
                                if (typeof deleteEntryFromDB === 'function') {
                                    await deleteEntryFromDB(stokEntry.id);
                                }
                            } catch (error) {
                                console.error('Error deleting stok entry:', stokEntry.id, error);
                            }
                        }
                        
                        // Update UI if functions are available
                        _markRender(1|2|4|8|16);

                        _log(`✅ Deleted ${stokEntriesToDelete.length} related stok entries`);
                        
                        // Delete remote stock entries if SyncManager is available
                        if (window.syncManager) {
                            const stockIds = stokEntriesToDelete.map(e => e.id).filter(id => id != null);
                            if (stockIds.length > 0) {
                                window.syncManager.deleteRemoteStockEntries(stockIds);
                            }
                        }
                    }
                    
                    alert('Semua log input dan data terkait di riwayat stok telah dihapus!');
                    _log('🗑️ Cleared all input logs and related stok entries');

                    // Clear remote logs as well
                    if (window.syncManager) {
                        window.syncManager.clearRemoteData('logs');
                    }
                } catch (error) {
                    console.error('Error clearing logs:', error);
                    alert('Terjadi kesalahan saat menghapus log. Beberapa data mungkin tidak terhapus.');
                }
            }
        }

        // Edit a specific log entry: load into form for editing (entry will be replaced when saved)
        function editLogEntry(index) {
            const entry = inputLogHistory[index];
            if (!entry) return;
            
            // Store reference to entry being edited
            editingLogEntry = { entry: entry, index: index };
            
            // Load to form
            loadInputFromLog(index, true);
            
            // Show editing indicator
            showEditingIndicator();

            // Automatically scroll to the form and focus on the first field
            const formElement = document.getElementById('tokoForm');
            if (formElement) {
                formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Small delay to allow scroll to complete before focusing
                setTimeout(() => {
                    const firstInput = document.getElementById('namaToko');
                    if (firstInput) {
                        firstInput.focus();
                        // Select text for easier editing
                        firstInput.select();
                    }
                }, 500);
            }
        }

        // Show editing mode indicator
        function showEditingIndicator() {
            // Remove existing indicator
            const existing = document.getElementById('editingIndicator');
            if (existing) existing.remove();
            
            // Create new indicator
            const indicator = document.createElement('div');
            indicator.id = 'editingIndicator';
            indicator.className = 'editing-indicator';
            indicator.innerHTML = '✏️ Mode Edit';
            document.body.appendChild(indicator);
        }

        // Hide editing mode indicator
        function hideEditingIndicator() {
            const indicator = document.getElementById('editingIndicator');
            if (indicator) indicator.remove();
        }

        // Cancel editing and restore original entry
        function cancelEditing() {
            if (editingLogEntry) {
                editingLogEntry = null;
                hideEditingIndicator();
                _log('❌ Editing cancelled');
            }
        }

        // Delete a specific log entry
        async function deleteLogEntry(index) {
            const entry = inputLogHistory[index];
            if (!entry) return;
            if (confirm('Hapus log ini? Tindakan ini tidak dapat dibatalkan.')) {
                // Get log entry ID and nomorSJ from the entry to delete related stok transactions
                const logEntryId = entry.id;
                const nomorSJ = entry.data?.nomorSJ || '';
                
                // Delete related stok transactions if logEntryId exists
                if (logEntryId) {
                    try {
                        // Ensure stokData is loaded
                        if (typeof window.stokData === 'undefined' || !Array.isArray(window.stokData)) {
                            if (typeof loadData === 'function') {
                                await loadData();
                            } else {
                                window.stokData = [];
                            }
                        }
                        
                        // Find all stok transactions with matching logEntryId (more precise than nota)
                        const currentStokData = window.stokData || [];
                        const transactionsToDelete = currentStokData.filter(stokEntry => {
                            return stokEntry.logEntryId === logEntryId;
                        });
                        
                        if (transactionsToDelete.length > 0) {
                            // Delete from IndexedDB and array
                            for (const transaction of transactionsToDelete) {
                                // Delete from IndexedDB
                                let deleteFunc = null;
                                if (typeof window.deleteEntryFromDB === 'function') {
                                    deleteFunc = window.deleteEntryFromDB;
                                } else if (typeof deleteEntryFromDB === 'function') {
                                    deleteFunc = deleteEntryFromDB;
                                }
                                
                                if (deleteFunc) {
                                    try {
                                        await deleteFunc(transaction.id);
                                    } catch (error) {
                                        console.error(`Error deleting transaction ID ${transaction.id} from DB:`, error);
                                    }
                                }
                                
                                // Remove from stokData array
                                const stokIndex = window.stokData.findIndex(e => e.id === transaction.id);
                                if (stokIndex !== -1) {
                                    window.stokData.splice(stokIndex, 1);
                                }
                            }
                            
                            // Update UI
                            _markRender(1|2|8|16);

                            // Delete related stok from backend
                            if (window.syncManager) {
                                const stockIds = transactionsToDelete.map(e => e.id).filter(id => id != null);
                                if (stockIds.length > 0) {
                                    // Use set timeout to not block UI
                                    setTimeout(() => {
                                        window.syncManager.deleteRemoteStockEntries(stockIds);
                                    }, 100);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error deleting related stok transactions:', error);
                    }
                }
                
                // Delete from backend BEFORE DOM teardown (button still alive)
                if (window.syncManager && window.syncManager.backend && logEntryId) {
                    const btn = document.activeElement;
                    let originalText;
                    if (btn && btn.tagName === 'BUTTON') {
                        originalText = btn.innerHTML;
                        btn.innerHTML = '⏳...';
                        btn.disabled = true;
                    }
                    try {
                        await window.syncManager.backend.deleteLog(logEntryId);
                        _log(`Remote log ${logEntryId} deleted.`);
                    } catch (e) {
                        console.error(`Failed to delete remote log ${logEntryId}:`, e);
                        alert('Log dihapus dari lokal, tetapi GAGAL dihapus dari server: ' + e.message);
                    } finally {
                        if (btn && btn.tagName === 'BUTTON') {
                            btn.innerHTML = originalText || 'Hapus';
                            btn.disabled = false;
                        }
                    }
                }

                // Delete the log entry (DOM destroyed — renderInputLog rebuilds it)
                inputLogHistory.splice(index, 1);
                saveInputLogToStorage();
                renderInputLog();

                alert('Log berhasil dihapus.');
            }
        }

        // Helper function to format date for display
        function formatDateForDisplay(dateString) {
            if (!dateString) return 'Tidak ada tanggal';
            
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            
            return date.toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });
        }

        // Load input log when page loads
        document.addEventListener('DOMContentLoaded', function() {
            loadInputLogFromStorage();
            // Reset search filter on page load
            resetLogSearchFilter();
            // Build initial suggestions (once after initial log load)
            updateKacaSuggestionsFromLogs();
            // Update supir and kendaraan suggestions with a small delay to ensure data is loaded
            setTimeout(function() {
                updateSupirDanKendaraanSuggestions();
            }, 100);
            // Disable browser autocomplete on existing inputs to avoid duplicate dropdowns
            document.querySelectorAll('input.jenis-kaca, input.ukuran').forEach(el => {
                el.setAttribute('autocomplete', 'off');
                el.setAttribute('autocapitalize', 'none');
                el.setAttribute('spellcheck', 'false');
            });
            
            // Ensure restore file input has proper multiple attribute
            const restoreInput = document.getElementById('restoreLogFileInput');
            if (restoreInput) {
                restoreInput.setAttribute('multiple', 'multiple');
            }
            
            // Add event listeners to update suggestions when input fields are focused
            const supirInput = document.getElementById('supir');
            const noKendaraanInput = document.getElementById('noKendaraan');
            
            if (supirInput) {
                supirInput.addEventListener('focus', function() {
                    updateSupirDanKendaraanSuggestions();
                });
            }
            
            if (noKendaraanInput) {
                noKendaraanInput.addEventListener('focus', function() {
                    updateSupirDanKendaraanSuggestions();
                });
            }
        });

        // Export input log to CSV (Excel compatible)
        function exportInputLogToCSV() {
            if (!inputLogHistory || inputLogHistory.length === 0) {
                alert('Tidak ada log untuk diexport.');
                return;
            }

            // Header dengan nama yang lebih jelas dan rapi
            const header = [
                'Timestamp',
                'Nama Toko',
                'Alias',
                'Alamat',
                'Tanggal',
                'Nomor SJ',
                'Supir',
                'No Kendaraan',
                'Jenis Kaca PWD',
                'No DO',
                'Ukuran=Box@Lbr',
                'Harga Jual',
                'Total Lebar',
                'Container',
                'Seal',
                'Grand Total'
            ];

            // Helper function untuk format field - format sederhana tanpa quote berlebihan
            const formatCSVField = (val) => {
                if (val === null || val === undefined) return '';
                let str = String(val).trim();
                // Replace newlines dengan spasi
                str = str.replace(/\n/g, ' ').replace(/\r/g, ' ');
                // Hanya quote jika mengandung separator atau quote
                if (str.includes(separator) || str.includes('"')) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            };

            const buildJenisKacaPwd = (row = {}) => {
                const jenis = (row.jenisKaca || '').toString().trim();
                const pwd = (row.pwd || '').toString().trim();
                if (!jenis && !pwd) return '';
                if (jenis && pwd) return `${jenis} ${pwd}`;
                return jenis || pwd;
            };

            const buildUkuranBoxLbr = (row = {}) => {
                const ukuran = (row.ukuran || '').toString().trim();
                const box = (row.box || '').toString().trim();
                const lbr = (row.lbr || '').toString().trim();
                if (!ukuran && !box && !lbr) return '';
                return `${ukuran}=${box}@${lbr}`;
            };

            const lines = [];
            // Gunakan semicolon untuk kompatibilitas Excel Indonesia (lebih umum digunakan)
            const separator = ';';
            
            // Add UTF-8 BOM for Excel compatibility
            lines.push('\uFEFF' + header.map(formatCSVField).join(separator));

            inputLogHistory.forEach(entry => {
                const d = entry.data || {};
                const kaca = d.kacaData || {};
                const rows = Array.isArray(kaca) ? kaca : (kaca.rows || []);
                const footer = kaca.footer || {};

                // Jika ada rows, buat satu baris per row kaca untuk lebih rapi
                if (rows && rows.length > 0) {
                    rows.forEach((row, idx) => {
                        const rec = [
                            idx === 0 ? (entry.timestamp || '') : '', // Timestamp hanya di baris pertama
                            idx === 0 ? (d.namaToko || '') : '',
                            idx === 0 ? (d.alias || '') : '',
                            idx === 0 ? (d.alamat || '').replace(/\n/g, ' ') : '',
                            idx === 0 ? (d.tanggal || '') : '',
                            idx === 0 ? (d.nomorSJ || '') : '',
                            idx === 0 ? (d.supir || '') : '',
                            idx === 0 ? (d.noKendaraan || '') : '',
                            buildJenisKacaPwd(row),
                            row.noDo || '',
                            buildUkuranBoxLbr(row),
                            row.hargaJual || row.harga || '',
                            row.totalLbr || '',
                            idx === rows.length - 1 ? (footer.cont || '') : '', // Footer hanya di baris terakhir
                            idx === rows.length - 1 ? (footer.seal || '') : '',
                            idx === rows.length - 1 ? (footer.grandTotal || '') : ''
                        ];
                        lines.push(rec.map(formatCSVField).join(separator));
                    });
                } else {
                    // Jika tidak ada rows, tetap export data utama
                    const rec = [
                        entry.timestamp || '',
                        d.namaToko || '',
                        d.alias || '',
                        (d.alamat || '').replace(/\n/g, ' '),
                        d.tanggal || '',
                        d.nomorSJ || '',
                        d.supir || '',
                        d.noKendaraan || '',
                        '', '', '', '', '', // Kolom kaca kosong (Jenis Kaca+PWD s/d Harga Jual)
                        footer.cont || '',
                        footer.seal || '',
                        footer.grandTotal || ''
                    ];
                    lines.push(rec.map(formatCSVField).join(separator));
                }
            });

            // Gunakan \r\n untuk line ending Windows dan pastikan format benar
            const csvContent = lines.join('\r\n');
            // Gunakan text/csv untuk CSV dengan semicolon separator
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'input_log_history.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // Import from new CSV format (one row per kaca item)
        function importInputLogFromCSVNewFormat(lines, header, rawHeader, separator) {
            const hidx = Object.fromEntries(header.map((h,i)=>[h,i]));
            const imported = [];
            let currentEntry = null;
            let currentRows = [];

            const getValue = (row, key) => {
                const idx = hidx[key];
                if (idx === undefined) return '';
                const val = (row[idx] || '').replace(/^\"|\"$/g, '').trim();
                return val;
            };

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVLine(lines[i], separator);
                if (!row || row.length === 0) continue;

                const timestamp = getValue(row, 'timestamp');
                const namaToko = getValue(row, 'namaToko');
                
                // If this row has timestamp and namaToko, it's a new entry (or first row of entry)
                if (timestamp && namaToko) {
                    // Save previous entry if exists
                    if (currentEntry) {
                        currentEntry.data.kacaData.rows = currentRows;
                        imported.push(currentEntry);
                    }
                    
                    // Start new entry
                    const alias = getValue(row, 'alias');
                    const alamat = getValue(row, 'alamat').replace(/\\n/g, '\n');
                    const tanggal = getValue(row, 'tanggal');
                    const nomorSJ = getValue(row, 'nomorSJ');
                    const supir = getValue(row, 'supir');
                    const noKendaraan = getValue(row, 'noKendaraan');

                    currentEntry = {
                        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
                            ? crypto.randomUUID()
                            : (Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2)),
                        timestamp: timestamp || new Date().toISOString(),
                        data: {
                            namaToko,
                            alias,
                            alamat,
                            tanggal,
                            nomorSJ,
                            supir,
                            noKendaraan,
                            kacaData: {
                                rows: [],
                                footer: {
                                    cont: '',
                                    seal: '',
                                    grandTotal: ''
                                }
                            }
                        }
                    };
                    currentRows = [];
                }
                
                // Get footer values (only from rows that have them, typically last row of entry)
                const cont = getValue(row, 'cont');
                const seal = getValue(row, 'seal');
                const grandTotal = getValue(row, 'grandTotal');
                if (currentEntry && (cont || seal || grandTotal)) {
                    currentEntry.data.kacaData.footer.cont = cont || currentEntry.data.kacaData.footer.cont;
                    currentEntry.data.kacaData.footer.seal = seal || currentEntry.data.kacaData.footer.seal;
                    currentEntry.data.kacaData.footer.grandTotal = grandTotal || currentEntry.data.kacaData.footer.grandTotal;
                }

                // Parse kaca row data (use normalized keys)
                const jenisKacaPwd = getValue(row, 'jenisKacaPwd');
                const noDo = getValue(row, 'noDo');
                const ukuranBoxLbr = getValue(row, 'ukuranBoxLbr');
                const hargaJual = getValue(row, 'hargaJual');
                const totalLbr = getValue(row, 'totalLbr');

                // Parse jenisKacaPwd: format "Jenis PWD" or "Jenis" or "PWD"
                // Smart parsing: only separate if last part looks like PWD
                // PWD criteria: 3 chars or less, letters only, AND previous parts don't contain numbers
                // This prevents "FL 2MM KCC" from being split (because "2MM" contains number)
                let jenisKaca = '';
                let pwd = '';
                if (jenisKacaPwd) {
                    const parts = jenisKacaPwd.trim().split(/\s+/);
                    if (parts.length >= 2) {
                        const lastPart = parts[parts.length - 1];
                        const previousParts = parts.slice(0, -1).join(' ');
                        // Check if last part looks like PWD: 3 characters or less, letters only
                        const isLikelyPWD = lastPart.length <= 3 && /^[A-Za-z]+$/.test(lastPart);
                        // Also check if previous parts contain numbers - if yes, likely the whole thing is jenis kaca
                        const previousHasNumbers = /\d/.test(previousParts);
                        
                        if (isLikelyPWD && !previousHasNumbers) {
                            // Separate: last part is PWD (and previous parts don't have numbers)
                            jenisKaca = previousParts;
                            pwd = lastPart;
                        } else {
                            // Last part is part of jenis kaca, not PWD
                            // This handles cases like "FL 2MM KCC" where KCC is part of jenis kaca
                            jenisKaca = parts.join(' ');
                            pwd = '';
                        }
                    } else {
                        jenisKaca = jenisKacaPwd;
                        pwd = '';
                    }
                }

                // Parse ukuranBoxLbr: format "Ukuran=Box@Lbr"
                let ukuran = '';
                let box = '';
                let lbr = '';
                if (ukuranBoxLbr) {
                    const match = ukuranBoxLbr.match(/^(.+?)=(.+?)@(.+)$/);
                    if (match) {
                        ukuran = match[1];
                        box = match[2];
                        lbr = match[3];
                    } else {
                        ukuran = ukuranBoxLbr;
                    }
                }

                // Only add row if there's actual kaca data
                if (jenisKaca || pwd || noDo || ukuran || box || lbr || hargaJual || totalLbr) {
                    currentRows.push({
                        jenisKaca,
                        pwd,
                        noDo,
                        ukuran,
                        box,
                        lbr,
                        hargaJual: hargaJual || '',
                        totalLbr
                    });
                }
            }

            // Save last entry
            if (currentEntry) {
                currentEntry.data.kacaData.rows = currentRows;
                imported.push(currentEntry);
            }

            // Merge strategy: append imported at the beginning (newer first)
            inputLogHistory = [...imported, ...inputLogHistory];

            saveInputLogToStorage();
            renderInputLog();
            updateKacaSuggestionsFromLogs();
            
            // Process stok transactions from imported log entries
            processStokFromImportedLogs(imported);
        }

        // Handle import CSV for input log
        function handleImportLogFile(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const text = e.target.result;
                    importInputLogFromCSV(text);
                    alert('Import log berhasil.');
                } catch (err) {
                    console.error('Import CSV error:', err);
                    alert('Gagal import CSV: ' + err.message);
                } finally {
                    // reset input so same file can be chosen again later
                    event.target.value = '';
                }
            };
            reader.readAsText(file, 'utf-8');
        }

        // Trigger restore file selection
        function triggerRestoreFileSelection() {
            const input = document.getElementById('restoreLogFileInput');
            if (input) {
                // Ensure multiple attribute is set
                input.setAttribute('multiple', 'multiple');
                _log('Triggering restore file selection, multiple:', input.multiple);
                input.click();
            } else {
                console.error('Restore file input not found');
            }
        }

        // Handle restore from multiple backup files
        function handleRestoreLogFiles(event) {
            _log('=== RESTORE FUNCTION CALLED ===');
            const files = event.target.files;
            _log('Selected files:', files);
            _log('Number of files:', files ? files.length : 0);
            
            if (!files || files.length === 0) {
                _log('No files selected - exiting');
                alert('Tidak ada file yang dipilih');
                return;
            }
            
            // Debug: log file names and details
            _log('=== FILE DETAILS ===');
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                _log(`File ${i + 1}:`, {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: new Date(file.lastModified)
                });
            }
            
            // Show progress dialog
            _log('Creating progress dialog...');
            const progressDialog = showRestoreProgressDialog(files.length);
            
            processRestoreFiles(files, progressDialog)
                .then(() => {
                    hideRestoreProgressDialog(progressDialog);
                    alert(`Restore berhasil! ${files.length} file backup telah diproses.`);
                })
                .catch(err => {
                    hideRestoreProgressDialog(progressDialog);
                    console.error('Restore error:', err);
                    alert('Gagal restore: ' + err.message);
                })
                .finally(() => {
                    // Reset file input to allow selecting same files again
                    event.target.value = '';
                    _log('File input reset');
                });
        }

        // Show restore progress dialog
        function showRestoreProgressDialog(totalFiles) {
            const dialog = document.createElement('div');
            dialog.id = 'restoreProgressDialog';
            dialog.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            `;
            
            const content = document.createElement('div');
            content.style.cssText = `
                background: white;
                padding: 30px;
                border-radius: 12px;
                text-align: center;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                max-width: 400px;
                width: 90%;
            `;
            
            content.innerHTML = `
                <h3 style="margin: 0 0 20px 0; color: #333;">🔄 Memproses Restore</h3>
                <div id="restoreProgressText">Membaca file 1 dari ${totalFiles}...</div>
                <div style="margin: 20px 0;">
                    <div style="background: #f0f0f0; border-radius: 10px; height: 20px; overflow: hidden;">
                        <div id="restoreProgressBar" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                    </div>
                </div>
                <div id="restoreStatusText" style="font-size: 14px; color: #666; margin-top: 10px;">Memulai proses...</div>
            `;
            
            dialog.appendChild(content);
            document.body.appendChild(dialog);
            return dialog;
        }

        // Hide restore progress dialog
        function hideRestoreProgressDialog(dialog) {
            if (dialog && dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        }

        // Process multiple restore files
        async function processRestoreFiles(files, progressDialog) {
            _log('=== PROCESSING RESTORE FILES ===');
            const allLogs = new Map(); // Use Map to store logs by ID, keeping only the latest
            const fileArray = Array.from(files);
            _log('Processing', fileArray.length, 'files');
            
            for (let i = 0; i < fileArray.length; i++) {
                const file = fileArray[i];
                const progressText = document.getElementById('restoreProgressText');
                const progressBar = document.getElementById('restoreProgressBar');
                const statusText = document.getElementById('restoreStatusText');
                
                _log(`\n--- Processing file ${i + 1}/${fileArray.length}: ${file.name} ---`);
                
                if (progressText) progressText.textContent = `Membaca file ${i + 1} dari ${fileArray.length}: ${file.name}`;
                if (statusText) statusText.textContent = `Memproses ${file.name}...`;
                
                try {
                    _log('Reading file content...');
                    const fileContent = await readFileAsText(file);
                    _log('File content length:', fileContent.length, 'characters');
                    _log('First 200 chars:', fileContent.substring(0, 200));
                    
                    let logs = [];
                    
                    // Determine file type and parse accordingly
                    if (file.name.toLowerCase().endsWith('.json')) {
                        _log('Parsing as JSON...');
                        logs = parseJSONToLogs(fileContent);
                        _log(`✅ Parsed JSON file ${file.name}:`, logs.length, 'entries');
                    } else if (file.name.toLowerCase().endsWith('.csv')) {
                        _log('Parsing as CSV...');
                        logs = parseCSVToLogs(fileContent);
                        _log(`✅ Parsed CSV file ${file.name}:`, logs.length, 'entries');
                    } else {
                        console.warn(`❌ Unsupported file type: ${file.name}`);
                        if (statusText) statusText.textContent = `Peringatan: File ${file.name} tidak didukung (hanya CSV/JSON)`;
                        continue;
                    }
                    
                    // Debug: log sample entries
                    if (logs.length > 0) {
                        _log('Sample log entry:', logs[0]);
                    }
                    
                    // Merge logs, keeping the latest version of each entry
                    let mergedCount = 0;
                    logs.forEach(log => {
                        if (log.id && log.timestamp) {
                            const existingLog = allLogs.get(log.id);
                            if (!existingLog || new Date(log.timestamp) > new Date(existingLog.timestamp)) {
                                allLogs.set(log.id, log);
                                mergedCount++;
                            }
                        } else {
                            console.warn('Log entry missing ID or timestamp:', log);
                        }
                    });
                    
                    _log(`Merged ${mergedCount} new/updated entries from ${file.name}`);
                    if (statusText) statusText.textContent = `File ${file.name} berhasil diproses (${logs.length} entri, ${mergedCount} baru/diupdate)`;
                    
                } catch (err) {
                    console.error(`❌ Error processing file ${file.name}:`, err);
                    console.error('Error stack:', err.stack);
                    if (statusText) statusText.textContent = `Error: File ${file.name} gagal diproses - ${err.message}`;
                }
                
                // Update progress bar
                const progress = ((i + 1) / fileArray.length) * 100;
                if (progressBar) progressBar.style.width = progress + '%';
                _log(`Progress: ${progress.toFixed(1)}%`);
            }
            
            // Convert Map back to array and sort by timestamp (newest first)
            _log('\n=== FINALIZING RESTORE ===');
            _log('Total unique logs collected:', allLogs.size);
            
            const mergedLogs = Array.from(allLogs.values()).sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );
            
            _log('Final merged logs count:', mergedLogs.length);
            _log('Sample final log:', mergedLogs[0]);
            
            const statusText = document.getElementById('restoreStatusText');
            if (statusText) statusText.textContent = `Menggabungkan ${mergedLogs.length} entri unik...`;
            
            // Replace current log history with merged logs
            _log('Replacing inputLogHistory...');
            inputLogHistory = mergedLogs;
            
            _log('Saving to storage...');
            saveInputLogToStorage();
            
            _log('Rendering log display...');
            renderInputLog();
            
            // Process stok transactions from restored log entries
            _log('Processing stok transactions from restored logs...');
            if (typeof processStokFromImportedLogs === 'function') {
                try {
                    await processStokFromImportedLogs(mergedLogs);
                    _log('✅ Stok transactions processed from restored logs');
                } catch (error) {
                    console.error('⚠️ Error processing stok from restored logs:', error);
                }
            } else {
                console.warn('⚠️ processStokFromImportedLogs function not available');
            }
            
            if (statusText) statusText.textContent = `Restore selesai! ${mergedLogs.length} entri log telah dipulihkan.`;
            _log('✅ Restore process completed successfully');
        }

        // Read file as text (Promise-based)
        function readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = e => reject(new Error('Gagal membaca file: ' + file.name));
                reader.readAsText(file, 'utf-8');
            });
        }

        // Parse CSV content to log entries
        function parseCSVToLogs(csvText) {
            const lines = csvText.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
            if (lines.length <= 1) return [];

            const hasSemicolon = lines[0].includes(';');
            const hasComma = lines[0].includes(',');
            const separator = (hasSemicolon && !hasComma) || (hasSemicolon && hasComma) ? ';' : ',';

            const header = parseCSVLine(lines[0], separator).map(h => h.replace(/^\"|\"$/g,''));
            const required = ['timestamp','namaToko','alamat','tanggal','nomorSJ','supir','noKendaraan','kacaRows'];

            for (const key of required) {
                if (!header.includes(key)) throw new Error('Header CSV tidak valid, kurang kolom: ' + key);
            }

            const hidx = Object.fromEntries(header.map((h,i)=>[h,i]));
            const logs = [];

            for (let i = 1; i < lines.length; i++) {
                try {
                    const fields = parseCSVLine(lines[i], separator);
                    const getField = (name) => (fields[hidx[name]] || '').replace(/^\"|\"$/g,'');
                    
                    // Parse kaca rows - support both old format (kacaRows string) and new format (separate columns)
                    let kacaRows = [];
                    const kacaRowsStr = getField('kacaRows');
                    if (kacaRowsStr) {
                        // Old format: kacaRows as string separated by ||
                        kacaRows = kacaRowsStr.split('||').map(rowStr => {
                            const vals = rowStr.split('|');
                            return {
                                jenisKaca: vals[0] || '',
                                pwd: vals[1] || '',
                                noDo: vals[2] || '',
                                ukuran: vals[3] || '',
                                hargaJual: vals[4] || vals[7] || '', // Support both old and new format
                                box: vals[5] || vals[4] || '', // Support both old and new format
                                lbr: vals[6] || vals[5] || '', // Support both old and new format
                                totalLbr: vals[7] || vals[6] || '' // Support both old and new format
                            };
                        });
                    } else {
                        // New format: separate columns
                        const jenisKacaPwd = getField('Jenis Kaca PWD') || '';
                        const noDo = getField('No DO') || '';
                        const ukuranBoxLbr = getField('Ukuran=Box@Lbr') || '';
                        const hargaJual = getField('Harga Jual') || '';
                        const totalLbr = getField('Total Lebar') || '';
                        
                        // Parse jenisKacaPwd (format: "jenis pwd" or "jenis" or "pwd")
                        // Smart parsing: only separate if last part looks like PWD
                        // PWD criteria: 3 chars or less, letters only, AND previous parts don't contain numbers
                        // This prevents "FL 2MM KCC" from being split (because "2MM" contains number)
                        const jenisKacaPwdParts = jenisKacaPwd.trim().split(/\s+/);
                        let jenisKaca = '';
                        let pwd = '';
                        if (jenisKacaPwdParts.length >= 2) {
                            const lastPart = jenisKacaPwdParts[jenisKacaPwdParts.length - 1];
                            const previousParts = jenisKacaPwdParts.slice(0, -1).join(' ');
                            // Check if last part looks like PWD: 3 characters or less, letters only
                            const isLikelyPWD = lastPart.length <= 3 && /^[A-Za-z]+$/.test(lastPart);
                            // Also check if previous parts contain numbers - if yes, likely the whole thing is jenis kaca
                            const previousHasNumbers = /\d/.test(previousParts);
                            
                            if (isLikelyPWD && !previousHasNumbers) {
                                // Separate: last part is PWD (and previous parts don't have numbers)
                                jenisKaca = previousParts;
                                pwd = lastPart;
                            } else {
                                // Last part is part of jenis kaca, not PWD
                                // This handles cases like "FL 2MM KCC" where KCC is part of jenis kaca
                                jenisKaca = jenisKacaPwdParts.join(' ');
                                pwd = '';
                            }
                        } else if (jenisKacaPwdParts.length === 1) {
                            jenisKaca = jenisKacaPwdParts[0];
                            pwd = '';
                        }
                        
                        // Parse ukuranBoxLbr (format: "ukuran=box@lbr")
                        let ukuran = '';
                        let box = '';
                        let lbr = '';
                        if (ukuranBoxLbr) {
                            const parts = ukuranBoxLbr.split('@');
                            if (parts.length === 2) {
                                const ukuranBox = parts[0].split('=');
                                ukuran = ukuranBox[0] || '';
                                box = ukuranBox[1] || '';
                                lbr = parts[1] || '';
                            } else {
                                ukuran = ukuranBoxLbr;
                            }
                        }
                        
                        if (jenisKaca || ukuran || noDo || hargaJual || box || lbr || totalLbr) {
                            kacaRows.push({
                                jenisKaca: jenisKaca.trim(),
                                pwd: pwd.trim(),
                                noDo: noDo.trim(),
                                ukuran: ukuran.trim(),
                                hargaJual: hargaJual.trim(),
                                box: box.trim(),
                                lbr: lbr.trim(),
                                totalLbr: totalLbr.trim()
                            });
                        }
                    }
                    
                    const log = {
                        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
                            ? crypto.randomUUID()
                            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)), // Generate new ID for restore
                        timestamp: getField('timestamp'),
                        data: {
                            namaToko: getField('namaToko'),
                            alias: getField('alias') || '',
                            alamat: getField('alamat').replace(/\\n/g, '\n'),
                            tanggal: getField('tanggal'),
                            nomorSJ: getField('nomorSJ'),
                            supir: getField('supir'),
                            noKendaraan: getField('noKendaraan'),
                            kacaData: {
                                rows: kacaRows,
                                footer: {
                                    cont: getField('kacaFooterCont') || '',
                                    seal: getField('kacaFooterSeal') || '',
                                    grandTotal: getField('kacaFooterGrandTotal') || ''
                                }
                            }
                        }
                    };
                    
                    logs.push(log);
                } catch (err) {
                    console.warn(`Gagal parse baris ${i + 1}:`, err);
                }
            }
            
            return logs;
        }

        // Parse JSON content to log entries
        function parseJSONToLogs(jsonText) {
            try {
                const data = JSON.parse(jsonText);
                
                // Handle different JSON formats
                let logs = [];
                
                if (Array.isArray(data)) {
                    // Direct array of logs
                    logs = data;
                } else if (data.logs && Array.isArray(data.logs)) {
                    // Object with logs property
                    logs = data.logs;
                } else if (data.inputLogHistory && Array.isArray(data.inputLogHistory)) {
                    // Object with inputLogHistory property
                    logs = data.inputLogHistory;
                } else {
                    throw new Error('Format JSON tidak dikenali. Harus berupa array atau object dengan property logs/inputLogHistory');
                }
                
                // Validate and clean log entries
                const validLogs = logs.filter(log => {
                    return log && 
                           typeof log === 'object' && 
                           log.timestamp && 
                           log.data && 
                           typeof log.data === 'object';
                }).map(log => {
                    // Ensure ID exists
                    if (!log.id) {
                        log.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                            ? crypto.randomUUID()
                            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
                    }
                    
                    // Ensure data structure is complete
                    if (!log.data.kacaData) {
                        log.data.kacaData = { rows: [], footer: {} };
                    }
                    
                    return log;
                });
                
                _log(`Parsed JSON: ${validLogs.length} valid entries from ${logs.length} total entries`);
                return validLogs;
                
            } catch (err) {
                console.error('JSON parse error:', err);
                throw new Error('Gagal memparse file JSON: ' + err.message);
            }
        }

        function importInputLogFromCSV(csvText) {
            const lines = csvText.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
            if (lines.length <= 1) throw new Error('CSV kosong');
            const hasSemicolon = lines[0].includes(';');
            const hasComma = lines[0].includes(',');
            const separator = (hasSemicolon && !hasComma) || (hasSemicolon && hasComma) ? ';' : ',';
            const rawHeader = parseCSVLine(lines[0], separator).map(h => h.replace(/^\"|\"$/g,'').trim());

            // Mapping header user-friendly ke key names
            const headerMapping = {
                'Timestamp': 'timestamp',
                'Nama Toko': 'namaToko',
                'Alias': 'alias',
                'Alamat': 'alamat',
                'Tanggal': 'tanggal',
                'Nomor SJ': 'nomorSJ',
                'Supir': 'supir',
                'No Kendaraan': 'noKendaraan',
                'Jenis Kaca PWD': 'jenisKacaPwd',
                'No DO': 'noDo',
                'Ukuran=Box@Lbr': 'ukuranBoxLbr',
                'Harga Jual': 'hargaJual',
                'Total Lebar': 'totalLbr',
                'Container': 'cont',
                'Seal': 'seal',
                'Grand Total': 'grandTotal'
            };

            // Normalize header: map user-friendly names to key names, keep original if no mapping
            const header = rawHeader.map(h => headerMapping[h] || h);

            // Support both old CSVs (with key names) and new ones (with user-friendly names)
            // Also support new export format (one row per kaca row)
            // Check if it's new format: has 'jenisKacaPwd' (after mapping) or has both 'Timestamp' and 'Nama Toko' in raw header
            const isNewFormat = header.includes('jenisKacaPwd') || 
                               (rawHeader.includes('Timestamp') && rawHeader.includes('Nama Toko') && rawHeader.includes('Jenis Kaca PWD'));
            
            if (isNewFormat) {
                // New format: one row per kaca item, need to group by entry
                return importInputLogFromCSVNewFormat(lines, header, rawHeader, separator);
            }

            // Old format: check required fields
            const required = ['timestamp','namaToko','alamat','tanggal','nomorSJ','supir','noKendaraan','kacaRows'];
            const missing = required.filter(key => !header.includes(key));
            if (missing.length > 0) {
                throw new Error('Header CSV tidak valid, kurang kolom: ' + missing.join(', '));
            }

            const hidx = Object.fromEntries(header.map((h,i)=>[h,i]));
            const imported = [];

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVLine(lines[i], separator);
                if (!row || row.length === 0) continue;
                const safe = idx => (row[hidx[idx]] || '').replace(/^\"|\"$/g,'');

                const timestamp = safe('timestamp');
                const namaToko = safe('namaToko');
                const alias = header.includes('alias') ? safe('alias') : '';
                const alamat = safe('alamat').replace(/\\n/g, '\n');
                const tanggal = safe('tanggal');
                const nomorSJ = safe('nomorSJ');
                const supir = safe('supir');
                const noKendaraan = safe('noKendaraan');
                const kacaRows = safe('kacaRows');
                const kacaFooterCont = safe('kacaFooterCont');
                const kacaFooterSeal = safe('kacaFooterSeal');
                const kacaFooterGrandTotal = safe('kacaFooterGrandTotal');

                const rows = kacaRows.split('||').filter(Boolean).map(r => {
                    const parts = r.split('|');
                    return {
                        jenisKaca: parts[0] || '',
                        pwd: parts[1] || '',
                        noDo: parts[2] || '',
                        ukuran: parts[3] || '',
                        box: parts[4] || '',
                        lbr: parts[5] || '',
                        totalLbr: parts[6] || ''
                    };
                });

                const entry = {
                    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
                        ? crypto.randomUUID()
                        : (Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2)),
                    timestamp: timestamp || new Date().toISOString(),
                    data: {
                        namaToko,
                        alias,
                        alamat,
                        tanggal,
                        nomorSJ,
                        supir,
                        noKendaraan,
                        kacaData: {
                            rows,
                            footer: {
                                cont: kacaFooterCont,
                                seal: kacaFooterSeal,
                                grandTotal: kacaFooterGrandTotal
                            }
                        }
                    }
                };
                imported.push(entry);
            }

            // Merge strategy: append imported at the beginning (newer first)
            inputLogHistory = [...imported, ...inputLogHistory];
            // No limit on log entries - keep all data

            saveInputLogToStorage();
            renderInputLog();
            updateKacaSuggestionsFromLogs();
            
            // Process stok transactions from imported log entries
            processStokFromImportedLogs(imported);
        }

        // Simple CSV line parser handling quoted fields
        // Auto-detect separator: semicolon (;) or comma (,)
        function parseCSVLine(line, separator) {
            const result = [];
            let current = '';
            let inQuotes = false;
            // Auto-detect separator if not provided
            if (!separator) {
                const hasSemicolon = line.includes(';');
                const hasComma = line.includes(',');
                separator = (hasSemicolon && !hasComma) || (hasSemicolon && hasComma) ? ';' : ',';
            }

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    if (inQuotes && line[i+1] === '"') { // escaped quote
                        current += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === separator && !inQuotes) {
                    result.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current);
            return result;
        }

        // Maintain unique suggestions for Jenis Kaca and Ukuran from stok data (case-insensitive, trimmed)
        function updateKacaSuggestionsFromLogs() {
            try {
                const jenisMap = new Map(); // key: normalized, value: display or {display, sisa, harga}
                const ukuranMap = new Map(); // key: normalized, value: display or {display, sisa, harga}

                const normalize = (s) => String(s || '')
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .trim();

                // Get data from stokData (prioritize stok data with available stock)
                let stokDataArray = [];
                if (typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
                    stokDataArray = window.stokData;
                } else if (typeof stokData !== 'undefined' && Array.isArray(stokData)) {
                    stokDataArray = stokData;
                }

                if (stokDataArray.length > 0) {
                    // Group data by Tebal Kaca, Ukuran Kaca, dan Harga Beli
                    const groupedData = {};
                    
                    stokDataArray.forEach((entry) => {
                        if (!entry.tebal || !entry.ukuran) return;
                        
                        const hargaKey = entry.harga !== undefined && entry.harga > 0 ? entry.harga : 'noharga';
                        const key = `${entry.tebal}-${entry.ukuran}-${hargaKey}`;

                        if (!groupedData[key]) {
                            groupedData[key] = { 
                                tebal: entry.tebal, 
                                ukuran: entry.ukuran, 
                                hargaMasuk: hargaKey !== 'noharga' ? entry.harga : undefined,
                                totalMasuk: 0, 
                                totalKeluar: 0, 
                                totalSisa: 0 
                            };
                        }

                        if (
                            groupedData[key].hargaMasuk === undefined &&
                            entry.masuk > 0 &&
                            entry.harga !== undefined &&
                            entry.harga > 0
                        ) {
                            groupedData[key].hargaMasuk = entry.harga;
                        }

                        groupedData[key].totalMasuk += entry.masuk;
                        groupedData[key].totalKeluar += entry.keluar;
                        groupedData[key].totalSisa = groupedData[key].totalMasuk - groupedData[key].totalKeluar;
                    });

                    // Process grouped data to build suggestions (only items with stock > 0)
                    // Store data with stock info for jenis kaca and ukuran
                    const jenisDataMap = new Map(); // key: normalized, value: { display, sisa, harga }
                    const ukuranDataMap = new Map(); // key: normalized, value: { display, sisa, harga }
                    
                    for (const key in groupedData) {
                        const data = groupedData[key];
                        if (data.totalSisa > 0) {
                            const jenisNorm = normalize(data.tebal);
                            const ukuranNorm = normalize(data.ukuran);
                            
                            // For jenis kaca: combine all ukuran and stock info
                            if (jenisNorm) {
                                if (!jenisDataMap.has(jenisNorm)) {
                                    jenisDataMap.set(jenisNorm, {
                                        display: data.tebal,
                                        sisa: 0,
                                        harga: []
                                    });
                                }
                                const jenisInfo = jenisDataMap.get(jenisNorm);
                                jenisInfo.sisa += data.totalSisa;
                                if (data.hargaMasuk && data.hargaMasuk > 0 && !jenisInfo.harga.includes(data.hargaMasuk)) {
                                    jenisInfo.harga.push(data.hargaMasuk);
                                }
                            }
                            
                            // For ukuran: keep stocks with different harga separate - don't combine them
                            if (ukuranNorm) {
                                const hargaKey = data.hargaMasuk !== undefined && data.hargaMasuk > 0 ? data.hargaMasuk : 'noharga';
                                const uniqueKey = `${ukuranNorm}-harga${hargaKey}`;
                                
                                if (!ukuranDataMap.has(uniqueKey)) {
                                    ukuranDataMap.set(uniqueKey, {
                                        display: data.ukuran,
                                        sisa: 0,
                                        harga: []
                                    });
                                }
                                const ukuranInfo = ukuranDataMap.get(uniqueKey);
                                ukuranInfo.sisa += data.totalSisa;
                                if (data.hargaMasuk && data.hargaMasuk > 0 && !ukuranInfo.harga.includes(data.hargaMasuk)) {
                                    ukuranInfo.harga.push(data.hargaMasuk);
                                }
                            }
                        }
                    }
                    
                    // Build jenis and ukuran maps with stock info
                    jenisDataMap.forEach((info, norm) => {
                        jenisMap.set(norm, info);
                    });
                    
                    ukuranDataMap.forEach((info, norm) => {
                        ukuranMap.set(norm, info);
                    });
                }

                // Fallback to log history if stokData not available or empty
                if (jenisMap.size === 0 && ukuranMap.size === 0) {
                    (inputLogHistory || []).forEach(entry => {
                        const rows = Array.isArray(entry.data?.kacaData) ? entry.data.kacaData : (entry.data?.kacaData?.rows || []);
                        rows.forEach(row => {
                            if (row.jenisKaca) {
                                const disp = String(row.jenisKaca).trim();
                                const key = normalize(disp);
                                if (key && !jenisMap.has(key)) jenisMap.set(key, disp);
                            }
                            if (row.ukuran) {
                                const disp = String(row.ukuran).trim();
                                const key = normalize(disp);
                                if (key && !ukuranMap.has(key)) ukuranMap.set(key, disp);
                            }
                        });
                    });
                }

                const sortCI = (a, b) => {
                    const aVal = typeof a === 'string' ? a : a.display;
                    const bVal = typeof b === 'string' ? b : b.display;
                    return aVal.toLowerCase().localeCompare(bVal.toLowerCase());
                };
                
                // Build option HTML for Jenis Kaca (Original logic)
                const buildJenisOptionHTML = (item) => {
                    if (typeof item === 'string') {
                        return `<option value="${item.replace(/"/g, '&quot;')}"></option>`;
                    } else {
                        let stockInfo = '';
                        
                        if (item.sisa > 0) {
                            if (item.harga && item.harga.length > 0) {
                                const hargaText = item.harga.length === 1 
                                    ? `Rp ${item.harga[0].toLocaleString('id-ID')}`
                                    : item.harga.map(h => `Rp ${h.toLocaleString('id-ID')}`).join(' / ');
                                stockInfo = `Harga: ${hargaText}, Sisa: ${item.sisa.toLocaleString('id-ID')}`;
                            } else {
                                stockInfo = `Sisa: ${item.sisa.toLocaleString('id-ID')}`;
                            }
                        }
                        
                        return `<option value="${item.display.replace(/"/g, '&quot;')}" data-stock="${item.sisa}" data-harga="${item.harga ? item.harga.join(',') : ''}">${stockInfo ? stockInfo.replace(/"/g, '&quot;') : item.display.replace(/"/g, '&quot;')}</option>`;
                    }
                };

                // Build option HTML for Ukuran (New logic per user request)
                const buildUkuranOptionHTML = (item) => {
                    if (typeof item === 'string') {
                        return `<option value="${item.replace(/"/g, '&quot;')}"></option>`;
                    } else {
                        let valueText = item.display;
                        
                        // Always append price to value
                        if (item.harga && item.harga.length > 0) {
                             const hargaFormatted = item.harga[0].toLocaleString('id-ID');
                             valueText = `${valueText} (Rp ${hargaFormatted})`;
                        }

                        let stockInfo = '';
                        // Only show stock info in label
                        if (item.sisa > 0) {
                            stockInfo = `Sisa: ${item.sisa.toLocaleString('id-ID')}`;
                        }
                        
                        return `<option value="${valueText.replace(/"/g, '&quot;')}" data-stock="${item.sisa}" data-harga="${item.harga ? item.harga.join(',') : ''}">${stockInfo ? stockInfo.replace(/"/g, '&quot;') : item.display.replace(/"/g, '&quot;')}</option>`;
                    }
                };
                
                const jenisValues = Array.from(jenisMap.values()).sort(sortCI);
                const ukuranValues = Array.from(ukuranMap.values()).sort(sortCI);

                const jenisList = document.getElementById('datalistJenisKaca');
                const ukuranList = document.getElementById('datalistUkuran');
                if (jenisList) jenisList.innerHTML = jenisValues.map(buildJenisOptionHTML).join('');
                if (ukuranList) ukuranList.innerHTML = ukuranValues.map(buildUkuranOptionHTML).join('');
            } catch (e) {
                console.warn('Failed updating kaca suggestions:', e);
            }
        }

        // Function to update supir and noKendaraan suggestions from input log history
        function updateSupirDanKendaraanSuggestions() {
            try {
                const supirSet = new Set();
                const noKendaraanSet = new Set();

                // Collect unique values from inputLogHistory
                (inputLogHistory || []).forEach(entry => {
                    const data = entry.data || {};
                    if (data.supir) {
                        const supirValue = String(data.supir).trim();
                        if (supirValue) {
                            supirSet.add(supirValue);
                        }
                    }
                    if (data.noKendaraan) {
                        const noKendaraanValue = String(data.noKendaraan).trim();
                        if (noKendaraanValue) {
                            noKendaraanSet.add(noKendaraanValue);
                        }
                    }
                });

                // Sort and create options
                const supirValues = Array.from(supirSet).sort((a, b) => 
                    a.toLowerCase().localeCompare(b.toLowerCase())
                );
                const noKendaraanValues = Array.from(noKendaraanSet).sort((a, b) => 
                    a.toLowerCase().localeCompare(b.toLowerCase())
                );

                // Update datalists
                const supirList = document.getElementById('datalistSupir');
                const noKendaraanList = document.getElementById('datalistNoKendaraan');
                
                if (supirList) {
                    supirList.innerHTML = supirValues.map(value => 
                        `<option value="${value.replace(/"/g, '&quot;')}"></option>`
                    ).join('');
                }
                
                if (noKendaraanList) {
                    noKendaraanList.innerHTML = noKendaraanValues.map(value => 
                        `<option value="${value.replace(/"/g, '&quot;')}"></option>`
                    ).join('');
                }
            } catch (e) {
                // Silently handle errors
            }
        }

        // Helper function to group stock data
        // Used by: updateUkuranByJenisKaca, getHargaBeliListWithStock, updateTotalSisa, exportStock
        let _groupStokDataCache = null;
        let _groupStokDataCacheLen = -1;
        let _groupStokDataCacheKey = '';
        function groupStokData(dataArray, filterFn = null) {
            const groupedData = {};

            if (!Array.isArray(dataArray)) return groupedData;

            // Cache for unfiltered calls (most common path)
            if (!filterFn) {
              const cacheKey = dataArray.length + '-' + isPriceGroupingEnabled;
              if (_groupStokDataCacheLen === dataArray.length && _groupStokDataCacheKey === cacheKey && _groupStokDataCache) {
                return _groupStokDataCache;
              }
            }

            // FIRST PASS: Group by tebal, ukuran, and optionally harga
            dataArray.forEach((entry) => {
                if (filterFn && !filterFn(entry)) return;
                if (!entry.tebal || !entry.ukuran) return;

                const normTebal = normalizeSpec(entry.tebal);
                const normUkuran = normalizeSpec(entry.ukuran);
                const hargaKey = (isPriceGroupingEnabled && entry.harga !== undefined && entry.harga > 0) ? entry.harga : 'noharga';
                
                // Use a robust key generation method (JSON stringify) to handle special characters like | or "
                const key = JSON.stringify([
                    normTebal, 
                    normUkuran, 
                    isPriceGroupingEnabled ? hargaKey : 'all'
                ]);

                if (!groupedData[key]) {
                    groupedData[key] = { 
                        tebal: entry.tebal, // Keep original display version from first entry
                        ukuran: entry.ukuran, 
                        hargaMasuk: (isPriceGroupingEnabled && hargaKey !== 'noharga') ? entry.harga : undefined,
                        totalMasuk: 0, 
                        totalKeluar: 0, 
                        totalSisa: 0,
                        entries: []
                    };
                }

                groupedData[key].totalMasuk += (entry.masuk || 0);
                groupedData[key].totalKeluar += (entry.keluar || 0);
                groupedData[key].entries.push(entry);
            });

            // SECOND PASS: Distribute 'noharga' sales (keluar) across priced pools (FIFO)
            if (isPriceGroupingEnabled) {
                const keys = Object.keys(groupedData);
                // In JSON key, 'noharga' will be the 3rd element
                const noHargaKeys = keys.filter(k => k.includes('"noharga"'));

                noHargaKeys.forEach(noHargaKey => {
                    const noHargaGroup = groupedData[noHargaKey];
                    if (noHargaGroup.totalKeluar > 0) {
                        let remainingKeluar = noHargaGroup.totalKeluar;
                        
                        const normTebal = normalizeSpec(noHargaGroup.tebal);
                        const normUkuran = normalizeSpec(noHargaGroup.ukuran);
                        
                        // Find priced groups for the same item type
                        const pricedGroups = keys
                            .filter(k => {
                                if (k === noHargaKey) return false;
                                try {
                                    const parsed = JSON.parse(k);
                                    return parsed[0] === normTebal && parsed[1] === normUkuran && parsed[2] !== 'noharga';
                                } catch (e) { return false; }
                            })
                            .map(k => groupedData[k])
                            .sort((a, b) => {
                                const minIdA = a.entries.map(e => String(e.id ?? '')).sort()[0] ?? '';
                                const minIdB = b.entries.map(e => String(e.id ?? '')).sort()[0] ?? '';
                                return minIdA.localeCompare(minIdB);
                            });

                        pricedGroups.forEach(targetGroup => {
                            if (remainingKeluar <= 0) return;
                            
                            const available = targetGroup.totalMasuk - targetGroup.totalKeluar;
                            if (available > 0) {
                                const taken = Math.min(remainingKeluar, available);
                                targetGroup.totalKeluar += taken;
                                remainingKeluar -= taken;
                            }
                        });

                        if (remainingKeluar <= 0) {
                            noHargaGroup.totalKeluar = 0;
                        } else {
                            noHargaGroup.totalKeluar = remainingKeluar;
                        }
                    }
                });
            }

            // Recalculate totalSisa and filter out empty groups
            const finalGroupedData = {};
            Object.keys(groupedData).forEach(key => {
                const group = groupedData[key];
                group.totalSisa = group.totalMasuk - group.totalKeluar;
                
                if (group.totalMasuk > 0 || group.totalKeluar > 0) {
                    // Check if it's a no-price group in the JSON key
                    const isNoHarga = key.includes('"noharga"');
                    if (isPriceGroupingEnabled && isNoHarga && group.totalSisa >= 0) {
                        return;
                    }
                    finalGroupedData[key] = group;
                }
            });

            // Store in cache for unfiltered calls
            if (!filterFn) {
              _groupStokDataCache = finalGroupedData;
              _groupStokDataCacheLen = dataArray.length;
              _groupStokDataCacheKey = dataArray.length + '-' + isPriceGroupingEnabled;
            }

            return finalGroupedData;
        }

        // Helper to sort grouped data by Tebal then Ukuran
        function sortGroupedData(groupedData) {
            return Object.keys(groupedData).map(key => ({
                key: key,
                data: groupedData[key]
            })).sort((a, b) => {
                // Sort by jenis kaca (tebal) A-Z
                const tebalA = (a.data.tebal || '').toUpperCase();
                const tebalB = (b.data.tebal || '').toUpperCase();
                if (tebalA !== tebalB) {
                    return tebalA.localeCompare(tebalB);
                }
                // If jenis kaca is the same, sort by ukuran A-Z
                const ukuranA = (a.data.ukuran || '').toUpperCase();
                const ukuranB = (b.data.ukuran || '').toUpperCase();
                return ukuranA.localeCompare(ukuranB);
            });
        }

        // Function to update ukuran dropdown based on selected jenis kaca
        // Fungsi untuk log perubahan harga
        function logPriceChange(oldPrice, newPrice, source, context) {
            try {
                if (!oldPrice && !newPrice) return;
                
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    oldPrice: oldPrice || '0',
                    newPrice: newPrice || '0',
                    source: source,
                    context: context
                };
                
                // Save to window global for session history
                if (!window.priceChangeHistory) {
                    window.priceChangeHistory = [];
                }
                window.priceChangeHistory.push(logEntry);
                
                // Optional: Persist to localStorage for audit trail
                // We keep last 50 changes
                try {
                    const storedLogs = JSON.parse(localStorage.getItem('stok_price_audit_log') || '[]');
                    storedLogs.push(logEntry);
                    if (storedLogs.length > 50) {
                        storedLogs.shift();
                    }
                    localStorage.setItem('stok_price_audit_log', JSON.stringify(storedLogs));
                } catch (e) {
                    console.warn('Failed to save price audit log:', e);
                }
                
                _log('📝 Price Change Logged:', logEntry);
            } catch (e) {
                console.error('Error logging price change:', e);
            }
        }

        function updateUkuranByJenisKaca(jenisKaca, ukuranInput) {
            try {
                if (!jenisKaca || !jenisKaca.trim()) {
                    // If jenis kaca is empty, show all ukuran
                    updateKacaSuggestionsFromLogs();
                    return;
                }

                const normalize = (s) => String(s || '')
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .trim();

                const jenisKacaNorm = normalize(jenisKaca);
                const ukuranMap = new Map(); // key: normalized, value: { display, sisa, harga }

                // Get data from stokData
                let stokDataArray = [];
                if (typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
                    stokDataArray = window.stokData;
                } else if (typeof stokData !== 'undefined' && Array.isArray(stokData)) {
                    stokDataArray = stokData;
                }

                if (stokDataArray.length > 0) {
                    // Group data by Tebal Kaca, Ukuran Kaca, dan Harga Beli
                    const groupedData = groupStokData(stokDataArray, (entry) => {
                        return normalize(entry.tebal) === jenisKacaNorm;
                    });

                    // Process grouped data to build ukuran suggestions (only items with stock > 0)
                    // Keep stocks with different harga separate - don't combine them
                    const ukuranEntries = [];
                    
                    for (const key in groupedData) {
                        const data = groupedData[key];
                        if (data.totalSisa > 0) {
                            // Create separate entry for each ukuran+harga combination
                            ukuranEntries.push({
                                display: data.ukuran,
                                sisa: data.totalSisa,
                                harga: data.hargaMasuk !== undefined && data.hargaMasuk > 0 ? [data.hargaMasuk] : []
                            });
                        }
                    }
                    
                    // Build ukuran map - use unique key for each ukuran+harga combination
                    ukuranEntries.forEach((entry) => {
                        const ukuranNorm = normalize(entry.display);
                        const hargaKey = entry.harga.length > 0 ? entry.harga[0] : 'noharga';
                        // Create unique key that includes both ukuran and harga
                        const uniqueKey = `${ukuranNorm}-harga${hargaKey}`;
                        
                        // Store entry with unique key to keep stocks with different harga separate
                        ukuranMap.set(uniqueKey, entry);
                    });
                }

                // Fallback to log history if stokData not available or empty
                if (ukuranMap.size === 0) {
                    (inputLogHistory || []).forEach(entry => {
                        const rows = Array.isArray(entry.data?.kacaData) ? entry.data.kacaData : (entry.data?.kacaData?.rows || []);
                        rows.forEach(row => {
                            if (row.jenisKaca && row.ukuran) {
                                const rowJenisNorm = normalize(row.jenisKaca);
                                if (rowJenisNorm === jenisKacaNorm) {
                                    const disp = String(row.ukuran).trim();
                                    const key = normalize(disp);
                                    if (key && !ukuranMap.has(key)) {
                                        ukuranMap.set(key, disp);
                                    }
                                }
                            }
                        });
                    });
                }

                // Build option HTML with stock info
                const sortCI = (a, b) => {
                    const aVal = typeof a === 'string' ? a : a.display;
                    const bVal = typeof b === 'string' ? b : b.display;
                    return aVal.toLowerCase().localeCompare(bVal.toLowerCase());
                };

                const ukuranValues = Array.from(ukuranMap.values()).sort(sortCI);
                
                // Calculate display counts to identify duplicates
                const displayCounts = {};
                ukuranValues.forEach(item => {
                    const display = typeof item === 'string' ? item : item.display;
                    displayCounts[display] = (displayCounts[display] || 0) + 1;
                });

                const ukuranList = document.getElementById('datalistUkuran');
                
                const buildOptionHTML = (item) => {
                    let valueText = typeof item === 'string' ? item : item.display;
                    
                    // Always append price to value if it exists (User request: "Baris 1: Ukuran produk ... dan harga dalam format (Rp ...)")
                    if (typeof item !== 'string' && item.harga && item.harga.length > 0) {
                        const hargaFormatted = item.harga[0].toLocaleString('id-ID');
                        valueText = `${valueText} (Rp ${hargaFormatted})`;
                    }

                    if (typeof item === 'string') {
                        return `<option value="${valueText.replace(/"/g, '&quot;')}"></option>`;
                    } else {
                        let stockInfo = '';
                        
                        // Only show stock info in the second line (User request: "Baris 2: Informasi stok tersedia (Sisa: ...)")
                        // User request: "Hilangkan tampilan harga yang muncul terpisah di baris kedua."
                        if (item.sisa > 0) {
                            stockInfo = `Sisa: ${item.sisa.toLocaleString('id-ID')}`;
                        }
                        
                        return `<option value="${valueText.replace(/"/g, '&quot;')}" data-stock="${item.sisa}" data-harga="${item.harga ? item.harga.join(',') : ''}">${stockInfo ? stockInfo.replace(/"/g, '&quot;') : item.display.replace(/"/g, '&quot;')}</option>`;
                    }
                };

                if (ukuranList) {
                    // Always update datalist, but prevent dropdown from showing if value was just selected
                    ukuranList.innerHTML = ukuranValues.map(buildOptionHTML).join('');
                    
                    // After updating datalist, trigger harga update for all ukuran inputs with values
                    // This ensures harga is refreshed when datalist changes
                    if (ukuranInput) {
                        requestAnimationFrame(() => {
                            // Trigger update for the specific input that triggered this update
                            if (ukuranInput.value.trim()) {
                                // Find the updateHargaFromSelectedUkuran function in the input's scope
                                // We'll trigger it via a custom event or direct call if available
                                const event = new CustomEvent('datalistUpdated', { bubbles: true });
                                ukuranInput.dispatchEvent(event);
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('Failed updating ukuran by jenis kaca:', e);
            }
        }

        // Removed testLogKacaData (not used anymore)

        // Make test function globally available
        // Removed window.testLogKacaData binding

        // Simple test function to verify log kaca data
        // Removed quickTestLogKaca (not used anymore)

        // Make quick test function globally available
        // Removed window.quickTestLogKaca binding

        // Test function to verify auto-fill kaca data from log
        function testAutoFillKacaData() {
            _log('🧪 Testing Auto-Fill Kaca Data from Log...');
            
            // Check if there are any log entries
            if (inputLogHistory.length === 0) {
                _log('❌ No log entries found. Please save a log first.');
                return;
            }
            
            // Get the first log entry
            const firstLog = inputLogHistory[0];
            _log('📊 First log entry:', firstLog);
            
            // Check if it has kaca data
            if (!firstLog.data.kacaData) {
                _log('❌ No kacaData found in log entry');
                return;
            }
            
            _log('✅ Kaca data found in log entry:', firstLog.data.kacaData);
            
            // Test the auto-fill function
            _log('🔄 Testing auto-fill function...');
            
            // Clear current form first
            document.getElementById('namaToko').value = '';
            document.getElementById('alamat').value = '';
            document.getElementById('tanggal').value = '';
            document.getElementById('nomorSJ').value = '';
            document.getElementById('supir').value = '';
            document.getElementById('noKendaraan').value = '';
            
            // Clear kaca table
            const tbody = document.getElementById('kacaTableBody');
            if (tbody) {
                tbody.innerHTML = '';
            }
            
            // Clear footer inputs
            const contInput = document.querySelector('.cont-input');
            const sealInput = document.querySelector('.seal-input');
            if (contInput) contInput.value = '';
            if (sealInput) sealInput.value = '';
            
            _log('🧹 Form cleared for testing');
            
            // Now test the auto-fill
            setTimeout(() => {
                _log('🔄 Calling loadInputFromLog(0)...');
                loadInputFromLog(0);
                
                // Check results after a delay
                setTimeout(() => {
                    _log('🔍 Checking auto-fill results...');
                    
                    // Check form fields
                    const namaToko = document.getElementById('namaToko').value;
                    const alamat = document.getElementById('alamat').value;
                    const tanggal = document.getElementById('tanggal').value;
                    const nomorSJ = document.getElementById('nomorSJ').value;
                    const supir = document.getElementById('supir').value;
                    const noKendaraan = document.getElementById('noKendaraan').value;
                    
                    _log('📝 Form fields filled:', {
                        namaToko: namaToko || 'empty',
                        alamat: alamat || 'empty',
                        tanggal: tanggal || 'empty',
                        nomorSJ: nomorSJ || 'empty',
                        supir: supir || 'empty',
                        noKendaraan: noKendaraan || 'empty'
                    });
                    
                    // Check kaca table
                    const kacaRows = document.querySelectorAll('#kacaTableBody tr');
                    _log('📊 Kaca table rows after auto-fill:', kacaRows.length);
                    
                    if (kacaRows.length > 0) {
                        _log('✅ Kaca data auto-filled successfully');
                        
                        // Check first row data
                        const firstRow = kacaRows[0];
                        const jenisKaca = firstRow.querySelector('.jenis-kaca')?.value || '';
                        const pwd = firstRow.querySelector('.pwd')?.value || '';
                        const noDo = firstRow.querySelector('.no-do')?.value || '';
                        const ukuran = firstRow.querySelector('.ukuran')?.value || '';
                        const box = firstRow.querySelector('.box')?.value || '';
                        const lbr = firstRow.querySelector('.lbr')?.value || '';
                        const totalLbr = firstRow.querySelector('.total-lbr-input')?.value || '';
                        
                        _log('🔍 First kaca row data:', {
                            jenisKaca: jenisKaca || 'empty',
                            pwd: pwd || 'empty',
                            noDo: noDo || 'empty',
                            ukuran: ukuran || 'empty',
                            box: box || 'empty',
                            lbr: lbr || 'empty',
                            totalLbr: totalLbr || 'empty'
                        });
                    } else {
                        _log('❌ No kaca rows found after auto-fill');
                    }
                    
                    // Check footer data
                    const contValue = contInput ? contInput.value : '';
                    const sealValue = sealInput ? sealInput.value : '';
                    
                    _log('📋 Footer data after auto-fill:', {
                        cont: contValue || 'empty',
                        seal: sealValue || 'empty'
                    });
                    
                    if (contValue || sealValue) {
                        _log('✅ Footer data auto-filled successfully');
                    } else {
                        _log('ℹ️ No footer data to auto-fill');
                    }
                    
                }, 1000);
                
            }, 500);
            
            _log('🧪 Auto-fill test completed');
        }

        // Make test function globally available (DEBUG only)
        if (DEBUG) window.testAutoFillKacaData = testAutoFillKacaData;

        // Debug function to check auto-fill issue
        function debugAutoFillIssue() {
            _log('🐛 Debugging Auto-Fill Issue...');
            
            // Check if there are log entries
            _log('📊 Number of log entries:', inputLogHistory.length);
            
            if (inputLogHistory.length > 0) {
                const firstLog = inputLogHistory[0];
                _log('📋 First log entry structure:', firstLog);
                
                // Check kaca data structure
                if (firstLog.data.kacaData) {
                    _log('✅ kacaData exists in log entry');
                    _log('📊 kacaData type:', typeof firstLog.data.kacaData);
                    _log('📊 kacaData is array:', Array.isArray(firstLog.data.kacaData));
                    _log('📊 kacaData content:', firstLog.data.kacaData);
                    
                    if (Array.isArray(firstLog.data.kacaData)) {
                        _log('📊 Array length:', firstLog.data.kacaData.length);
                    } else if (firstLog.data.kacaData.rows) {
                        _log('📊 Rows length:', firstLog.data.kacaData.rows.length);
                        _log('📊 Footer data:', firstLog.data.kacaData.footer);
                    }
                } else {
                    _log('❌ No kacaData in log entry');
                }
                
                // Test the condition logic
                const kacaData = firstLog.data.kacaData;
                if (kacaData) {
                    const hasData = Array.isArray(kacaData) ? 
                        kacaData.length > 0 : 
                        (kacaData.rows && kacaData.rows.length > 0);
                    
                    _log('🔍 Condition check result:', hasData);
                    _log('🔍 Array.isArray(kacaData):', Array.isArray(kacaData));
                    
                    if (Array.isArray(kacaData)) {
                        _log('🔍 kacaData.length > 0:', kacaData.length > 0);
                    } else {
                        _log('🔍 kacaData.rows exists:', !!kacaData.rows);
                        _log('🔍 kacaData.rows.length > 0:', kacaData.rows && kacaData.rows.length > 0);
                    }
                }
                
            } else {
                _log('❌ No log entries found');
            }
            
            // Check if loadKacaDataFromLog function exists
            _log('🔍 loadKacaDataFromLog function exists:', typeof loadKacaDataFromLog === 'function');
            
            // Check if kaca table exists
            const tbody = document.getElementById('kacaTableBody');
            _log('🔍 kacaTableBody exists:', !!tbody);
            
            _log('🐛 Debug completed');
        }

        // Make debug function globally available
        window.debugAutoFillIssue = debugAutoFillIssue;

        // Function to toggle log details view
    // Track which log detail is currently open (only one at a time)
    let currentOpenLogDetailId = null;

    function closeLogDetail(logId, skipAnimation) {
      const detailedView = document.getElementById(`log-detailed-${logId}`);
      const defaultView = document.getElementById(`log-default-${logId}`);
      if (!detailedView || !defaultView) return;

      const logEntry = defaultView.closest('.log-entry');
      const toggleIcon = logEntry ? logEntry.querySelector('.log-toggle-icon') : null;

      detailedView.classList.remove('expanding');
      if (skipAnimation) {
        detailedView.classList.remove('collapsing');
        defaultView.style.display = 'block';
        detailedView.style.display = 'none';
      } else {
        detailedView.classList.add('collapsing');
        setTimeout(() => {
          if (detailedView.classList.contains('collapsing')) {
            detailedView.classList.remove('collapsing');
            defaultView.style.display = 'block';
            detailedView.style.display = 'none';
          }
        }, 200);
      }
      if (toggleIcon) {
        toggleIcon.textContent = '📋';
        toggleIcon.style.transform = 'rotate(0deg)';
      }
      if (currentOpenLogDetailId === logId) {
        currentOpenLogDetailId = null;
      }
    }

    function openLogDetail(logId) {
      // Close previously opened detail first
      if (currentOpenLogDetailId && currentOpenLogDetailId !== logId) {
        closeLogDetail(currentOpenLogDetailId, true);
      }

      const detailedView = document.getElementById(`log-detailed-${logId}`);
      const defaultView = document.getElementById(`log-default-${logId}`);
      if (!detailedView || !defaultView) return;

      const logEntry = defaultView.closest('.log-entry');
      const toggleIcon = logEntry ? logEntry.querySelector('.log-toggle-icon') : null;

      defaultView.style.display = 'none';
      detailedView.style.display = 'block';
      // Force reflow to ensure animation starts from initial state
      detailedView.offsetHeight;
      detailedView.classList.add('expanding');
      if (toggleIcon) {
        toggleIcon.textContent = '📋';
        toggleIcon.style.transform = 'rotate(180deg)';
      }
      currentOpenLogDetailId = logId;
    }

    function toggleLogDetails(index) {
      const detailedView = document.getElementById(`log-detailed-${index}`);
      if (!detailedView) return;

      if (detailedView.style.display === 'none' || !detailedView.style.display) {
        openLogDetail(index);
      } else {
        closeLogDetail(index, false);
      }
    }

        // Helper: find log index by unique id (support string/numeric)
        function findLogIndexById(logId) {
            return inputLogHistory.findIndex(entry => entry && String(entry.id) === String(logId));
        }

        // Toggle by id (used after search rendering)
    function toggleLogDetailsById(logId) {
        const detailedView = document.getElementById(`log-detailed-${logId}`);
        if (!detailedView) return;

        if (detailedView.style.display === 'none' || !detailedView.style.display) {
            openLogDetail(logId);
        } else {
            closeLogDetail(logId, false);
        }
    }

        // Wrappers by id to keep button actions working after filtering
        function loadInputFromLogById(logId) {
            const idx = findLogIndexById(logId);
            if (idx >= 0) loadInputFromLog(idx);
        }
        function editLogEntryById(logId) {
            const idx = findLogIndexById(logId);
            if (idx >= 0) editLogEntry(idx);
        }
        async function deleteLogEntryById(logId) {
            const idx = findLogIndexById(logId);
            if (idx >= 0) await deleteLogEntry(idx);
        }

        // Test function to verify new log display
        function testNewLogDisplay() {
            _log('🧪 Testing New Log Display...');
            
            // Check if there are log entries
            if (inputLogHistory.length === 0) {
                _log('❌ No log entries found. Please save a log first.');
                return;
            }
            
            _log('✅ Log entries found:', inputLogHistory.length);
            
            // Check if new log structure exists
            const logEntries = document.querySelectorAll('.log-entry');
            _log('📊 Number of log entries in DOM:', logEntries.length);
            
            if (logEntries.length > 0) {
                const firstLogEntry = logEntries[0];
                
                // Check for default view
                const defaultView = firstLogEntry.querySelector('.log-content-default');
                if (defaultView) {
                    _log('✅ Default view found');
                    _log('📊 Default view display:', defaultView.style.display);
                } else {
                    _log('❌ Default view not found');
                }
                
                // Check for detailed view
                const detailedView = firstLogEntry.querySelector('.log-content-detailed');
                if (detailedView) {
                    _log('✅ Detailed view found');
                    _log('📊 Detailed view display:', detailedView.style.display);
                } else {
                    _log('❌ Detailed view not found');
                }
                
                // Check for toggle icon
                const toggleIcon = firstLogEntry.querySelector('.log-toggle-icon');
                if (toggleIcon) {
                    _log('✅ Toggle icon found');
                    _log('📊 Toggle icon text:', toggleIcon.textContent);
                } else {
                    _log('❌ Toggle icon not found');
                }
                
                // Check for load button in detailed view
                const loadButton = firstLogEntry.querySelector('.btn-load-data');
                if (loadButton) {
                    _log('✅ Load button found in detailed view');
                } else {
                    _log('❌ Load button not found');
                }
                
                // Test toggle functionality
                _log('🔄 Testing toggle functionality...');
                const logIndex = 0; // Test with first log entry
                
                // Get initial state
                const initialDefaultDisplay = defaultView.style.display;
                const initialDetailedDisplay = detailedView.style.display;
                
                _log('📊 Initial state:', {
                    default: initialDefaultDisplay,
                    detailed: initialDetailedDisplay
                });
                
                // Test toggle
                toggleLogDetails(logIndex);
                
                setTimeout(() => {
                    const afterToggleDefaultDisplay = defaultView.style.display;
                    const afterToggleDetailedDisplay = detailedView.style.display;
                    
                    _log('📊 After toggle state:', {
                        default: afterToggleDefaultDisplay,
                        detailed: afterToggleDetailedDisplay
                    });
                    
                    if (afterToggleDefaultDisplay !== initialDefaultDisplay || 
                        afterToggleDetailedDisplay !== initialDetailedDisplay) {
                        _log('✅ Toggle functionality working');
                    } else {
                        _log('❌ Toggle functionality not working');
                    }
                    
                    // Toggle back
                    setTimeout(() => {
                        toggleLogDetails(logIndex);
                        _log('🔄 Toggled back to original state');
                    }, 500);
                    
                }, 100);
                
            } else {
                _log('❌ No log entries found in DOM');
            }
            
            _log('🧪 New log display test completed');
        }

        // Make test function globally available (DEBUG only)
        if (DEBUG) window.testNewLogDisplay = testNewLogDisplay;

        // Test function to verify compact log display
        function testCompactLogDisplay() {
            _log('🧪 Testing Compact Log Display...');
            
            // Check if there are log entries
            if (inputLogHistory.length === 0) {
                _log('❌ No log entries found. Please save a log first.');
                return;
            }
            
            _log('✅ Log entries found:', inputLogHistory.length);
            
            // Check if new compact structure exists
            const logEntries = document.querySelectorAll('.log-entry');
            _log('📊 Number of log entries in DOM:', logEntries.length);
            
            if (logEntries.length > 0) {
                const firstLogEntry = logEntries[0];
                
                // Check for compact line
                const compactLine = firstLogEntry.querySelector('.log-compact-line');
                if (compactLine) {
                    _log('✅ Compact line found');
                    
                    // Check compact items
                    const compactItems = compactLine.querySelectorAll('.log-compact-item');
                    _log('📊 Number of compact items:', compactItems.length);
                    
                    compactItems.forEach((item, index) => {
                        const label = item.querySelector('.log-compact-label');
                        const value = item.querySelector('.log-compact-value');
                        
                        _log(`📋 Compact item ${index + 1}:`, {
                            label: label ? label.textContent : 'not found',
                            value: value ? value.textContent : 'not found'
                        });
                    });
                    
                    // Check separators
                    const separators = compactLine.querySelectorAll('.log-compact-separator');
                    _log('📊 Number of separators:', separators.length);
                    
                } else {
                    _log('❌ Compact line not found');
                }
                
                // Check for default view
                const defaultView = firstLogEntry.querySelector('.log-content-default');
                if (defaultView) {
                    _log('✅ Default view found');
                    _log('📊 Default view display:', defaultView.style.display);
                } else {
                    _log('❌ Default view not found');
                }
                
                // Check for detailed view
                const detailedView = firstLogEntry.querySelector('.log-content-detailed');
                if (detailedView) {
                    _log('✅ Detailed view found');
                    _log('📊 Detailed view display:', detailedView.style.display);
                } else {
                    _log('❌ Detailed view not found');
                }
                
                // Test compact layout
                _log('🔄 Testing compact layout...');
                
                // Check if layout is horizontal
                const computedStyle = window.getComputedStyle(compactLine);
                const flexDirection = computedStyle.flexDirection;
                _log('📊 Flex direction:', flexDirection);
                
                if (flexDirection === 'row') {
                    _log('✅ Compact layout is horizontal (desktop)');
                } else if (flexDirection === 'column') {
                    _log('✅ Compact layout is vertical (mobile)');
                } else {
                    _log('❌ Unexpected flex direction:', flexDirection);
                }
                
                // Test text overflow
                const compactValues = compactLine.querySelectorAll('.log-compact-value');
                compactValues.forEach((value, index) => {
                    const computedStyle = window.getComputedStyle(value);
                    const textOverflow = computedStyle.textOverflow;
                    const overflow = computedStyle.overflow;
                    const whiteSpace = computedStyle.whiteSpace;
                    
                    _log(`📊 Text overflow for value ${index + 1}:`, {
                        textOverflow: textOverflow,
                        overflow: overflow,
                        whiteSpace: whiteSpace
                    });
                });
                
            } else {
                _log('❌ No log entries found in DOM');
            }
            
            _log('🧪 Compact log display test completed');
        }

        // Make test function globally available (DEBUG only)
        if (DEBUG) window.testCompactLogDisplay = testCompactLogDisplay;

        // Test function to verify container height matching
        function testContainerHeightMatching() {
            _log('🧪 Testing Container Height Matching...');
            
            // Get container elements
            const leftSection = document.querySelector('.left-section');
            const rightSection = document.querySelector('.right-section');
            const mainLayout = document.querySelector('.main-layout');
            
            if (!leftSection || !rightSection || !mainLayout) {
                _log('❌ Container elements not found');
                return;
            }
            
            _log('✅ Container elements found');
            
            // Get computed styles
            const leftHeight = leftSection.offsetHeight;
            const rightHeight = rightSection.offsetHeight;
            const mainLayoutHeight = mainLayout.offsetHeight;
            
            _log('📊 Container heights:', {
                leftSection: leftHeight + 'px',
                rightSection: rightHeight + 'px',
                mainLayout: mainLayoutHeight + 'px'
            });
            
            // Check if heights match
            const heightDifference = Math.abs(leftHeight - rightHeight);
            const tolerance = 10; // 10px tolerance for minor differences
            
            if (heightDifference <= tolerance) {
                _log('✅ Container heights match (within tolerance)');
                _log('📊 Height difference:', heightDifference + 'px');
            } else {
                _log('❌ Container heights do not match');
                _log('📊 Height difference:', heightDifference + 'px');
            }
            
            // Check flex properties
            const leftComputedStyle = window.getComputedStyle(leftSection);
            const rightComputedStyle = window.getComputedStyle(rightSection);
            const mainLayoutComputedStyle = window.getComputedStyle(mainLayout);
            
            _log('📊 Flex properties:', {
                mainLayoutAlignItems: mainLayoutComputedStyle.alignItems,
                leftSectionFlex: leftComputedStyle.flex,
                rightSectionFlex: rightComputedStyle.flex,
                rightSectionDisplay: rightComputedStyle.display,
                rightSectionFlexDirection: rightComputedStyle.flexDirection
            });
            
            // Check if right section has flex column
            if (rightComputedStyle.display === 'flex' && rightComputedStyle.flexDirection === 'column') {
                _log('✅ Right section has flex column layout');
            } else {
                _log('❌ Right section does not have flex column layout');
            }
            
            // Check log container properties
            const logContainer = document.querySelector('.log-container');
            if (logContainer) {
                const logContainerComputedStyle = window.getComputedStyle(logContainer);
                _log('📊 Log container properties:', {
                    flex: logContainerComputedStyle.flex,
                    minHeight: logContainerComputedStyle.minHeight,
                    overflowY: logContainerComputedStyle.overflowY
                });
            }
            
            // Check log actions properties
            const logActions = document.querySelector('.log-actions');
            if (logActions) {
                const logActionsComputedStyle = window.getComputedStyle(logActions);
                _log('📊 Log actions properties:', {
                    marginTop: logActionsComputedStyle.marginTop,
                    flexShrink: logActionsComputedStyle.flexShrink
                });
            }
            
            // Test responsive behavior
            const isMobile = window.innerWidth <= 768;
            _log('📱 Device type:', isMobile ? 'Mobile' : 'Desktop');
            
            if (isMobile) {
                _log('📱 Mobile layout: Containers should stack vertically');
            } else {
                _log('🖥️ Desktop layout: Containers should have matching heights');
            }
            
            _log('🧪 Container height matching test completed');
        }

            // Make test function globally available (DEBUG only)
            if (DEBUG) window.testContainerHeightMatching = testContainerHeightMatching;

            // Toggle visibility of Log Input History section when header is clicked
            (function initLogHistoryToggle() {
                try {
                    const logHeader = document.querySelector('.right-section .log-header');
                    const logContainer = document.getElementById('inputLogContainer');
                    const logActions = document.querySelector('.right-section .log-actions');
                    const logHeaderActions = document.querySelector('.right-section .log-header-actions');
                    const rightSection = document.querySelector('.right-section');
                    if (!logHeader || !logContainer || !logActions) return;

                    // Keep log container always visible
                    logContainer.style.display = '';
                    logActions.style.display = 'flex';
                    logHeader.setAttribute('aria-expanded', 'true');
                    logHeader.style.marginBottom = '8px';
                    
                    // Keep header actions always visible
                    if (logHeaderActions) {
                        logHeaderActions.style.opacity = '1';
                    }
                } catch (error) {
                    console.error('Failed to initialize Log Input History toggle:', error);
                }
            })();

            // Toggle FAB for showing/hiding log action buttons
            function toggleLogFab(btn) {
                try {
                    const section = btn.closest('.right-section');
                    if (!section) return;
                    const isOpen = section.classList.toggle('log-fab-open');
                    // Optionally focus search when opening
                    if (isOpen) {
                        const search = section.querySelector('#logSearchInput');
                        if (search) search.focus();
                    }
                } catch (error) {
                    console.error('Failed to toggle log FAB:', error);
                }
            }

            // IndexedDB-backed persistence + auto-refresh for GitHub Pages (frontend-only)
            (function enhanceLogPersistenceAndRefresh() {
                try {
                    function openLogDB() {
                        return new Promise((resolve, reject) => {
                            const req = window.indexedDB.open('sj-logs-db', 1);
                            req.onupgradeneeded = () => {
                                const db = req.result;
                                if (!db.objectStoreNames.contains('kv')) {
                                    db.createObjectStore('kv', { keyPath: 'key' });
                                }
                            };
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });
                    }

                    async function idbSet(key, value) {
                        try {
                            const db = await openLogDB();
                            await new Promise((resolve, reject) => {
                                const tx = db.transaction('kv', 'readwrite');
                                tx.oncomplete = resolve;
                                tx.onerror = () => reject(tx.error);
                                tx.objectStore('kv').put({ key, value });
                            });
                            db.close();
                        } catch (e) {
                            console.warn('IDB set failed; continuing with localStorage only', e);
                        }
                    }

                    async function idbGet(key) {
                        try {
                            const db = await openLogDB();
                            const val = await new Promise((resolve, reject) => {
                                const tx = db.transaction('kv', 'readonly');
                                tx.onerror = () => reject(tx.error);
                                const req = tx.objectStore('kv').get(key);
                                req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
                                req.onerror = () => reject(req.error);
                            });
                            db.close();
                            return val;
                        } catch (e) {
                            console.warn('IDB get failed; falling back to localStorage', e);
                            return undefined;
                        }
                    }

                    const originalLoad = typeof loadInputLogFromStorage === 'function' ? loadInputLogFromStorage : null;
                    const originalSave = typeof saveInputLogToStorage === 'function' ? saveInputLogToStorage : null;

                    window.loadInputLogFromStorage = async function() {
                        // Cegah double render dengan flag
                        if (window._logLoadedOnce) return;
                        window._logLoadedOnce = true;
                        try {
                            const fromIDB = await idbGet('inputLogHistory');
                            if (Array.isArray(fromIDB)) {
                                inputLogHistory = fromIDB;
                                if (typeof renderInputLog === 'function') renderInputLog();
                                if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
                                if (typeof updateSupirDanKendaraanSuggestions === 'function') updateSupirDanKendaraanSuggestions();
                                if (typeof window.refreshNomorSJWarningNow === 'function') window.refreshNomorSJWarningNow();
                                return;
                            }
                        } catch (e) {
                            console.warn('Load from IndexedDB failed, will try fallback', e);
                        }

                        if (originalLoad) {
                            try { originalLoad(); return; } catch (e) { console.warn('Original load failed', e); }
                        }
                        try {
                            const saved = (typeof storageManager !== 'undefined' && storageManager.load)
                                ? storageManager.load('inputLogHistory') : null;
                            if (saved) {
                                inputLogHistory = saved;
                                if (typeof renderInputLog === 'function') renderInputLog();
                                if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
                                if (typeof updateSupirDanKendaraanSuggestions === 'function') updateSupirDanKendaraanSuggestions();
                            }
                        } catch (e) {
                            console.warn('Fallback localStorage load failed', e);
                        }
                    };

                    window.saveInputLogToStorage = function() {
                        try {
                            if (typeof storageManager !== 'undefined' && storageManager.save) {
                                storageManager.save('inputLogHistory', inputLogHistory);
                            }
                            if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
                            if (typeof updateSupirDanKendaraanSuggestions === 'function') updateSupirDanKendaraanSuggestions();
                            if (typeof window.refreshNomorSJWarningNow === 'function') window.refreshNomorSJWarningNow();
                        } catch (e) {
                            console.warn('localStorage save fallback failed', e);
                        }
                        idbSet('inputLogHistory', inputLogHistory);
                        _log('💾 Input log mirrored to IndexedDB:', inputLogHistory.length, 'entries');
                    };

                    window.addEventListener('storage', function(e) {
                        try {
                            if (e && e.key === 'inputLogHistory' && e.newValue) {
                                const parsed = JSON.parse(e.newValue);
                                if (Array.isArray(parsed)) {
                                    inputLogHistory = parsed;
                                    if (typeof renderInputLog === 'function') renderInputLog();
                                    if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
                                    if (typeof window.refreshNomorSJWarningNow === 'function') window.refreshNomorSJWarningNow();
                                }
                            }
                        } catch (err) {
                            console.warn('Failed to process storage event', err);
                        }
                    });

                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', () => {
                            if (typeof window.loadInputLogFromStorage === 'function') window.loadInputLogFromStorage();
                        });
                    } else {
                        if (typeof window.loadInputLogFromStorage === 'function') window.loadInputLogFromStorage();
                    }
                } catch (error) {
                    console.warn('Enhance persistence/init failed; app will continue with existing storage only', error);
                }
            })();

            // UI: Tampilkan ukuran pemakaian storage (origin) dan ukuran log IndexedDB (perkiraan)
            (function initStorageUsageIndicator() {
                try {
                    function ensureBadgeEl() {
                        let badge = document.getElementById('storageUsageBadge');
                        if (badge) return badge;
                        badge = document.createElement('div');
                        badge.id = 'storageUsageBadge';
                        badge.textContent = 'Storage: ...';
                        badge.style.fontSize = '12px';
                        badge.style.color = '#555';
                        badge.style.padding = '4px 8px';
                        badge.style.border = '1px solid #e1e5e9';
                        badge.style.borderRadius = '12px';
                        badge.style.background = '#f8f9fa';
                        badge.style.display = 'inline-block';
                        badge.style.marginLeft = '8px';
                        badge.style.whiteSpace = 'nowrap';

                        // Place next to refresh button in kaca-header
                        const refreshBtn = document.querySelector('.btn-refresh-page');
                        if (refreshBtn && refreshBtn.parentNode) {
                            refreshBtn.parentNode.insertBefore(badge, refreshBtn.nextSibling);
                            return badge;
                        }
                        // Fallback: append to body
                        document.body.appendChild(badge);
                        return badge;
                    }

                    function formatBytes(bytes) {
                        if (!bytes && bytes !== 0) return '...';
                        if (bytes < 1024) return bytes + ' B';
                        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
                        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
                    }

                    async function readLogRecordBytes() {
                        // Read IDB record and estimate bytes via Blob of JSON
                        try {
                            if (window.indexedDB && window.indexedDB.databases) {
                                const dbs = await window.indexedDB.databases();
                                if (!dbs.some(db => db.name === 'sj-logs-db')) return undefined;
                            }
                            const open = (name, ver=1) => new Promise((res, rej) => {
                                const req = indexedDB.open(name, ver);
                                req.onsuccess = () => res(req.result);
                                req.onerror = () => rej(req.error);
                            });
                            const db = await open('sj-logs-db', 1);
                            const value = await new Promise((res, rej) => {
                                const tx = db.transaction('kv', 'readonly');
                                const req = tx.objectStore('kv').get('inputLogHistory');
                                req.onsuccess = () => res(req.result ? req.result.value : undefined);
                                req.onerror = () => rej(req.error);
                            });
                            db.close();
                            const json = JSON.stringify(value || []);
                            return new Blob([json]).size; // UTF-8 size approximation
                        } catch (_) {
                            return undefined;
                        }
                    }

                    async function readStockDataBytes() {
                        try {
                            if (window.indexedDB && window.indexedDB.databases) {
                                const dbs = await window.indexedDB.databases();
                                if (!dbs.some(db => db.name === 'StokKacaDB')) return undefined;
                            }
                            const open = (name, ver=1) => new Promise((res, rej) => {
                                const req = indexedDB.open(name, ver);
                                req.onsuccess = () => res(req.result);
                                req.onerror = () => rej(req.error);
                            });
                            // DB_NAME = 'StokKacaDB', DB_VERSION = 1
                            const db = await open('StokKacaDB', 1);
                            const value = await new Promise((res, rej) => {
                                const tx = db.transaction('stokData', 'readonly');
                                const req = tx.objectStore('stokData').getAll();
                                req.onsuccess = () => res(req.result);
                                req.onerror = () => rej(req.error);
                            });
                            db.close();
                            const json = JSON.stringify(value || []);
                            return new Blob([json]).size;
                        } catch (_) {
                            return undefined;
                        }
                    }

                    async function measureAndRender() {
                        const badge = ensureBadgeEl();
                        try {
                            const est = await (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({}));
                            const usage = est && typeof est.usage === 'number' ? est.usage : undefined;
                            const quota = est && typeof est.quota === 'number' ? est.quota : undefined;
                            const logBytes = await readLogRecordBytes();

                            // Format: Used X.XX MB of 10 GB
                            let text = '';
                            if (usage !== undefined) {
                                text += 'Used ' + formatBytes(usage);
                                if (quota !== undefined) {
                                    text += ' of ' + formatBytes(quota);
                                }
                            } else {
                                text = 'Storage: N/A';
                            }

                            // Color coding
                            if (quota && usage !== undefined) {
                                const remainingPercent = ((quota - usage) / quota) * 100;
                                if (remainingPercent < 10) {
                                    badge.style.background = '#ffebee';
                                    badge.style.borderColor = '#f44336';
                                    badge.style.color = '#c62828';
                                } else if (remainingPercent < 25) {
                                    badge.style.background = '#fff3e0';
                                    badge.style.borderColor = '#ff9800';
                                    badge.style.color = '#e65100';
                                } else {
                                    badge.style.background = '#f8f9fa';
                                    badge.style.borderColor = '#e1e5e9';
                                    badge.style.color = '#555';
                                }
                            }

                            badge.textContent = text;
                        } catch (e) {
                            console.error('Storage measure error:', e);
                            const badgeEl = ensureBadgeEl();
                            badgeEl.textContent = 'Storage: N/A';
                            badgeEl.style.background = '#f8f9fa';
                            badgeEl.style.borderColor = '#e1e5e9';
                            badgeEl.style.color = '#555';
                        }
                    }

                    // Expose manual refresh
                    window.refreshStorageUsageDisplay = measureAndRender;

                    // Initial render after DOM ready
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', measureAndRender);
                    } else {
                        measureAndRender();
                    }

                    // Periodic refresh — store handle so it can be cleared if needed
                    window._storageUsageInterval = setInterval(measureAndRender, 60000);

                    // Refresh after localStorage cross-tab updates
                    window.addEventListener('storage', () => measureAndRender());
                } catch (err) {
                    // No-op if anything fails; UI remains unaffected
                }
            })();




// ===== STOCK JS =====
    let stokData = [];
    let activeItemFilter = null;
    let currentlyReorderingId = null;
    let originalStokDataBeforeReorder = null;
    let currentlyEditingId = null;
    let db = null;
    const DB_NAME = 'StokKacaDB';
    const DB_VERSION = 3;
    const STORE_NAME = 'stokData';
    // Flag to prevent auto-overwrite when user mengisi harga beli/manual
    let hargaManualOverride = false;

    // Helper to normalize product specifications (thickness, size, etc.)
    function normalizeSpec(s) {
      if (!s) return '';
      return String(s)
        .toLowerCase()
        // Replace spaces between numbers and units (e.g., "5 mm" -> "5mm")
        .replace(/(\d+)\s+(mm|cm|m|inch|")/gi, '$1$2')
        // Normalize 'x' separator for sizes, handling potential units/quotes (e.g., "60\" x 48\"" -> "60\"x48\"")
        .replace(/([\d.]+(?:"|mm|cm|m|inch)?)\s*x\s*([\d.]+(?:"|mm|cm|m|inch)?)/gi, '$1x$2')
        // Collapse multiple spaces
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Expose functions to window for backup/restore and cross-script access
    window.initDB = initDB;
    window.loadData = loadData;
    window.addEntry = addEntry;
    window.deleteEntryFromDB = deleteEntryFromDB;
    window.updateStokTable = updateStokTable;
    window.updateTotalSisa = updateTotalSisa;
    window.stokData = stokData;
    window.normalizeSpec = normalizeSpec;

    // Initialize IndexedDB
    function initDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error('IndexedDB error:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          db = request.result;
          resolve(db);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: false });
            objectStore.createIndex('id', 'id', { unique: true });
            objectStore.createIndex('tanggal', 'tanggal', { unique: false });
            objectStore.createIndex('nama', 'nama', { unique: false });
            objectStore.createIndex('tebal', 'tebal', { unique: false });
            objectStore.createIndex('ukuran', 'ukuran', { unique: false });
          } else {
            const objectStore = event.target.transaction.objectStore(STORE_NAME);
            if (!objectStore.indexNames.contains('tebal')) {
              objectStore.createIndex('tebal', 'tebal', { unique: false });
            }
            if (!objectStore.indexNames.contains('ukuran')) {
              objectStore.createIndex('ukuran', 'ukuran', { unique: false });
            }
          }
        };
      });
    }

    // Load all data from IndexedDB
    async function loadData() {
      try {
        if (!db) {
          await initDB();
        }

        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readonly');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.getAll();

          request.onsuccess = () => {
            const raw = request.result || [];
            // Dedup by ID — jaga-jaga kalo ada duplikat di IndexedDB
            const seen = new Set();
            stokData = [];
            for (const item of raw) {
              const key = item.id !== undefined ? String(item.id) : JSON.stringify(item);
              if (!seen.has(key)) {
                seen.add(key);
                stokData.push(item);
              }
            }
            if (stokData.length !== raw.length) {
              _log('⚠️ loadData: dibersihkan', raw.length - stokData.length, 'duplikat by ID');
            }
            window.stokData = stokData;
            _log('Data loaded:', stokData.length, 'entries');
            if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
            resolve(stokData);
          };

          request.onerror = () => {
            console.error('Error loading data:', request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error('Error in loadData:', error);
        stokData = [];
        return [];
      }
    }

    // === Daftar ID yang berubah (dirty) untuk saveData incremental ===
    const _dirtyIds = new Set();
    function _markDirty(id) { if (id !== undefined && id !== null) _dirtyIds.add(id); }
    function _markAllDirty() { _dirtyIds.clear(); _dirtyIds._full = true; }

    // Save data ke IndexedDB — incremental: hanya tulis ulang item yang dirty
    async function saveData() {
      try {
        if (!db) {
          await initDB();
        }

        // Saat full rewrite diperlukan (_full = true), rewrite semua
        if (_dirtyIds._full) {
          _dirtyIds.clear();
          delete _dirtyIds._full;
          return await _fullSave();
        }

        // Jika tidak ada yang dirty, skip
        if (_dirtyIds.size === 0) return;

        const ids = [..._dirtyIds];
        _dirtyIds.clear();

        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          let completed = 0;
          let hasError = false;
          const total = ids.length;

          ids.forEach((id) => {
            const item = stokData.find(e => String(e.id) === String(id));
            if (!item) {
              // Item dihapus — hapus dari store juga
              // Konversi ke number untuk match IndexedDB key (semua ID numeric)
              const deleteKey = (typeof id === 'string' && !isNaN(Number(id))) ? Number(id) : id;
              const req = store.delete(deleteKey);
              req.onsuccess = () => { completed++; if (completed === total && !hasError) resolve(); };
              req.onerror = () => { if (!hasError) { hasError = true; reject(req.error); } };
            } else {
              const req = store.put(item);
              req.onsuccess = () => { completed++; if (completed === total && !hasError) resolve(); };
              req.onerror = () => { if (!hasError) { hasError = true; reject(req.error); } };
            }
          });

          transaction.oncomplete = () => { if (!hasError) resolve(); };
          transaction.onerror = () => { if (!hasError) { hasError = true; reject(transaction.error); } };
        });
      } catch (error) {
        console.error("Error in saveData:", error);
        // Fallback: full rewrite
        try { await _fullSave(); } catch (_) {}
      }
    }

    // Full rewrite (fallback atau saat _markAllDirty dipanggil)
    async function _fullSave() {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const clear = store.clear();
        clear.onsuccess = () => {
          if (!stokData || stokData.length === 0) { resolve(); return; }
          let done = 0, err = false;
          stokData.forEach((item) => {
            const r = store.add(item);
            r.onsuccess = () => { done++; if (done === stokData.length && !err) resolve(); };
            r.onerror = () => { if (!err) { err = true; reject(r.error); } };
          });
        };
        clear.onerror = () => reject(clear.error);
      });
    }

    // Add single entry to IndexedDB
    async function addEntry(entry) {
      try {
        if (!db) {
          await initDB();
        }

        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.add(entry);

          request.onsuccess = () => {
            resolve(entry);
          };

          request.onerror = () => {
            reject(request.error);
          };
        });
      } catch (error) {
        console.error('Error adding entry:', error);
        throw error;
      }
    }

    // Update single entry in IndexedDB
    async function updateEntry(entry) {
      try {
        if (!db) {
          await initDB();
        }

        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(entry);

          request.onsuccess = () => {
            resolve(entry);
          };

          request.onerror = () => {
            reject(request.error);
          };
        });
      } catch (error) {
        console.error('Error updating entry:', error);
        throw error;
      }
    }

    // Delete single entry from IndexedDB
    async function deleteEntryFromDB(id) {
      try {
        if (!db) {
          await initDB();
        }

        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          // Konversi id ke number untuk match key di IndexedDB (semua ID numeric)
          const key = (typeof id === 'string' && !isNaN(Number(id))) ? Number(id) : id;
          const request = store.delete(key);

          request.onsuccess = () => {
            resolve();
          };

          request.onerror = () => {
            reject(request.error);
          };
        });
      } catch (error) {
        console.error('Error deleting entry:', error);
        throw error;
      }
    }

    // Initialize date field with today's date
    document.addEventListener('DOMContentLoaded', async function() {
      // Initialize IndexedDB and load data
      try {
        await initDB();
        await loadData();
        // Build stock cache setelah load data
        if (typeof rebuildStockCache === 'function') {
          rebuildStockCache();
        }
      } catch (error) {
        console.error('Error initializing database:', error);
        showStatus("Error memuat database. Menggunakan data kosong.", "error");
        stokData = [];
      }

      // Set tanggal default ke hari ini - khusus untuk form stok
      const stokForm = document.getElementById('stokForm');
      if (stokForm) {
        const tanggalInput = stokForm.querySelector('#tanggalStok');
        if (tanggalInput && !tanggalInput.value) {
          tanggalInput.valueAsDate = new Date();
          tanggalInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      // Initialize form mode
      setFormMode('pembelian');

      // Tunggu inputLogHistory ter-load agar aliveLogIds akurat saat render
      // Bypass _logLoadedOnce guard — langsung baca dari storage
      if (!inputLogHistory || inputLogHistory.length === 0) {
        try {
          const saved = (typeof storageManager !== 'undefined' && storageManager.load)
            ? storageManager.load('inputLogHistory') : null;
          if (Array.isArray(saved) && saved.length > 0) {
            inputLogHistory = saved;
          }
        } catch (_) {}
      }

      updateStokTable(true);
      updateTotalSisa(true);
      updateNamaTokoList();
      updateJenisKacaList();
      updateUkuranKacaList();
      if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
      
      // Add Enter key functionality to form inputs
      setupEnterKeyNavigation();
      // Add Enter key functionality for footer (CONT to SEAL)
      setupFooterEnterNavigation();
      // Update placeholder when harga beli berubah
      const hargaInput = document.getElementById('harga');
      if (hargaInput) {
        hargaInput.addEventListener('input', () => {
          // Jika user mengetik harga sendiri, jangan timpa otomatis
          hargaManualOverride = hargaInput.value.trim() !== '';
          updateHargaJualPlaceholder();
        });
      }
      
      
      // Monitor tebal and ukuran fields — ganti polling 50ms + RAF loop dengan event listener
      const tebalField = document.getElementById('tebal');
      const ukuranField = document.getElementById('ukuran');

      const handleTebalValueChange = function() {
        hargaManualOverride = false;
        updateHargaBeliPlaceholder();
        updateUkuranKacaList();
        fillHargaFromSelectedJenisKaca();
        updateHargaJualPlaceholder();
      };

      const handleUkuranValueChange = function() {
        hargaManualOverride = false;
        updateHargaBeliPlaceholder();
        fillHargaFromSelectedJenisKaca();
        updateHargaJualPlaceholder();
      };

      // Event listener: input (debounced 250ms) + change (pilih datalist/blur)
      if (tebalField) {
        let timeout;
        tebalField.addEventListener('input', function() {
          clearTimeout(timeout);
          timeout = setTimeout(handleTebalValueChange, 250);
        });
        tebalField.addEventListener('change', function() {
          clearTimeout(timeout);
          handleTebalValueChange();
        });
      }
      if (ukuranField) {
        let timeout;
        ukuranField.addEventListener('input', function() {
          clearTimeout(timeout);
          timeout = setTimeout(handleUkuranValueChange, 250);
        });
        ukuranField.addEventListener('change', function() {
          clearTimeout(timeout);
          handleUkuranValueChange();
        });
      }

      // Focus search input on Ctrl+F or Cmd+F
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          document.getElementById('searchInput').focus();
        }
        // Handle Ctrl+P or Cmd+P to trigger Print Sekarang
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
          e.preventDefault();
          if (typeof handleQuickPrint === 'function') {
            handleQuickPrint();
          }
        }
      });
    });

    // Function to update nama toko autocomplete list
    function updateNamaTokoList() {
      const namaTokoList = document.getElementById('namaTokoList');
      const uniqueNama = [...new Set(stokData.map(item => item.nama))].sort();
      
      namaTokoList.innerHTML = '';
      uniqueNama.forEach(nama => {
        const option = document.createElement('option');
        option.value = nama;
        namaTokoList.appendChild(option);
      });
    }

    // Function to update jenis kaca autocomplete list
    function updateJenisKacaList() {
      const jenisKacaList = document.getElementById('jenisKacaList');
      const groupedData = {};

      // Group data by Tebal Kaca, Ukuran Kaca, dan Harga Beli (untuk membedakan stok berdasarkan harga)
      stokData.forEach((entry) => {
        const hargaKey = entry.harga !== undefined && entry.harga > 0 ? entry.harga : 'noharga';
        const key = `${entry.tebal}-${entry.ukuran}-${hargaKey}`;

        if (!groupedData[key]) {
          groupedData[key] = { 
            tebal: entry.tebal, 
            ukuran: entry.ukuran, 
            hargaMasuk: hargaKey !== 'noharga' ? entry.harga : undefined,
            totalMasuk: 0, 
            totalKeluar: 0, 
            totalSisa: 0 
          };
        }

        // Simpan harga khusus untuk transaksi masuk (harga beli)
        if (
          groupedData[key].hargaMasuk === undefined &&
          entry.masuk > 0 &&
          entry.harga !== undefined &&
          entry.harga > 0
        ) {
          groupedData[key].hargaMasuk = entry.harga;
        }

        groupedData[key].totalMasuk += entry.masuk;
        groupedData[key].totalKeluar += entry.keluar;
        groupedData[key].totalSisa = groupedData[key].totalMasuk - groupedData[key].totalKeluar;
      });

      // Clear the datalist
      jenisKacaList.innerHTML = '';

      // Insert grouped data into the datalist (hanya yang memiliki sisa stok > 0)
      for (const key in groupedData) {
        const data = groupedData[key];
        
        // Hanya tampilkan jika ada sisa stok yang bisa dijual
        if (data.totalSisa > 0) {
          const option = document.createElement('option');
          option.value = data.tebal; // Only the glass type gets filled
          
          // Format: "Jenis Kaca : Ukuran (Harga: Rp X, Sisa: Y)"
          let displayText = `${data.ukuran}`;
          if (data.hargaMasuk !== undefined && data.hargaMasuk > 0) {
            displayText += ` (Harga: Rp ${data.hargaMasuk.toLocaleString('id-ID')}, Sisa: ${data.totalSisa.toLocaleString('id-ID')})`;
          } else {
            displayText += ` (Sisa: ${data.totalSisa.toLocaleString('id-ID')})`;
          }
          
          option.textContent = displayText;
          jenisKacaList.appendChild(option);
        }
      }
      
      // Update placeholder after datalist is updated
      updateHargaBeliPlaceholder();
      updateHargaJualPlaceholder();
    }

    // Function to update ukuran kaca autocomplete list
    function updateUkuranKacaList() {
      const ukuranKacaList = document.getElementById('ukuranKacaList');
      const selectedTebal = document.getElementById('tebal').value;
      const groupedData = {};

      // Group data by Tebal Kaca, Ukuran Kaca, dan Harga Beli (untuk membedakan stok berdasarkan harga)
      stokData.forEach((entry) => {
        const hargaKey = entry.harga !== undefined && entry.harga > 0 ? entry.harga : 'noharga';
        const key = `${entry.tebal}-${entry.ukuran}-${hargaKey}`;

        if (!groupedData[key]) {
          groupedData[key] = { 
            tebal: entry.tebal, 
            ukuran: entry.ukuran, 
            hargaMasuk: hargaKey !== 'noharga' ? entry.harga : undefined,
            totalMasuk: 0, 
            totalKeluar: 0, 
            totalSisa: 0 
          };
        }

        // Catat harga hanya dari transaksi masuk (harga beli)
        if (
          groupedData[key].hargaMasuk === undefined &&
          entry.masuk > 0 &&
          entry.harga !== undefined &&
          entry.harga > 0
        ) {
          groupedData[key].hargaMasuk = entry.harga;
        }

        groupedData[key].totalMasuk += entry.masuk;
        groupedData[key].totalKeluar += entry.keluar;
        groupedData[key].totalSisa = groupedData[key].totalMasuk - groupedData[key].totalKeluar;
      });

      // Clear the datalist
      ukuranKacaList.innerHTML = '';

      // Filter sizes based on selected glass type (hanya yang memiliki sisa stok > 0)
      for (const key in groupedData) {
        const data = groupedData[key];
        
        // If a glass type is selected, only show sizes for that type
        if (selectedTebal && data.tebal !== selectedTebal) {
          continue;
        }
        
        // Hanya tampilkan jika ada sisa stok yang bisa dijual
        if (data.totalSisa > 0) {
          const option = document.createElement('option');
          option.value = data.ukuran; // Only the glass size gets filled
          
          // Format: "Ukuran (Harga: Rp X, Sisa: Y)"
          let displayText = data.ukuran;
          if (data.hargaMasuk !== undefined && data.hargaMasuk > 0) {
            displayText += ` (Harga: Rp ${data.hargaMasuk.toLocaleString('id-ID')}, Sisa: ${data.totalSisa.toLocaleString('id-ID')})`;
          } else {
            displayText += ` (Sisa: ${data.totalSisa.toLocaleString('id-ID')})`;
          }
          
          option.textContent = displayText;
          ukuranKacaList.appendChild(option);
        }
      }
      
      // Update placeholder after datalist is updated
      updateHargaBeliPlaceholder();
      updateHargaJualPlaceholder();
    }

    // Function to update harga beli placeholder
    function updateHargaBeliPlaceholder() {
      const tebalField = document.getElementById('tebal');
      const ukuranField = document.getElementById('ukuran');
      const hargaField = document.getElementById('harga');
      
      if (!tebalField || !ukuranField || !hargaField) {
        return;
      }
      
      const tebal = tebalField.value.trim();
      const ukuran = ukuranField.value.trim();
      
      // Default placeholder
      let placeholderText = 'Harga Beli';
      
      // If both tebal and ukuran are filled, try to get harga
      if (tebal && ukuran) {
        const normTebal = normalizeSpec(tebal);
        const normUkuran = normalizeSpec(ukuran);
        const groupedData = {};
        
        stokData.forEach((entry) => {
          if (normalizeSpec(entry.tebal) === normTebal && normalizeSpec(entry.ukuran) === normUkuran) {
            const hargaKey = entry.harga !== undefined && entry.harga > 0 ? entry.harga : 'noharga';
            // Use JSON key for robustness
            const key = JSON.stringify([normTebal, normUkuran, hargaKey]);
            
            if (!groupedData[key]) {
              groupedData[key] = { 
                hargaMasuk: hargaKey !== 'noharga' ? entry.harga : undefined,
                totalMasuk: 0, 
                totalKeluar: 0, 
                totalSisa: 0 
              };
            }
            
            // Always set hargaMasuk from entry harga if available (prioritize masuk entries)
            if (entry.harga !== undefined && entry.harga > 0) {
              if (groupedData[key].hargaMasuk === undefined) {
                // If not set yet, set it from any entry with harga
                groupedData[key].hargaMasuk = entry.harga;
              } else if (entry.masuk > 0) {
                // If already set but this is a masuk entry, prefer this one (it's the purchase price)
                groupedData[key].hargaMasuk = entry.harga;
              }
              // If hargaMasuk already set and this is not a masuk entry, keep the existing one
            }
            
            groupedData[key].totalMasuk += (entry.masuk || 0);
            groupedData[key].totalKeluar += (entry.keluar || 0);
            groupedData[key].totalSisa = groupedData[key].totalMasuk - groupedData[key].totalKeluar;
          }
        });
        
        // Get all available harga with stock
        const hargaList = [];
        for (const key in groupedData) {
          const data = groupedData[key];
          // Include all entries with stock > 0 and has harga
          if (data.totalSisa > 0) {
            if (data.hargaMasuk !== undefined && data.hargaMasuk > 0) {
              hargaList.push(data.hargaMasuk);
            }
          }
        }
        
        // Unique and sort ascending
        const uniqueSorted = [...new Set(hargaList)].sort((a, b) => a - b);
        
        if (uniqueSorted.length > 0) {
          if (uniqueSorted.length === 1) {
            placeholderText = `Harga Beli | Rp ${uniqueSorted[0].toLocaleString('id-ID')}`;
          } else {
            const displayList = uniqueSorted.map(h => `Rp ${h.toLocaleString('id-ID')}`).join(' / ');
            placeholderText = `Harga Beli | ${displayList}`;
          }
        }
      }
      
      // Always update placeholder, even if field is hidden
      hargaField.setAttribute('placeholder', placeholderText);
      
      // Force update by triggering input event (for compatibility)
      if (hargaField.value === '') {
        // Only update placeholder if field is empty
        hargaField.placeholder = placeholderText;
      }
    }

    // Function to fill harga beli from selected jenis kaca and ukuran
    function fillHargaFromSelectedJenisKaca() {
      const tebal = document.getElementById('tebal').value.trim();
      const ukuran = document.getElementById('ukuran').value.trim();
      const hargaField = document.getElementById('harga');

      // Jika user sudah mengisi harga manual, jangan timpa
      if (hargaManualOverride && hargaField && hargaField.value.trim() !== '') {
        updateHargaJualPlaceholder();
        return;
      }

      // Update placeholder first
      updateHargaBeliPlaceholder();

      // Only proceed if both tebal and ukuran are filled
      if (!tebal || !ukuran) {
        return;
      }

      // Find matching entry with sisa stok > 0
      const groupedData = {};

      stokData.forEach((entry) => {
        if (entry.tebal === tebal && entry.ukuran === ukuran) {
          const hargaKey = entry.harga !== undefined && entry.harga > 0 ? entry.harga : 'noharga';
          const key = `${entry.tebal}-${entry.ukuran}-${hargaKey}`;

          if (!groupedData[key]) {
            groupedData[key] = {
              hargaMasuk: hargaKey !== 'noharga' ? entry.harga : undefined,
              totalMasuk: 0,
              totalKeluar: 0,
              totalSisa: 0
            };
          }

          if (
            groupedData[key].hargaMasuk === undefined &&
            entry.masuk > 0 &&
            entry.harga !== undefined &&
            entry.harga > 0
          ) {
            groupedData[key].hargaMasuk = entry.harga;
          }

          groupedData[key].totalMasuk += entry.masuk;
          groupedData[key].totalKeluar += entry.keluar;
          groupedData[key].totalSisa = groupedData[key].totalMasuk - groupedData[key].totalKeluar;
        }
      });

      // Kumpulkan semua harga dengan stok > 0
      const hargaList = [];
      for (const key in groupedData) {
        const data = groupedData[key];
        if (data.totalSisa > 0 && data.hargaMasuk !== undefined && data.hargaMasuk > 0) {
          hargaList.push(data.hargaMasuk);
        }
      }
      const uniqueSorted = [...new Set(hargaList)].sort((a, b) => a - b);

      // Isi harga otomatis hanya bila tersedia tepat satu harga
      if (uniqueSorted.length === 1) {
        const newValue = uniqueSorted[0].toLocaleString('id-ID');
        // Hanya update jika benar-benar berubah untuk mencegah flicker saat mengetik
        if (hargaField.value !== newValue) {
          hargaField.value = newValue;
        }
      }
      // JANGAN kosongkan harga jika tidak cocok — biarkan nilai sebelumnya
      // agar tidak hilang saat user masih mengetik rename jenis kaca

      // Always update placeholder to reflect latest state
      updateHargaJualPlaceholder();
    }

    // Helper: get all harga beli with sisa > 0 for given tebal+ukuran
    function getHargaBeliListWithStock(tebal, ukuran) {
      const groupedData = groupStokData(stokData, (entry) => {
        return entry.tebal === tebal && entry.ukuran === ukuran;
      });

      // Get all available harga with stock
      const hargaList = [];
      for (const key in groupedData) {
        const data = groupedData[key];
        // Include all entries with stock > 0 and has harga
        if (data.totalSisa > 0) {
          // Use hargaMasuk if available, otherwise extract from key
          if (data.hargaMasuk !== undefined && data.hargaMasuk > 0) {
            hargaList.push(data.hargaMasuk);
          } else {
            // Fallback: extract harga from key (format: tebal-ukuran-harga)
            const parts = key.split('-');
            if (parts.length >= 3) {
              const hargaFromKey = parts.slice(2).join('-'); // Handle harga that might contain dashes
              if (hargaFromKey !== 'noharga') {
                const hargaValue = parseFloat(hargaFromKey);
                if (!isNaN(hargaValue) && hargaValue > 0) {
                  hargaList.push(hargaValue);
                }
              }
            }
          }
        }
      }

      // Unique and sort ascending
      const uniqueSorted = [...new Set(hargaList)].sort((a, b) => a - b);
      return uniqueSorted;
    }

    // Update placeholder harga jual dengan informasi harga beli yang tersedia
    function updateHargaJualPlaceholder() {
      const tebalField = document.getElementById('tebal');
      const ukuranField = document.getElementById('ukuran');
      const hargaJualField = document.getElementById('hargaJual');
      const hargaField = document.getElementById('harga');

      if (!tebalField || !ukuranField || !hargaJualField) {
        return;
      }

      const tebal = tebalField.value.trim();
      const ukuran = ukuranField.value.trim();

      // Default placeholder
      let placeholderText = 'Harga Jual | [Harga Beli]';

      // Hanya relevan di mode penjualan
      if (currentFormMode === 'penjualan' && tebal && ukuran) {
        // Jika harga beli sudah terisi (misal dari klik tabel kanan atau ketikan), pakai itu
        const hargaBeliSelected = hargaField ? parseNumber(hargaField.value) : 0;
        if (hargaBeliSelected > 0) {
          placeholderText = `Harga Jual | Rp ${hargaBeliSelected.toLocaleString('id-ID')}`;
        } else {
          // Jika belum, tampilkan daftar semua harga beli yang punya stok
          const hargaList = getHargaBeliListWithStock(tebal, ukuran);
          if (hargaList.length > 0) {
            if (hargaList.length === 1) {
              placeholderText = `Harga Jual | Rp ${hargaList[0].toLocaleString('id-ID')}`;
            } else {
              const displayList = hargaList.map(h => `Rp ${h.toLocaleString('id-ID')}`).join(' / ');
              placeholderText = `Harga Jual | ${displayList}`;
            }
          }
        }
      }

      // Always update placeholder
      hargaJualField.setAttribute('placeholder', placeholderText);
      hargaJualField.placeholder = placeholderText; // Also set directly for compatibility
    }

    // Function to setup Enter key navigation
    function setupEnterKeyNavigation() {
      const formInputs = [
        'nama',
        'tanggal', 
        'nota',
        'tebal',
        'ukuran',
        'harga',
        'hargaJual',
        'masuk',
        'keluar'
      ];

      formInputs.forEach((inputId, index) => {
        // Langsung cari input dari form stok, bukan dari document
        const stokForm = document.getElementById('stokForm');
        if (!stokForm) return;
        
        // Gunakan querySelector dari stokForm untuk memastikan kita mendapatkan field yang benar
        let input = null;
        if (inputId === 'tanggal') {
          // Khusus untuk tanggal, cari input type="date" di dalam stokForm
          input = stokForm.querySelector('input[type="date"]#tanggalStok');
        } else {
          // Untuk field lain, gunakan selector biasa dari stokForm
          input = stokForm.querySelector('#' + inputId);
        }
        
        if (input) {
          // Double check: pastikan input benar-benar berada di form stok
          if (!stokForm.contains(input)) {
            return; // Skip field yang tidak berada di form stok
          }
          
          input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation(); // Prevent event from bubbling to global listener
              
              // Skip hidden fields based on form mode
              if (currentFormMode === 'pembelian' && (inputId === 'hargaJual' || inputId === 'keluar')) {
                e.stopImmediatePropagation();
                tambahData();
                return;
              }
              if (currentFormMode === 'penjualan' && (inputId === 'harga' || inputId === 'masuk')) {
                e.stopImmediatePropagation();
                tambahData();
                return;
              }

              // Special handling for "masuk" field
              if (inputId === 'masuk') {
                const stokForm = document.getElementById('stokForm');
                const masukInput = stokForm ? stokForm.querySelector('#masuk') : null;
                const keluarInput = stokForm ? stokForm.querySelector('#keluar') : null;
                const masukValue = masukInput ? masukInput.value : '';
                const keluarValue = keluarInput ? keluarInput.value : '';

                // If masuk has value and keluar is empty, skip keluar and submit
                if (masukValue && masukValue > 0 && (!keluarValue || keluarValue == 0)) {
                  e.stopImmediatePropagation(); // Cegah bubble ke listener lain
                  tambahData();
                  return;
                }
              }

              // Find next visible input - hanya di form stok
              const stokForm = document.getElementById('stokForm');
              if (!stokForm) {
                e.stopImmediatePropagation();
                tambahData();
                return;
              }

              let nextIndex = index + 1;
              while (nextIndex < formInputs.length) {
                const nextInputId = formInputs[nextIndex];

                // Gunakan querySelector dari stokForm dengan selector yang lebih spesifik
                let nextInput = null;
                if (nextInputId === 'tanggal') {
                  // Khusus untuk tanggal, cari input type="date" di dalam stokForm
                  nextInput = stokForm.querySelector('input[type="date"]#tanggalStok');
                } else {
                  // Untuk field lain, gunakan selector biasa dari stokForm
                  nextInput = stokForm.querySelector('#' + nextInputId);
                }

                if (nextInput && stokForm.contains(nextInput)) {
                  // Check if field is visible based on mode
                  const isPembelianField = nextInputId === 'harga' || nextInputId === 'masuk';
                  const isPenjualanField = nextInputId === 'hargaJual' || nextInputId === 'keluar';

                  if (currentFormMode === 'pembelian' && isPenjualanField) {
                    nextIndex++;
                    continue;
                  }
                  if (currentFormMode === 'penjualan' && isPembelianField) {
                    nextIndex++;
                    continue;
                  }

                  // Check visibility - simplified check
                  const computedStyle = window.getComputedStyle(nextInput);
                  const isHidden = computedStyle.display === 'none' ||
                                  computedStyle.visibility === 'hidden' ||
                                  nextInput.disabled ||
                                  nextInput.hidden ||
                                  nextInput.type === 'hidden';

                  // If not hidden, focus on it immediately
                  if (!isHidden) {
                    // Use requestAnimationFrame for immediate focus
                    requestAnimationFrame(() => {
                      // Double check field still exists and is in stokForm
                      let verifyInput = null;
                      if (nextInputId === 'tanggal') {
                        verifyInput = stokForm.querySelector('input[type="date"]#tanggalStok');
                      } else {
                        verifyInput = stokForm.querySelector('#' + nextInputId);
                      }
                      if (verifyInput && stokForm.contains(verifyInput) && !verifyInput.disabled) {
                        verifyInput.focus();
                      }
                    });
                    return;
                  }
                }
                nextIndex++;
              }
              
              // If no next visible input found, submit form
              e.stopImmediatePropagation();
              tambahData();
            }
          });
          
          // Add multiple event listeners for tebal field to handle datalist selection
          if (inputId === 'tebal') {
            const handleTebalChange = function() {
              // Force update placeholder immediately
              hargaManualOverride = false; // reset supaya boleh auto-fill sesuai pilihan baru
              updateHargaBeliPlaceholder();
              updateUkuranKacaList();
              fillHargaFromSelectedJenisKaca();
              updateHargaJualPlaceholder();
              // Kosongkan harga jual agar placeholder terlihat saat di penjualan
              if (currentFormMode === 'penjualan') {
                const hargaJualField = document.getElementById('hargaJual');
                if (hargaJualField) {
                  hargaJualField.value = '';
                }
              }
            };
            // Use multiple events to catch all possible interactions
            input.addEventListener('input', handleTebalChange);
            input.addEventListener('change', handleTebalChange);
            // Use blur with delay to catch datalist selections that don't trigger change immediately
            input.addEventListener('blur', function() {
              setTimeout(handleTebalChange, 150);
            });
            // Listen for keyboard events that might be used to select from datalist
            input.addEventListener('keyup', function(e) {
              // Arrow keys, Enter, or Tab might be used to select from datalist
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab') {
                setTimeout(handleTebalChange, 100);
              }
            });
            // Also listen for focus events
            input.addEventListener('focus', function() {
              setTimeout(handleTebalChange, 200);
            });
          }
          
          // Add multiple event listeners for ukuran field to handle datalist selection
          if (inputId === 'ukuran') {
            const handleUkuranChange = function() {
              // Force update placeholder immediately
              hargaManualOverride = false; // reset supaya boleh auto-fill sesuai pilihan baru
              updateHargaBeliPlaceholder();
              fillHargaFromSelectedJenisKaca();
              updateHargaJualPlaceholder();
              // Kosongkan harga jual agar placeholder terlihat saat di penjualan
              if (currentFormMode === 'penjualan') {
                const hargaJualField = document.getElementById('hargaJual');
                if (hargaJualField) {
                  hargaJualField.value = '';
                }
              }
            };
            // Use multiple events to catch all possible interactions
            input.addEventListener('input', handleUkuranChange);
            input.addEventListener('change', handleUkuranChange);
            // Use blur with delay to catch datalist selections that don't trigger change immediately
            input.addEventListener('blur', function() {
              setTimeout(handleUkuranChange, 150);
            });
            // Listen for keyboard events that might be used to select from datalist
            input.addEventListener('keyup', function(e) {
              // Arrow keys, Enter, or Tab might be used to select from datalist
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab') {
                setTimeout(handleUkuranChange, 100);
              }
            });
            // Also listen for focus events
            input.addEventListener('focus', function() {
              setTimeout(handleUkuranChange, 200);
            });
          }
        }
      });
    }

    // Function to setup Enter key navigation for footer (CONT to SEAL)
    function setupFooterEnterNavigation() {
      const contInput = document.querySelector('.cont-input');
      const sealInput = document.querySelector('.seal-input');
      
      if (contInput && sealInput) {
        contInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            sealInput.focus();
          }
        });
      }
    }

    // Function to perform search
    function performSearch() {
      const searchInput = document.getElementById('searchInput');
      const searchTerm = searchInput ? searchInput.value.trim() : '';
      const searchClearBtn = document.getElementById('searchClearBtn');
      const tableBody = document.getElementById("stokTable");

      // Reset active item filter if user manually types a DIFFERENT search term
      // (not just re-rendering with the same filter)
      // Note: do NOT call updateStokTable() here to avoid re-entrant loop
      // updateStokTable() already calls performSearch() at the end
      if (activeItemFilter) {
        const filterText = `${activeItemFilter.tebal} ${activeItemFilter.ukuran}${(isPriceGroupingEnabled && activeItemFilter.harga !== undefined) ? ` ${activeItemFilter.harga.toLocaleString('id-ID')}` : ''}`;
        // Only clear filter if user actually typed something different AND it's not empty
        if (searchTerm && searchTerm !== filterText) {
          activeItemFilter = null;
          currentlyReorderingId = null;
          requestAnimationFrame(() => updateStokTable());
          return;
        }
      }
      if (!tableBody) {
        _log('❌ stokTable not found');
        return;
      }
      
      const tbody = tableBody.getElementsByTagName('tbody')[0];
      if (!tbody) {
        _log('❌ tbody not found');
        return;
      }
      
      const rows = Array.from(tbody.querySelectorAll('tr'));
      _log(`🔍 performSearch called with term: "${searchTerm}", found ${rows.length} rows`);
      
      // Show/hide clear button
      if (searchTerm.length > 0) {
        if (searchClearBtn) searchClearBtn.style.display = 'block';
      } else {
        if (searchClearBtn) searchClearBtn.style.display = 'none';
      }
      
      // Check for sorting patterns: "1-2" (ascending) or "2-1" (descending)
      if (searchTerm === '1-2' || searchTerm === '2-1') {
        _log(`📊 Sorting by nota: ${searchTerm === '1-2' ? 'ascending' : 'descending'}`);
        // Sort by nota number
        const sortAscending = searchTerm === '1-2';
        
        // First, make sure all rows are visible
        rows.forEach(row => {
          row.style.display = '';
        });
        
        // Extract nota from each row and sort
        const rowsWithNota = rows.map(row => {
          const cells = row.querySelectorAll('td');
          // Nota is in the 4th column (index 3)
          const notaCell = cells[3];
          const notaText = notaCell ? notaCell.textContent.trim() : '';
          
          // Extract numeric part from nota for sorting
          // Handle various nota formats (e.g., "SJ-123", "123", "ABC-456")
          // Try to get the last number in the string (most likely the main number)
          const notaMatches = notaText.match(/\d+/g);
          let notaNumber = 0;
          if (notaMatches && notaMatches.length > 0) {
            // Use the last number found (usually the main number after prefix)
            notaNumber = parseInt(notaMatches[notaMatches.length - 1], 10);
          }
          
          return { row, notaText, notaNumber };
        });
        
        _log('📋 Nota data:', rowsWithNota.map(r => ({ nota: r.notaText, number: r.notaNumber })));
        
        // Sort by nota number
        rowsWithNota.sort((a, b) => {
          if (sortAscending) {
            // Ascending: small to large
            if (a.notaNumber !== b.notaNumber) {
              return a.notaNumber - b.notaNumber;
            }
            // If numbers are equal, sort by text
            return a.notaText.localeCompare(b.notaText);
          } else {
            // Descending: large to small
            if (a.notaNumber !== b.notaNumber) {
              return b.notaNumber - a.notaNumber;
            }
            // If numbers are equal, sort by text (reverse)
            return b.notaText.localeCompare(a.notaText);
          }
        });
        
        // Clear table and re-append sorted rows
        tbody.innerHTML = '';
        rowsWithNota.forEach((item, index) => {
          // Update row number
          const cells = item.row.querySelectorAll('td');
          if (cells[0]) {
            cells[0].textContent = index + 1;
          }
          // Ensure row is visible
          item.row.style.display = '';
          tbody.appendChild(item.row);
        });
        
        _log(`✅ Sorted ${rowsWithNota.length} rows by nota (${sortAscending ? 'ascending' : 'descending'})`);
        return;
      }
      
      // Normal search functionality
      if (searchTerm === '') {
        // Show all rows if search is empty
        rows.forEach(row => {
          row.style.display = '';
        });
        return;
      }
      
      // Split search term into keywords for multi-field search (e.g. "FL 5MM 60X48")
      const keywords = searchTerm.toLowerCase().split(/\s+/).filter(k => k.length > 0);
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        // Get text from all searchable columns (skip No and Aksi)
        const searchableText = cells
          .slice(1, -1)
          .map(cell => cell.textContent.toLowerCase())
          .join(' ');
        
        // Check if ALL keywords are present in the searchable text
        const found = keywords.every(keyword => searchableText.includes(keyword));
        
        row.style.display = found ? '' : 'none';
      });
    }

    // Function to clear search
    function clearSearch() {
      document.getElementById('searchInput').value = '';
      document.getElementById('searchClearBtn').style.display = 'none';
      activeItemFilter = null; // Reset item filter when clearing search
      currentlyReorderingId = null; // Reset reorder mode too
      // Clear active row highlight in total sisa table
      const activeRow = document.querySelector('.total-sisa-container tr.row-filter-active');
      if (activeRow) activeRow.classList.remove('row-filter-active');
      updateStokTable();
      document.getElementById('searchInput').focus();
    }

    // Function to set form mode (Pembelian/Penjualan)
    let currentFormMode = 'pembelian';
    
    function setFormMode(mode) {
      // Only support pembelian mode
      currentFormMode = 'pembelian';
      const pembelianFields = document.querySelectorAll('.field-pembelian');
      const penjualanFields = document.querySelectorAll('.field-penjualan');
      
      // Always show pembelian fields, hide penjualan fields
      pembelianFields.forEach(field => {
        field.style.display = '';
        field.removeAttribute('disabled');
      });
      penjualanFields.forEach(field => {
        field.style.display = 'none';
        field.value = '';
        field.setAttribute('disabled', 'disabled');
      });

      // Update placeholder harga beli dengan referensi harga beli yang tersedia
      updateHargaBeliPlaceholder();
    }

    // Function to toggle input fields for Masuk/Keluar
    function toggleJumlahMasukKeluar() {
      const masuk = document.getElementById("masuk");
      const keluar = document.getElementById("keluar");
      
      const masukVal = parseRupiah(masuk.value);
      const keluarVal = parseNumber(keluar.value);

      if (masukVal > 0) {
        keluar.disabled = true;
        keluar.value = '';
      } else if (keluarVal > 0) {
        masuk.disabled = true;
        masuk.value = '';
      } else {
        masuk.disabled = false;
        keluar.disabled = false;
      }
    }

    // Guard: cegah double submit saat proses masih jalan
    let _isSubmitting = false;

    // Reset submit button ke state awal
    function _resetSubmitBtn() {
      _isSubmitting = false;
      const btn = document.getElementById('submitBtn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Tambah Data';
      }
    }

    // Function to add or update data
    async function tambahData() {
      // Cegah re-entry kalo masih proses
      if (_isSubmitting) {
        _log('⏳ tambahData masih proses, skip double call');
        return;
      }
      _isSubmitting = true;

      // Disable submit button biar user gak klik 2x
      const submitBtn = document.getElementById('submitBtn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan...';
      }

      const nama = document.getElementById("nama").value.trim();
      const tanggal = document.getElementById("tanggalStok").value;
      const nota = document.getElementById("nota").value.trim();
      const tebal = document.getElementById("tebal").value;
      const ukuran = document.getElementById("ukuran").value.trim();
          
          // Parse values - gunakan parseRupiah untuk harga (input text) dan parseNumber untuk jumlah (input number)
          const harga = parseRupiah(document.getElementById("harga").value);
          const hargaJual = parseRupiah(document.getElementById("hargaJual").value);
          const masuk = parseRupiah(document.getElementById("masuk").value);
          const keluar = parseRupiah(document.getElementById("keluar").value);

      if (!nama || !tanggal || !nota || !tebal || !ukuran) {
        alert("Semua field harus diisi !");
        _resetSubmitBtn();
        return;
      }

      // Validate based on form mode
      if (currentFormMode === 'pembelian') {
        if (masuk === 0) {
          alert("Harap isi jumlah kaca masuk!");
          _resetSubmitBtn();
          return;
        }
      } else {
        if (keluar === 0) {
          alert("Harap isi jumlah kaca keluar!");
          _resetSubmitBtn();
          return;
        }
      }

      // Format date for display
      const formattedDate = formatDate(tanggal);

      try {
        if (currentlyEditingId) {
          // Normalize ID to string for comparison
          const normalizedId = String(currentlyEditingId);

          // Update existing entry - check both stokData and window.stokData
          let index = stokData.findIndex(item => String(item.id) === normalizedId);

          // If not found in local stokData, check window.stokData
          if (index === -1 && typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
            const windowIndex = window.stokData.findIndex(item => String(item.id) === normalizedId);
            if (windowIndex !== -1) {
              // Sync local stokData with window.stokData (pakai reference)
              stokData = window.stokData;
              index = windowIndex;
            }
          }
          
          if (index !== -1) {
            const oldEntry = { ...stokData[index] };
            const oldTebal = oldEntry.tebal;
            const oldUkuran = oldEntry.ukuran;

            const updatedEntry = {
              id: currentlyEditingId,
              nama,
              tanggal: formattedDate,
              nota,
              tebal,
              ukuran,
              harga,
              hargaJual,
              masuk,
              keluar
            };
            stokData[index] = updatedEntry;
            markStockCacheDirty();

            // Jika jenis kaca berubah, update penjualan terkait yang match dengan jenis LAMA
            if ((oldTebal !== tebal || oldUkuran !== ukuran) && oldTebal && oldUkuran) {
              const oldTebalNorm = normalizeSpec(oldTebal);
              const oldUkuranNorm = normalizeSpec(oldUkuran);

              // Cari penjualan (keluar > 0, masuk = 0) dengan jenis kaca LAMA
              const relatedPenjualan = stokData.filter(e =>
                String(e.id) !== normalizedId &&
                e.keluar > 0 &&
                (!e.masuk || e.masuk === 0) &&
                normalizeSpec(e.tebal) === oldTebalNorm &&
                normalizeSpec(e.ukuran) === oldUkuranNorm
              );

              if (relatedPenjualan.length > 0) {
                _log(`🔄 Update ${relatedPenjualan.length} penjualan: ${oldTebal}→${tebal}, ${oldUkuran}→${ukuran}`);
                for (const penjualan of relatedPenjualan) {
                  penjualan.tebal = tebal;
                  penjualan.ukuran = ukuran;
                  try {
                    if (typeof updateEntry === 'function') {
                      await updateEntry(penjualan);
                    }
                  } catch (e) {
                    console.error('Gagal update penjualan:', penjualan.id, e);
                  }
                }
                // Sinkron ke window.stokData — PASTIKAN semua penjualan ada di window.stokData
                if (typeof window !== 'undefined') {
                  if (!Array.isArray(window.stokData)) window.stokData = [];
                  for (const penjualan of relatedPenjualan) {
                    const winIdx = window.stokData.findIndex(e => String(e.id) === String(penjualan.id));
                    if (winIdx !== -1) {
                      window.stokData[winIdx].tebal = tebal;
                      window.stokData[winIdx].ukuran = ukuran;
                    } else {
                      window.stokData.push({ ...penjualan });
                    }
                  }
                }
                // Update juga data di inputLogHistory — GUNAKAN logEntryId dari penjualan (lebih akurat)
                if (typeof inputLogHistory !== 'undefined' && Array.isArray(inputLogHistory) && inputLogHistory.length > 0) {
                  var _logMap = {};
                  relatedPenjualan.forEach(function(p) { if (p.logEntryId) _logMap[p.logEntryId] = true; });
                  var _logKeys = Object.keys(_logMap);
                  if (_logKeys.length > 0) {
                    var _updCount = 0;
                    inputLogHistory.forEach(function(logEntry) {
                      if (!logEntry.data || !logEntry.id) return;
                      if (_logMap[logEntry.id]) {
                        var _kd = logEntry.data.kacaData || {};
                        var _rows = _kd.rows || [];
                        if (!Array.isArray(_rows)) _rows = [];
                        var _changed = false;
                        _rows.forEach(function(r) {
                          // HANYA update row yang jenis kacanya MATCH dengan yang direname
                          if (r.jenisKaca && r.ukuran && normalizeSpec(String(r.jenisKaca)) === oldTebalNorm && normalizeSpec(String(r.ukuran)) === oldUkuranNorm) {
                            r.jenisKaca = tebal;
                            r.ukuran = ukuran;
                            _changed = true;
                          }
                        });
                        if (_changed) _updCount++;
                      }
                    });
                    if (_updCount > 0) {
                      try { storageManager.save('inputLogHistory', inputLogHistory); } catch(_) {}
                      try {
                        var _r = window.indexedDB.open('sj-logs-db', 1);
                        _r.onsuccess = function() {
                          try { var _d = _r.result; var _t = _d.transaction('kv','readwrite'); _t.objectStore('kv').put({key:'inputLogHistory',value:inputLogHistory}); _t.oncomplete = function(){_d.close();}; } catch(_) {}
                        };
                      } catch(_) {}
                      if (typeof renderInputLog === 'function') renderInputLog();
                      if (typeof updateKacaSuggestionsFromLogs === 'function') updateKacaSuggestionsFromLogs();
                    }
                  }
                }
              }
            }

            // Sync dengan window.stokData — satukan referensi agar tidak double
            if (typeof window !== 'undefined') {
              if (window.stokData !== stokData) {
                // Jika referensi terputus (misal akibat updateStokTable yg pake spread),
                // satukan semua data dari stokData ke window.stokData tanpa duplikasi
                if (!Array.isArray(window.stokData)) {
                  window.stokData = stokData;
                } else {
                  const existingIds = new Set(window.stokData.map(e => e.id));
                  // Update atau tambah entry dari stokData
                  stokData.forEach(item => {
                    const wIdx = window.stokData.findIndex(w => String(w.id) === String(item.id));
                    if (wIdx !== -1) {
                      window.stokData[wIdx] = item;
                    } else if (!existingIds.has(item.id)) {
                      window.stokData.push(item);
                      existingIds.add(item.id);
                    }
                  });
                }
              } else {
                // Referensi sama, cukup assign langsung
                const windowIndex = window.stokData.findIndex(item => String(item.id) === normalizedId);
                if (windowIndex !== -1) {
                  window.stokData[windowIndex] = updatedEntry;
                } else {
                  window.stokData.push(updatedEntry);
                }
              }
            }
            
            await updateEntry(updatedEntry);
            // Incremental save — tandai ID yang berubah saja
            _markDirty(updatedEntry.id);
            if (typeof saveData === 'function') {
              await saveData().catch(function(e) { console.warn('saveData after update:', e); });
            }
            showStatus("Data berhasil diupdate", "saving");
            setTimeout(() => {
              const statusBar = document.getElementById('statusBar');
              if (statusBar) statusBar.style.display = 'none';
            }, 2000);

            // Batch render — semua update di-flush sekali per frame
            _markRender(1|2|4|8|16|32);

            // Reset form
            cancelEdit();
            return;
          }
          cancelEdit();
        } else {
          // Add new entry
          const newId = Date.now();

          // Last-line defense: cek apakah entry persis sama udah ada (by ID)
          if (stokData.some(e => String(e.id) === String(newId))) {
            _log('⚠️ Duplicate ID detected, skip');
            _resetSubmitBtn();
            return;
          }

          const newEntry = {
            id: newId,
            nama, 
            tanggal: formattedDate, 
            nota, 
            tebal, 
            ukuran, 
            harga,
            hargaJual,
            masuk, 
            keluar
          };
          stokData.unshift(newEntry);
          markStockCacheDirty();
          // Sync dengan window.stokData — hindari double entry
          // saat stokData dan window.stokData adalah reference array yang sama
          if (stokData !== window.stokData) {
            window.stokData.unshift(newEntry);
          }
          await addEntry(newEntry);
          _markDirty(newEntry.id);
          if (typeof saveData === 'function') {
            await saveData().catch(function(e) { console.warn('saveData after add:', e); });
          }
          showStatus("Data berhasil ditambahkan", "saving");
          setTimeout(() => document.getElementById('statusBar').style.display = 'none', 2000);
        }

        _markRender(1|2|4|8|16);
        
        // Update dropdown surat jalan tanpa refresh
        if (typeof updateKacaSuggestionsFromLogs === 'function') {
          updateKacaSuggestionsFromLogs();
        }
        
        // Reset form
        document.getElementById("stokForm").reset();
        document.getElementById("tanggalStok").value = new Date().toISOString().split('T')[0];
        toggleJumlahMasukKeluar();
        updateHargaBeliPlaceholder();
        updateHargaJualPlaceholder();

        // Batch render — semua update dijadwalkan sekali per frame
        _markRender(1|2|4|8|16|32);

        // Auto refresh non-functional (too fast, destroys UX) - removed
        // All table updates already done synchronously above
      } catch (error) {
        console.error('Error in tambahData:', error);
        alert("Terjadi kesalahan saat menyimpan data: " + error.message);
      } finally {
        _resetSubmitBtn();
      }
    }

    // ===== STOCK CACHE: precompute running stock untuk O(1) lookup =====
    if (!window._stockCache) {
      window._stockCache = new Map();
      window._stockCacheDirty = true;
    }

    // Rebuild stock cache dari awal (dipanggil saat data berubah)
    function rebuildStockCache(dataArray) {
      const cache = new Map();
      const sourceData = dataArray || (window.stokData && Array.isArray(window.stokData) ? window.stokData : stokData);
      if (!Array.isArray(sourceData) || sourceData.length === 0) {
        window._stockCache = cache;
        window._stockCacheDirty = false;
        return;
      }

      // Single pass: group + sort key generation
      const groups = {};
      const parseDate = window._parseDateCached || ((d) => new Date(d.split('/').reverse().join('/')));

      for (let i = 0; i < sourceData.length; i++) {
        const entry = sourceData[i];
        if (!entry.tebal || !entry.ukuran) continue;
        const normTebal = normalizeSpec(entry.tebal);
        const normUkuran = normalizeSpec(entry.ukuran);
        const hargaKey = (isPriceGroupingEnabled && entry.harga > 0) ? entry.harga : 'noharga';
        const key = normTebal + '||' + normUkuran + '||' + (isPriceGroupingEnabled ? hargaKey : 'all');

        if (!groups[key]) groups[key] = [];
        // Precompute sort key: [timestamp, id] untuk Schwartzian
        groups[key].push({
          entry,
          sortKey: parseDate(entry.tanggal).getTime(),
          id: String(entry.id ?? '')
        });
      }

      // Process each group: sort by precomputed key, then running stock
      const keys = Object.keys(groups);
      for (let g = 0; g < keys.length; g++) {
        const group = groups[keys[g]];
        group.sort((a, b) => {
          if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
          return a.id.localeCompare(b.id);
        });

        let runningStock = 0;
        for (let i = 0; i < group.length; i++) {
          const e = group[i].entry;
          runningStock += (e.masuk || 0) - (e.keluar || 0);
          cache.set(e.id, runningStock);
        }
      }

      window._stockCache = cache;
      window._stockCacheDirty = false;
    }

    // Tandai cache perlu rebuild
    function markStockCacheDirty() {
      window._stockCacheDirty = true;
      // Invalidate groupStokData cache
      _groupStokDataCache = null;
      _groupStokDataCacheLen = -1;
    }

    // Function to calculate current stock at the time of transaction
    // Cache for date parsing to improve performance (global cache)
    if (!window._dateCache) {
      window._dateCache = new Map();
    }
    if (!window._parseDateCached) {
      window._parseDateCached = (dateStr) => {
        if (!window._dateCache.has(dateStr)) {
          // Cap cache at 500 entries to prevent memory leak
          if (window._dateCache.size > 500) {
            const firstKey = window._dateCache.keys().next().value;
            window._dateCache.delete(firstKey);
          }
          window._dateCache.set(dateStr, new Date(dateStr.split('/').reverse().join('/')));
        }
        return window._dateCache.get(dateStr);
      };
    }
    
    function calculateCurrentStock(entry, data) {
      // Gunakan cache jika data tidak berubah dan tidak ada data array override
      if (!data && !window._stockCacheDirty && window._stockCache && window._stockCache.has(entry.id)) {
        return window._stockCache.get(entry.id);
      }

      // Fallback: hitung manual (jika ada override data array)
      const sourceData = data || stokData;
      const normTebal = normalizeSpec(entry.tebal);
      const normUkuran = normalizeSpec(entry.ukuran);

      // Early exit jika tebal/ukuran kosong
      if (!normTebal || !normUkuran) return 0;

      const sameTypeEntries = sourceData.filter(e => {
        const matchBase = normalizeSpec(e.tebal) === normTebal &&
                         normalizeSpec(e.ukuran) === normUkuran;

        if (!matchBase) return false;

        if (isPriceGroupingEnabled) {
          const targetPrice = entry.harga ?? null;
          return (e.harga ?? null) === targetPrice;
        }

        return true;
      });

      // Running stock: iterasi sekali, bukan filter + 2 reduce
      let runningStock = 0;
      const entryIdNorm = String(entry.id);
      for (let i = 0; i < sameTypeEntries.length; i++) {
        const e = sameTypeEntries[i];
        runningStock += (e.masuk || 0) - (e.keluar || 0);
        if (String(e.id) === entryIdNorm) break;
      }
      return runningStock;
    }

    // Helper: parse number supporting thousand separators (., ,)
    function parseNumber(value) {
      if (value === undefined || value === null) return 0;
      if (typeof value === 'number') return isNaN(value) ? 0 : value;
      const cleaned = value.toString().replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    }

    // Function to format date as dd/mm/yyyy
    function formatDate(dateString) {
      const date = new Date(dateString);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }

    // Function to manually move stok rows to fix chronological flow
    async function moveStokRow(id, direction) {
      // Cari entry dengan ID yang cocok (support string/numeric)
      const searchId = String(id);
      const allStokData = (typeof window !== 'undefined' && Array.isArray(window.stokData)) ? window.stokData : stokData;
      const matchEntry = allStokData.find(e => String(e.id) === searchId);
      if (!matchEntry) return;
      const normalizedId = matchEntry.id;
      
      // Get current sorted data source based on activeItemFilter (slice untuk copy agar bisa di-sort)
      const src = (typeof window !== 'undefined' && Array.isArray(window.stokData)) ? window.stokData : stokData;
      let dataSource = src.slice();

      if (activeItemFilter) {
        const normFilterTebal = normalizeSpec(activeItemFilter.tebal);
        const normFilterUkuran = normalizeSpec(activeItemFilter.ukuran);
        
        dataSource = dataSource.filter(entry => {
          const matchBase = normalizeSpec(entry.tebal) === normFilterTebal && 
                           normalizeSpec(entry.ukuran) === normFilterUkuran;
          
          if (!matchBase) return false;
          
          // If price grouping is enabled, we MUST match by price to reorder within that price pool
          if (isPriceGroupingEnabled && activeItemFilter.hasOwnProperty('harga')) {
            return (entry.harga ?? null) === (activeItemFilter.harga ?? null);
          }
          
          // If grouping is disabled, we reorder within the aggregate product pool
          return true;
        });
      }

      // Sort to match table display: chronological (oldest first) when filtering, newest first otherwise
      dataSource.sort((a, b) => {
        const parseDate = window._parseDateCached || ((d) => new Date(d.split('/').reverse().join('/')));
        const dateA = parseDate(a.tanggal);
        const dateB = parseDate(b.tanggal);
        const idA = String(a.id ?? '');
        const idB = String(b.id ?? '');
        if (activeItemFilter) {
          if (dateA - dateB !== 0) return dateA - dateB;
          return idA.localeCompare(idB);
        } else {
          if (idA !== idB) return idB.localeCompare(idA);
          return dateB - dateA;
        }
      });

      const currentIndex = dataSource.findIndex(item => String(item.id) === String(normalizedId));
      if (currentIndex === -1) return;

      let targetIndex = -1;
      if (direction === 'up' && currentIndex > 0) {
        targetIndex = currentIndex - 1;
      } else if (direction === 'down' && currentIndex < dataSource.length - 1) {
        targetIndex = currentIndex + 1;
      }

      if (targetIndex !== -1) {
        const currentItem = dataSource[currentIndex];
        const targetItem = dataSource[targetIndex];

        // To swap positions while maintaining date sort:
        // 1. If dates are different, swap their dates
        // 2. If dates are same, swap their IDs (or slightly adjust them)
        
        const parseDate = window._parseDateCached || ((d) => new Date(d.split('/').reverse().join('/')));
        const dateA = parseDate(currentItem.tanggal);
        const dateB = parseDate(targetItem.tanggal);

        try {
          // Store old IDs for deletion
          const oldIdCurrent = currentItem.id;
          const oldIdTarget = targetItem.id;

          if (dateA.getTime() !== dateB.getTime()) {
            // Swap dates to move across days
            const tempDate = currentItem.tanggal;
            currentItem.tanggal = targetItem.tanggal;
            targetItem.tanggal = tempDate;
          } else {
            // Same day: swap IDs to change relative order within the day
            const tempId = currentItem.id;
            currentItem.id = targetItem.id;
            targetItem.id = tempId;
            
            // Ensure IDs remain unique if they were identical for some reason
            if (currentItem.id === targetItem.id) {
              currentItem.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                  ? crypto.randomUUID()
                  : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
            }

            // UPDATE HIGHLIGHT ID: If we are in reorder mode, update the ID to follow the data
            if (currentlyReorderingId === oldIdCurrent) {
              currentlyReorderingId = currentItem.id;
            }
          }

          // Update both in IndexedDB (Delete then Add because ID is PK)
          const deleteFunc = window.deleteEntryFromDB || deleteEntryFromDB;
          const addFunc = window.addEntry || addEntry;

          if (deleteFunc && addFunc) {
            await deleteFunc(oldIdCurrent);
            await deleteFunc(oldIdTarget);
            await addFunc(currentItem);
            await addFunc(targetItem);
          }

          // Sync global arrays — avoid spread copy jika already same reference
          if (typeof window !== 'undefined' && Array.isArray(window.stokData)) {
            const idx1 = window.stokData.findIndex(e => e.id === oldIdCurrent);
            if (idx1 !== -1) window.stokData[idx1] = currentItem;
            const idx2 = window.stokData.findIndex(e => e.id === oldIdTarget);
            if (idx2 !== -1) window.stokData[idx2] = targetItem;
            if (stokData !== window.stokData) stokData = window.stokData;
          }

          // Invalidate cache because entries were reordered (IDs swapped)
          markStockCacheDirty();

          // Full re-render without animation (no flicker since scroll-animate-row is suppressed)
          rebuildStockCache();
          updateStokTable(true);

        } catch (err) {
          console.error("Failed to move row:", err);
          alert("Gagal mengubah urutan: " + err.message);
        }
      }
    }

    // New logic for Keyboard Reordering
    function toggleReorderMode(id) {
      if (String(currentlyReorderingId) === String(id)) {
        currentlyReorderingId = null;
        updateStokTable(true);
        updateTotalSisa(true); // suppress animation at finish
        showStatus("Urutan manual selesai", "saving");
        setTimeout(() => document.getElementById('statusBar').style.display = 'none', 1500);
      } else {
        // Cari entry di stokData berdasarkan ID untuk highlight
        const allStok = window.stokData || stokData;
        const entry = allStok.find(e => String(e.id) === String(id));
        if (!entry) {
          console.warn('Entry not found for reorder:', id);
          return;
        }
        currentlyReorderingId = entry.id;
        originalStokDataBeforeReorder = JSON.stringify(window.stokData || stokData);
        updateStokTable();
        showStatus("Gunakan panah UP/DOWN untuk memindah, ENTER untuk simpan", "saving");
      }
    }

    // Handle global keyboard events for reordering
    document.addEventListener('keydown', function(e) {
      if (!currentlyReorderingId) return;
      
      // Don't trigger reordering if an input or textarea is currently focused
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
          activeEl.tagName === 'INPUT' || 
          activeEl.tagName === 'TEXTAREA' || 
          activeEl.isContentEditable
      );
      
      // Special case: Allow Enter even if input is focused to finish reordering
      if (e.key === 'Enter' && currentlyReorderingId) {
        e.preventDefault();
        toggleReorderMode(currentlyReorderingId);
        return;
      }

      if (isInputFocused) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveStokRow(currentlyReorderingId, 'up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveStokRow(currentlyReorderingId, 'down');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        toggleReorderMode(currentlyReorderingId);
      } else if (e.key === 'Escape') {
        if (originalStokDataBeforeReorder) {
            const dataToRestore = JSON.parse(originalStokDataBeforeReorder);
            if (typeof window !== 'undefined' && typeof window.stokData !== 'undefined') {
                window.stokData = dataToRestore;
            }
            stokData = dataToRestore;
            // Persist restored order to IndexedDB — clear then re-add
            // (moveStokRow swapped entries in DB, add() would fail on duplicate keys)
            if (db && STORE_NAME) {
                try {
                    const tx = db.transaction([STORE_NAME], 'readwrite');
                    const store = tx.objectStore(STORE_NAME);
                    store.clear();
                    for (const entry of dataToRestore) {
                        if (entry && entry.id) store.put(entry);
                    }
                } catch(_) {}
            }
        }
        currentlyReorderingId = null;
        originalStokDataBeforeReorder = null;
        markStockCacheDirty();
        updateStokTable(true);
        updateTotalSisa(true);
        // Hide status bar notification when cancelled
        const statusBar = document.getElementById('statusBar');
        if (statusBar) statusBar.style.display = 'none';
      }
    });

    // Function to update Riwayat Stok table
    let _isUpdatingStokTable = false;
    function updateStokTable(suppressAnimation = false) {
      if (_isUpdatingStokTable) return; // prevent re-entrant double render
      _isUpdatingStokTable = true;
      try {
        _updateStokTableInner(suppressAnimation);
      } finally {
        _isUpdatingStokTable = false;
      }
    }
    function _updateStokTableInner(suppressAnimation = false) {
      const tableHead = document.getElementById("stokTable").getElementsByTagName('thead')[0];
      const tableBody = document.getElementById("stokTable").getElementsByTagName('tbody')[0];

      // Update Table Headers based on isPriceGroupingEnabled
      if (tableHead) {
        const headerRow = tableHead.rows[0];
        if (headerRow) {
          // Columns: No(0), Nama(1), Tanggal(2), Nota(3), Jenis(4), Ukuran(5), HargaBeli(6), HargaJual(7), Masuk(8), Keluar(9), Sisa(10), Aksi(11)
          const hargaBeliHeader = headerRow.cells[6];
          const hargaJualHeader = headerRow.cells[7];

          if (isPriceGroupingEnabled) {
            if (hargaBeliHeader) hargaBeliHeader.style.display = '';
            if (hargaJualHeader) hargaJualHeader.style.display = '';
          } else {
            if (hargaBeliHeader) hargaBeliHeader.style.display = 'none';
            if (hargaJualHeader) hargaJualHeader.style.display = 'none';
          }
        }
      }

      tableBody.innerHTML = ""; // Clear the table body

      // Use window.stokData if available (for sync with surat jalan), otherwise use local stokData
      // Hindari spread operator penuh — gunakan reference langsung + filter
      let dataSource = (typeof window !== 'undefined' && window.stokData && Array.isArray(window.stokData))
        ? window.stokData
        : stokData;

      // Sync hanya jika referensi berbeda
      if (dataSource !== stokData) {
        stokData = dataSource;
      }

      // Apply active item filter if set
      if (activeItemFilter) {
        const normFilterTebal = normalizeSpec(activeItemFilter.tebal);
        const normFilterUkuran = normalizeSpec(activeItemFilter.ukuran);

        dataSource = dataSource.filter(entry => {
          const matchBase = normalizeSpec(entry.tebal) === normFilterTebal &&
                           normalizeSpec(entry.ukuran) === normFilterUkuran;

          if (!matchBase) return false;

          // If filter includes price (which only happens if isPriceGroupingEnabled is true), match by price too
          if (activeItemFilter.hasOwnProperty('harga')) {
            return (entry.harga ?? null) === (activeItemFilter.harga ?? null);
          }

          return true;
        });
      }

      // Rebuild stock cache sebelum render (jika dirty)
      // Always rebuild from full stokData (not filtered dataSource)
      // because calculateCurrentStock(entry) without data param uses this cache
      if (window._stockCacheDirty) {
        rebuildStockCache();
      }

      // Sort logic — gunakan Schwartzian transform: hitung tanggal sekali per item
      const parseDate = window._parseDateCached || ((d) => new Date(d.split('/').reverse().join('/')));
      const sortedData = dataSource.map((entry, idx) => {
        const date = parseDate(entry.tanggal);
        const id = String(entry.id ?? '');
        return { entry, date, id, _idx: idx };
      }).sort((a, b) => {
        if (activeItemFilter) {
          if (a.date - b.date !== 0) return a.date - b.date;
          return a.id.localeCompare(b.id);
        } else {
          if (a.id !== b.id) return b.id.localeCompare(a.id);
          return b.date - a.date;
        }
      }).map(({ entry }) => entry);

      // Pre-build Set of alive log entry IDs for O(1) lookup during render
      const aliveLogIds = new Set();
      (inputLogHistory || []).forEach(e => { if (e && e.id) aliveLogIds.add(String(e.id)); });

      // Batch insert menggunakan DocumentFragment untuk mengurangi layout thrashing
      const fragment = document.createDocumentFragment();
      sortedData.forEach((entry, index) => {
        // Always use cache (built from full stokData) for correct running stock
        // Filtered dataSource should NOT be used — it would miss entries outside filter
        const currentStock = calculateCurrentStock(entry);

        // Determine if this is a pembelian (masuk > 0) or penjualan (keluar > 0)
        // Only show edit button for pembelian entries (masuk > 0)
        // For penjualan entries (keluar > 0), editing should be done in log surat jalan
        const isPembelian = entry.masuk > 0;
        const isReordering = currentlyReorderingId === entry.id;

        // Handle potential undefined/null values for toLocaleString
        const displayHarga = (entry.harga !== undefined && entry.harga !== null) ? entry.harga.toLocaleString('id-ID') : '-';
        const displayHargaJual = (entry.hargaJual !== undefined && entry.hargaJual !== null) ? entry.hargaJual.toLocaleString('id-ID') : '-';
        const displayMasuk = (entry.masuk !== undefined && entry.masuk !== null) ? entry.masuk.toLocaleString('id-ID') : '0';
        const displayKeluar = (entry.keluar !== undefined && entry.keluar !== null) ? entry.keluar.toLocaleString('id-ID') : '0';
        const displaySisa = (currentStock !== undefined && currentStock !== null) ? currentStock.toLocaleString('id-ID') : '0';

        const row = document.createElement('tr');
        if (isReordering) row.classList.add('reordering-row');
        // Skip scroll animation during reorder — all rows rebuild → flash
        if (!suppressAnimation) {
          row.classList.add('scroll-animate-row');
        }

        row.innerHTML = `
          <td>${index + 1}</td>
          <td>${entry.nama || '-'}</td>
          <td>${entry.tanggal || '-'}</td>
          <td>${entry.nota || '-'}</td>
          <td>${entry.tebal || '-'}</td>
          <td>${entry.ukuran || '-'}</td>
          <td style="display: ${isPriceGroupingEnabled ? '' : 'none'}">${displayHarga}</td>
          <td style="display: ${isPriceGroupingEnabled ? '' : 'none'}">${displayHargaJual}</td>
          <td class="masuk">${displayMasuk}</td>
          <td class="keluar">${displayKeluar}</td>
          <td class="sisa">${displaySisa}</td>
          <td style="padding-left: 25px;padding-right: 0px;padding-top: 5px;padding-bottom: 5px;">
            <div class="action-buttons-container">
              <button class="row-action-btn move-btn ${isReordering ? 'reorder-active-btn' : ''}"
                      onclick="toggleReorderMode('${entry.id}')"
                      style="display: ${activeItemFilter ? '' : 'none'}"
                      title="${isReordering ? 'Selesai mengurutkan (Enter)' : 'Aktifkan urutan manual (Gunakan panah keyboard)'}">
                <i class="fas ${isReordering ? 'fa-check' : 'fas fa-arrows-alt-v'}"></i>
              </button>
              ${isPembelian ? `
              <button class="row-action-btn edit-btn" onclick="editEntry('${entry.id}')" title="Edit data pembelian">
                <i class="fas fa-edit"></i>
              </button>
              ` : (entry.logEntryId && aliveLogIds.has(String(entry.logEntryId)) ? `
              <button class="row-action-btn edit-btn" onclick="editLogEntryById('${entry.logEntryId}')" title="Edit penjualan di Log Surat Jalan">
                <i class="fas fa-edit"></i>
              </button>
              ` : `
              <button class="row-action-btn edit-btn" style="opacity: 0.4; cursor: not-allowed;" title="Log SJ asal sudah tidak ada — data orphaned">
                <i class="fas fa-edit"></i>
              </button>
              `)}
              ${isPembelian || !aliveLogIds.has(String(entry.logEntryId)) ? `
              <button class="row-action-btn delete-btn" onclick="deleteEntry('${entry.id}')" title="${isPembelian ? 'Hapus data pembelian' : 'Hapus data orphaned (log SJ sudah tidak ada)'}">
                <i class="fas fa-trash"></i>
              </button>
              ` : `
              <button class="row-action-btn delete-btn" style="display: none;" title="Hapus penjualan di log surat jalan">
                <i class="fas fa-trash"></i>
              </button>
              `}
            </div>
          </td>
        `;
        fragment.appendChild(row);
      });

      // Append semua row sekaligus — 1 reflow, bukan N reflow
      tableBody.appendChild(fragment);

      // Reapply DOM search only when there's NO activeItemFilter
      // (activeItemFilter is handled at data level above, skip DOM filtering to avoid conflicts)
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value.trim() !== '' && !activeItemFilter) {
        performSearch();
      }

      // Ensure the row currently being reordered is visible
      if (currentlyReorderingId) {
        setTimeout(() => {
          const reorderRow = document.querySelector('.reordering-row');
          if (reorderRow) {
            reorderRow.scrollIntoView({ behavior: 'auto', block: 'nearest' });
          }
        }, 50);
      }

      // Observe new rows for scroll animation
      observeStokScrollRows();
    }

    // IntersectionObserver for scroll animation on stok table rows
    let stokScrollObserver = null;

    function observeStokScrollRows() {
      const container = document.querySelector('.riwayat-stok-container');
      if (!container) return;

      // Disconnect old observer if any
      if (stokScrollObserver) {
        stokScrollObserver.disconnect();
      }

      stokScrollObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          } else {
            entry.target.classList.remove('visible');
          }
        }
      }, {
        root: container,
        rootMargin: '30px 0px',
        threshold: 0
      });

      const rows = container.querySelectorAll('tbody tr.scroll-animate-row');
      // observe() triggers initial callback — no need for getBoundingClientRect
      for (let i = 0; i < rows.length; i++) {
        stokScrollObserver.observe(rows[i]);
      }
    }

    // IntersectionObserver for scroll animation on jenis table rows
    let jenisScrollObserver = null;

    function observeJenisScrollRows() {
      const container = document.querySelector('.total-sisa-container');
      if (!container) return;

      if (jenisScrollObserver) {
        jenisScrollObserver.disconnect();
      }

      jenisScrollObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          } else {
            entry.target.classList.remove('visible');
          }
        }
      }, {
        root: container,
        rootMargin: '30px 0px',
        threshold: 0
      });

      const rows = container.querySelectorAll('tbody tr.scroll-animate-row');
      for (let i = 0; i < rows.length; i++) {
        jenisScrollObserver.observe(rows[i]);
      }
    }

    // IntersectionObserver for scroll animation on log entries
    let logScrollObserver = null;

    function observeLogScrollRows() {
      const container = document.getElementById('inputLogContainer');
      if (!container) return;

      if (logScrollObserver) {
        logScrollObserver.disconnect();
      }

      logScrollObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          } else {
            entry.target.classList.remove('visible');
          }
        }
      }, {
        root: container,
        rootMargin: '30px 0px',
        threshold: 0
      });

      const rows = container.querySelectorAll('.log-entry.scroll-animate-row');
      for (let i = 0; i < rows.length; i++) {
        logScrollObserver.observe(rows[i]);
      }
    }

    // Function to edit an entry
    function editEntry(id) {
      // Normalize ID to string for comparison (supports both legacy numeric and UUID string IDs)
      const normalizedId = String(id);

      // Check both stokData and window.stokData for the entry
      let entry = stokData.find(item => String(item.id) === normalizedId);
      
      if (!entry && typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
        entry = window.stokData.find(item => String(item.id) === String(normalizedId));

        // Sync local stokData if entry found in window.stokData
        if (entry) {
          const localIndex = stokData.findIndex(item => String(item.id) === String(normalizedId));
          if (localIndex === -1) {
            // Entry not in local stokData, add it
            stokData.push(entry);
          } else {
            // Entry exists but might be outdated, update it
            stokData[localIndex] = entry;
          }
        }
      }
      if (!entry) {
        console.warn('Entry not found with id:', id, 'normalized:', normalizedId);
        _log('Available IDs in stokData:', stokData.map(e => e.id).slice(0, 10));
        return;
      }

      // Only allow editing for pembelian entries (masuk > 0)
      // For penjualan entries (keluar > 0), editing should be done in log surat jalan
      // But allow edit if the log entry is orphaned (log SJ already deleted)
      if (entry.keluar > 0 && entry.masuk === 0) {
        if (entry.logEntryId && isLogEntryAlive(entry.logEntryId)) {
          alert('Data penjualan tidak dapat diedit di sini. Silakan edit di log surat jalan.');
          return;
        }
        // Orphaned entry — allow edit as pembelian
      }

      // Always use pembelian mode
      setFormMode('pembelian');
      currentlyReorderingId = null; // Reset reorder mode when starting to edit
      
      // Format date for input field (yyyy-mm-dd)
      const [day, month, year] = entry.tanggal.split('/');
      const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

      // Fill the form with entry data
      document.getElementById("nama").value = entry.nama;
      document.getElementById("tanggalStok").value = formattedDate;
      document.getElementById("nota").value = entry.nota;
      document.getElementById("tebal").value = entry.tebal;
      document.getElementById("ukuran").value = entry.ukuran;
      // Format harga dengan separator ribuan
      document.getElementById("harga").value = (entry.harga !== undefined && entry.harga !== null) ? entry.harga.toLocaleString('id-ID') : '';
      document.getElementById("hargaJual").value = (entry.hargaJual !== undefined && entry.hargaJual !== null) ? entry.hargaJual.toLocaleString('id-ID') : '';
      document.getElementById("masuk").value = (entry.masuk !== undefined && entry.masuk !== null) ? entry.masuk.toLocaleString('id-ID') : '';
      document.getElementById("keluar").value = (entry.keluar !== undefined && entry.keluar !== null) ? entry.keluar : '';
      updateHargaBeliPlaceholder();
      updateHargaJualPlaceholder();

      // Set editing mode
      currentlyEditingId = id;
      document.getElementById("stokForm").classList.add("edit-mode");
      document.getElementById("submitBtn").textContent = "Update Data";
      document.getElementById("cancelEditBtn").style.display = "block";

      // Scroll to form and focus
      document.getElementById("stokForm").scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => {
        const firstInput = document.getElementById("nama");
        if (firstInput) {
          firstInput.focus();
          firstInput.select();
        }
      }, 500);
    }

    // Function to cancel edit
    function cancelEdit() {
      currentlyEditingId = null;
      document.getElementById("stokForm").reset();
      document.getElementById("tanggalStok").value = new Date().toISOString().split('T')[0];
      document.getElementById("stokForm").classList.remove("edit-mode");
      document.getElementById("submitBtn").textContent = "Tambah Data";
      document.getElementById("cancelEditBtn").style.display = "none";
      // Reset to default mode (pembelian)
      setFormMode('pembelian');
      updateHargaBeliPlaceholder();
    }

    // Function to delete an entry
    async function deleteEntry(id) {
      // Normalize ID to string for comparison (supports both legacy numeric and UUID string IDs)
      const normalizedId = String(id);
      
      // Check both stokData and window.stokData for the entry
      let entry = stokData.find(item => String(item.id) === String(normalizedId));

      if (!entry && typeof window !== 'undefined' && Array.isArray(window.stokData)) {
        entry = window.stokData.find(item => String(item.id) === String(normalizedId));
        if (entry) {
          stokData = window.stokData;
        }
      }
      if (!entry) {
        console.warn('Entry not found with id:', id, 'normalized:', normalizedId);
        return;
      }
      
      // Prevent deletion of penjualan entries (keluar > 0, masuk === 0)
      // But allow delete if the log entry is orphaned (log SJ already deleted)
      if (entry.keluar > 0 && entry.masuk === 0) {
        if (entry.logEntryId && isLogEntryAlive(entry.logEntryId)) {
          alert('Data penjualan tidak dapat dihapus di sini. Silakan hapus di log surat jalan.');
          return;
        }
        // Orphaned entry — allow delete
      }
      
      if (confirm("Apakah Anda yakin ingin menghapus data ini?")) {
        try {
          // Remove from local stokData
          stokData = stokData.filter(entry => String(entry.id) !== normalizedId);
          markStockCacheDirty();

          // Also update window.stokData if it exists (for sync with surat jalan)
          if (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
            window.stokData = window.stokData.filter(entry => String(entry.id) !== normalizedId);
          }
          
          // Delete from IndexedDB
          await deleteEntryFromDB(id);
          
          // Update UI immediately after deletion
          _markRender(1|2|4|8|16);
          
          showStatus("Data berhasil dihapus", "saving");
          setTimeout(() => {
            const statusBar = document.getElementById('statusBar');
            if (statusBar) statusBar.style.display = 'none';
          }, 2000);
        } catch (error) {
          console.error('Error deleting entry:', error);
          alert("Terjadi kesalahan saat menghapus data: " + error.message);
          // Still update table even if DB deletion fails
          _markRender(1|2);
        }
      }
    }

    // Function to update Total Sisa per Jenis
    function updateTotalSisa(suppressAnimation = false) {
      const totalSisaTableBody = document.getElementById("jenisTable").getElementsByTagName('tbody')[0];
      
      // Sync local stokData with window.stokData if available
      if (typeof window !== 'undefined' && Array.isArray(window.stokData)) {
        stokData = window.stokData;
      }

      // Group data using helper
      const groupedData = groupStokData(stokData);

      // Clear the table body
      totalSisaTableBody.innerHTML = "";

      // Convert groupedData to array and sort by jenis kaca (tebal) A-Z
      const sortedData = sortGroupedData(groupedData);

      // Insert sorted grouped data into the Total Sisa table (batch dengan DocumentFragment)
      const fragment = document.createDocumentFragment();
      sortedData.forEach(({ data }) => {
        const row = document.createElement('tr');
        if (!suppressAnimation) {
          row.classList.add('scroll-animate-row');
        }
        const sisaValue = data.totalSisa.toLocaleString('id-ID');
        const sisaClass = data.totalSisa < 0 ? 'sisa negative' : 'sisa';
        const sisaStyle = data.totalSisa < 0 ? 'style="color: #dc3545; font-weight: 600;"' : '';
        
        row.innerHTML = `
          <td>${data.tebal}</td>
          <td>${data.ukuran}</td>
          <td>${data.hargaMasuk !== undefined ? data.hargaMasuk.toLocaleString('id-ID') : '-'}</td>
          <td class="masuk">${data.totalMasuk.toLocaleString('id-ID')}</td>
          <td class="keluar">${data.totalKeluar.toLocaleString('id-ID')}</td>
          <td class="${sisaClass}" ${sisaStyle}>${sisaValue}</td>
        `;
        
        // Add click event to fill form fields and filter history
        row.style.cursor = 'pointer';
        row.addEventListener('click', function() {
          // Highlight active row
          const allRows = totalSisaTableBody.querySelectorAll('tr');
          allRows.forEach(r => r.classList.remove('row-filter-active'));
          row.classList.add('row-filter-active');

          // Fill form
          document.getElementById('tebal').value = data.tebal;
          document.getElementById('ukuran').value = data.ukuran;
          if (data.hargaMasuk !== undefined) {
            document.getElementById('harga').value = data.hargaMasuk.toLocaleString('id-ID');
          }
          // Perbarui placeholder harga beli dan harga jual sesuai harga beli terpilih
          updateHargaBeliPlaceholder();
          updateHargaJualPlaceholder();
          document.getElementById('keluar').focus();

          // Filter history table
          activeItemFilter = {
            tebal: data.tebal,
            ukuran: data.ukuran
          };

          // Only add price filter if price grouping is enabled and price exists
          if (isPriceGroupingEnabled && data.hargaMasuk !== undefined) {
            activeItemFilter.harga = data.hargaMasuk;
          }

          // Update search input to show what's being filtered
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            const hargaText = (isPriceGroupingEnabled && data.hargaMasuk !== undefined) ? ` ${data.hargaMasuk.toLocaleString('id-ID')}` : '';
            searchInput.value = `${data.tebal} ${data.ukuran}${hargaText}`;
            const searchClearBtn = document.getElementById('searchClearBtn');
            if (searchClearBtn) searchClearBtn.style.display = 'block';
          }

          updateStokTable();

          // Scroll to history table
          const stokTable = document.getElementById('stokTable');
          if (stokTable) {
            stokTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        
        // Add hover effect
        row.addEventListener('mouseenter', function() {
          this.style.backgroundColor = '#e3f2fd';
        });
        
        row.addEventListener('mouseleave', function() {
          this.style.backgroundColor = '';
        });

        fragment.appendChild(row);
      });

      // Append semua row sekaligus — 1 reflow
      totalSisaTableBody.appendChild(fragment);

      // Update jenis kaca autocomplete list
      updateJenisKacaList();
      updateUkuranKacaList(); // Add this line

      // Observe new rows for scroll animation
      observeJenisScrollRows();
    }

    // Function to clear all data
    async function clearData() {
      if (confirm("Apakah Anda yakin ingin menghapus semua data? Tindakan ini tidak dapat dibatalkan.")) {
        try {
          if (!db) {
            await initDB();
          }

          // Clear IndexedDB using Promise wrapper
          await new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
              resolve();
            };

            request.onerror = () => {
              reject(request.error);
            };

            transaction.onerror = () => {
              reject(transaction.error);
            };
          });

          // Clear local arrays
          stokData = [];
          markStockCacheDirty();
          // Also clear window.stokData if it exists (for sync with surat jalan)
          if (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
            window.stokData = [];
          }
          
          // Update all UI components without page refresh
          _markRender(1|2|4|8|16);
          clearSearch();
          
          showStatus("Semua data berhasil dihapus", "saving");
          setTimeout(() => {
            const statusBar = document.getElementById('statusBar');
            if (statusBar) statusBar.style.display = 'none';
          }, 2000);
          
          _log('🗑️ Cleared all stok data');

          // Clear remote stock data as well
          if (window.syncManager) {
              window.syncManager.clearRemoteData('stock');
          }
        } catch (error) {
          console.error('Error clearing data:', error);
          alert("Terjadi kesalahan saat menghapus data: " + error.message);
        }
      }
    }

    // Function to export data to Excel
    function exportToExcel() {
      try {
        // Use window.stokData if available (for sync with surat jalan), otherwise use local stokData
        const dataSource = (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) 
          ? window.stokData 
          : stokData;
        
        if (!dataSource || dataSource.length === 0) {
          showStatus("Tidak ada data untuk diexport", "error");
          setTimeout(() => {
            const statusBar = document.getElementById('statusBar');
            if (statusBar) statusBar.style.display = 'none';
          }, 2000);
          return;
        }

        // Prepare data for export (respecting price grouping toggle)
        const exportData = dataSource.map(entry => {
          const item = {
            'Nama Toko': entry.nama || '',
            'Tanggal': entry.tanggal || '',
            'No. Nota': entry.nota || '',
            'Jenis Kaca': entry.tebal || '',
            'Ukuran Kaca': entry.ukuran || '',
          };

          if (isPriceGroupingEnabled) {
            item['Harga Beli'] = entry.harga || 0;
            item['Harga Jual'] = entry.hargaJual || 0;
          }

          item['Jumlah Masuk'] = entry.masuk || 0;
          item['Jumlah Keluar'] = entry.keluar || 0;
          item['Sisa Stok'] = calculateCurrentStock(entry, dataSource) || 0;
          
          return item;
        });

        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths for better readability
        const colWidths = [
          { wch: 20 }, // Nama Toko
          { wch: 12 }, // Tanggal
          { wch: 15 }, // No. Nota
          { wch: 20 }, // Jenis Kaca
          { wch: 15 }, // Ukuran Kaca
        ];

        if (isPriceGroupingEnabled) {
          colWidths.push({ wch: 12 }); // Harga Beli
          colWidths.push({ wch: 12 }); // Harga Jual
        }

        colWidths.push({ wch: 12 }); // Jumlah Masuk
        colWidths.push({ wch: 12 }); // Jumlah Keluar
        colWidths.push({ wch: 12 }); // Sisa Stok
        
        ws['!cols'] = colWidths;
        
        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Stok Barang Kaca");
        
        // Export to file
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const fileName = `Stok_Barang_Kaca_${date}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        showStatus(`Data berhasil diexport ke Excel (${exportData.length} baris)`, "saving");
        setTimeout(() => {
          const statusBar = document.getElementById('statusBar');
          if (statusBar) statusBar.style.display = 'none';
        }, 2000);
        
        _log(`✅ Exported ${exportData.length} entries to ${fileName}`);
      } catch (error) {
        console.error('Error exporting to Excel:', error);
        showStatus("Gagal mengexport data: " + error.message, "error");
        setTimeout(() => {
          const statusBar = document.getElementById('statusBar');
          if (statusBar) statusBar.style.display = 'none';
        }, 3000);
      }
    }

    // Function to export Stock data from totalSisaContainer
    function exportStock() {
      try {
        // Use window.stokData if available (for sync with surat jalan), otherwise use local stokData
        const dataSource = (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) 
          ? window.stokData 
          : stokData;
        
        if (!dataSource || dataSource.length === 0) {
          showStatus("Tidak ada data untuk diexport", "error");
          setTimeout(() => {
            const statusBar = document.getElementById('statusBar');
            if (statusBar) statusBar.style.display = 'none';
          }, 2000);
          return;
        }

        // Group data using helper
        const groupedData = groupStokData(dataSource);

        // Convert groupedData to array and sort by jenis kaca (tebal) A-Z
        const sortedData = sortGroupedData(groupedData);

        // Prepare data for export
        const exportData = sortedData.map(({ data }) => {
          const item = {
            'Jenis Kaca': data.tebal || '',
            'Ukuran Kaca': data.ukuran || '',
          };

          if (isPriceGroupingEnabled) {
            item['Harga'] = data.hargaMasuk !== undefined ? data.hargaMasuk : 0;
          }

          item['Kaca Masuk'] = data.totalMasuk || 0;
          item['Kaca Keluar'] = data.totalKeluar || 0;
          item['Sisa Stok'] = data.totalSisa || 0;
          
          return item;
        });

        if (exportData.length === 0) {
          showStatus("Tidak ada data stok untuk diexport", "error");
          setTimeout(() => {
            const statusBar = document.getElementById('statusBar');
            if (statusBar) statusBar.style.display = 'none';
          }, 2000);
          return;
        }

        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths for better readability
        const colWidths = [
          { wch: 20 }, // Jenis Kaca
          { wch: 15 }, // Ukuran Kaca
        ];

        if (isPriceGroupingEnabled) {
          colWidths.push({ wch: 12 }); // Harga
        }

        colWidths.push({ wch: 12 }); // Kaca Masuk
        colWidths.push({ wch: 12 }); // Kaca Keluar
        colWidths.push({ wch: 12 }); // Sisa Stok
        
        ws['!cols'] = colWidths;
        
        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Stock Summary");
        
        // Export to file
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const fileName = `Stock_Summary_${date}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        showStatus(`Data stok berhasil diexport ke Excel (${exportData.length} baris)`, "saving");
        setTimeout(() => {
          const statusBar = document.getElementById('statusBar');
          if (statusBar) statusBar.style.display = 'none';
        }, 2000);
        
        _log(`✅ Exported ${exportData.length} stock entries to ${fileName}`);
      } catch (error) {
        console.error('Error exporting stock to Excel:', error);
        showStatus("Gagal mengexport data stok: " + error.message, "error");
        setTimeout(() => {
          const statusBar = document.getElementById('statusBar');
          if (statusBar) statusBar.style.display = 'none';
        }, 3000);
      }
    }

    // Function to import data from Excel
    async function importFromExcel(event) {
      const file = event.target.files[0];
      if (!file) return;

      showStatus("Memproses file Excel...", "loading");
      
      try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Validate and format imported data
        const importedData = jsonData.map((item, index) => {
          // Handle different column name variations
          const nama = (item['Nama Toko'] || item['Nama'] || item.nama || '').toString().trim();
          const tanggal = item.Tanggal || item.tanggal || '';
          const nota = (item['No. Nota'] || item.Nota || item.nota || '').toString().trim();
          const tebal = (item['Jenis Kaca'] || item.Tebal || item.tebal || '').toString().trim();
          const ukuran = (item['Ukuran Kaca'] || item.Ukuran || item.ukuran || '').toString().trim();
          const harga = item['Harga Beli'] || item['Harga'] || item.harga || 0;
          const hargaJual = item['Harga Jual'] || item.hargaJual || 0;
          const masuk = item['Jumlah Masuk'] || item.Masuk || item.masuk || 0;
          const keluar = item['Jumlah Keluar'] || item.Keluar || item.keluar || 0;
          
          // Generate unique ID if not provided or if invalid
          let id = item.ID;
          if (!id || id <= 0) {
            // Generate unique ID
            id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : (Date.now().toString(36) + '-' + index + '-' + Math.random().toString(36).slice(2));
          }

          // Format date - handle multiple formats
          let formattedDate = tanggal;
          if (tanggal instanceof Date) {
            formattedDate = formatDate(tanggal.toISOString());
          } else if (typeof tanggal === 'string' && tanggal.trim()) {
            // Handle various date formats
            if (tanggal.includes('-')) {
              // ISO format or YYYY-MM-DD
              formattedDate = formatDate(tanggal);
            } else if (tanggal.includes('/')) {
              // DD/MM/YYYY or MM/DD/YYYY
              const parts = tanggal.split('/');
              if (parts.length === 3) {
                // Assume DD/MM/YYYY format
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                formattedDate = `${day}/${month}/${year}`;
              } else {
                formattedDate = tanggal;
              }
            } else {
              // Try to parse as Excel serial date
              const excelDate = parseFloat(tanggal);
              if (!isNaN(excelDate) && excelDate > 0) {
                // Excel date serial number (days since 1900-01-01)
                const excelEpoch = new Date(1899, 11, 30);
                const date = new Date(excelEpoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
                formattedDate = formatDate(date.toISOString());
              } else {
                formattedDate = tanggal;
              }
            }
          }

          return {
            id,
            nama: nama,
            tanggal: formattedDate,
            nota: nota,
            tebal: tebal,
            ukuran: ukuran,
            harga: parseNumber(harga),
            hargaJual: parseNumber(hargaJual),
            masuk: parseNumber(masuk),
            keluar: parseNumber(keluar)
          };
        }).filter(item => {
          // Filter out invalid rows - must have nama and tanggal
          return item.nama && item.tanggal && item.tanggal.trim() !== '';
        });

        if (importedData.length === 0) {
          showStatus("Tidak ada data valid untuk diimpor", "error");
          setTimeout(() => {
            const statusBar = document.getElementById('statusBar');
            if (statusBar) statusBar.style.display = 'none';
          }, 2000);
          return;
        }

        if (confirm(`Akan mengimpor ${importedData.length} data. Data yang sama (berdasarkan ID) akan diupdate, data baru akan ditambahkan. Lanjutkan?`)) {
          let updatedCount = 0;
          let addedCount = 0;
          let errorCount = 0;
          
          // Get current data source to check for existing IDs
          const currentStokData = (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) 
            ? window.stokData 
            : stokData;
          
          // Process each imported item
          for (const importedItem of importedData) {
            try {
              // Check if item with same ID exists in both arrays
              const existingIndex = currentStokData.findIndex(item => item.id === importedItem.id);
              const localIndex = stokData.findIndex(item => item.id === importedItem.id);
              
              if (existingIndex !== -1 || localIndex !== -1) {
                // Update existing data
                const targetIndex = localIndex !== -1 ? localIndex : existingIndex;
                if (targetIndex !== -1) {
                  stokData[targetIndex] = importedItem;
                } else {
                  // Entry exists in window.stokData but not in local stokData
                  stokData.push(importedItem);
                }
                
                // Also update window.stokData if it exists
                if (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
                  const windowIndex = window.stokData.findIndex(item => item.id === importedItem.id);
                  if (windowIndex !== -1) {
                    window.stokData[windowIndex] = importedItem;
                  } else {
                    window.stokData.push(importedItem);
                  }
                }
                
                await updateEntry(importedItem);
                updatedCount++;
              } else {
                // Generate new unique ID if ID already exists
                let uniqueId = importedItem.id;
                // Gabungkan tanpa spread — pake Set untuk ID lookup
                const allStokData = (typeof window !== 'undefined' && Array.isArray(window.stokData))
                  ? window.stokData.concat(stokData.filter(s => !window.stokData.includes(s)))
                  : stokData;
                
                while (allStokData.some(item => String(item.id) === String(uniqueId))) {
                  uniqueId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                      ? crypto.randomUUID()
                      : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
                }
                importedItem.id = uniqueId;
                
                // Add new data to both arrays
                stokData.unshift(importedItem);
                if (typeof window !== 'undefined') {
                  if (typeof window.stokData === 'undefined' || !Array.isArray(window.stokData)) {
                    window.stokData = [];
                  }
                  window.stokData.unshift(importedItem);
                }
                
                await addEntry(importedItem);
                addedCount++;
              }
            } catch (error) {
              console.error('Error processing imported item:', importedItem, error);
              errorCount++;
            }
          }
          
          // Ensure both arrays are fully synchronized
          // Remove duplicates and ensure consistency
          const uniqueStokData = [];
          const seenIds = new Set();
          
          // First, add all entries from stokData
          for (const entry of stokData) {
            if (!seenIds.has(entry.id)) {
              uniqueStokData.push(entry);
              seenIds.add(entry.id);
            }
          }
          
          // Then, add any entries from window.stokData that aren't in stokData
          if (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) {
            for (const entry of window.stokData) {
              if (!seenIds.has(entry.id)) {
                uniqueStokData.push(entry);
                seenIds.add(entry.id);
              }
            }
          }
          
          // Update both arrays with synchronized data
          stokData = uniqueStokData;
          if (typeof window !== 'undefined') {
            window.stokData = stokData;
          }
          
          // Save all data to ensure consistency
          await saveData();
          
          // Reload data from IndexedDB to ensure we have the latest
          await loadData();
          
          // Update all UI components without page refresh
          _markRender(1|2|4|8|16);
          
          let message = `Berhasil mengimpor ${importedData.length} data`;
          const parts = [];
          if (updatedCount > 0) parts.push(`${updatedCount} diupdate`);
          if (addedCount > 0) parts.push(`${addedCount} ditambahkan`);
          if (errorCount > 0) parts.push(`${errorCount} error`);
          
          if (parts.length > 0) {
            message += ` (${parts.join(', ')})`;
          }
          
          if (errorCount > 0) {
            showStatus(message, "error");
          } else {
            showStatus(message, "saving");
          }
          
          _log(`✅ Imported ${importedData.length} entries (${updatedCount} updated, ${addedCount} added, ${errorCount} errors)`);
        } else {
          showStatus("Import dibatalkan", "error");
        }
      } catch (error) {
        console.error("Error importing Excel:", error);
        showStatus("Gagal mengimpor: " + error.message, "error");
      } finally {
        event.target.value = ''; // Reset input
        setTimeout(() => document.getElementById('statusBar').style.display = 'none', 2000);
      }
    }


    // Show status message
    function showStatus(message, type) {
      const statusBar = document.getElementById('statusBar');
      statusBar.textContent = message;
      statusBar.className = `status-bar status-${type}`;
      statusBar.style.display = 'block';
    }

    // Toggle sections
    document.querySelectorAll('.toggle-section-btn').forEach(button => {
      button.addEventListener('click', function() {
        const target = document.getElementById('stokForm');
        const icon = this.querySelector('i');
        
        if (target.style.display === 'none') {
          target.style.display = 'flex';
          this.classList.remove('collapsed');
        } else {
          target.style.display = 'none';
          this.classList.add('collapsed');
        }
      });
    });

    // Initialize sections
    document.getElementById('stokForm').style.display = 'flex';
    document.getElementById('totalSisaContainer').style.display = 'block';

    // --- Google Apps Script Integration ---

    // KONFIGURASI: Masukkan URL Web App Google Apps Script Anda di sini
    // Sync otomatis nonaktif saat DEBUG=true (testing), aktif saat DEBUG=false (production)
    const SCRIPT_URL = DEBUG ? '' : 'https://script.google.com/macros/s/AKfycbzVJmtqpkMzFc5Fb2OF-bhow_PGLKbkMxDaASRaK1GjSIorf1JAghxZGgHPQVPCQnvDqg/exec';
    const SCRIPT_TOKEN = '083819114977'; // token auth — ganti kalo beda

    // Function to get aggregated stock data for sync
    function getAggregatedStockData() {
        const dataSource = (typeof window !== 'undefined' && typeof window.stokData !== 'undefined' && Array.isArray(window.stokData)) 
            ? window.stokData 
            : (typeof stokData !== 'undefined' ? stokData : []);

        if (!dataSource || dataSource.length === 0) return [];

        // Helper functions groupStokData and sortGroupedData must be available
        if (typeof groupStokData !== 'function' || typeof sortGroupedData !== 'function') {
            console.warn('Helper functions for aggregation not found');
            return [];
        }

        const groupedData = groupStokData(dataSource);
        const sortedData = sortGroupedData(groupedData);
        
        return sortedData.map(({ data }) => ({
            tebal: data.tebal,
            ukuran: data.ukuran,
            harga: data.hargaMasuk !== undefined ? data.hargaMasuk : 0,
            masuk: data.totalMasuk,
            keluar: data.totalKeluar,
            sisa: data.totalSisa
        }));
    }

    class BackendService {
      constructor(url, token) {
        this.url = url;
        this.token = token;
      }

      _buildUrl(action) {
        return `${this.url}?action=${action}&token=${this.token}`;
      }

      isConfigured() {
        return !!this.url && !!this.token && !this.url.includes('GANTI_DENGAN');
      }

      async getStock() {
        return this._fetch('get_stock');
      }

      async getLogs() {
        return this._fetch('get_logs');
      }

      async getToko() {
        return this._fetch('get_toko');
      }

      async saveStock(data) {
        return this._postWithRetry('save_stock', { data });
      }

      async saveAggregatedStock(data) {
        return this._postWithRetry('save_aggregated_stock', { data });
      }

      async saveLogs(data) {
        return this._postWithRetry('save_log', { data });
      }
      
      async deleteLog(id) {
        return this._postWithRetry('delete_log', { id });
      }

      async saveToko(data) {
        return this._postWithRetry('save_toko', { data });
      }
      
      async clearData(target) {
          return this._postWithRetry('clear_data', { target });
      }

      async deleteStockEntries(ids) {
          return this._postWithRetry('delete_stock_entries', { ids });
      }

      async syncBatch(data) {
          return this._postWithRetry('sync_batch', data);
      }

      async _fetch(action) {
        if (!this.isConfigured()) return null;
        try {
            const response = await fetch(this._buildUrl(action));
            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid JSON response: ${text.substring(0, 100)}...`);
            }

            if (result.status === 'success') {
                return result.data;
            } else {
                throw new Error(result.message || 'Unknown error');
            }
        } catch (e) {
            console.error(`Backend fetch error (${action}):`, e);
            throw e;
        }
      }

      async _post(action, payload) {
        return this._postWithRetry(action, payload, 0); // No retry for legacy calls unless updated
      }

      async _postWithRetry(action, payload, maxRetries = 2) {
        if (!this.isConfigured()) return null;
        
        let attempt = 0;
        let lastError;
        
        while (attempt <= maxRetries) {
            try {
                const response = await fetch(this._buildUrl(action), {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                const text = await response.text();
                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    throw new Error(`Invalid JSON response: ${text.substring(0, 100)}...`);
                }

                if (result.status === 'success') {
                    return true;
                } else {
                    throw new Error(result.message || 'Unknown error');
                }
            } catch (e) {
                console.warn(`Backend post error (${action}) attempt ${attempt + 1}:`, e);
                lastError = e;
                attempt++;
                if (attempt <= maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s...
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        console.error(`Backend post failed after ${maxRetries + 1} attempts (${action})`);
        throw lastError;
      }
    }

    class SyncManager {
        constructor(backend) {
            this.backend = backend;
            this.isSyncing = false;
        }

        async clearRemoteData(target) {
             if (!this.backend.isConfigured()) return;
             try {
                 this.updateStatus('Menghapus data di server...', 'syncing');
                 await this.backend.clearData(target);
                 this.updateStatus('Data server dihapus', 'success');
                 setTimeout(() => this.updateStatus('Online', 'online'), 2000);
             } catch (e) {
                 console.error('Remote clear failed:', e);
                 this.updateStatus('Gagal hapus data server', 'error');
             }
        }

        async deleteRemoteStockEntries(ids) {
            if (!ids || ids.length === 0) return;
            if (!this.backend.isConfigured()) return;
            try {
                this.updateStatus('Menghapus stok di server...', 'syncing');
                await this.backend.deleteStockEntries(ids);
                this.updateStatus('Stok server dihapus', 'success');
                setTimeout(() => this.updateStatus('Online', 'online'), 2000);
            } catch (e) {
                console.error('Remote stock delete failed:', e);
                this.updateStatus('Gagal hapus stok server', 'error');
            }
        }

        async syncAll() {
            if (this.isSyncing) return;

            if (!this.backend.isConfigured()) {
                _log('⏸️ Sync dinonaktifkan (DEBUG mode).');
                this.updateStatus('Sync offline', 'offline');
                setTimeout(() => this.updateStatus('', ''), 3000);
                return;
            }

            this.isSyncing = true;
            this.updateStatus('Sedang sinkronisasi...', 'syncing');
            _log('🔄 Starting full sync...');

            try {
                // Collect all data for batch sync
                const batchPayload = {
                    mode: 'incremental'
                };
                let hasData = false;
                
                // 1. Prepare Stock Data
                if (typeof stokData !== 'undefined') {
                    // Enrich stokData with sisa using optimized calculation
                    // Sort stokData by type and date first to enable O(N) calculation
                    // Create a map of sisa values to avoid O(N^2) complexity
                    const sisaMap = new Map();
                    
                    if (Array.isArray(stokData)) {
                        // Group by type (tebal + ukuran + harga)
                        const groups = {};
                        stokData.forEach(item => {
                             const key = `${item.tebal}|${item.ukuran}|${item.harga ?? ''}`;
                             if (!groups[key]) groups[key] = [];
                             groups[key].push(item);
                        });
                        
                        // Calculate sisa for each group
                        Object.values(groups).forEach(group => {
                            // Sort by date and ID
                            group.sort((a, b) => {
                                const parseDate = window._parseDateCached || ((d) => new Date(d.split('/').reverse().join('/')));
                                const dateA = parseDate(a.tanggal);
                                const dateB = parseDate(b.tanggal);
                                if (dateA - dateB !== 0) return dateA - dateB;
                                return a.id - b.id;
                            });
                            
                            let runningTotal = 0;
                            group.forEach(item => {
                                runningTotal += (item.masuk || 0) - (item.keluar || 0);
                                sisaMap.set(item.id, runningTotal);
                            });
                        });
                    }

                    const enrichedStock = stokData.map(item => {
                        return {
                            ...item,
                            sisa: sisaMap.has(item.id) ? sisaMap.get(item.id) : 0
                        };
                    });
                    
                    batchPayload.stock = enrichedStock;
                    
                    // 1b. Aggregated Stock
                    const aggregatedData = getAggregatedStockData();
                    if (aggregatedData && aggregatedData.length > 0) {
                        batchPayload.aggregatedStock = aggregatedData;
                    }
                    hasData = true;
                }
                
                // 2. Prepare Logs
                if (typeof inputLogHistory !== 'undefined') {
                    const validLogs = inputLogHistory.filter(item => item && item.id);
                    if (validLogs.length > 0) {
                        batchPayload.logs = validLogs;
                        hasData = true;
                    }
                }
                
                // 3. Prepare Toko
                if (typeof databaseTokoLengkap !== 'undefined') {
                    const validToko = databaseTokoLengkap.filter(item => item && item.nama);
                    if (validToko.length > 0) {
                        batchPayload.toko = validToko;
                        hasData = true;
                    }
                }
                
                if (hasData) {
                    _log('📡 Sending batch sync request (Mode: Incremental)...');
                    await this.backend.syncBatch(batchPayload);
                    _log('✅ Batch sync completed');
                } else {
                    _log('⚠️ No data to sync');
                }
                
                this.updateStatus('Sinkronisasi berhasil!', 'success');
                setTimeout(() => this.updateStatus('', ''), 3000);
                
            } catch (e) {
                console.error("❌ Sync error:", e);
                this.updateStatus(`Gagal: ${e.message}`, 'error');
            } finally {
                this.isSyncing = false;
            }
        }

        updateStatus(msg, type) {
            const status = document.getElementById('syncStatus');
            if (!status) return;

            // Toggle syncing class on container for CSS animation
            const container = status.closest('.sync-container');
            if (container) {
                container.classList.toggle('syncing', type === 'syncing');
            }

            // Use bright colors for dark header background
            status.style.color = type === 'error' ? '#ff6b6b' : (type === 'success' ? '#4ade80' : 'white');

            // Tambahkan ikon sesuai status
            if (type === 'syncing') {
                status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + msg;
            } else if (type === 'success') {
                status.innerHTML = '<i class="fas fa-check-circle"></i> ' + msg;
            } else if (type === 'error') {
                status.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + msg;
            } else if (type === 'offline') {
                status.innerHTML = '<i class="fas fa-wifi" style="opacity:0.5"></i> ' + msg;
                status.style.color = 'rgba(255,255,255,0.5)';
            } else {
                status.textContent = msg;
            }
        }
    }

    // Init
    const backendService = new BackendService(SCRIPT_URL, SCRIPT_TOKEN);
    const syncManager = new SyncManager(backendService);
    window.syncManager = syncManager; // Make globally available

    // Auto Sync on Load (No Button)
    document.addEventListener('DOMContentLoaded', () => {
        const header = document.querySelector('.header');
        if (header) {
            const syncContainer = document.createElement('div');
            syncContainer.className = 'sync-container';
            
            const status = document.createElement('span');
            status.id = 'syncStatus';
            status.textContent = 'Menunggu sinkronisasi...';
            
            syncContainer.appendChild(status);
            
            // Insert at the beginning of header (left side)
            if (header.firstChild) {
                header.insertBefore(syncContainer, header.firstChild);
            } else {
                header.appendChild(syncContainer);
            }
            
            // Trigger sync otomatis
            // Beri sedikit delay agar IndexedDB siap sepenuhnya
            setTimeout(() => {
                syncManager.syncAll();
            }, 1500);
        }
    });


