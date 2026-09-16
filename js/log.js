// js/log.js — iskenderpay (v8.239 sade log)
// Ne zaman ne oldu + düzeltme. Filtre: tek arama + zaman + tür (+ dokunulan kişi).
// Kayda dokun -> detay: tam zaman, ne oldu, kalemin ŞU ANKİ durumu, düzelt / geri al / sil.
// Para değiştiren her işlem hareket.js üzerinden tek Store.tx'te yapılır -> plan ve cari kart senkron.

import { toTRY, fmtA, araNormalize } from './util.js';
import { ZAMANLAR, TURLER, logFiltrele, gunGrupla, saatYaz, odemeDurumu, silmePlani, zamandaMi } from './log-core.js';
import { hareketGeriAl, logKayitlariniSil, kalemDurumu, geriAlinabilir } from './hareket.js';

const IKON = {
  paid: '✅', plan_add: '📅', cred_add: '💳', plan_del: '🗑️', hist_del: '🗑️', rhb_del: '🗑️',
  plan_edit: '✏️', rhb_edit: '✏️', cred_restructure: '🔁', restore: '↩️', plan_undo: '↩️',
  rhb_add: '👤', rhb_import: '📥',
};

const _f = { ara: '', zaman: 'tum', tur: 'tum', kisi: '' };
let _secim = null;          // null = seçim modu kapalı; Set<anahtar>
let _harita = new Map();    // anahtar -> log kaydı (her çizimde yenilenir)
let _acikAnahtar = '';

const esc = s => window.esc(s == null ? '' : String(s));
const _anahtar = (e, i) => (e.id != null ? 'k' + e.id : 'i' + i);
const _kisiAdi = pid => { const p = pid && (window.persons || []).find(x => x.id === pid); return p ? p.name : ''; };
const _tamZaman = iso => { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' }); };
const _gun = s => { if (!s) return '—'; const d = window.parseLocalDate ? window.parseLocalDate(s) : new Date(s); return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }); };

// ── ÜST: arama + çipler ────────────────────────────────────────────────────
function _cipler() {
  const cip = (grup, k, ad, secili) => '<button class="log-cip' + (secili ? ' on' : '') + '" onclick="logCip(\'' + grup + '\',\'' + k + '\')">' + ad + '</button>';
  const z = document.getElementById('LOG_ZAMAN');
  if (z) z.innerHTML = ZAMANLAR.map(x => cip('zaman', x.k, x.ad, _f.zaman === x.k)).join('');
  const t = document.getElementById('LOG_TUR');
  if (t) t.innerHTML = TURLER.map(x => cip('tur', x.k, x.ad, _f.tur === x.k)).join('');
  const k = document.getElementById('LOG_KISI');
  if (k) k.innerHTML = _f.kisi
    ? '<button class="log-cip on" onclick="logKisi(\'\')">👤 ' + esc(_kisiAdi(_f.kisi) || 'Kişi') + ' ✕</button>'
    : '';
  const temizle = document.getElementById('LOG_TEMIZLE');
  if (temizle) temizle.style.display = (_f.ara || _f.zaman !== 'tum' || _f.tur !== 'tum' || _f.kisi) ? '' : 'none';
}

function logCip(grup, k) { _f[grup] = k; if (grup === 'tur' && k === 'silinen') _secim = null; renderActLog(); }
function logKisi(pid) { _f.kisi = pid || ''; renderActLog(); }
function logAra(v) { _f.ara = v || ''; _liste(); }
function logTemizle() {
  Object.assign(_f, { ara: '', zaman: 'tum', tur: 'tum', kisi: '' });
  const a = document.getElementById('LOG_ARA'); if (a) a.value = '';
  renderActLog();
}

// ── LİSTE ─────────────────────────────────────────────────────────────────
function renderActLog() {
  _cipler();
  const secBtn = document.getElementById('LOG_SEC_BTN');
  if (secBtn) secBtn.style.display = _f.tur === 'silinen' ? 'none' : '';
  _liste();
}

