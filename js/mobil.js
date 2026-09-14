// js/mobil.js — iskenderpay
// TELEFON DENEYİMİ (≤767px). Bilgisayar görünümüne DOKUNMAZ; bütün düzen app.css'teki
// @media (max-width:767px) bloğundadır. Bu modül yalnız:
//   • Ana sayfa özetini (#MOB_HOME) üretir: toplam borç kartı + gecikmiş + yaklaşan ödemeler
//   • Alt menü (+ ve Diğer sayfaları) eylemlerini bağlar
// Veri YAZMAZ: satıra dokununca mevcut ekranlar (openCell, cari kart, ödeme gir) açılır.

import { toTRY, toLocalISO, parseLocalDate } from './util.js';

const GUN = 86400000;
const $ = id => document.getElementById(id);
export const mobilMi = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;

// ── SAF: ana sayfa verisi (test edilir) ─────────────────────────────────────
// items: getAllItems çıktısı. bugun: yerel gece yarısı Date.
export function anaSayfaVerisi(items, rates, bugun, ufukGun) {
  ufukGun = ufukGun || 45;
  const bugunISO = toLocalISO(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
  const ufuk = new Date(bugun.getTime() + ufukGun * GUN);
  const ufukISO = toLocalISO(ufuk.getFullYear(), ufuk.getMonth(), ufuk.getDate());
  const ayBas = bugunISO.slice(0, 8) + '01';
  const aySon = toLocalISO(bugun.getFullYear(), bugun.getMonth() + 1, 0);
  let toplam = 0, gecikmis = 0, buAyKalan = 0, buAyOdenen = 0, buAyToplam = 0;
  const gecikmisler = [], yaklasanlar = [];
  (items || []).forEach(p => {
    const tam = p._cid ? (p.amount || 0) : toTRY(p.amount, p.currency || 'TRY', rates);
    const st = p.status || 'pending';
    const kalan = st === 'paid' ? 0 : Math.max(0, tam - (p.paid || 0));
    const d = String(p.date || '');
    if (d >= ayBas && d <= aySon) {
      buAyToplam += tam;
      buAyOdenen += st === 'paid' ? (p.paid > 0 ? p.paid : tam) : (p.paid || 0);
      buAyKalan += kalan;
    }
    if (kalan <= 0.5) return;
    toplam += kalan;
    const satir = { p, kalan, tam, kismi: st === 'partial' || (p.paid || 0) > 0 };
    if (d < bugunISO) {
      gecikmis += kalan;
      satir.gun = Math.round((bugun - parseLocalDate(d)) / GUN);
      gecikmisler.push(satir);
    } else if (d <= ufukISO) {
      satir.gun = Math.round((parseLocalDate(d) - bugun) / GUN);
      yaklasanlar.push(satir);
    }
  });
  gecikmisler.sort((a, b) => String(a.p.date).localeCompare(String(b.p.date)));
  yaklasanlar.sort((a, b) => String(a.p.date).localeCompare(String(b.p.date)));
  const oran = buAyToplam > 0 ? Math.min(100, Math.round(buAyOdenen / buAyToplam * 100)) : 0;
  return { toplam, gecikmis, buAyKalan, buAyOdenen, buAyToplam, oran, gecikmisler, yaklasanlar };
}

// ── UI ─────────────────────────────────────────────────────────────────────
const _ayAdi = d => window.parseLocalDate(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });

function _rowKey(p) {
  return p._cid ? 'cred_' + p._cid : (p.groupId ? 'g_' + p.groupId : 'pay_' + String(Math.floor(Number(p.id))));
}

function _etiket(p) {
  if (p._cid) {
    const c = window.findCredById ? window.findCredById(p._cid) : null;
    return (p.desc || 'Kredi') + ' · ' + p._ii + '/' + (c ? (c.pays || []).length : '?');
  }
  return p.desc || p.category || '';
}

function _bas(name) {
  const parca = String(name || '?').trim().split(/\s+/);
  return (parca[0][0] + (parca.length > 1 ? parca[parca.length - 1][0] : '')).toLocaleUpperCase('tr');
}

