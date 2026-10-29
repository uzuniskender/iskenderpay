// js/kaza.js — iskenderpay (v8.247) — Kaza namazı takvimi (Diğer → 🕌 Kaza Namazı)
//
// Borç verisinden AYRI kayıt: Firestore `users/<uid>_kaza` (firebase.js#_kazaOku/_kazaYaz) + cihazda
// `localStorage['ipay-kaza-<uid>']`. İkisi de oturum anahtarıyla ŞİFRELİ (Session.encrypt).
// Ana veri bloğuna (pays/creds/...) dokunmaz; bu modül bozulsa bile borç kayıtları etkilenmez.
// Hesaplar saf: js/kaza-core.js.

import { Session } from './session.js';
import { VAKITLER, TAM, isoGun, gunTarih, bosVeri, vakitDegistir, ozet, eksikGun, veriTemizle } from './kaza-core.js';

const AYLAR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const GUN_KISA = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const bugun = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const tr = n => n.toLocaleString('tr-TR');

let _veri = null;          // { baslangic, g }
let _ay = null;            // { y, m }
let _yazZaman = null;      // debounce
let _yaziyor = false, _tekrar = false;
let _bagli = false;

const _yerelAnahtar = () => 'ipay-kaza-' + (window.Store && window.Store.fbUid || 'yerel');

async function _yukle() {
  let enc = null;
  try { if (window._kazaOku) enc = await window._kazaOku(); } catch (e) { console.warn('[kaza] uzak okuma:', e); }
  if (!enc) { try { enc = localStorage.getItem(_yerelAnahtar()); } catch (e) {} }
  if (!enc) return bosVeri();
  try { return veriTemizle(await Session.decrypt(enc)); }
  catch (e) { console.warn('[kaza] çözme hatası:', e); throw new Error('cozulemedi'); }
}

function _kaydetPlanla() {
  clearTimeout(_yazZaman);
  _durum('Kaydediliyor…');
  _yazZaman = setTimeout(_kaydet, 500);
}

async function _kaydet() {
  if (_yaziyor) { _tekrar = true; return; }
  _yaziyor = true;
  try {
    do {
      _tekrar = false;
      const enc = await Session.encrypt(_veri);
      try { localStorage.setItem(_yerelAnahtar(), enc); } catch (e) {}
      if (window._kazaYaz) await window._kazaYaz(enc);
    } while (_tekrar);
    _yazZaman = null;
    _durum('Kaydedildi');
  } catch (e) {
    console.warn('[kaza] kayıt:', e);
    _durum('İnternet yok: telefona kaydedildi, bağlantı gelince bir işaret daha koyunca buluta da yazılır.');
  } finally { _yaziyor = false; }
}

function _durum(t) { const el = $('KZ_DURUM'); if (el) el.textContent = t; }

function _ozetCiz() {
  const o = ozet(_veri, bugun());
  $('KZ_KALAN').textContent = tr(o.kalan);
  $('KZ_KILINAN').textContent = tr(o.kilinan);
  const oran = o.toplam ? o.kilinan / o.toplam : 0;
  $('KZ_ORAN').textContent = '%' + (oran * 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $('KZ_CUBUK').style.width = (oran * 100) + '%';
  $('KZ_VAKIT').innerHTML = VAKITLER.map((v, i) => '<div><b>' + tr(o.vakitKalan[i]) + '</b>' + v + '</div>').join('');
}

function _aySecenekleri() {
  const bas = gunTarih(_veri.baslangic), son = bugun(), out = [];
  for (let y = son.getFullYear(); y >= bas.getFullYear(); y--) {
    const m1 = y === bas.getFullYear() ? bas.getMonth() : 0, m2 = y === son.getFullYear() ? son.getMonth() : 11;
    for (let m = m2; m >= m1; m--) out.push('<option value="' + y + '-' + m + '">' + AYLAR[m] + ' ' + y + '</option>');
  }
  $('KZ_AY').innerHTML = out.join('');
}

function _listeCiz(vurgu) {
  const { y, m } = _ay;
  $('KZ_AY').value = y + '-' + m;
  const gizle = $('KZ_GIZLE').checked, bas = gunTarih(_veri.baslangic), son = bugun(), bugunIso = isoGun(son);
  const gunAdedi = new Date(y, m + 1, 0).getDate(), satir = [];
  let gizlenen = 0;
  for (let g = 1; g <= gunAdedi; g++) {
    const d = new Date(y, m, g);
    if (d < bas || d > son) continue;
    const iso = isoGun(d), mk = _veri.g[iso] || 0;
    if (gizle && mk === TAM && g !== vurgu) { gizlenen++; continue; }
    const hucre = VAKITLER.map((v, i) => {
      const on = mk & (1 << i);
      return '<button class="kz-vk' + (on ? ' on' : '') + '" data-kz="' + iso + '|' + i + '" aria-pressed="' + (on ? 'true' : 'false')
        + '" aria-label="' + pad(g) + '.' + pad(m + 1) + '.' + y + ' ' + v + '">' + (on ? '✓' : '') + '</button>';
    }).join('');
    satir.push('<div class="kz-gun' + (iso === bugunIso ? ' bugun' : '') + (g === vurgu ? ' vurgu' : '') + '" id="KZG' + g + '">'
      + '<div class="kz-tarih">' + pad(g) + '.' + pad(m + 1) + '<small>' + GUN_KISA[d.getDay()] + ' · ' + y + '</small></div>' + hucre + '</div>');
  }
  $('KZ_LISTE').innerHTML = satir.length ? satir.join('')
    : '<div class="kz-bos">' + AYLAR[m] + ' ' + y + ' içinde eksik gün yok.' + (gizlenen ? ' Tamamlanan ' + gizlenen + ' gün gizli.' : '') + '</div>';
  if (vurgu) { const el = $('KZG' + vurgu); if (el) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60); }
}