function _liste() {
  const el = document.getElementById('ACT_LOG_LIST'); if (!el) return;
  if (_f.tur === 'silinen') { _silinenler(el); _secimBar(); return; }
  const tum = window.actLog || [];
  _harita = new Map();
  tum.forEach((e, i) => { if (e) _harita.set(_anahtar(e, i), e); });
  const anahtarOf = new Map([..._harita].map(([k, e]) => [e, k]));
  const liste = logFiltrele(tum, _f, new Date(), _kisiAdi);
  const cnt = document.getElementById('LOG_CNT');
  if (cnt) cnt.textContent = liste.length === tum.length ? tum.length + ' kayıt' : liste.length + ' / ' + tum.length + ' kayıt';
  if (!tum.length) { el.innerHTML = '<div class="empty"><div class="ico">📋</div><p>Henüz kayıt yok.</p></div>'; _secimBar(); return; }
  if (!liste.length) { el.innerHTML = '<div class="empty"><div class="ico">🔍</div><p>Bu aramaya uyan kayıt yok.</p><button class="btn bc" onclick="logTemizle()">Filtreleri temizle</button></div>'; _secimBar(); return; }
  el.innerHTML = gunGrupla(liste, new Date()).map(g =>
    '<div class="log-gun">' + esc(g.etiket) + '<span>' + g.kayitlar.length + '</span></div>'
    + g.kayitlar.map(e => _satir(e, anahtarOf.get(e))).join('')
  ).join('');
  _secimBar();
}

function _satir(e, k) {
  const d = odemeDurumu(e);
  const secili = _secim && _secim.has(k);
  const rozet = d === 'geri' ? '<span class="log-rozet geri">geri alındı</span>'
    : (e.hareket && e.hareket.duzenlendi ? '<span class="log-rozet">düzeltildi</span>' : '')
    + (e.duzeltildi ? '<span class="log-rozet">düzeltildi</span>' : '');
  const tutar = e.hareket ? fmtA(Number(e.hareket.tutar) || 0, e.hareket.para || 'TRY') : '';
  const ad = _kisiAdi(e.personId);
  return '<div class="log-satir' + (d === 'geri' ? ' geri' : '') + (secili ? ' secili' : '') + '" onclick="logAc(\'' + k + '\')">'
    + (_secim ? '<input type="checkbox" class="log-cb"' + (secili ? ' checked' : '') + ' tabindex="-1">' : '')
    + '<div class="log-saat">' + saatYaz(e.at) + '</div>'
    + '<div class="log-ico">' + (IKON[e.type] || '📋') + '</div>'
    + '<div class="log-orta"><div class="log-bas">' + esc(e.title || '(başlık yok)') + rozet + '</div>'
    + (e.detail ? '<div class="log-det">' + esc(e.detail) + '</div>' : '')
    + (e.not ? '<div class="log-not">📝 ' + esc(e.not) + '</div>' : '')
    + (ad && !_f.kisi ? '<button class="log-kisi" onclick="event.stopPropagation();logKisi(\'' + esc(e.personId) + '\')">👤 ' + esc(ad) + '</button>' : '')
    + '</div>'
    + (tutar ? '<div class="log-tutar' + (d === 'geri' ? ' geri' : '') + '">' + tutar + '</div>' : '')
    + '</div>';
}

// Silinen plan kayıtları (hist): geri getir / sil
function _silinenler(el) {
  const tum = window.hist || [];
  const q = araNormalize(_f.ara.trim());
  const n = s => araNormalize(String(s));
  const liste = tum.map((p, oi) => ({ p, oi })).filter(({ p }) =>
    (!_f.kisi || p.personId === _f.kisi)
    && zamandaMi(p.delAt || p.date, _f.zaman, new Date())
    && (!q || n([p.name, p.desc, p.category, p.amount].join(' ')).includes(q)));
  const cnt = document.getElementById('LOG_CNT');
  if (cnt) cnt.textContent = liste.length + ' silinen kayıt';
  if (!liste.length) { el.innerHTML = '<div class="empty"><div class="ico">🗑️</div><p>Silinen kayıt yok.</p></div>'; return; }
  el.innerHTML = '<div class="log-bilgi">Plandan silinen kalemler. ↩ ile plana geri gelir (ödenmemiş olarak).</div>'
    + liste.map(({ p, oi }) => '<div class="log-satir">'
      + '<div class="log-ico">🗑️</div>'
      + '<div class="log-orta"><div class="log-bas">' + esc(p.name || '') + '</div>'
      + '<div class="log-det">' + (p.date ? _gun(p.date) + ' kalemi' : '') + (p.delAt ? ' · silindi ' + _tamZaman(p.delAt) : '') + '</div></div>'
      + '<div class="log-tutar">' + window.fmt(toTRY(p.amount, p.currency || 'TRY', window.rates)) + '</div>'
      + '<button class="log-mini ok" onclick="restoreFromHist(' + oi + ')">↩</button>'
      + '<button class="log-mini" onclick="if(confirm(\'Kalıcı silinsin mi?\'))delHist(' + oi + ')">🗑</button>'
      + '</div>').join('');
}

