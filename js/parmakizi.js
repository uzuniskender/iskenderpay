// js/parmakizi.js — iskenderpay (v8.241)
// PARMAK İZİ / YÜZ İLE GİRİŞ (WebAuthn + PRF uzantısı).
//
// NASIL: Ayarlar'da şifre bir kez girilir -> veri anahtarı şifreyle açılır -> telefonun
// kendi kilidinde (parmak izi) bir "geçiş anahtarı" oluşturulur. PRF uzantısı, yalnız
// parmak izi doğrulanınca telefonun güvenli donanımından gizli bir değer döndürür; veri
// anahtarı bu değerle AES-GCM şifrelenip YALNIZ BU CİHAZDA (localStorage) saklanır.
// Girişte: parmak izi -> gizli değer -> veri anahtarı çözülür.
//
// GÜVENLİK: saklanan kayıt parmak izi olmadan çözülemez; şifre hiçbir yere yazılmaz.
// Şifreyle giriş aynen durur (yedek yol). Veri / şifreli blob / Firebase DEĞİŞMEZ.
// Şifre değişirse veri anahtarı değişmediği için parmak izi çalışmaya devam eder.

import { Session } from './session.js';
import { unwrapDataKey } from './crypto.js';

const KAYIT = 'ipay-parmakizi';

const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rastgele = n => crypto.getRandomValues(new Uint8Array(n));

export function destekVarMi() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!(navigator.credentials && navigator.credentials.create);
}

export function kayitOku(uid) {
  try {
    const k = JSON.parse(localStorage.getItem(KAYIT) || 'null');
    return k && k.uid && k.uid === uid && k.credId && k.tuz && k.iv && k.ct ? k : null;
  } catch (e) { return null; }
}

export function parmakiziKapat() { try { localStorage.removeItem(KAYIT); } catch (e) {} }

async function _prfAnahtar(prf) {
  return crypto.subtle.importKey('raw', new Uint8Array(prf).slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function sarmala(rawBytes, prf) {
  const iv = rastgele(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await _prfAnahtar(prf), rawBytes);
  return { iv: b64(iv), ct: b64(ct) };
}

export async function coz(kayit, prf) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(kayit.iv) }, await _prfAnahtar(prf), unb64(kayit.ct));
  return new Uint8Array(pt);
}

// Parmak izi sor -> PRF gizli değeri
async function _prfAl(creds, credIdB64, tuzB64) {
  const a = await creds.get({ publicKey: {
    challenge: rastgele(32),
    allowCredentials: [{ type: 'public-key', id: unb64(credIdB64) }],
    userVerification: 'required',
    timeout: 60000,
    extensions: { prf: { eval: { first: unb64(tuzB64) } } },
  } });
  const r = a && a.getClientExtensionResults && a.getClientExtensionResults();
  const first = r && r.prf && r.prf.results && r.prf.results.first;
  if (!first) throw new Error('prf_yok');
  return new Uint8Array(first);
}

// Kurulum. sifre: kullanıcının şifresi (veri anahtarını açmak için). Hata kodları:
// 'sifre_yanlis' | 'prf_yok' | 'destek_yok' | 'oturum_yok' | NotAllowedError (vazgeçti)
export async function parmakiziKur(sifre, creds) {
  creds = creds || navigator.credentials;
  if (!creds || !creds.create) throw new Error('destek_yok');
  const uid = window.Store && window.Store.fbUid;
  if (!uid) throw new Error('oturum_yok');
  const wrapped = window._getWrappedKey() || (window._loadWrappedKeyFirebase && await window._loadWrappedKeyFirebase());
  if (!wrapped) throw new Error('oturum_yok');
  let raw;
  try { raw = (await unwrapDataKey(wrapped, sifre, await window.getSaltAsync('v5-pin-salt'))).rawBytes; }
  catch (e) { throw new Error('sifre_yanlis'); }

  const tuz = rastgele(32);
  const cred = await creds.create({ publicKey: {
    rp: { name: 'Ödeme Takvimi' },
    user: { id: rastgele(16), name: 'odeme-takvimi', displayName: 'Ödeme Takvimi' },
    challenge: rastgele(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000,
    extensions: { prf: { eval: { first: tuz } } },
  } });
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!ext.prf || ext.prf.enabled === false) throw new Error('prf_yok');
  const credId = b64(cred.rawId);
  // Bazı cihazlar PRF değerini kurulumda vermez -> bir kez daha parmak izi ister
  let prf = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
  if (!prf) prf = await _prfAl(creds, credId, b64(tuz));

  const kayit = { uid, credId, tuz: b64(tuz), ...(await sarmala(raw, prf)), at: new Date().toISOString() };
  const geri = await coz(kayit, prf);                       // kendi kendini doğrula
  if (geri.length !== raw.length || geri.some((x, i) => x !== raw[i])) throw new Error('dogrulama');
  localStorage.setItem(KAYIT, JSON.stringify(kayit));
  return true;
}

