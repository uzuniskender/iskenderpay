// js/guvenlik.js — iskenderpay
// SİLME KAVRAMLARI (v8.233) — üç ayrı şey, üç ayrı düğme:
//
//   ↩ GERİ AL      (hareket.js)  "olmamış say": tutar kalemden düşülür, log satırı ÜSTÜ ÇİZİLİ kalır.
//   🗑 KAYDI SİL   (hareket.js)  "iz de gitsin": PIN ister. Ödeme hâlâ geçerliyse ÖNCE geri alınır —
//                                 kaydı yok ama planda "ödendi" duran hayalet ödeme OLUŞMAZ.
//   KİŞİ:  Arşivle  → listeden kalkar, geçmiş/log/bağlar AYNEN durur, geri getirilebilir.
//          Kalıcı Sil (PIN) → kişi + borçları + kredileri + defter + silinmişler + logları birlikte gider.
//          Silinenler cihazda ŞİFRELİ kopya olarak saklanır (son 5).
//
// Log sekmesindeki toplu silmeler geçerli (geri alınmamış) ödeme hareketlerine DOKUNMAZ.

import { Session } from './session.js';
import { payKisiye, credKisiye } from './hareket.js';

// ── SAF ÇEKİRDEK (test edilir) ─────────────────────────────────────────────

// Geri alınmamış ödeme hareketi mi? (plandaki para buna bağlı)
export function aktifHareketMi(e) {
  return !!(e && e.hareket && !e.hareket.iptal);
}

// Kişiyi tüm geçmişiyle silme planı. Girdiyi DEĞİŞTİRMEZ; kalacak dizileri + silinenleri döner.
export function kisiSilmePlani(person, d, baseOf) {
  baseOf = baseOf || (n => (n || '').replace(/ \d+$/, '').trim() || n);
  const base = baseOf(person.name);
  const ayir = (liste, sil) => {
    const kalan = [], giden = [];
    (liste || []).forEach(x => (sil(x) ? giden : kalan).push(x));
    return { kalan, giden };
  };
  const pays = ayir(d.pays, p => payKisiye(p, person, baseOf));
  const creds = ayir(d.creds, c => credKisiye(c, person, baseOf));
  const credIds = new Set(creds.giden.map(c => String(c.id)));
  const groupIds = new Set(pays.giden.map(p => p.groupId).filter(Boolean));
  const kayitKisinin = x => {
    if (!x) return false;
    if (x._cid != null && credIds.has(String(x._cid))) return true;
    if (x._restructuredFrom != null && credIds.has(String(x._restructuredFrom))) return true;
    if (x._closedFrom != null && credIds.has(String(x._closedFrom))) return true;
    if (x.personId) return x.personId === person.id;
    if (x.groupId && groupIds.has(x.groupId)) return true;
    return baseOf(x.name) === base;
  };
  const paidItems = ayir(d.paidItems, kayitKisinin);
  const hist = ayir(d.hist, kayitKisinin);
  const actLog = ayir(d.actLog, e => {
    if (!e || (e.type || '').startsWith('rhb_')) return false;
    if (e.personId) return e.personId === person.id;
    if (e.credId && credIds.has(String(e.credId))) return true;
    if (e.groupId && groupIds.has(e.groupId)) return true;
    return !!e.detail && baseOf(e.detail.split(' · ')[0] || '') === base;
  });
  const persons = ayir(d.persons, p => p.id === person.id);
  return {
    kalan: { persons: persons.kalan, pays: pays.kalan, creds: creds.kalan, paidItems: paidItems.kalan, hist: hist.kalan, actLog: actLog.kalan },
    giden: { persons: persons.giden, pays: pays.giden, creds: creds.giden, paidItems: paidItems.giden, hist: hist.giden, actLog: actLog.giden },
    sayim: { odeme: pays.giden.length, kredi: creds.giden.length, defter: paidItems.giden.length, silinmis: hist.giden.length, log: actLog.giden.length }
  };
}

// Kişinin açık (ödenmemiş) borcu var mı?
export function acikBorcVar(person, pays, creds, baseOf) {
  const acik = x => (x.status || 'pending') !== 'paid';
  return (pays || []).some(p => payKisiye(p, person, baseOf) && acik(p))
    || (creds || []).some(c => credKisiye(c, person, baseOf) && (c.pays || []).some(acik));
}

// ── PIN ONAYI ──────────────────────────────────────────────────────────────
let _pinCoz = null;

// Promise<boolean>: doğru PIN → true, vazgeç → false
export function pinOnay(baslik, aciklama) {
  return new Promise(resolve => {
    if (_pinCoz) _pinCoz(false);
    _pinCoz = resolve;
    document.getElementById('PIN_T').innerHTML = baslik || 'Şifreyle <span>Onayla</span>';
    document.getElementById('PIN_ACK').innerHTML = aciklama || '';
    const inp = document.getElementById('PIN_INP');
    inp.value = '';
    document.getElementById('PIN_ERR').textContent = '';
    window.ModalManager.open('PINMOD');
    setTimeout(() => inp.focus(), 120);
  });
}

