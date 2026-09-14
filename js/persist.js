// js/persist.js — iskenderpay (v1.0)
// Encrypt + storage (localStorage + Firestore hybrid) + schema migration.
// firestore.js'ten window._fbSave/_fbLoad'i, oturum sirlari icin Session'i tuketir.
// v8.127'de db.js'ten ayristirildi. v8.187: Store.session -> Session closure.

import { Session } from './session.js';
import { recordWrite } from './audit.js';
import { validateBeforeSave } from './validate.js';

// ── saveSecure / loadSecure ───────────────────────────────────────────────────

async function saveSecure() {
  if (window.Store.suppressSave) return;
  if (!Session.hasKey()) return;
  if (window.Store.saveTimer) clearTimeout(window.Store.saveTimer);
  window.Store.dirty = true;  // Bekleyen degisiklik var — sync ezmesin
  window.Store.saveTimer = setTimeout(() => { _doSave(); }, 400);
}

async function _doSave() {
  window.Store.saveTimer = null;
  if (!Session.hasKey()) return;
  // WO-03: normalizeBeforeSave (onarim) SAVE yolundan CIKARILDI -> yalniz loadSecure'da
  // bir kez calisir (WO-01 karantina + WO-02 bypass-kapali sayesinde save'de bozuk kayit
  // olusmaz; onarim artik load-time + idempotent). Validate (KARANTINA, WO-01) save'de
  // guvenlik agi olarak KALIR.
  const _quarantined = validateBeforeSave();
  const data = {
    pays: window.pays, creds: window.creds, hist: window.hist,
    persons: window.persons, notes: window.notes, paidItems: window.paidItems,
    rehber: window.rehber, actLog: window.actLog
  };
  const enc = await Session.encrypt(data);
  // v8.231 GUVENLIK KOPYASI: bu surumun ILK kaydindan once, cihazdaki mevcut SIFRELI veri
  // ayri anahtara bir kez kopyalanir (cari kart gecisi oncesi geri donus noktasi). Sifreli kalir.
  try {
    const _yk = 'ipay-guvenlik-oncesi-v8.231-' + window.Store.planId;
    if (!localStorage.getItem(_yk)) {
      const _eski = localStorage.getItem('v5-data-' + window.Store.planId);
      if (_eski) localStorage.setItem(_yk, _eski);
    }
  } catch(e) { console.warn('[persist] guvenlik kopyasi alinamadi:', e); }
  // localStorage ÖNCE yaz — Firebase başarısız olsa bile veri güvende
  localStorage.setItem('v5-data-' + window.Store.planId, enc);
  localStorage.setItem('v5-rates-' + window.Store.planId, JSON.stringify(window.rates));
  let _fbResult = 'no-fb';
  if (window._fbSave) {
    try {
      const res = await window._fbSave(enc);
      if (res && res.conflict) {
        // v8.199: baska cihaz bizden sonra yazmis. Uzeri YAZMA — uzak veriyi yukle + uyar.
        // Bu cihazda kaydedilmemis son degisiklik(ler) uzak veriyle degisir (sessiz kayip yok: uyari verilir).
        _fbResult = 'conflict';
        window.Store.lastUpdated = res.remoteTs;   // baseline = uzak gercek
        window.Store.fbSyncNeeded = false;          // bayat blob'u poll'da push etme
        if (res.remote && window.applyRemote) {
          try { await window.applyRemote(res.remote); } catch(e) { console.warn('Cakisma uzak uygulama hatasi:', e); }
        }
        window.setSyncDot && window.setSyncDot('synced');
        window.showWarnToast && window.showWarnToast('Baska cihazda degisiklik yapilmis — en guncel veri yuklendi. Son degisikligini tekrar yapman gerekebilir.');
      } else if (res && res.ok) {
        _fbResult = 'ok';
        window.Store.lastUpdated = res.updatedAt;   // saat kaymasi-dayanikli baseline (Date.now degil)
        window.Store.fbSyncNeeded = false;
      } else if (res && res.skipped) {
        _fbResult = 'skipped';
      }
    } catch(e) {
      _fbResult = 'error';
      console.warn('Firebase kayıt hatası:', e);
      window.Store.fbSyncNeeded = true;  // Bir sonraki başarılı poll'da yeniden dene
    }
  }
  // WO-07: 'finally { dirty=false }' KALDIRILDI. dirty'yi firebase varligindan
  // BAGIMSIZ, save yolu bittikten sonra temizle -> firebase YOKKEN dirty asili
  // kalmaz (eski hata). Conflict/throw dahil tum firebase yollari buraya duser;
  // localStorage zaten yukarida yazildi -> bekleyen yerel degisiklik yok.
  window.Store.dirty = false;
  // KATMAN 3 yakalayici write-audit (yalniz METADATA — deger/blob icerigi YAZILMAZ).
  // Defensive: audit ASLA kaydi bozmamali.
  try {
    recordWrite({
      source: 'persist:_doSave',
      target: window._fbSave ? 'localStorage+firebase' : 'localStorage',
      result: _fbResult,
      size: (enc && enc.length) || 0,
      counts: {
        pays: (data.pays||[]).length, creds: (data.creds||[]).length, hist: (data.hist||[]).length,
        persons: (data.persons||[]).length, notes: (data.notes||[]).length,
        paidItems: (data.paidItems||[]).length, rehber: (data.rehber||[]).length, actLog: (data.actLog||[]).length
      },
      quarantined: _quarantined
    });
  } catch(e) {}
}