// Giriş: veri anahtarının ham baytları (çağıran non-extractable import eder)
export async function parmakiziIleAnahtar(uid, creds) {
  creds = creds || navigator.credentials;
  const k = kayitOku(uid);
  if (!k) throw new Error('kayit_yok');
  const prf = await _prfAl(creds, k.credId, k.tuz);
  return coz(k, prf);
}

// ── UI ───────────────────────────────────────────────────────────────────
function _uid() { return window.Store && window.Store.fbUid; }

// Şifre ekranında düğmeyi göster; otomatik bir kez sor
let _otoSoruldu = false;
export function pinEkraniParmak() {
  const btn = document.getElementById('PIN_PARMAK');
  const var_ = destekVarMi() && !!kayitOku(_uid());
  if (btn) btn.style.display = var_ ? '' : 'none';
  if (var_ && !_otoSoruldu && document.visibilityState === 'visible') {
    _otoSoruldu = true;
    setTimeout(() => parmakiziGiris(true), 350);
  }
}

let _girisSuruyor = false;
async function parmakiziGiris(otomatik) {
  if (_girisSuruyor) return;
  _girisSuruyor = true;
  try {
    const raw = await parmakiziIleAnahtar(_uid());
    const key = await window.importDataKey(raw);
    Session.set({ cryptoKey: key });
    try { await window.loadSecure(); }
    catch (e) { Session.clear(); throw new Error('cozulemedi'); }
    if (window.oturumKaydet) await window.oturumKaydet(key);
    window.enterApp();
  } catch (e) {
    const vazgecti = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
    if (!(otomatik && vazgecti) && window.showPinErr) {
      window.showPinErr(vazgecti ? 'Parmak izi iptal edildi — şifreyle girebilirsin.'
        : e.message === 'cozulemedi' ? 'Parmak izi kaydı bu veriyi açmadı. Şifreyle gir; Ayarlar\'dan parmak izini yeniden aç.'
        : 'Parmak izi olmadı — şifreyle girebilirsin.');
    }
  } finally { _girisSuruyor = false; }
}

export function ayarlarParmak() {
  const d = document.getElementById('PARMAK_DURUM');
  const ac = document.getElementById('PARMAK_AC');
  const kap = document.getElementById('PARMAK_KAPAT');
  if (!d) return;
  if (!destekVarMi()) {
    d.textContent = 'Bu tarayıcı parmak izi girişini desteklemiyor.';
    if (ac) ac.style.display = 'none'; if (kap) kap.style.display = 'none';
    return;
  }
  const var_ = !!kayitOku(_uid());
  d.textContent = var_ ? '✅ Bu cihazda açık' : 'Kapalı — şifreni gir ve aç';
  if (ac) ac.style.display = var_ ? 'none' : '';
  if (kap) kap.style.display = var_ ? '' : 'none';
}

async function parmakiziAcUI() {
  const inp = document.getElementById('PARMAK_SIFRE');
  const msg = document.getElementById('PARMAK_MSG');
  const yaz = (renk, t) => { if (msg) { msg.style.color = renk; msg.textContent = t; } };
  if (!inp || !inp.value) { yaz('var(--danger)', 'Önce şifreni gir.'); return; }
  yaz('var(--muted)', 'Telefon parmak izini soracak…');
  try {
    await parmakiziKur(inp.value);
    inp.value = '';
    yaz('var(--ok)', '✅ Parmak izi açıldı. Şifre ekranında 👆 ile gireceksin.');
  } catch (e) {
    const m = e && e.message;
    yaz('var(--danger)', m === 'sifre_yanlis' ? '❌ Şifre yanlış.'
      : m === 'prf_yok' ? '❌ Bu telefon/tarayıcı parmak izi anahtarını desteklemiyor. Chrome\'u güncelleyip tekrar dene.'
      : (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) ? 'İptal edildi.'
      : '❌ Açılamadı: ' + (m || e));
  }
  ayarlarParmak();
}

function parmakiziKapatUI() {
  if (!confirm('Bu cihazda parmak izi girişi kapatılsın mı? (Şifreyle giriş aynen çalışır)')) return;
  parmakiziKapat();
  const msg = document.getElementById('PARMAK_MSG'); if (msg) msg.textContent = '';
  ayarlarParmak();
}

if (typeof window !== 'undefined') {
  Object.assign(window, { parmakiziGiris, parmakiziAcUI, parmakiziKapatUI, ayarlarParmak, pinEkraniParmak });
}