function _satirHTML(s, tur) {
  const p = s.p, esc = window.esc;
  const mk = String(p.date).slice(0, 7);
  const alt = tur === 'gec'
    ? '<span class="mh-kirmizi">' + s.gun + ' gün gecikti</span>'
    : (s.gun === 0 ? '<span class="mh-sari">Bugün</span>' : s.gun === 1 ? '<span class="mh-sari">Yarın</span>' : _ayAdi(p.date) + ' · ' + s.gun + ' gün');
  return '<button class="mh-satir" data-key="' + esc(_rowKey(p)) + '" data-ay="' + mk + '">'
    + '<span class="mh-avatar' + (p._cid ? ' kredi' : '') + '">' + esc(_bas(p.name)) + '</span>'
    + '<span class="mh-orta"><span class="mh-ad">' + esc(p.name || '') + '</span>'
    + '<span class="mh-alt">' + esc(_etiket(p)) + (_etiket(p) ? ' · ' : '') + alt + '</span></span>'
    + '<span class="mh-sag"><span class="mh-tutar' + (tur === 'gec' ? ' kirmizi' : '') + '">' + window.fmt(s.kalan) + '</span>'
    + (s.kismi ? '<span class="mh-kismi">kısmi</span>' : '') + '</span>'
    + '</button>';
}

function renderMobil() {
  const el = $('MOB_HOME');
  if (!el || !window.getAllItems) return;
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const v = anaSayfaVerisi(window.getAllItems(), window.rates, bugun, 45);
  const fmt = window.fmt;
  const saat = new Date().getHours();
  const selam = saat < 6 ? 'İyi geceler' : saat < 12 ? 'Günaydın' : saat < 18 ? 'İyi günler' : 'İyi akşamlar';
  let h = '<div class="mh-ust"><div><div class="mh-selam">' + selam + '</div>'
    + '<div class="mh-tarih">' + bugun.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</div></div>'
    + '<button class="mh-ikon" data-mh="ara" aria-label="Ara">🔍</button></div>';

  h += '<div class="mh-kart">'
    + '<div class="mh-kart-lbl">Toplam bekleyen borç</div>'
    + '<div class="mh-kart-tutar">' + fmt(v.toplam) + '</div>'
    + '<div class="mh-kart-bar"><span style="width:' + v.oran + '%"></span></div>'
    + '<div class="mh-kart-alt"><span>Bu ay ödenen <b>' + fmt(v.buAyOdenen) + '</b></span><span>%' + v.oran + '</span></div>'
    + '<div class="mh-kart-kutular">'
    +   '<div><span>Bu ay kalan</span><b>' + fmt(v.buAyKalan) + '</b></div>'
    +   '<div class="' + (v.gecikmis > 0.5 ? 'kirmizi' : '') + '"><span>Gecikmiş</span><b>' + fmt(v.gecikmis) + '</b></div>'
    + '</div></div>';

  h += '<div class="mh-hizli">'
    + '<button data-mh="ode"><span>💰</span>Ödeme Gir</button>'
    + '<button data-mh="yeni"><span>📄</span>Yeni Borç</button>'
    + '<button data-mh="kisiler"><span>👥</span>Kişiler</button>'
    + '<button data-mh="tablo"><span>📊</span>Tablo</button>'
    + '</div>';

  if (v.gecikmisler.length) {
    h += '<div class="mh-baslik kirmizi">Gecikmiş <span>' + v.gecikmisler.length + '</span></div><div class="mh-liste">'
      + v.gecikmisler.map(s => _satirHTML(s, 'gec')).join('') + '</div>';
  }
  h += '<div class="mh-baslik">Yaklaşan · 45 gün <span>' + v.yaklasanlar.length + '</span></div>';
  h += v.yaklasanlar.length
    ? '<div class="mh-liste">' + v.yaklasanlar.map(s => _satirHTML(s, 'yak')).join('') + '</div>'
    : '<div class="mh-bos">Önümüzdeki 45 günde ödeme yok.</div>';
  el.innerHTML = h;
}