async function saveSecureNow() {
  if (window.Store.saveTimer) clearTimeout(window.Store.saveTimer);
  window.Store.suppressSave = false;
  await _doSave();
}

async function loadSecure() {
  let enc = null;
  let fbHadData = false;
  let _repaired = 0;
  if (window._fbLoad) {
    try {
      enc = await window._fbLoad();
      fbHadData = (enc !== null);
    } catch(e) { console.warn('Firebase yükleme hatasi:', e); }
  }
  if (!enc) enc = localStorage.getItem('v5-data-' + window.Store.planId) || localStorage.getItem('v5-data');
  if (!enc) return;
  try {
    const data = await Session.decrypt(enc);
    // Toplu sessiz atama — saveSecure tetiklenmez (veri zaten kaynak)
    if (window.Store) {
      window.Store.hydrate(data);
    } else {
      window.pays      = data.pays      || [];
      window.creds     = data.creds     || [];
      window.hist      = data.hist      || [];
      window.persons   = data.persons   || [];
      window.notes     = data.notes     || [];
      window.paidItems = data.paidItems || [];
      window.rehber    = data.rehber    || [];
      window.actLog    = data.actLog    || [];
    }
    // WO-03: TUM onarim pass'i load'da BIR KEZ calisir (idx-leak dahil; eski ayri idx
    // blogu kaldirildi -> tek kaynak, bakim borcu yok). normalizeBeforeSave onarilan
    // kayit sayisini doner; >0 ise asagida persist edilir. Idempotent (2. cagri no-op).
    try { _repaired = window.normalizeBeforeSave ? window.normalizeBeforeSave() : 0; }
    catch(e) { console.warn('[integrity] yukleme onarim hatasi:', e); }
    // Sadece Firebase bos ise localStorage verisini yukle (migration)
    // Firebase hatali iken localStorage ile ezme - DATA LOSS onlendi
    if (!fbHadData && window._fbSave) { try { await window._fbSave(enc); } catch(e) {} }
  } catch(e) {
    throw new Error('decrypt_failed');
  }
  window.Store.dirty = _repaired > 0;  // WO-03: load-time onarim olduysa persist et
  if (_repaired > 0 && window.saveSecure) window.saveSecure();
  const r = localStorage.getItem('v5-rates-' + window.Store.planId) || localStorage.getItem('v5-rates');
  if (r) try { Object.assign(window.rates, JSON.parse(r)); } catch(e) {}
}

// ── Migrasyon ─────────────────────────────────────────────────────────────────

async function migrateToV7() {
  const migKey = 'v7-migrated-' + (window.Store.fbUid||'local') + '-' + window.Store.planId;
  if (localStorage.getItem(migKey)) return;
  window.Store.suppressSave = true;
  const _migPays = (window.pays||[]).map(p => {
    const entry = {...p};
    if (!entry.groupId) entry.groupId = String(Math.floor(Number(entry.rp || entry.id)));
    delete entry.rec; delete entry.rp; delete entry.rs; delete entry.rm;
    return entry;
  });
  if (window.Store) window.Store.replace('pays', _migPays); else window.pays = _migPays;
  if (!(window.paidItems||[]).length) {
    const allItems = [...(window.pays||[])];
    (window.creds||[]).forEach(c => (c.pays||[]).forEach(i => allItems.push({...i, name: c.name, currency: 'TRY', _cid: c.id, _ii: i.idx})));
    const _migPaid = allItems
      .filter(p => p.status === 'paid' || p.status === 'partial')
      .map(p => ({...p, paidId: 'pi_' + Date.now() + '_' + Math.random()}));
    if (window.Store) window.Store.replace('paidItems', _migPaid); else window.paidItems = _migPaid;
  }
  window.Store.suppressSave = false;
  await saveSecureNow();
  localStorage.setItem(migKey, '1');
  console.log('v7 migrasyon tamamlandı');
}

// ── Global compat ─────────────────────────────────────────────────────────────
window.saveSecure    = saveSecure;
window.saveSecureNow = saveSecureNow;
window.loadSecure    = loadSecure;
window.migrateToV7   = migrateToV7;