// ── SEÇİM (toplu) ─────────────────────────────────────────────────────────
function logSecimAc() { _secim = _secim ? null : new Set(); _liste(); }

function _gorunenAnahtarlar() {
  const tum = window.actLog || [];
  const set = new Set(logFiltrele(tum, _f, new Date(), _kisiAdi));
  return [..._harita].filter(([, e]) => set.has(e)).map(([k]) => k);
}

function logTumunuSec() {
  if (!_secim) return;
  const g = _gorunenAnahtarlar();
  const hepsi = g.length && g.every(k => _secim.has(k));
  g.forEach(k => hepsi ? _secim.delete(k) : _secim.add(k));
  _liste();
}

function _secimBar() {
  const bar = document.getElementById('LOG_SEC_BAR'); if (!bar) return;
  const btn = document.getElementById('LOG_SEC_BTN');
  if (btn) btn.textContent = _secim ? '✕ Seçimi kapat' : '☑ Seç';
  if (!_secim || _f.tur === 'silinen') { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const n = _secim.size;
  const aktif = [..._secim].map(k => _harita.get(k)).filter(e => odemeDurumu(e) === 'aktif').length;
  bar.innerHTML = '<div class="log-sec-ust"><b>' + n + ' seçili</b>' + (aktif ? ' · ' + aktif + ' geçerli ödeme' : '')
    + '<button class="log-cip" onclick="logTumunuSec()">Görünenlerin hepsi</button></div>'
    + '<div class="log-sec-alt">'
    + '<button class="btn bc" ' + (n ? '' : 'disabled') + ' onclick="logTopluSil(false)">Yalnız logu sil</button>'
    + '<button class="btn log-tehlike" ' + (aktif ? '' : 'disabled') + ' onclick="logTopluSil(true)">Sil + ödemeyi geri al</button>'
    + '</div>';
}

async function logTopluSil(geriAl) {
  if (!_secim || !_secim.size) return;
  const kayitlar = [..._secim].map(k => _harita.get(k)).filter(Boolean);
  const plan = silmePlani(kayitlar, geriAl, h => geriAlinabilir(h, window.pays, window.creds, window.rates));
  const aktifKalan = kayitlar.filter(e => odemeDurumu(e) === 'aktif').length;
  let ack = '<b>' + plan.sil.length + '</b> log kaydı silinecek.<br>';
  if (geriAl) {
    ack += plan.geriAl.length + ' ödeme geri alınır: tutarları kalemden düşer, plan ve cari kart birlikte güncellenir.';
    if (plan.atla.length) ack += '<br><span style="color:var(--ora)">' + plan.atla.length + ' ödeme geri alınamıyor (kalemi silinmiş/değişmiş) — bunlar SİLİNMEZ.</span>';
  } else {
    ack += aktifKalan
      ? '<span style="color:var(--ora)">' + aktifKalan + ' geçerli ödeme planda ve cari kartta ÖDENMİŞ KALIR</span>, yalnız kayıtları gider.'
      : 'Plana ve cari karta dokunulmaz.';
  }
  ack += '<br>Onaylamak için şifreni gir.';
  if (!plan.sil.length) { alert('Silinecek kayıt yok.' + (plan.atla.length ? '\n' + plan.atla[0].neden : '')); return; }
  if (!(await window.pinOnay(geriAl ? 'Sil + <span>Geri Al</span>' : 'Logu <span>Sil</span>', ack))) return;
  const s = logKayitlariniSil(plan.sil, geriAl);
  _secim = null;
  renderActLog();
  if (window.showWarnToast) window.showWarnToast(s.silinen + ' kayıt silindi' + (s.geriAlinan ? ' · ' + s.geriAlinan + ' ödeme geri alındı' : '') + (s.atlanan.length ? ' · ' + s.atlanan.length + ' atlandı' : ''));
}

// ── DETAY ─────────────────────────────────────────────────────────────────
function logAc(k) {
  if (_secim) {
    _secim.has(k) ? _secim.delete(k) : _secim.add(k);
    _liste();
    return;
  }
  const e = _harita.get(k); if (!e) return;
  _acikAnahtar = k;
  _detayCiz(e);
  window.ModalManager.open('LOGMOD');
}

function _satirBilgi(ad, deger) { return '<div class="log-bilgi-satir"><span>' + ad + '</span><b>' + deger + '</b></div>'; }

function _detayCiz(e) {
  const d = odemeDurumu(e);
  const ic = document.getElementById('LOGMOD_IC'); if (!ic) return;
  const ad = _kisiAdi(e.personId);
  let h = '<h2>' + (IKON[e.type] || '📋') + ' ' + esc(e.title || 'Kayıt') + '</h2>';
  h += '<div class="log-kutu">'
    + _satirBilgi('Ne zaman', _tamZaman(e.at))
    + (e.detail ? _satirBilgi('Ne oldu', esc(e.detail)) : '')
    + (ad ? _satirBilgi('Kişi', '<a href="#" onclick="event.preventDefault();logKisiKarti(\'' + esc(e.personId) + '\')">' + esc(ad) + ' ›</a>') : '');
  if (e.hareket) {
    h += _satirBilgi('Tutar', fmtA(Number(e.hareket.tutar) || 0, e.hareket.para || 'TRY'))
      + _satirBilgi('Ödeme günü', _gun(e.hareket.tarih));
    if (e.hareket.duzenlendi) h += _satirBilgi('Düzeltildi', _tamZaman(e.hareket.duzenlendi));
    if (e.hareket.iptal) h += _satirBilgi('Geri alındı', _tamZaman(e.hareket.iptal));
  }
  if (e.duzeltildi) h += _satirBilgi('Açıklama düzeltildi', _tamZaman(e.duzeltildi));
  if (e.not) h += _satirBilgi('Not', esc(e.not));
  h += '</div>';

  if (e.hareket) {
    const k = kalemDurumu(e.hareket);
    h += k
      ? '<div class="log-kutu log-simdi"><div class="log-kutu-bas">Kalem şu an (plan = cari kart)</div>'
        + '<div class="log-det">' + esc(k.etiket) + '</div>'
        + _satirBilgi('Tutar', fmtA(k.tam, k.para)) + _satirBilgi('Ödenen', fmtA(k.odenen, k.para))
        + _satirBilgi('Kalan', k.kalan > 0 ? fmtA(k.kalan, k.para) : '✅ ödendi') + '</div>'
      : '<div class="log-bilgi">Bu ödemenin yazıldığı kalem artık planda yok (silinmiş veya kredi yapılandırılmış).</div>';
  }

  // Eylemler
  const b = (cls, onclick, yazi) => '<button class="btn ' + cls + '" onclick="' + onclick + '">' + yazi + '</button>';
  h += '<div class="log-eylem">';
  if (d === 'aktif') {
    const g = geriAlinabilir(e.hareket, window.pays, window.creds, window.rates);
    if (g.ok) {
      h += b('bs', 'logOdemeDuzelt()', '✏️ Ödemeyi düzelt <small>tutar · kalem · gün · kişi</small>')
        + b('bc', 'logGeriAl()', '↩ Ödemeyi geri al <small>kayıt üstü çizili kalır</small>');
    } else {
      h += '<div class="log-bilgi">' + esc(g.neden) + '</div>';
    }
  } else if (d === 'geri') {
    h += '<div class="log-bilgi">Bu ödeme geri alınmış; plana etkisi yok.</div>';
  } else {
    h += b('bc', 'logAciklamaDuzelt()', '✏️ Açıklamayı düzelt')
      + '<div class="log-bilgi">Bu kayıt bilgi amaçlı' + (d === 'eski' ? ' (eski tür ödeme kaydı)' : '') + '; plana bağlı değil, buradan geri alınamaz.</div>';
  }
  h += b('bc', 'logNotDuzelt()', e.not ? '📝 Notu değiştir' : '📝 Not ekle');
  h += '<div class="log-sil-baslik">Sil</div>';
  if (d === 'aktif' && geriAlinabilir(e.hareket, window.pays, window.creds, window.rates).ok) {
    h += b('log-tehlike', 'logTekSil(true)', '🗑 Logu sil + ödemeyi geri al <small>plan ve cari karttan düşer</small>');
  }
  h += b('bc log-sil-yalniz', 'logTekSil(false)', '🗑 Yalnız logu sil <small>' + (d === 'aktif' ? 'ödeme planda KALIR' : 'plana dokunulmaz') + '</small>');
  h += b('bc', 'ModalManager.close(\'LOGMOD\')', 'Kapat');
  h += '</div>';
  ic.innerHTML = h;
}

const _acik = () => _harita.get(_acikAnahtar);

function _sonra() {
  window.ModalManager.close('LOGMOD');
  renderActLog();
}

function logGeriAl() {
  const e = _acik(); if (!e) return;
  if (!confirm('Ödeme geri alınsın mı? Tutar kalemden düşer; plan ve cari kart birlikte güncellenir. Log kaydı üstü çizili kalır.')) return;
  const r = hareketGeriAl(e);
  if (!r.ok) { alert(r.neden); return; }
  _sonra();
  if (window.showWarnToast) window.showWarnToast('Ödeme geri alındı');
}

async function logTekSil(geriAl) {
  const e = _acik(); if (!e) return;
  const aktif = odemeDurumu(e) === 'aktif';
  const ack = esc(e.detail || e.title || '') + '<br><br>'
    + (geriAl
      ? '<b>Ödeme geri alınır</b> ve kayıt silinir: tutar kalemden düşer, plan ve cari kart birlikte güncellenir.'
      : aktif
        ? '<b style="color:var(--ora)">Ödeme planda ve cari kartta ÖDENMİŞ KALIR</b>; yalnız bu kayıt silinir.'
        : 'Kayıt silinir. Plana dokunulmaz.')
    + '<br>Onaylamak için şifreni gir.';
  if (!(await window.pinOnay(geriAl ? 'Sil + <span>Geri Al</span>' : 'Logu <span>Sil</span>', ack))) return;
  const s = logKayitlariniSil([e], geriAl);
  if (s.atlanan.length) { alert(s.atlanan[0].neden); return; }
  _sonra();
  if (window.showWarnToast) window.showWarnToast(geriAl ? 'Kayıt silindi · ödeme geri alındı' : 'Kayıt silindi');
}

function logOdemeDuzelt() {
  const e = _acik(); if (!e || !window.openHareket) return;
  window.ModalManager.close('LOGMOD');
  window.openHareket(e.personId || '', String(e.id), null, 'log');
}

function _formCiz(baslik, alanlar, kaydet) {
  const ic = document.getElementById('LOGMOD_IC'); if (!ic) return;
  ic.innerHTML = '<h2>' + baslik + '</h2>'
    + alanlar.map(a => '<div class="fg"><label class="fl">' + a.ad + '</label>'
      + (a.cok ? '<textarea class="fi" id="' + a.id + '" rows="3">' + esc(a.deger) + '</textarea>'
               : '<input class="fi" id="' + a.id + '" value="' + esc(a.deger) + '">') + '</div>').join('')
    + '<div class="brow"><button class="btn bc" onclick="logDetayaDon()">Vazgeç</button><button class="btn bs" onclick="' + kaydet + '">Kaydet</button></div>';
}

function logDetayaDon() { const e = _acik(); if (e) _detayCiz(e); }

function logAciklamaDuzelt() {
  const e = _acik(); if (!e) return;
  _formCiz('Açıklamayı <span>Düzelt</span>', [
    { id: 'LOG_E_T', ad: 'Başlık', deger: e.title || '' },
    { id: 'LOG_E_D', ad: 'Ne oldu', deger: e.detail || '', cok: true },
  ], 'logAciklamaKaydet()');
}
function logAciklamaKaydet() {
  const e = _acik(); if (!e) return;
  const title = document.getElementById('LOG_E_T').value.trim();
  const detail = document.getElementById('LOG_E_D').value.trim();
  if (!title) { alert('Başlık boş olamaz.'); return; }
  window.Store.mutateItem(e, { title, detail, duzeltildi: new Date().toISOString() });
  renderActLog(); _detayCiz(e);
}

function logNotDuzelt() {
  const e = _acik(); if (!e) return;
  _formCiz('Not', [{ id: 'LOG_E_N', ad: 'Bu kayıtla ilgili not (yalnız bilgi)', deger: e.not || '', cok: true }], 'logNotKaydet()');
}
function logNotKaydet() {
  const e = _acik(); if (!e) return;
  const not = document.getElementById('LOG_E_N').value.trim();
  window.Store.mutateItem(e, { not: not || undefined });
  if (!not) delete e.not;
  renderActLog(); _detayCiz(e);
}

function logKisiKarti(pid) {
  window.ModalManager.close('LOGMOD');
  if (window.openPersonHist) window.openPersonHist(pid);
}

// Başka ekrandan "bu kişinin logu" ile gelmek için
function logKisiyeGit(pid) { _f.kisi = pid || ''; window.go(7); }

// ── GLOBAL ───────────────────────────────────────────────────────────────
Object.assign(window, {
  renderActLog, logCip, logKisi, logAra, logTemizle, logSecimAc, logTumunuSec, logTopluSil,
  logAc, logGeriAl, logTekSil, logOdemeDuzelt, logDetayaDon, logAciklamaDuzelt, logAciklamaKaydet,
  logNotDuzelt, logNotKaydet, logKisiKarti, logKisiyeGit,
});
