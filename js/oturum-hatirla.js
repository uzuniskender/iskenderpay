// js/oturum-hatirla.js — iskenderpay (v8.238)
// "Bu cihazda açık kalsın": sayfa yenilenince (hard reset dahil) şifre tekrar sorulmaz.
//
// NE SAKLANIR: yalnız veri anahtarı — DIŞARI AKTARILAMAZ (non-extractable) CryptoKey
// olarak IndexedDB'de. Ham anahtar baytları ve şifre (PIN) HİÇBİR YERE yazılmaz;
// tarayıcı bu anahtarı yalnız bu site içinde şifrele/çöz için kullandırır.
// Veri yapısı ve şifreli blob DEĞİŞMEZ; bu yalnız anahtara ikinci bir erişim yolu.
//
// SÜRE (v8.240, Serdar: "kimse benim haricimde girmemeli"): son dokunuştan 5 dk sonra
// hem açık uygulama kendiliğinden kilitlenir hem yenilemede şifre sorulur.
// Kilitle / Çıkış kaydı siler. Farklı Google hesabında kayıt kullanılmaz.

import { Session } from './session.js';

export const OTURUM_SURE_MS = 5 * 60 * 1000;

// Saf karar (test edilir): kayıt bu kullanıcı için şu an kullanılabilir mi?
export function oturumGecerliMi(kayit, uid, simdi, sure = OTURUM_SURE_MS) {
  if (!kayit || !kayit.key || !uid || kayit.uid !== uid || !kayit.planId) return false;
  if (typeof kayit.ts !== 'number') return false;
  const gecen = simdi - kayit.ts;
  return gecen > -60000 && gecen < sure;   // saat 1 dk geri kaymış olabilir
}

// ── IndexedDB (hata = sessiz null; hiçbir hata girişi bozmaz) ────────────────
const DB = 'ipay-oturum', DEPO = 'kv', ANAHTAR = 'aktif';

function _db() {
  return new Promise((ok, red) => {
    if (typeof indexedDB === 'undefined') return red(new Error('idb yok'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DEPO);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => red(r.error);
  });
}
async function _islem(mod, fn) {
  const db = await _db();
  try {
    return await new Promise((ok, red) => {
      const t = db.transaction(DEPO, mod);
      const r = fn(t.objectStore(DEPO));
      t.oncomplete = () => ok(r && r.result);
      t.onerror = () => red(t.error);
    });
  } finally { db.close(); }
}
const _oku  = () => _islem('readonly',  s => s.get(ANAHTAR));
const _yaz  = k  => _islem('readwrite', s => s.put(k, ANAHTAR));

export async function oturumSil() {
  _sonYazim = 0;
  try { await _islem('readwrite', s => s.delete(ANAHTAR)); } catch (e) {}
}

export async function oturumKaydet(cryptoKey) {
  const uid = window.Store && window.Store.fbUid;
  const planId = window.Store && window.Store.planId;
  if (!cryptoKey || !uid || !planId) return;
  try {
    _sonEtkilesim = Date.now();
    await _yaz({ uid, planId, key: cryptoKey, ts: _sonEtkilesim });
    _sonYazim = _sonEtkilesim;
  } catch (e) { console.warn('[oturum] kaydedilemedi:', e); }
}

// Son kullanıcı etkileşimi (bellekte) + kayda en fazla 30 sn'de bir yazım.
let _sonEtkilesim = Date.now();
let _sonYazim = 0;
async function _kaydaYaz(ts) {
  try {
    const k = await _oku();
    if (k && k.uid === (window.Store && window.Store.fbUid)) await _yaz({ ...k, ts });
  } catch (e) {}
}
export async function oturumDokun() {
  const simdi = Date.now();
  _sonEtkilesim = simdi;
  if (!_sonYazim || simdi - _sonYazim < 30000) return;
  _sonYazim = simdi;
  await _kaydaYaz(simdi);
}

// Saf karar (test edilir): açık oturum zaman aşımına uğradı mı?
export function bosKaldiMi(sonEtkilesim, simdi, sure = OTURUM_SURE_MS) {
  return simdi - sonEtkilesim >= sure;
}

// Geçerli kayıt varsa {planId, key} döner; süresi geçmiş/başka hesap ise siler, null döner.
export async function oturumBul(uid) {
  let k = null;
  try { k = await _oku(); } catch (e) { return null; }
  if (!k) return null;
  if (!oturumGecerliMi(k, uid, Date.now())) { await oturumSil(); return null; }
  return { planId: k.planId, key: k.key };
}

// ── GİRİŞ AKIŞI (firebase.js onAuthStateChanged çağırır) ─────────────────────
// Plan seçim ekranı yok: son kullanılan plan (Store.planId, vars. plan1) açılır.
// Geçerli oturum kaydı varsa şifre sorulmadan uygulamaya girilir.
export async function girisAkisi(uid) {
  if (Session.isUnlocked()) return 'acik';
  const k = await oturumBul(uid);
  if (k) {
    try {
      window.Store.planId = k.planId;
      Session.set({ cryptoKey: k.key });
      await window.loadSecure();
      _sonEtkilesim = _sonYazim = Date.now();
      window.enterApp();
      return 'otomatik';
    } catch (e) {
      console.warn('[oturum] kayıtlı anahtarla açılamadı, şifre sorulacak:', e);
      Session.clear();
      await oturumSil();
    }
  }
  window.selectPlan(window.Store.planId || 'plan1');
  return 'sifre';
}

// Kilitle: bellekteki anahtar + kayıt silinir, sayfa yeniden yüklenir -> şifre ekranı.
let _kilitleniyor = false;
export async function kilitle() {
  if (_kilitleniyor) return;
  _kilitleniyor = true;
  // Bekleyen kayıt varsa anahtar silinmeden ÖNCE yaz (veri kaybı yok)
  try { if (window.Store && window.Store.dirty && window.saveSecureNow) await window.saveSecureNow(); } catch (e) { console.warn('[kilit] kayıt hatası:', e); }
  Session.clear();
  await oturumSil();
  location.reload();
}

function _zamanKontrol() {
  if (Session.isUnlocked() && bosKaldiMi(_sonEtkilesim, Date.now())) kilitle();
}

window.girisAkisi = girisAkisi;
window.kilitle     = kilitle;
window.oturumKaydet = oturumKaydet;
window.oturumSil  = oturumSil;

// Etkileşim dinleyicileri (uygulama açıkken süreyi uzatır)
if (typeof document !== 'undefined') {
  const d = () => { if (Session.isUnlocked()) oturumDokun(); };
  document.addEventListener('pointerdown', d, { passive: true });
  document.addEventListener('keydown', d);
  document.addEventListener('input', d, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (Session.isUnlocked()) _kaydaYaz(_sonEtkilesim); }
    else _zamanKontrol();   // arka plandan dönüş: 5 dk geçtiyse hemen kilit
  });
  window.addEventListener('focus', _zamanKontrol);
  setInterval(_zamanKontrol, 15000);
}