// ── Alt menü + sayfalar ────────────────────────────────────────────────────
function _kisiListesiHTML() {
  const esc = window.esc;
  return [...(window.persons || [])].filter(p => p.id).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map(p => '<button class="mh-satir" data-yeni-kisi="' + esc(p.id) + '"><span class="mh-avatar">' + esc(_bas(p.name)) + '</span>'
      + '<span class="mh-orta"><span class="mh-ad">' + esc(p.name) + '</span></span><span class="mh-ok">›</span></button>').join('')
    || '<div class="mh-bos">Önce kişi ekleyin.</div>';
}

function mobilIslem(islem) {
  const M = window.ModalManager;
  switch (islem) {
    case 'hizli': M.open('MOB_HIZLI'); break;
    case 'diger': M.open('MOB_DIGER'); break;
    case 'ara': M.closeAll(); M.open('SRCHMOD'); setTimeout(() => { const i = $('SRCHINP'); if (i) i.focus(); }, 120); break;
    case 'ode': {
      M.closeAll();
      // En acil ödemenin (gecikmiş → yaklaşan) kişisiyle aç; kişi pencerede değiştirilebilir
      const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
      const v = anaSayfaVerisi(window.getAllItems(), window.rates, bugun, 45);
      const acil = [...v.gecikmisler, ...v.yaklasanlar][0];
      const kisiler = [...(window.persons || [])].filter(p => p.id);
      let kisi = null;
      if (acil && window.Hareket) {
        kisi = kisiler.find(k => acil.p._cid
          ? window.Hareket.credKisiye(window.findCredById(acil.p._cid), k, window.Hesap._baseOf)
          : window.Hareket.payKisiye(acil.p, k, window.Hesap._baseOf));
      }
      kisi = kisi || kisiler.sort((a, b) => a.name.localeCompare(b.name, 'tr'))[0];
      if (!kisi) { alert('Önce kişi ekleyin.'); return; }
      window.openHareket(kisi.id);
      break;
    }
    case 'yeni':
      M.closeAll();
      $('MOB_KISI_LISTE').innerHTML = _kisiListesiHTML();
      M.open('MOB_KISI');
      break;
    case 'kisi_ekle': M.closeAll(); window.openAddPerson(); break;
    case 'tek': M.closeAll(); window.go(0); window.openPay(); break;
    case 'kisiler': M.closeAll(); window.go(2); break;
    case 'tablo':
      M.closeAll();
      if (window.curTab !== 0) window.go(0);
      document.body.classList.toggle('mob-tablo');
      if (document.body.classList.contains('mob-tablo')) setTimeout(() => { const s = $('PLANWRAP'); if (s) s.scrollIntoView({ block: 'start' }); }, 50);
      break;
    default:
      if (/^git\d$/.test(islem)) { M.closeAll(); window.go(Number(islem.slice(3))); window.scrollTo(0, 0); }
  }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-mh]');
  if (b) { e.preventDefault(); mobilIslem(b.dataset.mh); return; }
  const k = e.target.closest('[data-yeni-kisi]');
  if (k) {
    window.ModalManager.closeAll();
    window.openCari(k.dataset.yeniKisi);
    setTimeout(() => window.openCariYeni && window.openCariYeni(), 60);
    return;
  }
  const s = e.target.closest('#MOB_HOME .mh-satir');
  if (s) window.openCell(encodeURIComponent(s.dataset.key), s.dataset.ay);
});

// Alt menüde aktif sekme
function altbarGuncelle(n) {
  document.querySelectorAll('.altbar [data-tab]').forEach(b => b.classList.toggle('on', Number(b.dataset.tab) === n));
  const digerde = [3, 5, 6].includes(n);
  const dg = document.querySelector('.altbar [data-mh="diger"]');
  if (dg) dg.classList.toggle('on', digerde);
}

window.addEventListener('store:change', () => { if (window.curTab === 0) renderMobil(); });

window.renderMobil   = renderMobil;
window.mobilIslem    = mobilIslem;
window.altbarGuncelle = altbarGuncelle;