function _git(d) { _ay = { y: d.getFullYear(), m: d.getMonth() }; _listeCiz(d.getDate()); }

function _ayKaydir(fark) {
  let { y, m } = _ay; m += fark;
  if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  if (new Date(y, m + 1, 0) < gunTarih(_veri.baslangic) || new Date(y, m, 1) > bugun()) return;
  _ay = { y, m }; _listeCiz();
}

function _bagla() {
  if (_bagli) return;
  _bagli = true;
  $('KZ_LISTE').addEventListener('click', e => {
    const b = e.target.closest('[data-kz]');
    if (!b || !_veri) return;
    const [iso, i] = b.dataset.kz.split('|');
    _veri = vakitDegistir(_veri, iso, +i);
    const on = (_veri.g[iso] || 0) & (1 << +i);
    b.classList.toggle('on', !!on); b.textContent = on ? '✓' : ''; b.setAttribute('aria-pressed', on ? 'true' : 'false');
    _ozetCiz();
    if (_veri.g[iso] === TAM && $('KZ_GIZLE').checked) setTimeout(() => _listeCiz(), 600);
    _kaydetPlanla();
  });
  $('KZ_ILK').onclick = () => { const d = eksikGun(_veri, bugun(), false); d ? _git(d) : _durum('Bugüne kadar eksik gün yok.'); };
  $('KZ_SON').onclick = () => { const d = eksikGun(_veri, bugun(), true); d ? _git(d) : _durum('Bugüne kadar eksik gün yok.'); };
  $('KZ_BUGUN').onclick = () => _git(bugun());
  $('KZ_ONCEKI').onclick = () => _ayKaydir(-1);
  $('KZ_SONRAKI').onclick = () => _ayKaydir(1);
  $('KZ_AY').onchange = e => { const [y, m] = e.target.value.split('-').map(Number); _ay = { y, m }; _listeCiz(); };
  $('KZ_GIZLE').onchange = () => _listeCiz();
  $('KZ_BAS').onchange = e => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
    _veri = { ..._veri, baslangic: e.target.value };
    _aySecenekleri(); _ozetCiz(); _git(eksikGun(_veri, bugun(), false) || bugun());
    _kaydetPlanla();
  };
}

async function openKaza() {
  if (!Session.hasKey()) { alert('Önce şifreyle giriş yapın.'); return; }
  window.ModalManager.closeAll();
  window.ModalManager.open('KAZA');
  _bagla();
  // Her açılışta buluttan taze okunur (başka cihazda koyulan işaretler gelsin); yazma sürüyorsa bellek kullanılır
  if (!_veri || (!_yaziyor && !_yazZaman)) {
    $('KZ_LISTE').innerHTML = '<div class="kz-bos">Yükleniyor…</div>';
    try { _veri = await _yukle(); }
    catch (e) { $('KZ_LISTE').innerHTML = '<div class="kz-bos">Kaza kaydı açılamadı. Uygulamayı kilitleyip yeniden açmayı dene.</div>'; return; }
  }
  $('KZ_BAS').value = _veri.baslangic;
  _aySecenekleri(); _ozetCiz();
  _git(bugun());
}

window.openKaza = openKaza;