function pinOnayla() {
  const inp = document.getElementById('PIN_INP');
  if (!Session.verifyPin(inp.value)) {
    document.getElementById('PIN_ERR').textContent = 'Şifre hatalı.';
    inp.value = '';
    inp.focus();
    return;
  }
  inp.value = '';
  window.ModalManager.close('PINMOD');
  const c = _pinCoz; _pinCoz = null;
  if (c) c(true);
}

function pinVazgec() {
  window.ModalManager.close('PINMOD');
  const c = _pinCoz; _pinCoz = null;
  if (c) c(false);
}

// ── KİŞİ ARŞİV / KALICI SİL ────────────────────────────────────────────────
const _kisi = pid => (window.persons || []).find(p => p.id === pid);

function kisiArsivle(pid) {
  const p = _kisi(pid);
  if (!p) return;
  if (acikBorcVar(p, window.pays, window.creds, window.Hesap._baseOf)) {
    alert('"' + p.name + '" kişisinin ödenmemiş borcu var, arşivlenemez.\n\nBorç bittiyse arşivleyebilirsin; tamamen silmek için "Kalıcı Sil".');
    return;
  }
  if (!confirm('"' + p.name + '" arşive kaldırılsın mı?\n\nListeden kalkar. Geçmişi, ödemeleri ve logları AYNEN durur; istediğinde geri getirirsin.')) return;
  window.Store.mutateItem(p, { arsiv: new Date().toISOString() });
  window.addLog('plan_edit', 'Kişi arşivlendi', p.name, 2, { personId: p.id });
  window.ModalManager.close('PHIST');
  if (window.renderPersons) window.renderPersons();
}

function kisiGeriGetir(pid) {
  const p = _kisi(pid);
  if (!p) return;
  window.Store.mutateItem(p, { arsiv: undefined });
  delete p.arsiv;
  window.Store.touch();
  window.addLog('plan_edit', 'Kişi arşivden geri geldi', p.name, 2, { personId: p.id });
  if (window.renderPersons) window.renderPersons();
}

async function _silinenSakla(p, giden) {
  try {
    const enc = await Session.encrypt({ kisi: p, at: new Date().toISOString(), giden });
    const anahtar = 'ipay-silinen-' + Date.now();
    localStorage.setItem(anahtar, enc);
    const eski = Object.keys(localStorage).filter(k => k.startsWith('ipay-silinen-')).sort();
    while (eski.length > 5) localStorage.removeItem(eski.shift());
    return true;
  } catch (e) {
    console.warn('[guvenlik] silinen kopya saklanamadi:', e);
    return false;
  }
}

async function kisiKaliciSil(pid) {
  const p = _kisi(pid);
  if (!p) return;
  const plan = kisiSilmePlani(p, {
    persons: window.persons, pays: window.pays, creds: window.creds,
    paidItems: window.paidItems, hist: window.hist, actLog: window.actLog
  }, window.Hesap._baseOf);
  const s = plan.sayim;
  const ozet = '<b>' + window.esc(p.name) + '</b> ve bağlı her şey kalıcı silinecek:<br>'
    + s.odeme + ' plan kaydı · ' + s.kredi + ' kredi · ' + s.defter + ' ödeme defteri · '
    + s.silinmis + ' silinmiş kayıt · ' + s.log + ' log.<br><br>'
    + 'Diğer kişilere dokunulmaz. Onaylamak için şifreni gir.';
  if (!(await window.pinOnay('Kişiyi <span>Kalıcı Sil</span>', ozet))) return;
  const saklandi = await _silinenSakla(p, plan.giden);
  window.Store.tx(() => {
    ['pays', 'creds', 'paidItems', 'hist', 'actLog', 'persons'].forEach(k => window.Store.replace(k, plan.kalan[k]));
  });
  window.ModalManager.closeAll();
  if (window.renderPersons) window.renderPersons();
  if (window.showWarnToast) window.showWarnToast(p.name + ' silindi' + (saklandi ? ' (cihazda şifreli kopyası tutuldu)' : ''));
}

// Kişi silme penceresi: arşiv mi kalıcı mı
function kisiSilSec(pid) {
  const p = _kisi(pid);
  if (!p) return;
  document.getElementById('KS_PID').value = pid;
  document.getElementById('KS_AD').textContent = p.name;
  const borclu = acikBorcVar(p, window.pays, window.creds, window.Hesap._baseOf);
  document.getElementById('KS_ARSIV').disabled = borclu;
  document.getElementById('KS_ARSIV_NOT').textContent = borclu
    ? 'Ödenmemiş borcu var — önce borç bitmeli.'
    : 'Listeden kalkar, geçmişi ve logları durur. Geri getirilebilir.';
  window.ModalManager.open('KISISIL');
}

window.pinOnay        = pinOnay;
window.pinOnayla      = pinOnayla;
window.pinVazgec      = pinVazgec;
window.kisiArsivle    = kisiArsivle;
window.kisiGeriGetir  = kisiGeriGetir;
window.kisiKaliciSil  = kisiKaliciSil;
window.kisiSilSec     = kisiSilSec;
window.Guvenlik       = { aktifHareketMi, kisiSilmePlani, acikBorcVar, pinOnay };
