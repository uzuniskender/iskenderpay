// js/app.js — iskenderpay (v1.0)
// Uygulama yaşam döngüsü, sekme yönetimi, kur, yedek/geri yükleme, versiyon.
// Tüm state window.* üzerinden okunur/yazılır.
// v8.187: oturum sirlari Store.session -> Session closure (js/session.js).

import { Session } from './session.js';
import { toLocalISO } from './util.js';

// ── PLAN ADI ─────────────────────────────────────────────────────────────────

// ── PLAN SEÇ ─────────────────────────────────────────────────────────────────

// ── APP GİRİŞİ ───────────────────────────────────────────────────────────────
let _migrationRunning = false;  // v8.117: window._migrationRunning yerine modül-local
let _backfilledFor = null;      // v8.196: son backfill yapilan uid+planId — ardisik enterApp'ta tekrar onler

function _backfillPersonIds() {
  if (!window.Store) return;
  let np = 0, npy = 0;
  // Pass 1: persons'a id ata (v8.111)
  (window.persons || []).forEach(p => {
    if (!p.id) {
      window.Store.mutateItem(p, {
        id: 'per_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)
      });
      np++;
    }
  });
  // Pass 2: pays'a personId ata — isim eşleşmesi (v8.112)
  const baseOf = window.Hesap ? window.Hesap._baseOf : (n => n);
  (window.pays || []).forEach(p => {
    if (p.personId) return;
    const base = baseOf(p.name);
    const person = (window.persons || []).find(q => q.name === base);
    if (person && person.id) {
      window.Store.mutateItem(p, { personId: person.id });
      npy++;
    }
  });
  // Pass 3: actLog'a personId ata — entry.detail'in ilk segmentinden isim eşleşmesi (v8.148)
  const personByName = new Map();
  (window.persons || []).forEach(q => { if (q.id) personByName.set(q.name, q.id); });
  let nal = 0;
  (window.actLog || []).forEach(e => {
    if (e.personId) return;
    // rhb_* tipleri rehber (contact) hakkında, plan participant değil — skip
    if (e.type && e.type.startsWith('rhb_')) return;
    // cred-iliskili tipleri skip (false positive azaltir): cred_add ve detail'i 'taksit' iceren plan_edit/plan_del
    if (e.type === 'cred_add') return;
    const detail = e.detail || '';
    if (detail.includes(' taksit')) return;
    const firstSep = detail.indexOf(' · ');
    const namePart = (firstSep > 0 ? detail.substring(0, firstSep) : detail).trim();
    if (!namePart) return;
    const base = baseOf(namePart);
    const pid = personByName.get(base);
    if (pid) { window.Store.mutateItem(e, { personId: pid }); nal++; }
  });
  // Pass 4: actLog'a groupId ata — baz isim → groupId eşlemesi, YALNIZ tek-gruplu isimde (v8.195)
  // Coklu grup (QNB Kira + QNB Elektrik) -> isimden hangi grup belli degil -> ATLA (yanlis atama riski).
  // DV/openCell grup-history (actLog.filter(e=>e.groupId===gid)) eski entry'leri de yakalasin diye.
  const groupsByBase = new Map(); // base -> Set<groupId>
  (window.pays || []).forEach(p => {
    if (!p.groupId) return;
    const b = baseOf(p.name);
    if (!groupsByBase.has(b)) groupsByBase.set(b, new Set());
    groupsByBase.get(b).add(p.groupId);
  });
  let ngl = 0;
  (window.actLog || []).forEach(e => {
    if (e.groupId) return;
    if (e.type && e.type.startsWith('rhb_')) return;
    if (e.type === 'cred_add') return;
    const detail = e.detail || '';
    if (detail.includes(' taksit')) return;
    const firstSep = detail.indexOf(' · ');
    const namePart = (firstSep > 0 ? detail.substring(0, firstSep) : detail).trim();
    if (!namePart) return;
    const gset = groupsByBase.get(baseOf(namePart));
    if (gset && gset.size === 1) {        // yalniz tek grup -> guvenli
      window.Store.mutateItem(e, { groupId: [...gset][0] });
      ngl++;
    }
  });
  if (np > 0)  console.log('[backfill] ' + np + ' persons id atandı');
  if (npy > 0) console.log('[backfill] ' + npy + ' pays personId atandı');
  if (nal > 0) console.log('[backfill] ' + nal + ' actLog personId atandı');
  if (ngl > 0) console.log('[backfill] ' + ngl + ' actLog groupId atandı');
}

