// js/cari.js — iskenderpay
// CARİ KART: bir kişinin HER ŞEYİ tek ekranda. Kişiler → karta dokun.
//   • Üst: kişi bilgisi (+ Rehber'deki telefon/IBAN), özet (bekleyen / gecikmiş / ödenen)
//   • Sekmeler: kişinin her borcu ayrı sekme (Kira, Kredi, ...) + Hareketler + "+ Yeni"
//   • Borç sekmesi: aylar/taksitler, Öde, ay düzenle, borç düzenle, ay ekle,
//     kredi yapılandır / erken kapat, sil
// Planda her borç ZATEN ayrı satırdır (groupId / kredi id) — kart aynı veriyi yönetir,
// ayrı bir kopya TUTMAZ. Bütün yazmalar Store üzerinden gider (kayıt + senkron aynı yol),
// her değişiklik kişiye bağlı loglanır.
//
// Güvenlik kuralları:
//   • Ödenmiş aylara/taksitlere tutar toplu uygulanmaz (yalnız bekleyenlere).
//   • Ödemesi olan ay silinemez (önce ödeme geri alınır).
//   • Kredi taksit sayısı/tarihi yalnız "Yapılandır" ile değişir (mevcut güvenli akış).

import { toTRY, toLocalISO } from './util.js';
import { payKisiye, credKisiye, refKey, refParse, hedefBul, hareketYerel } from './hareket.js';
import { kalemOzet, odemePatch, paraTopla, paraYazi } from './para.js';

const EPS = 0.5;

// ── SAF ÇEKİRDEK (test edilir) ─────────────────────────────────────────────

// start (YYYY-MM-DD) tarihinden i ay sonrası; gün ay sonuna kırpılır (31 → 30/28).
export function ayTarihi(start, i) {
  const [sy, sm, sd] = String(start).split('-').map(Number);
  const tm = (sm - 1) + i;
  const yr = sy + Math.floor(tm / 12);
  const mo = ((tm % 12) + 12) % 12;
  const last = new Date(yr, mo + 1, 0).getDate();
  return toLocalISO(yr, mo, Math.min(sd, last));
}