function enterApp() {
  document.getElementById('PS').classList.remove('active');
  document.getElementById('PS').style.display = 'none';
  document.getElementById('APP').style.display = '';
  rhbNormalizeCompanies();
  if (!_migrationRunning) {
    _migrationRunning = true;
    window.migrateToV7()
      .then(() => {
        // v8.196: backfill (uid+planId) basina BIR kez. migrateToV7 erken donse bile
        // .then her enterApp'ta calisiyordu -> ardisik enterApp cagrilarinda redundant
        // backfill ("[backfill] 5 atandi" x3). Plan degisiminde planId degisir -> yeni
        // planda yine kosar; ayni plana donuste kayitli veri zaten backfilled -> no-op.
        const bfKey = (window.Store.fbUid||'local') + '-' + window.Store.planId;
        if (_backfilledFor !== bfKey) { _backfillPersonIds(); _backfilledFor = bfKey; }
      })
      .catch(e => console.warn('Migrasyon hatası:', e))
      .finally(() => { _migrationRunning = false; });
  }
  initApp();
  window.startRealtimeSync();
}

function rhbNormalizeCompanies() {
  let changed = false;
  (window.rehber || []).forEach(p => {
    const norm = (p.company||'').toLocaleUpperCase('tr').trim();
    if (norm !== (p.company||'')) { p.company = norm; changed = true; }
    const normName = (p.name||'').toLocaleUpperCase('tr').trim();
    if (normName !== (p.name||'')) { p.name = normName; changed = true; }
  });
  if (changed) rhbSave();
}

function rhbSave() { saveSecure(); }

// ── SEKME YÖNETİMİ ───────────────────────────────────────────────────────────
function go(n) {
  window.curTab = n;
  // T1 (Ödemeler) + T4 (Geçmiş) v8.181'de gizlendi, v8.188'de tamamen kaldirildi —
  // islevleri Log ledger'inda (v8.177). go(1)/go(4) artik no-op.
  [0,2,3,5,6,7].forEach(i => {
    const t = document.getElementById('T'+i); if (t) t.style.display = i===n ? '' : 'none';
    const m = document.getElementById('m'+i); if (m) m.classList.toggle('on', i===n);
    const s = document.getElementById('s'+i); if (s) s.classList.toggle('on', i===n);
  });
  if (n===0) { window.render(); if (window.renderCredSummary) window.renderCredSummary(); }
  if (n===2) window.renderPersons();
  if (n===3) window.renderNotes();
  if (n===5) window.renderAI();
  if (n===6) window.renderRhb();
  if (n===7) window.renderActLog();
}

function chSort(v) { window.sortMode = v; render(); }
async function chAhead(v) { localStorage.setItem('v5-ahead', v); render(); }

// ── MİGRASYON (kredi tarihleri) ──────────────────────────────────────────────
async function migrateCredDates() {
  (window.creds || []).forEach(c => {
    if (!c.start || !c.pays || !c.pays.length) return;
    const [_sy,_sm,_sd] = c.start.split('-').map(Number);
    const startDay=_sd, startMo=_sm-1, startYr=_sy;
    c.pays.forEach((p,i) => {
      const totalMo = startMo + i;
      const yr = startYr + Math.floor(totalMo/12), mo = totalMo%12;
      const lastDay = new Date(yr, mo+1, 0).getDate();
      const correct = toLocalISO(yr, mo, Math.min(startDay, lastDay));
      if (p.date !== correct) p.date = correct;
    });
  });
}

// ── SYNC UI ──────────────────────────────────────────────────────────────────


function toggleEye(id) {
  const i = document.getElementById(id);
  if (!i) return;
  i.type = i.type === 'password' ? 'text' : 'password';
}

// ── KUR ──────────────────────────────────────────────────────────────────────

// ── AYARLAR SEKMESİ ──────────────────────────────────────────────────────────

// ── YEDEK / GERİ YÜKLE ───────────────────────────────────────────────────────

// ── CSV EXPORT ───────────────────────────────────────────────────────────────


// ── AKTİVİTE LOGU ────────────────────────────────────────────────────────────
// ctx (v8.136 + v8.155): opsiyonel {personId, groupId, credId, hareket} — sadece truthy alanlar entry'e set edilir
function addLog(type, title, detail, navTab, ctx) {
  try {
    const entry = {
      id: Date.now() + Math.random(),
      type, title: String(title||''), detail: String(detail||''),
      navTab: (navTab !== undefined && navTab !== null) ? navTab : -1,
      at: new Date().toISOString()
    };
    if (ctx) {
      if (ctx.personId) entry.personId = ctx.personId;
      if (ctx.groupId)  entry.groupId  = ctx.groupId;
      if (ctx.credId)   entry.credId   = ctx.credId;
      if (ctx.hareket)  entry.hareket  = ctx.hareket;   // kisi karti: duzenlenebilir odeme (hareket.js)
    }
    // WO-02: dogrudan in-place unshift yerine Store API -> invalidate + dirty + autoSave
    // + (coalesced, key-filtreli) store:change. Ayri logSaveTimer GEREKSIZ: Store.unshift
    // zaten _autoSave debounce'unu tetikler (cift save'i onler).
    window.Store.unshift('actLog', entry);
  } catch(e) { console.warn('addLog hata:', e); }
}

// ── INIT ─────────────────────────────────────────────────────────────────────
function initApp() {
  // Acilis varsayilani: 'Tumu' = ileri pencere en uzak odemeye kadar (maxAheadMonths).
  // Her acilis full-gorunume doner; oturum ici daraltma (chAhead -> '6' vb.) korunur,
  // bir sonraki acilista yine 'Tumu'ye doner.
  localStorage.setItem('v5-ahead', 'all');
  const ah = 'all';
  document.getElementById('AH').value = ah;
  const sortEl = document.getElementById('SORT');
  if (sortEl) sortEl.value = window.sortMode;
  const planName = window.getPlanName(window.Store.planId);
  const planBtn = document.getElementById('PLANBTN');
  if (planBtn) planBtn.textContent = '🔄 ' + planName + ' › Değiştir';
  migrateCredDates();
  go(0);
  window.fetchRates();
}

// ── GÜNCELLEME ───────────────────────────────────────────────────────────────

// ── DEBUG ─────────────────────────────────────────────────────────────────────
// Konsoldan window.debugState() — Store flag'leri, session, veri sayilari,
// kur cache, SW durumu.
function debugState() {
  const s = window.Store;
  const sess = Session.debugInfo();
  console.log('%c🔍 debugState — ' + (window.APP_VERSION||'') + ' / ' + (window.APP_BUILD||''),
    'font-weight:700;color:#e8c07d');

  console.log('Store flags');
  console.table({
    dirty:        s.dirty,
    saveTimer:    s.saveTimer,
    syncTimer:    s.syncTimer,
    fbSyncNeeded: s.fbSyncNeeded,
    lastUpdated:  s.lastUpdated ? new Date(s.lastUpdated).toISOString() : 0,
    planId:       s.planId,
    fbUid:        s.fbUid,
  });

  console.log('Session');
  console.table({
    cryptoKey:   sess.hasKey,
    plainPinLen: sess.pinLen,
  });

  console.log('Veri sayilari');
  console.table({
    pays:      (window.pays      || []).length,
    creds:     (window.creds     || []).length,
    hist:      (window.hist      || []).length,
    persons:   (window.persons   || []).length,
    notes:     (window.notes     || []).length,
    paidItems: (window.paidItems || []).length,
    rehber:    (window.rehber    || []).length,
    actLog:    (window.actLog    || []).length,
  });

  console.log('Kur cache');
  const r = window.rates || {};
  console.table({
    EUR:        r.EUR,
    USD:        r.USD,
    GOLD:       r.GOLD,
    _fetchedAt: r._fetchedAt || null,
  });

  console.log('Service Worker');
  console.table({
    swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  });
}

// ── GLOBAL COMPAT ─────────────────────────────────────────────────────────────
window.enterApp           = enterApp;
window.rhbNormalizeCompanies = rhbNormalizeCompanies;
window.rhbSave            = rhbSave;
window.go                 = go;
window.chSort             = chSort;
window.chAhead            = chAhead;
window.migrateCredDates   = migrateCredDates;
window.toggleEye          = toggleEye;
window.addLog             = addLog;
window.initApp            = initApp;
window.debugState         = debugState;

// ── SAYFA AÇILIŞINDA OTOMATİK ────────────────────────────────────────────────
// Modules deferred olduğundan DOM hazır olduğunda çalışır