export function ayFarki(a, b) {
  const [ay, am] = String(a).split('-').map(Number);
  const [by, bm] = String(b).split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

// Kalemin durumu — v8.234: tek kaynak js/para.js#kalemOzet.
//   tam/kalan/odenen = TL karşılığı (sekme ve özet toplamları için)
//   yerel = kalemin kendi parasında özet (altın gram, euro €)
function _kalemOzet(h, rates, bugunISO) {
  const yerel = kalemOzet(h.cred ? { ...h.obj, _cid: h.cred.id } : h.obj, rates);
  const st = yerel.durum;
  const gecikmis = yerel.kalan > 0 && String(h.obj.date) < bugunISO;
  return { tam: yerel.tamTL, st, kalan: yerel.kalanTL, odenen: yerel.odenenTL, gecikmis, yerel };
}

// Kişinin borçları: her ödeme grubu ve her kredi AYRI yükümlülük.
export function yukumlulukler(person, pays, creds, rates, bugunISO, baseOf) {
  const gruplar = new Map();
  (pays || []).forEach(p => {
    if (!payKisiye(p, person, baseOf)) return;
    const key = p.groupId ? 'g_' + p.groupId : 'pay_' + String(Math.floor(Number(p.id)));
    if (!gruplar.has(key)) gruplar.set(key, { key, tip: 'odeme', groupId: p.groupId || null, kalemler: [] });
    gruplar.get(key).kalemler.push({ ref: { k: 'pay', id: p.id }, h: { obj: p, cred: null } });
  });
  const out = [...gruplar.values()];
  (creds || []).forEach(c => {
    if (!credKisiye(c, person, baseOf)) return;
    out.push({
      key: 'cred_' + c.id, tip: 'kredi', cred: c,
      kalemler: (c.pays || []).map(t => ({ ref: { k: 'cred', cid: c.id, ii: t.idx }, h: { obj: t, cred: c } }))
    });
  });
  out.forEach(y => {
    y.kalemler.sort((a, b) => String(a.h.obj.date).localeCompare(String(b.h.obj.date)));
    const ilk = y.kalemler[0] && y.kalemler[0].h.obj;
    y.etiket = y.tip === 'kredi' ? (y.cred.desc || 'Kredi') : ((ilk && (ilk.desc || ilk.category)) || 'Ödeme');
    const o = { kalan: 0, gecikmis: 0, odenen: 0, acikN: 0, gecikmisN: 0, toplamN: y.kalemler.length };
    y.kalemler.forEach(k => {
      k.oz = _kalemOzet(k.h, rates, bugunISO);
      o.kalan += k.oz.kalan;
      o.odenen += k.oz.odenen;
      if (k.oz.yerel.kalan > 0) o.acikN++;
      if (k.oz.gecikmis) { o.gecikmis += k.oz.kalan; o.gecikmisN++; }
    });
    o.para = paraTopla(y.kalemler.map(k => k.oz.yerel));   // {TRY, EUR, GOLD} kalan, kendi parasında
    y.ozet = o;
  });
  const seen = {};
  // Sıra: gecikmişi olan → açık borç → biten; kendi içinde etiket
  const oncelik = y => (y.ozet.gecikmisN ? 2 : 0) + (y.ozet.acikN ? 1 : 0);
  out.sort((a, b) => (oncelik(b) - oncelik(a)) || a.etiket.localeCompare(b.etiket, 'tr'));
  out.forEach(y => { const n = (seen[y.etiket] = (seen[y.etiket] || 0) + 1); if (n > 1) y.etiket += ' #' + n; });
  return out;
}

// Yeni düzenli ödeme grubu kayıtları (savePay ile aynı şekil)
export function odemeKayitlari({ name, personId, amount, currency, start, adet, category, desc, groupId }) {
  return Array.from({ length: adet }, (_, i) => {
    const r = { id: Date.now() + i + Math.random(), groupId, name, amount, currency: currency || 'TRY',
      date: ayTarihi(start, i), category: category || 'Diğer', status: 'pending', paid: 0 };
    if (personId) r.personId = personId;
    if (desc) r.desc = desc;
    return r;
  });
}

// Mevcut gruba ay ekle: ilk ayın gününe göre, son aydan sonra devam eder.
export function ayEkleKayitlari(grupKalemleri, adet, amount) {
  const liste = [...grupKalemleri].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ilk = liste[0], son = liste[liste.length - 1];
  const bas = ayFarki(ilk.date, son.date) + 1;
  return Array.from({ length: adet }, (_, i) => {
    const r = { id: Date.now() + i + Math.random(), groupId: son.groupId, name: son.name,
      amount: amount != null ? amount : son.amount, currency: son.currency || 'TRY',
      date: ayTarihi(ilk.date, bas + i), category: son.category || 'Diğer', status: 'pending', paid: 0 };
    if (son.personId) r.personId = son.personId;
    if (son.desc) r.desc = son.desc;
    return r;
  });
}

// Kalemin tutar/tarih değişikliği -> patch. Ödeme tutarı (paid) KORUNUR, durum yeniden hesaplanır.
// Eski kayıt (status 'paid' ama paid yok) ödenmiş kalır.
export function ayPatch(h, amount, date, rates) {
  const patch = { amount };
  if (!h.cred && date) patch.date = date;
  const st = h.obj.status || 'pending';
  const pd = h.obj.paid || 0;
  if (st === 'paid' && !(pd > 0)) return patch;
  const yeni = { ...h.obj, amount, ...(h.cred ? { _cid: h.cred.id } : {}) };
  if (!(pd > 0)) return Object.assign(patch, { status: 'pending', paid: 0 });
  const p2 = odemePatch(yeni, 0, rates);        // ödenen korunur, durum yeni tutara göre
  delete p2._cid;
  return Object.assign(patch, p2);
}

// ── ERTELE (v8.235) — saf ─────────────────────────────────────────────────
// kalemler: [{ key, obj }] (aynı borcun kalemleri). secKey: ertelenen kalemin anahtarı.
// kapsam 'tek': yalnız o kalem yeniTarih'e gider.
// kapsam 'sonraki': o kalem yeniTarih'e, ondan SONRAKİ ödenmemiş kalemler aynı ay farkı kadar ileri
// (her biri kendi ayın gününü korur). Ödenmiş kaleme ve tutarlara dokunulmaz.
// Dönüş: [{ key, eski, yeni }] ya da hata fırlatır.
export function ertelePlani(kalemler, secKey, yeniTarih, kapsam) {
  const sec = (kalemler || []).find(k => k.key === secKey);
  if (!sec) throw new Error('Kalem bulunamadı.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(yeniTarih || ''))) throw new Error('Yeni tarih seçin.');
  if ((sec.obj.status || 'pending') === 'paid') throw new Error('Ödenmiş kalem ertelenemez.');
  if (String(yeniTarih) <= String(sec.obj.date)) throw new Error('Yeni tarih mevcut tarihten (' + sec.obj.date + ') sonra olmalı.');
  const fark = ayFarki(sec.obj.date, yeniTarih);
  const out = [{ key: sec.key, eski: sec.obj.date, yeni: yeniTarih }];
  if (kapsam === 'sonraki' && fark > 0) {
    kalemler.forEach(k => {
      if (k.key === sec.key) return;
      if ((k.obj.status || 'pending') === 'paid') return;
      if (String(k.obj.date) <= String(sec.obj.date)) return;
      out.push({ key: k.key, eski: k.obj.date, yeni: ayTarihi(k.obj.date, fark) });
    });
  }
  return out;
}

// ── UI ─────────────────────────────────────────────────────────────────────

let _pid = null;
let _tab = null;
let _delegated = false;

const $ = id => document.getElementById(id);
const _bugun = () => { const d = new Date(); return toLocalISO(d.getFullYear(), d.getMonth(), d.getDate()); };
const _tarihUzun = s => s ? window.parseLocalDate(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const _kisi = () => (window.persons || []).find(p => p.id === _pid);
const _ys = (person) => yukumlulukler(person, window.pays, window.creds, window.rates, _bugun(), window.Hesap._baseOf);
const _yBul = (key) => { const p = _kisi(); return p ? _ys(p).find(y => y.key === key) : null; };
const _acik = () => { const el = $('PHIST'); return !!(el && el.classList.contains('open')); };

function _log(type, title, detail, y, extra) {
  const ctx = Object.assign({ personId: _pid }, extra || {});
  if (y && y.tip === 'kredi') ctx.credId = y.cred.id;
  else if (y && y.groupId) ctx.groupId = y.groupId;
  window.addLog(type, title, detail, 2, ctx);
}

function _rehberKaydi(person) {
  const ad = (person.name || '').toLocaleUpperCase('tr').trim();
  return (window.rehber || []).find(r => {
    const n = (window.rhbGetName ? window.rhbGetName(r) : r.name) || '';
    return n.toLocaleUpperCase('tr').trim() === ad || (r.name || '').toLocaleUpperCase('tr').trim() === ad;
  }) || null;
}

function openCari(personId) {
  if (!personId) { alert('Bu kişinin ID\'si yok'); return; }
  if (!(window.persons || []).some(p => p.id === personId)) return;
  if (_pid !== personId) _tab = null;
  _pid = personId;
  _render();
  ModalManager.open('PHIST');
}

function _render() {
  const person = _kisi();
  const list = $('PHIST_LIST');
  if (!person || !list) { ModalManager.close('PHIST'); return; }
  const esc = window.esc, fmt = window.fmt;
  const ys = _ys(person);
  const hareketler = window.Hareket ? window.Hareket.kisiHareketleri(_pid) : [];
  if (!_tab || (_tab !== 'hareket' && !ys.some(y => y.key === _tab))) _tab = ys.length ? ys[0].key : 'hareket';

  $('PHIST_T').innerHTML = esc(person.name) + ' <span>Cari Kart</span>';

  const top = ys.reduce((a, y) => ({ kalan: a.kalan + y.ozet.kalan, gec: a.gec + y.ozet.gecikmis, od: a.od + y.ozet.odenen }), { kalan: 0, gec: 0, od: 0 });
  // Para birimi bazında kalan (TL + gram + €) — planda TL karşılığı, kartta asıl borç
  const paraTop = {};
  ys.forEach(y => Object.entries(y.ozet.para || {}).forEach(([pb, v]) => { paraTop[pb] = (paraTop[pb] || 0) + v; }));
  const dovizli = Object.keys(paraTop).some(pb => pb !== 'TRY');
  // v8.234: iletişim bilgisi kişinin ÜSTÜNDE (Rehber kişilere katıldı); eski veri için Rehber yedek
  const r = _rehberKaydi(person);
  const tel = (person.phones && person.phones.length ? person.phones : (r && r.phones) || []).filter(p => p.num);
  const iban = person.iban || (r && r.iban) || '';
  const eposta = person.email || (r && r.email) || '';
  let h = '';

  // Kişi bilgisi
  h += '<div class="cari-kisi">'
    + '<div style="flex:1;min-width:0">'
    + (person.desc ? '<div style="font-size:12px;color:var(--muted)">' + esc(person.desc) + '</div>' : '')
    + (person.company ? '<div style="font-size:11px;color:var(--muted)">🏢 ' + esc(person.company) + '</div>' : '')
    + tel.map(p => '<a class="cari-bilgi" href="tel:' + encodeURIComponent(p.num) + '">📞 ' + esc(p.num) + '</a>').join('')
    + (iban ? '<button class="cari-bilgi" data-act="kopya" data-copy="' + esc(iban) + '">🏦 ' + esc(iban) + ' 📋</button>' : '')
    + (eposta ? '<a class="cari-bilgi" href="mailto:' + encodeURIComponent(eposta) + '">✉️ ' + esc(eposta) + '</a>' : '')
    + (!tel.length && !iban && !eposta ? '<div style="font-size:11px;color:var(--muted)">Telefon/IBAN yok — ✏️ Kişi ile ekle</div>' : '')
    + (person.note ? '<div style="font-size:11px;color:var(--muted);white-space:pre-wrap;margin-top:4px">' + esc(person.note) + '</div>' : '')
    + '</div>'
    + '<div class="cari-kisi-btn"><button class="cari-btn" data-act="kisi">✏️ Kişi</button>'
    + '<button class="cari-btn" data-act="birlestir" title="Başka kişiyi veya bağsız borcu bu karta al">⇄ Birleştir</button>'
    + '<button class="cari-btn sil" data-act="kisisil" title="Kişiyi arşivle veya sil">🗑</button></div>'
    + '</div>';

  // Özet
  h += '<div class="cari-ozet">'
    + '<div><div class="cari-lbl">Bekleyen</div><div class="cari-val" style="color:var(--ora)">' + fmt(top.kalan) + '</div></div>'
    + '<div><div class="cari-lbl">Gecikmiş</div><div class="cari-val" style="color:' + (top.gec > EPS ? 'var(--danger)' : 'var(--muted)') + '">' + fmt(top.gec) + '</div></div>'
    + '<div><div class="cari-lbl">Ödenen</div><div class="cari-val" style="color:var(--ok)">' + fmt(top.od) + '</div></div>'
    + '</div>'
    + (dovizli ? '<div class="cari-para">Borç: <b>' + esc(paraYazi(paraTop, window.fmtA)) + '</b> <span>· TL karşılığı bugünkü kurla</span></div>' : '');

  // Sekmeler
  h += '<div class="cari-tabs">'
    + ys.map(y => '<button class="cari-tab' + (y.key === _tab ? ' on' : '') + '" data-act="tab" data-key="' + esc(y.key) + '">'
        + (y.tip === 'kredi' ? '💳 ' : '📅 ') + esc(y.etiket)
        + '<span>' + (y.ozet.acikN ? esc(paraYazi(y.ozet.para, window.fmtA)) : '✓') + '</span></button>').join('')
    + '<button class="cari-tab' + (_tab === 'hareket' ? ' on' : '') + '" data-act="tab" data-key="hareket">📋 Hareketler<span>' + hareketler.length + '</span></button>'
    + '<button class="cari-tab cari-yeni" data-act="yeni">+ Yeni Borç / Kredi</button>'
    + '</div>';

  h += _tab === 'hareket' ? _hareketHTML(person, hareketler) : _yukumlulukHTML(ys.find(y => y.key === _tab), hareketler);
  list.innerHTML = h;

  if (!_delegated) {
    list.addEventListener('click', _tikla);
    _delegated = true;
  }
}

function _yukumlulukHTML(y, hareketler) {
  const esc = window.esc, fmt = window.fmt;
  const ilk = y.kalemler[0] && y.kalemler[0].h.obj;
  const son = y.kalemler.length && y.kalemler[y.kalemler.length - 1].h.obj;
  let bilgi;
  if (y.tip === 'kredi') {
    const c = y.cred;
    bilgi = (c.closed ? '✅ Erken kapatıldı · ' : '') + fmt(c.monthly || (ilk && ilk.amount) || 0) + ' × ' + y.ozet.toplamN + ' taksit'
      + ' · ' + y.ozet.acikN + ' açık' + (son ? ' · bitiş ' + _tarihUzun(son.date) : '');
  } else {
    const cur = ilk && ilk.currency && ilk.currency !== 'TRY' ? ' ' + ilk.currency : '';
    bilgi = 'Aylık ' + (cur ? window.fmtA(ilk.amount, ilk.currency) : fmt(ilk ? ilk.amount : 0)) + ' · ' + y.ozet.toplamN + ' ay · ' + y.ozet.acikN + ' açık'
      + (ilk && ilk.category ? ' · ' + esc(ilk.category) : '');
  }
  const acikIlk = y.kalemler.find(k => k.oz.yerel.kalan > 0);
  let h = '<div class="cari-bilgi-satir">' + bilgi + (y.ozet.gecikmisN ? ' · <b style="color:var(--danger)">' + y.ozet.gecikmisN + ' gecikmiş</b>' : '') + '</div>';
  h += '<div class="cari-aksiyon">'
    + (acikIlk ? '<button class="cari-btn ok" data-act="ode" data-ref="' + esc(refKey(acikIlk.ref)) + '">💰 Ödeme Gir</button>' : '')
    + '<button class="cari-btn" data-act="duzenle">✏️ Düzenle</button>'
    + (y.tip === 'odeme' ? '<button class="cari-btn" data-act="ayekle">➕ Ay Ekle</button>' : '')
    + (y.tip === 'kredi' && !y.cred.closed ? '<button class="cari-btn" data-act="yapilandir">🔁 Yapılandır</button><button class="cari-btn" data-act="kapat">🏁 Erken Kapat</button>' : '')
    + '<button class="cari-btn" data-act="tasi" title="Bu borcu başka kişinin cari kartına taşı">↪ Taşı</button>'
    + '<button class="cari-btn sil" data-act="sil">🗑 Sil</button>'
    + '</div>';

  h += '<div class="cari-aylar' + (y.kalemler.length > 6 ? ' cok' : '') + '">' + y.kalemler.map(k => {
    const o = k.h.obj;
    const renk = k.oz.st === 'paid' ? 'var(--ok)' : k.oz.gecikmis ? 'var(--danger)' : k.oz.st === 'partial' ? 'var(--ora)' : 'var(--txt)';
    const yz = k.oz.yerel;
    const durum = k.oz.st === 'paid' ? '✓ Ödendi' : k.oz.st === 'partial' ? 'Kısmi · kalan ' + window.fmtA(yz.kalan, yz.para) : k.oz.gecikmis ? 'Gecikmiş' : 'Bekliyor';
    const tutar = yz.para !== 'TRY' ? window.fmtA(o.amount, yz.para) + '<small> ≈' + fmt(k.oz.tam) + '</small>' : fmt(k.oz.tam);
    return '<div class="cari-ay" data-act="ay" data-ref="' + esc(refKey(k.ref)) + '">'
      + '<div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:600">' + (k.h.cred ? o.idx + '. taksit · ' : '') + _tarihUzun(o.date) + '</div>'
      + '<div style="font-size:11px;color:' + renk + '">' + durum + '</div></div>'
      + '<div class="cari-tutar" style="color:' + renk + '">' + tutar + '</div>'
      + (yz.kalan > 0 ? '<button class="cari-btn ok kucuk" data-act="ode" data-ref="' + esc(refKey(k.ref)) + '">Öde</button>' : '<span style="width:44px"></span>')
      + '</div>';
  }).join('') + '</div>';

  const refler = new Set(y.kalemler.map(k => refKey(k.ref)));
  const ilgili = hareketler.filter(e => refler.has(refKey(e.hareket.ref)));
  if (ilgili.length) h += '<div class="cari-alt-baslik">Bu borcun hareketleri (' + ilgili.length + ')</div>' + ilgili.map(_hareketSatir).join('');
  return h;
}

function _hareketSatir(e) {
  const esc = window.esc, hr = e.hareket, iptal = !!hr.iptal;
  return '<div class="cari-hrk' + (iptal ? ' iptal' : '') + '" data-act="hrk" data-id="' + esc(String(e.id)) + '">'
    + '<div style="flex:1;min-width:0"><div class="cari-hrk-t">' + esc(e.detail || '') + '</div>'
    + '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + esc(window.fmtD(hr.tarih)) + (iptal ? ' · geri alındı' : (hr.duzenlendi ? ' · düzenlendi' : '')) + '</div></div>'
    + '<div class="cari-tutar" style="color:' + (iptal ? 'var(--muted)' : 'var(--ok)') + '">' + window.fmtA(hr.tutar, hr.para || 'TRY') + '</div>'
    + (iptal ? '<div class="cari-hrk-sil" title="Kaydı sil">🗑</div>' : '<div style="color:var(--muted)">›</div>')
    + '</div>';
}

function _hareketHTML(person, hareketler) {
  const esc = window.esc;
  let h = '<div class="cari-aksiyon"><button class="cari-btn ok" data-act="ode">💰 Ödeme Gir</button></div>';
  h += hareketler.length ? hareketler.map(_hareketSatir).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0 12px">Henüz hareket yok. Bundan sonraki ödemeler burada görünür; dokunarak düzeltilir, başka kişiye/aya taşınır veya geri alınır.</div>';
  // Eski metin loglar (salt okunur)
  const baseOf = window.Hesap._baseOf, base = baseOf(person.name);
  const eski = (window.actLog || []).filter(e => {
    if (!e || e.hareket || (e.type || '').startsWith('rhb_')) return false;
    if (e.personId) return e.personId === _pid;
    return !!e.detail && baseOf(e.detail.split(' · ')[0] || '') === base;
  });
  if (eski.length) {
    h += '<details style="margin-top:12px"><summary class="cari-alt-baslik" style="cursor:pointer">Tüm kayıtlar / eski loglar (' + eski.length + ') — salt okunur</summary>'
      + eski.map(e => '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr)">'
        + '<div style="font-size:11px;color:var(--muted);min-width:72px">' + (e.at ? window.fmtLogTime(e.at) : '') + '</div>'
        + '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">' + esc(e.title || '') + '</div>'
        + (e.detail ? '<div style="font-size:11px;color:var(--muted)">' + esc(e.detail) + '</div>' : '') + '</div></div>').join('')
      + '</details>';
  }
  return h;
}

function _tikla(ev) {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.stopPropagation();
  const act = el.dataset.act;
  const y = _tab && _tab !== 'hareket' ? _yBul(_tab) : null;
  switch (act) {
    case 'tab': _tab = el.dataset.key; _render(); break;
    case 'ode': window.openHareket(_pid, null, el.dataset.ref || null); break;
    case 'hrk': window.openHareket(_pid, el.dataset.id); break;
    case 'ay': openCariAy(el.dataset.ref); break;
    case 'duzenle': if (y) openCariGrp(y); break;
    case 'ayekle': if (y) openCariEk(y); break;
    case 'yapilandir': if (y) window.openRestructure(y.cred.id); break;
    case 'kapat': if (y) window.openCloseCredit(y.cred.id); break;
    case 'sil': if (y) _borcSil(y); break;
    case 'kisisil': window.kisiSilSec && window.kisiSilSec(_pid); break;
    case 'birlestir': window.openBirlestir && window.openBirlestir(_pid); break;
    case 'tasi': if (y && window.openBorcTasi) window.openBorcTasi(_pid, y.key, _kisi().name + ' · ' + y.etiket); break;
    case 'yeni': openCariYeni(); break;
    case 'kisi': {
      const i = (window.persons || []).findIndex(p => p.id === _pid);
      if (i >= 0 && window.editPerson) window.editPerson(i);
      break;
    }
    case 'kopya':
      try { navigator.clipboard.writeText(el.dataset.copy); window.showWarnToast && window.showWarnToast('Kopyalandı'); } catch (e) {}
      break;
  }
}

// Borç/kredi silme: PIN ister; mevcut güvenli silme akışı (hist'e arşiv + log) kullanılır.
async function _borcSil(y) {
  const odenmis = y.kalemler.filter(k => (k.h.obj.paid || 0) > 0 || k.h.obj.status === 'paid').length;
  const ack = '<b>' + window.esc(_kisi().name + ' · ' + y.etiket) + '</b> — ' + y.kalemler.length + ' ' + (y.tip === 'kredi' ? 'taksit' : 'ay') + ' silinecek'
    + (odenmis ? ' (' + odenmis + ' tanesi ödenmiş)' : '') + '.<br>Silinenler "Silinenler" listesine düşer, oradan geri getirilebilir.<br>Onaylamak için şifreni gir.';
  if (!(await window.pinOnay((y.tip === 'kredi' ? 'Krediyi' : 'Borcu') + ' <span>Sil</span>', ack))) return;
  const eskiConfirm = window.confirm;
  window.confirm = () => true;          // delByKey kendi onayını sorar; PIN zaten alındı
  try { window.delByKey(encodeURIComponent(y.key)); } finally { window.confirm = eskiConfirm; }
}

// ── AY / TAKSİT DÜZENLE ────────────────────────────────────────────────────
function openCariAy(rk) {
  const ref = refParse(rk);
  const h = hedefBul(ref, window.pays, window.creds);
  if (!h) { alert('Kayıt bulunamadı.'); return; }
  const o = h.obj;
  $('CA_REF').value = rk;
  $('CA_T').innerHTML = (h.cred ? o.idx + '. Taksit' : 'Ay') + ' <span>Düzenle</span>';
  const pd = o.paid || 0;
  $('CA_INFO').textContent = _tarihUzun(o.date) + ' · ' + ((o.status || 'pending') === 'paid' ? 'ödendi' : pd > 0 ? 'ödenen ' + window.fmt(pd) : 'ödeme yok')
    + (pd > 0 ? ' — ödeme tutarı korunur, yalnız borç tutarı değişir.' : '');
  $('CA_AMT').value = o.amount;
  $('CA_CUR').textContent = h.cred ? '₺' : (o.currency === 'EUR' ? '€ EUR' : o.currency === 'GOLD' ? 'gr Altın' : '₺');
  $('CA_DATE').value = o.date || '';
  $('CA_DATE_WRAP').style.display = h.cred ? 'none' : '';
  $('CA_DATE_NOTE').style.display = h.cred ? '' : 'none';
  const silinebilir = !h.cred && !(pd > 0) && (o.status || 'pending') !== 'paid';
  $('CA_DEL').style.display = silinebilir ? '' : 'none';
  $('CA_ODE').style.display = (o.status || 'pending') === 'paid' ? 'none' : '';
  if ($('CA_ERT')) $('CA_ERT').style.display = (o.status || 'pending') === 'paid' ? 'none' : '';
  ModalManager.open('CARI_AY');
}

function saveCariAy() {
  const ref = refParse($('CA_REF').value);
  const h = hedefBul(ref, window.pays, window.creds);
  if (!h) { alert('Kayıt bulunamadı.'); return; }
  const amount = parseFloat($('CA_AMT').value);
  const date = $('CA_DATE').value;
  if (!(amount > 0)) { alert('Tutar 0\'dan büyük olmalı.'); return; }
  if (!h.cred && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('Tarih seçin.'); return; }
  const o = h.obj;
  const eski = { amount: o.amount, date: o.date };
  const patch = ayPatch(h, amount, date, window.rates);
  if (patch.amount === eski.amount && (!patch.date || patch.date === eski.date)) { ModalManager.close('CARI_AY'); return; }
  const y = _yBul(h.cred ? 'cred_' + h.cred.id : 'g_' + o.groupId);
  window.Store.tx(() => {
    window.Store.mutateItem(o, patch);
    const ne = [];
    if (patch.amount !== eski.amount) ne.push(window.fmt(eski.amount) + ' → ' + window.fmt(patch.amount));
    if (patch.date && patch.date !== eski.date) ne.push(_tarihUzun(eski.date) + ' → ' + _tarihUzun(patch.date));
    _log('plan_edit', h.cred ? 'Taksit düzenlendi' : 'Ay düzenlendi',
      _kisi().name + ' (' + (y ? y.etiket : '') + ') · ' + ne.join(' · '), y);
  });
  ModalManager.close('CARI_AY');
}

// ── ERTELE UI ──────────────────────────────────────────────────────────────
function openCariErtele(refArg) {
  const rk = refArg || $('CA_REF').value;
  const h = hedefBul(refParse(rk), window.pays, window.creds);
  if (!h) { alert('Kayıt bulunamadı.'); return; }
  const o = h.obj;
  if ((o.status || 'pending') === 'paid') { alert('Ödenmiş kalem ertelenemez.'); return; }
  ModalManager.close('CARI_AY');
  if (window.closeDV) window.closeDV();
  $('CER_REF').value = rk;
  // Varsayılan: bugünden sonraki ilk ay, kalemin kendi günüyle (geçmişte kalmış taksit öne gelir)
  const gun = Number(String(o.date).slice(8, 10)) || 1;
  const b = new Date();
  let aday = ayTarihi(toLocalISO(b.getFullYear(), b.getMonth(), 1).slice(0, 8) + String(gun).padStart(2, '0'), 1);
  if (aday <= String(o.date)) aday = ayTarihi(o.date, 1);
  $('CER_DATE').value = aday;
  $('CER_KAPSAM').value = h.cred ? 'sonraki' : 'tek';
  $('CER_INFO').textContent = (h.cred ? o.idx + '. taksit' : 'Ay') + ' · şu an ' + _tarihUzun(o.date) + ' · ' + window.fmtA(o.amount, h.cred ? 'TRY' : (o.currency || 'TRY'));
  cerOnizle();
  ModalManager.open('CARI_ERT');
}

// Aynı borcun kalemleri — cari kart açık olmasa da (plan hücresinden erteleme) doğrudan veriden
function _erteleKalemleri(h) {
  if (h.cred) return (h.cred.pays || []).map(t => ({ key: refKey({ k: 'cred', cid: h.cred.id, ii: t.idx }), obj: t }));
  const grp = h.obj.groupId ? 'g_' + h.obj.groupId : 'pay_' + String(Math.floor(Number(h.obj.id)));
  return (window.pays || []).filter(p => (p.groupId ? 'g_' + p.groupId : 'pay_' + String(Math.floor(Number(p.id)))) === grp)
    .map(p => ({ key: refKey({ k: 'pay', id: p.id }), obj: p }));
}

function cerOnizle() {
  const rk = $('CER_REF').value;
  const h = hedefBul(refParse(rk), window.pays, window.creds);
  if (!h) return;
  try {
    const plan = ertelePlani(_erteleKalemleri(h), rk, $('CER_DATE').value, $('CER_KAPSAM').value);
    $('CER_PREV').innerHTML = plan.length + ' kalem: ' + plan.slice(0, 4).map(p => _tarihUzun(p.eski) + ' → <b>' + _tarihUzun(p.yeni) + '</b>').join(' · ')
      + (plan.length > 4 ? ' …' : '') + '<br><span style="color:var(--muted)">Tutarlar ve toplam borç değişmez.</span>';
  } catch (e) { $('CER_PREV').innerHTML = '<span style="color:var(--danger)">' + window.esc(e.message) + '</span>'; }
}

function saveCariErtele() {
  const rk = $('CER_REF').value;
  const h = hedefBul(refParse(rk), window.pays, window.creds);
  if (!h) { alert('Kayıt bulunamadı.'); return; }
  const kalemler = _erteleKalemleri(h);
  let plan;
  try { plan = ertelePlani(kalemler, rk, $('CER_DATE').value, $('CER_KAPSAM').value); } catch (e) { alert(e.message); return; }
  const pid = h.cred ? h.cred.personId : h.obj.personId;
  const kisiAd = ((window.persons || []).find(p => p.id === pid) || {}).name || (h.cred ? h.cred.name : h.obj.name) || '';
  const etiket = h.cred ? (h.cred.desc || 'Kredi') : (h.obj.desc || h.obj.category || '');
  const ctx = { personId: pid || undefined };
  if (h.cred) ctx.credId = h.cred.id; else if (h.obj.groupId) ctx.groupId = h.obj.groupId;
  window.Store.tx(() => {
    plan.forEach(p => { const k = kalemler.find(x => x.key === p.key); if (k) window.Store.mutateItem(k.obj, { date: p.yeni }); });
    if (h.cred) h.cred.pays.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.idx - b.idx);
    window.addLog('plan_edit', 'Ertelendi', kisiAd + (etiket ? ' (' + etiket + ')' : '') + ' · ' + _tarihUzun(plan[0].eski) + ' → ' + _tarihUzun(plan[0].yeni) + (plan.length > 1 ? ' (+' + (plan.length - 1) + ' sonraki kalem aynı farkla)' : ''), 2, ctx);
  });
  ModalManager.close('CARI_ERT');
}

function odeCariAy() {
  const rk = $('CA_REF').value;
  ModalManager.close('CARI_AY');
  window.openHareket(_pid, null, rk);
}

function silCariAy() {
  const ref = refParse($('CA_REF').value);
  const h = hedefBul(ref, window.pays, window.creds);
  if (!h || h.cred) return;
  if ((h.obj.paid || 0) > 0 || h.obj.status === 'paid') { alert('Ödemesi olan ay silinemez. Önce ödemeyi geri al.'); return; }
  ModalManager.close('CARI_AY');
  window.delMonthEntry(encodeURIComponent(String(h.obj.id)));   // onay + hist + log mevcut akışta
}

// ── BORÇ DÜZENLE ───────────────────────────────────────────────────────────
function openCariGrp(y) {
  const ilk = y.kalemler[0] && y.kalemler[0].h.obj;
  $('CG_KEY').value = y.key;
  $('CG_T').innerHTML = (y.tip === 'kredi' ? 'Kredi' : 'Borç') + ' <span>Düzenle</span>';
  $('CG_DESC').value = y.tip === 'kredi' ? (y.cred.desc || '') : ((ilk && ilk.desc) || '');
  $('CG_CAT_WRAP').style.display = y.tip === 'kredi' ? 'none' : '';
  if (ilk && y.tip !== 'kredi') $('CG_CAT').value = ilk.category || 'Diğer';
  const bekleyenN = y.kalemler.filter(k => (k.h.obj.status || 'pending') === 'pending' && !((k.h.obj.paid || 0) > 0)).length;
  $('CG_AMT').value = '';
  $('CG_AMT').placeholder = 'Boş = değişmesin';
  $('CG_INFO').textContent = 'Tutar yalnız ödemesi olmayan ' + bekleyenN + ' ' + (y.tip === 'kredi' ? 'taksite' : 'aya') + ' uygulanır. Ödenmiş/kısmi olanlar değişmez.'
    + (y.tip === 'kredi' ? ' Taksit sayısı veya tarih için "Yapılandır" kullan.' : '');
  ModalManager.open('CARI_GRP');
}

function saveCariGrp() {
  const y = _yBul($('CG_KEY').value);
  if (!y) { alert('Kayıt bulunamadı.'); return; }
  const desc = $('CG_DESC').value.trim();
  const cat = $('CG_CAT').value;
  const amtRaw = $('CG_AMT').value.trim();
  const amt = amtRaw === '' ? null : parseFloat(amtRaw);
  if (amt !== null && !(amt > 0)) { alert('Tutar 0\'dan büyük olmalı (veya boş bırak).'); return; }
  const bekleyen = k => (k.h.obj.status || 'pending') === 'pending' && !((k.h.obj.paid || 0) > 0);
  let degisenAy = 0;
  window.Store.tx(() => {
    if (y.tip === 'kredi') {
      const c = y.cred;
      if (amt !== null) {
        y.kalemler.forEach(k => { if (bekleyen(k)) { k.h.obj.amount = amt; degisenAy++; } });
        c.monthly = amt;
        c.total = (c.pays || []).reduce((s, t) => s + (t.amount || 0), 0);
      }
      if (desc) c.desc = desc; else delete c.desc;
      window.Store.touch();
    } else {
      y.kalemler.forEach(k => {
        const patch = { category: cat, desc: desc || undefined };
        if (amt !== null && bekleyen(k)) { patch.amount = amt; degisenAy++; }
        window.Store.mutateItem(k.h.obj, patch);
        if (!desc) delete k.h.obj.desc;
      });
    }
    _log('plan_edit', y.tip === 'kredi' ? 'Kredi düzenlendi' : 'Borç düzenlendi',
      _kisi().name + ' (' + (desc || (y.tip === 'kredi' ? 'Kredi' : cat)) + ')' + (amt !== null ? ' · ' + degisenAy + ' bekleyen → ' + window.fmt(amt) : ''), y);
  });
  ModalManager.close('CARI_GRP');
}

// ── AY EKLE ────────────────────────────────────────────────────────────────
function openCariEk(y) {
  const son = y.kalemler[y.kalemler.length - 1].h.obj;
  $('CE_KEY').value = y.key;
  $('CE_N').value = 1;
  $('CE_AMT').value = son.amount;
  $('CE_INFO').textContent = 'Son ay: ' + _tarihUzun(son.date) + '. Yeni aylar bundan sonra, aynı gün eklenir.';
  ModalManager.open('CARI_EK');
}

function saveCariEk() {
  const y = _yBul($('CE_KEY').value);
  if (!y || y.tip !== 'odeme') { alert('Kayıt bulunamadı.'); return; }
  const n = parseInt($('CE_N').value, 10);
  const amt = parseFloat($('CE_AMT').value);
  if (!(n >= 1 && n <= 120)) { alert('Ay sayısı 1-120 arası olmalı.'); return; }
  if (!(amt > 0)) { alert('Tutar 0\'dan büyük olmalı.'); return; }
  if (!y.groupId) { alert('Bu eski kaydın grubu yok; ay eklenemez.'); return; }
  const recs = ayEkleKayitlari(y.kalemler.map(k => k.h.obj), n, amt);
  window.Store.tx(() => {
    recs.forEach(r => window.Store.push('pays', r));
    _log('plan_add', 'Ay eklendi', _kisi().name + ' (' + y.etiket + ') · ' + n + ' ay · ' + window.fmtAmt(amt, recs[0].currency)
      + ' · ' + _tarihUzun(recs[0].date) + (n > 1 ? ' → ' + _tarihUzun(recs[n - 1].date) : ''), y);
  });
  ModalManager.close('CARI_EK');
}

// ── YENİ BORÇ / KREDİ ──────────────────────────────────────────────────────
function openCariYeni() {
  $('CY_TIP').value = 'odeme';
  $('CY_DESC').value = '';
  $('CY_AMT').value = '';
  $('CY_CUR').value = 'TRY';
  $('CY_START').value = _bugun();
  $('CY_N').value = 12;
  $('CY_CAT').value = 'Diğer';
  cyGuncelle();
  ModalManager.open('CARI_YENI');
}

function cyGuncelle() {
  const kredi = $('CY_TIP').value === 'kredi';
  $('CY_CUR_WRAP').style.display = kredi ? 'none' : '';
  $('CY_CAT_WRAP').style.display = kredi ? 'none' : '';
  $('CY_N_LBL').textContent = kredi ? 'Taksit Sayısı' : 'Kaç Ay';
  $('CY_AMT_LBL').textContent = kredi ? 'Aylık Taksit (₺)' : 'Aylık Tutar';
  $('CY_DESC').placeholder = kredi ? 'ör: Araç kredisi, QNB' : 'ör: Kira, Elektrik';
  const n = parseInt($('CY_N').value, 10) || 0, a = parseFloat($('CY_AMT').value) || 0, s = $('CY_START').value;
  $('CY_PREV').textContent = (n > 0 && a > 0 && s)
    ? n + ' × ' + (kredi || $('CY_CUR').value === 'TRY' ? window.fmt(a) : window.fmtA(a, $('CY_CUR').value))
      + ' · ilk ' + _tarihUzun(s) + ' · son ' + _tarihUzun(ayTarihi(s, n - 1)) + '. Planda ayrı satır olarak görünür.'
    : '';
}

function saveCariYeni() {
  const person = _kisi();
  if (!person) return;
  const kredi = $('CY_TIP').value === 'kredi';
  const desc = $('CY_DESC').value.trim();
  const amt = parseFloat($('CY_AMT').value);
  const start = $('CY_START').value;
  const n = parseInt($('CY_N').value, 10);
  if (!(amt > 0)) { alert('Aylık tutar girin.'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { alert('İlk tarih seçin.'); return; }
  if (!(n >= 1 && n <= 360)) { alert((kredi ? 'Taksit' : 'Ay') + ' sayısı 1-360 arası olmalı.'); return; }
  window.Store.tx(() => {
    if (kredi) {
      const c = { id: 'c' + Date.now(), name: person.name, personId: person.id, total: amt * n, monthly: amt, inst: n, start,
        pays: window.Hesap.yapilandirPlan(start, n, amt) };
      if (desc) c.desc = desc;
      window.Store.push('creds', c);
      _tab = 'cred_' + c.id;
      window.addLog('cred_add', 'Kredi eklendi', person.name + ' (' + (desc || 'Kredi') + ') · ' + n + ' taksit · ' + window.fmtAmt(amt, 'TRY'), 2,
        { personId: person.id, credId: c.id });
    } else {
      const groupId = String(Date.now());
      const cur = $('CY_CUR').value, cat = $('CY_CAT').value;
      odemeKayitlari({ name: person.name, personId: person.id, amount: amt, currency: cur, start, adet: n, category: cat, desc, groupId })
        .forEach(r => window.Store.push('pays', r));
      _tab = 'g_' + groupId;
      window.addLog('plan_add', 'Kayıt eklendi', person.name + ' (' + (desc || cat) + ') · ' + n + ' ay · ' + window.fmtAmt(amt, cur), 2,
        { personId: person.id, groupId });
    }
  });
  ModalManager.close('CARI_YENI');
}

// Kart açıkken veri değişirse (kayıt, başka cihazdan senkron, yapılandırma...) kart kendini yeniler.
window.addEventListener('store:change', () => { if (_pid && _acik()) _render(); });

window.openCari     = openCari;
window.saveCariAy   = saveCariAy;
window.odeCariAy    = odeCariAy;
window.openCariErtele = openCariErtele;
window.cerOnizle      = cerOnizle;
window.saveCariErtele = saveCariErtele;
window.silCariAy    = silCariAy;
window.saveCariGrp  = saveCariGrp;
window.saveCariEk   = saveCariEk;
window.saveCariYeni = saveCariYeni;
window.cyGuncelle   = cyGuncelle;
window.openCariYeni = openCariYeni;   // mobil + menüsü: kişi seç -> yeni borç