// ── SYNC UI (sync.js / firestore.js tarafından çağrılır) ─────────────────────

function showPinErr(msg) {
  const inp = document.getElementById('PI');
  if (!inp) return;
  inp.classList.add('err');
  const pe = document.getElementById('PE');
  if (pe) pe.textContent = msg;
  setTimeout(() => {
    inp.classList.remove('err');
    if (pe) pe.textContent = '';
    inp.value = '';
  }, 2000);
}

// ── WO-16 YARDIMCILARI ──────────────────────────────────────────────────────
// Yedek-PIN alani (RPINWRAP/RPIN): yedek aktif oturum PIN'iyle acilmazsa acilir.
function _revealBackupPin(show) {
  const wrap = document.getElementById('RPINWRAP');
  if (wrap) wrap.style.display = show ? '' : 'none';
  const inp = document.getElementById('RPIN');
  if (inp && !show) inp.value = '';
}
// Cozulen yedegi kabul et: durum metni + dataset.d (doRestore bunu okur).
function _acceptRestore(st, data) {
  _revealBackupPin(false);
  st.style.color = 'var(--ok)';
  st.textContent = (data.pays||[]).length+' ödeme, '+(data.creds||[]).length+" kredi bulundu. Geri Yükle'ye bas.";
  st.dataset.d = JSON.stringify(data);
}

function readRF(inp) {
  const f = inp.files[0]; if (!f) return;
  const st = document.getElementById('RS');
  // Yeni dosya -> onceki denemenin durumunu sifirla (bayat enc/d/pin alani kalmasin).
  delete st.dataset.d; delete st.dataset.enc;
  _revealBackupPin(false);
  const fr = new FileReader();
  fr.onload = e => {
    try {
      const raw = JSON.parse(e.target.result);
      if (!(raw.enc && raw.data)) { st.style.color='var(--danger)'; st.textContent='Geçersiz dosya'; return; }
      // 1) MUTLU YOL: aktif oturum PIN'i ile coz + yapisal dogrula.
      const dec = Session.decryptBackup(raw.data);
      if (dec) {
        let o = null; try { o = JSON.parse(dec); } catch(e2) {}
        if (o && window._looksLikeBackup(o)) { _acceptRestore(st, o); return; }
      }
      // 2) WO-16: oturum PIN'i acmadi -> yedek farkli bir sifreyle alinmis olabilir.
      //    Cop/JSON-hatasiyla SESSIZCE durmak yerine yedek-PIN alanini ac.
      st.dataset.enc = raw.data;
      st.style.color = 'var(--danger)';
      st.textContent = 'Bu yedek şu anki şifrenle açılmadı. Yedeği ALDIĞINDA kullandığın şifreyi gir.';
      _revealBackupPin(true);
      const rp = document.getElementById('RPIN'); if (rp) rp.focus();
    } catch(err) { st.style.color='var(--danger)'; st.textContent='Hata: '+err.message; }
  };
  fr.readAsText(f);
}

// WO-16: kullanicinin girdigi "yedek sifresi" ile coz (oturum PIN'inden bagimsiz).
function tryRestorePin() {
  const st  = document.getElementById('RS');
  const inp = document.getElementById('RPIN');
  if (!st || !inp) return;
  const pin = inp.value;
  if (!pin) { st.style.color='var(--danger)'; st.textContent='Yedek şifresini gir.'; return; }
  if (!st.dataset.enc) { st.style.color='var(--danger)'; st.textContent='Önce yedek dosyası seç.'; return; }
  const data = window.decodeBackupPayload(st.dataset.enc, pin);  // yanlis PIN -> null
  if (!data) { st.style.color='var(--danger)'; st.textContent='Bu şifre yedeği açmadı. Tekrar dene.'; inp.value=''; inp.focus(); return; }
  inp.value = '';                 // girilen yedek-PIN'i UI'da tutma
  _acceptRestore(st, data);
}

window.showPinErr        = showPinErr;
window.readRF            = readRF;
window.tryRestorePin     = tryRestorePin;

// ── VISIBILITY SYNC POLL ─────────────────────────────────────────────────────
// WO-05: Buradaki visibilitychange dinleyicisi KALDIRILDI (cift tetik -> cift pull).
// Tek dinleyici sync.js _attachFocusHooks'ta (guard'li: visibilitychange + focus +
// online, hepsi pull()). setSyncDot('connecting') o pull()'a tasindi -> ayni UX.
