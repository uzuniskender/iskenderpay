// js/hareket.js — iskenderpay
// KİŞİ HAREKETLERİ: ödeme = tek bir kaleme yazılan TUTAR (toplama/çıkarma).
//
// Neden: eski loglar yalnız metin tutuyordu ("Ödeme yapıldı · ₺X"); hangi kaleme ne kadar
// yazıldığını bilmediği için bir ödemeyi geri alıp başka yere girmek plan/grup/kredi
// düzenlemesine dokunmayı gerektiriyordu. Artık her ödeme logu `hareket` alanı taşır:
//   { ref:{k:'pay',id} | {k:'cred',cid,ii}, tutar (TRY), tarih (ödeme günü), paidId }
// Düzenle/Taşı/Geri Al = eski kalemden `tutar` DÜŞ, yeni kaleme `tutar` EKLE. Başka hiçbir
// kayıt (grup adı, diğer aylar, kredi planı) değişmez.
//
// Geçmiş veriye DOKUNULMAZ: `hareket` alanı olmayan eski loglar salt-okunur kalır.
// Güvenlik kapısı: eski kalem silinmiş / yapılandırılmışsa (üzerinde o kadar ödeme yoksa)
// hareket değiştirilemez — yanlış kalemden para düşülmez.

import { toTRY, fmtA } from './util.js';
import { kalemOzet, odemePatch, odenenYerel, kalemParasi, kur, tolerans } from './para.js';

const EPS = 0.5; // kuruş/yuvarlama toleransı (₺)

// ── SAF ÇEKİRDEK (test edilir) ─────────────────────────────────────────────

// Plan kaleminin (getAllItems elemanı) referansı
export function refOf(item) {
  if (item && item._cid != null) return { k: 'cred', cid: item._cid, ii: item._ii };
  return { k: 'pay', id: item && item.id };
}

export function refEsit(a, b) {
  if (!a || !b || a.k !== b.k) return false;
  return a.k === 'cred'
    ? String(a.cid) === String(b.cid) && a.ii === b.ii
    : String(a.id) === String(b.id);
}

export function refKey(r) {
  return r.k === 'cred' ? 'c|' + r.cid + '|' + r.ii : 'p|' + r.id;
}

export function refParse(s) {
  const [k, a, b] = String(s || '').split('|');
  if (k === 'c') return { k: 'cred', cid: a, ii: Number(b) };
  if (k === 'p') return { k: 'pay', id: a };
  return null;
}

// Referansın gösterdiği GERÇEK (saklanan) nesne: pay objesi veya kredi taksiti.
export function hedefBul(ref, pays, creds) {
  if (!ref) return null;
  if (ref.k === 'cred') {
    const c = (creds || []).find(x => String(x.id) === String(ref.cid));
    const t = c && (c.pays || []).find(x => x.idx === ref.ii);
    return t ? { obj: t, cred: c } : null;
  }
  const p = (pays || []).find(x => String(x.id) === String(ref.id));
  return p ? { obj: p, cred: null } : null;
}

// Kalemin TRY toplam tutarı
export function tamTutar(h, rates) {
  if (!h) return 0;
  return h.cred ? (h.obj.amount || 0) : toTRY(h.obj.amount, h.obj.currency || 'TRY', rates);
}

// Kalemin paid'ine delta ekle/çıkar -> yeni {paid, status}. Saf.
export function durumHesapla(oncekiPaid, delta, tam) {
  const paid = Math.max(0, (oncekiPaid || 0) + delta);
  const status = paid <= 0.005 ? 'pending' : (paid >= tam - EPS ? 'paid' : 'partial');
  return { paid: paid <= 0.005 ? 0 : paid, status };
}

// paidItems defterini delta kadar ayarla. Saf: YENİ dizi döner.
// Önce paidId ile, sonra referansla eşleşir. Kayıt 0'a inerse silinir; yoksa ve delta>0 ise eklenir.
export function defterAyarla(liste, ref, delta, tam, ek) {
  const arr = (liste || []).slice();
  ek = ek || {};
  let i = ek.paidId ? arr.findIndex(x => x && x.paidId === ek.paidId) : -1;
  if (i < 0) {
    i = ref.k === 'cred'
      ? arr.findIndex(x => x && x._cid != null && String(x._cid) === String(ref.cid) && x._ii === ref.ii)
      : arr.findIndex(x => x && x._cid == null && String(x.id) === String(ref.id));
  }
  if (i >= 0) {
    const { paid, status } = durumHesapla(arr[i].paid, delta, tam);
    if (paid <= 0) { arr.splice(i, 1); return { liste: arr, paidId: null }; }
    arr[i] = { ...arr[i], paid, status };
    return { liste: arr, paidId: arr[i].paidId || null };
  }
  if (delta <= 0) return { liste: arr, paidId: null };
  const paidId = 'pi_' + Date.now() + '_' + Math.random();
  const { status } = durumHesapla(0, delta, tam);
  arr.push({ ...(ek.snapshot || {}), paidId, status, paid: delta, paidAt: ek.paidAt || new Date().toISOString() });
  return { liste: arr, paidId };
}

// v8.234: hareket tutarı KALEMİN PARASINDADIR (`para` alanı). Eski hareketlerde `para` yok ve tutar TL'dir.
export function kalemNesnesi(h) {
  return h.cred ? { ...h.obj, _cid: h.cred.id } : h.obj;
}
export function hareketYerel(hareket, h, rates) {
  const para = kalemParasi(kalemNesnesi(h));
  if (para === 'TRY' || hareket.para === para) return Number(hareket.tutar) || 0;
  const r = kur(para, rates);
  return r ? (Number(hareket.tutar) || 0) / r : 0;
}

// Hareket değiştirilebilir mi? Eski kalem duruyor ve üzerinde en az `tutar` ödeme var.
export function geriAlinabilir(hareket, pays, creds, rates) {
  if (!hareket || hareket.iptal) return { ok: false, neden: 'Bu hareket zaten geri alınmış.' };
  const h = hedefBul(hareket.ref, pays, creds);
  if (!h) return { ok: false, neden: 'Ödemenin yazıldığı kalem artık yok (silinmiş veya kredi yapılandırılmış). Bu hareket değiştirilemez.' };
  const nesne = kalemNesnesi(h);
  const para = kalemParasi(nesne);
  if (odenenYerel(nesne, rates) + tolerans(para) < hareketYerel(hareket, h, rates)) {
    return { ok: false, neden: 'Kalemdeki ödeme bu hareketten az (plan ekranından değiştirilmiş). Bu hareket değiştirilemez.' };
  }
  return { ok: true, h };
}

// ── UYGULAMA (Store'a yazar) ───────────────────────────────────────────────

function _kisiIdBul(name, personId) {
  if (personId) return personId;
  const base = window.Hesap ? window.Hesap._baseOf(name) : name;
  const p = (window.persons || []).find(x => x.name === base);
  return p && p.id ? p.id : null;
}

// Kalemin görünen adı: "HAKAN AKÇA (Kira) · Eyl 2026"
function _etiket(h) {
  const o = h.obj;
  const ay = o.date ? window.parseLocalDate(o.date).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' }) : '';
  if (h.cred) return h.cred.name + ' (' + (h.cred.desc || 'Kredi') + ' ' + o.idx + '/' + (h.cred.pays || []).length + ') · ' + ay;
  const tag = o.desc || o.category;
  return (o.name || '') + (tag ? ' (' + tag + ')' : '') + ' · ' + ay;
}

function _snapshot(h, ref) {
  if (h.cred) return { ...h.obj, name: h.cred.name, currency: 'TRY', _cid: ref.cid, _ii: ref.ii };
  return { ...h.obj };
}

// Kaleme delta uygula (kalem + defter). delta KALEMİN PARASINDA. Dönüş: kullanılan paidId.
// Kalem: ödenen kendi parasında (para.js). Defter: o günün TL karşılığı (trend/geçmiş için).
function _uygula(ref, delta, paidAt, paidId) {
  const h = hedefBul(ref, window.pays, window.creds);
  if (!h) return null;
  const nesne = kalemNesnesi(h);
  const oz = kalemOzet(nesne, window.rates);
  const patch = odemePatch(nesne, delta, window.rates);
  Object.assign(h.obj, patch);
  if (!patch.odenenPara) delete h.obj.odenenPara;
  const oran = kur(oz.para, window.rates) || 0;
  const r = defterAyarla(window.paidItems, ref, delta * oran, oz.tamTL, { paidId, snapshot: _snapshot(h, ref), paidAt });
  window.Store.replace('paidItems', r.liste);
  return r.paidId;
}

function _paraOf(ref) {
  const h = hedefBul(ref, window.pays, window.creds);
  return h ? kalemParasi(kalemNesnesi(h)) : 'TRY';
}

function _detay(ref, tutar) {
  const h = hedefBul(ref, window.pays, window.creds);
  return (h ? _etiket(h) : '?') + ' · ' + fmtA(Number(tutar), _paraOf(ref));
}

function _ctx(ref, extra) {
  const h = hedefBul(ref, window.pays, window.creds);
  const name = h ? (h.cred ? h.cred.name : h.obj.name) : '';
  const ctx = { personId: _kisiIdBul(name, h ? (h.cred ? h.cred.personId : h.obj.personId) : null) };
  if (h && h.cred) ctx.credId = h.cred.id; else if (h) ctx.groupId = h.obj.groupId;
  return Object.assign(ctx, extra || {});
}

// Plan ekranı (markOk/doPartial) çağırır: kalemin paid'i ZATEN güncellendi, yalnız log yazılır.
// item: getAllItems elemanı; delta: bu işlemle eklenen TRY; paidId: defter kaydı.
export function planOdemesiLogla(item, delta, paidId, kismi) {
  if (!(delta > 0.005)) return;
  const ref = refOf(item);
  const bugun = new Date();
  const hareket = { ref, tutar: delta, para: _paraOf(ref), tarih: bugun.toISOString().slice(0, 10), paidId: paidId || null };
  window.addLog('paid', kismi ? 'Kısmi ödeme' : 'Ödeme yapıldı', _detay(ref, delta), 1, _ctx(ref, { hareket }));
}

// Plan ekranında "Geri Al"/"Sıfırla" yapılınca o kaleme bağlı açık hareketler kapanır
// (aksi halde sonradan düzenlenince ikinci kez düşülürdü).
export function kalemHareketleriniKapat(item) {
  const ref = refOf(item);
  const iso = new Date().toISOString();
  (window.actLog || []).forEach(e => {
    if (e && e.hareket && !e.hareket.iptal && refEsit(e.hareket.ref, ref)) {
      window.Store.mutateItem(e, { hareket: { ...e.hareket, iptal: iso, iptalNeden: 'plan' } });
    }
  });
}

// ── UI: KİŞİ KARTI İÇİN ────────────────────────────────────────────────────

// Kayıt bu kişiye mi ait? personId varsa O KESİN; yoksa (eski kayıt) taban-isim eşleşmesi.
const _baseDef = n => (n || '').replace(/ \d+$/, '').trim() || n;
export function payKisiye(p, person, baseOf) {
  baseOf = baseOf || _baseDef;
  if (!p || !person) return false;
  return p.personId ? p.personId === person.id : baseOf(p.name) === baseOf(person.name);
}
export function credKisiye(c, person, baseOf) {
  baseOf = baseOf || _baseDef;
  if (!c || !person) return false;
  return c.personId ? c.personId === person.id : baseOf(c.name) === baseOf(person.name);
}

// Kişinin kalemleri (normal ödemeler + kredi taksitleri), tarihe göre.
function _kisiKalemleri(personId) {
  const person = (window.persons || []).find(p => p.id === personId);
  if (!person) return [];
  const baseOf = window.Hesap._baseOf;
  const out = [];
  (window.pays || []).forEach(p => {
    if (payKisiye(p, person, baseOf)) out.push({ ref: { k: 'pay', id: p.id }, h: { obj: p, cred: null } });
  });
  (window.creds || []).forEach(c => {
    if (!credKisiye(c, person, baseOf)) return;
    (c.pays || []).forEach(t => out.push({ ref: { k: 'cred', cid: c.id, ii: t.idx }, h: { obj: t, cred: c } }));
  });
  return out.sort((a, b) => String(a.h.obj.date).localeCompare(String(b.h.obj.date)));
}

export function kisiHareketleri(personId) {
  return (window.actLog || []).filter(e => e && e.hareket && e.personId === personId);
}

let _hrkPerson = null; // kart hangi kişi için açık

function _kalemSecenekleri(personId, seciliRef, haricTutar) {
  const sel = document.getElementById('HRK_ITEM');
  const kalemler = _kisiKalemleri(personId);
  const opts = [];
  let secildi = false;
  kalemler.forEach(({ ref, h }) => {
    const nesne = kalemNesnesi(h);
    const oz = kalemOzet(nesne, window.rates);
    const ayni = seciliRef && refEsit(ref, seciliRef);
    // Düzenlenen hareketin kendi tutarı kalana geri eklenir (aynı kaleme yeniden yazılabilsin)
    const kalan = ayni ? Math.min(oz.tam, oz.kalan + (haricTutar || 0)) : oz.kalan;
    if (kalan <= tolerans(oz.para) && !ayni) return; // tamamen ödenmiş kalemler listelenmez
    const isSel = ayni || (!seciliRef && !secildi);
    if (isSel) secildi = true;
    opts.push('<option value="' + window.esc(refKey(ref)) + '" data-kalan="' + kalan + '" data-para="' + oz.para + '"' + (isSel ? ' selected' : '') + '>'
      + window.esc(_etiket(h)) + ' · kalan ' + fmtA(kalan, oz.para) + '</option>');
  });
  sel.innerHTML = opts.length ? opts.join('') : '<option value="">Bu kişinin açık kalemi yok</option>';
  sel.disabled = !opts.length;
  _birimYaz();
}

function _kalanOf() {
  const o = document.getElementById('HRK_ITEM').selectedOptions[0];
  return o ? Number(o.dataset.kalan) || 0 : 0;
}

function _paraSecili() {
  const o = document.getElementById('HRK_ITEM').selectedOptions[0];
  return (o && o.dataset.para) || 'TRY';
}

function _birimYaz() {
  const el = document.getElementById('HRK_AMT_LBL');
  if (!el) return;
  const para = _paraSecili();
  el.textContent = 'Tutar (' + (para === 'EUR' ? '€' : para === 'GOLD' ? 'gram altın' : '₺') + ')';
}

function _yuvarla(x, para) { return para === 'TRY' ? Math.round(x) : Math.round(x * 100) / 100; }

// Yeni ödeme (entryId boş) veya mevcut hareketi düzenle
function openHareket(personId, entryId, onSecim) {
  const e = entryId ? (window.actLog || []).find(x => String(x.id) === String(entryId)) : null;
  if (entryId && !e) { alert('Hareket bulunamadı.'); return; }
  // Geri alınmış hareket: tek işlem kalır -> kaydı sistemden sil (PIN)
  if (e && e.hareket && e.hareket.iptal) { _hrkPerson = personId; kaydiSilHareket(String(e.id)); return; }
  if (e) {
    const g = geriAlinabilir(e.hareket, window.pays, window.creds, window.rates);
    if (!g.ok) {
      // Kalemi silinmiş / yapılandırılmış: para değiştirilemez ama iz silinebilir
      if (confirm(g.neden + '\n\nBu kaydı yalnızca logdan silmek ister misin? (Plana dokunulmaz)')) { _hrkPerson = personId; kaydiSilHareket(String(e.id), true); }
      return;
    }
  }
  _hrkPerson = personId;
  document.getElementById('HRK_EID').value = entryId || '';
  document.getElementById('HRK_T').innerHTML = e ? 'Hareket <span>Düzenle</span>' : 'Ödeme <span>Gir</span>';
  document.getElementById('HRK_DEL').style.display = e ? '' : 'none';
  const silBtn = document.getElementById('HRK_SIL'); if (silBtn) silBtn.style.display = e ? '' : 'none';
  const pSel = document.getElementById('HRK_PERSON');
  pSel.innerHTML = [...(window.persons || [])].filter(p => p.id && (!p.arsiv || p.id === personId))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map(p => '<option value="' + window.esc(p.id) + '"' + (p.id === personId ? ' selected' : '') + '>' + window.esc(p.name) + '</option>').join('');
  // onSecim: cari karttan "Öde" -> o ayın kalemi seçili gelir (refKey)
  const eYerel = e ? (() => { const h = hedefBul(e.hareket.ref, window.pays, window.creds); return h ? hareketYerel(e.hareket, h, window.rates) : e.hareket.tutar; })() : 0;
  _kalemSecenekleri(personId, e ? e.hareket.ref : refParse(onSecim), eYerel);
  document.getElementById('HRK_AMT').value = e ? Math.round(eYerel * 100) / 100 : _yuvarla(_kalanOf(), _paraSecili());
  document.getElementById('HRK_DATE').value = e ? e.hareket.tarih : new Date().toISOString().slice(0, 10);
  document.getElementById('HRK_INFO').textContent = e ? 'Değiştirince yalnız bu tutar eski kalemden düşülür, seçtiğin kaleme eklenir. Başka kayıt değişmez.' : '';
  ModalManager.open('HRKMOD');
}

function hrkKisiDegisti() {
  const pid = document.getElementById('HRK_PERSON').value;
  const eid = document.getElementById('HRK_EID').value;
  const e = eid ? (window.actLog || []).find(x => String(x.id) === eid) : null;
  // Aynı kişiye geri dönüldüyse eski kalem seçili gelsin
  const eskiKisi = e && e.personId === pid;
  const h = eskiKisi ? hedefBul(e.hareket.ref, window.pays, window.creds) : null;
  _kalemSecenekleri(pid, eskiKisi ? e.hareket.ref : null, h ? hareketYerel(e.hareket, h, window.rates) : 0);
}

function saveHareket() {
  const eid = document.getElementById('HRK_EID').value;
  const personId = document.getElementById('HRK_PERSON').value;
  const ref = refParse(document.getElementById('HRK_ITEM').value);
  const tutar = parseFloat(document.getElementById('HRK_AMT').value);
  const tarih = document.getElementById('HRK_DATE').value;
  if (!ref) { alert('Kalem seçin.'); return; }
  if (!(tutar > 0)) { alert('Tutar 0\'dan büyük olmalı.'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) { alert('Tarih seçin.'); return; }
  const kalan = _kalanOf();
  const para = _paraSecili();
  if (tutar > kalan + tolerans(para)) { alert('Tutar bu kalemin kalanından (' + fmtA(kalan, para) + ') büyük olamaz.'); return; }
  if (!hedefBul(ref, window.pays, window.creds)) { alert('Seçilen kalem bulunamadı.'); return; }
  const paidAt = new Date(tarih + 'T12:00:00').toISOString();

  if (!eid) {
    window.Store.tx(() => {
      const paidId = _uygula(ref, tutar, paidAt, null);
      const hareket = { ref, tutar, para, tarih, paidId };
      window.addLog('paid', 'Ödeme yapıldı', _detay(ref, tutar), 1, _ctx(ref, { hareket }));
    });
  } else {
    const e = (window.actLog || []).find(x => String(x.id) === eid);
    if (!e) { alert('Hareket bulunamadı.'); return; }
    const g = geriAlinabilir(e.hareket, window.pays, window.creds, window.rates);
    if (!g.ok) { alert(g.neden); return; }
    const eski = e.hareket;
    const eskiYerel = hareketYerel(eski, g.h, window.rates);
    window.Store.tx(() => {
      _uygula(eski.ref, -eskiYerel, null, eski.paidId);            // eski kalemden düş (kalemin parasında)
      const paidId = _uygula(ref, tutar, paidAt, refEsit(ref, eski.ref) ? eski.paidId : null); // yeni kaleme ekle
      const ctx = _ctx(ref);
      const patch = {
        title: 'Ödeme yapıldı', detail: _detay(ref, tutar),
        personId: ctx.personId || undefined, groupId: ctx.groupId || undefined, credId: ctx.credId || undefined,
        hareket: { ref, tutar, para, tarih, paidId, duzenlendi: new Date().toISOString() }
      };
      window.Store.mutateItem(e, patch);
      Object.keys(patch).forEach(k => { if (patch[k] === undefined) delete e[k]; });
    });
  }
  window.closeMov('HRKMOD');
  _yenile(personId);
}

function geriAlHareket() {
  const eid = document.getElementById('HRK_EID').value;
  const e = (window.actLog || []).find(x => String(x.id) === eid);
  if (!e) return;
  const g = geriAlinabilir(e.hareket, window.pays, window.creds, window.rates);
  if (!g.ok) { alert(g.neden); return; }
  const yerel = hareketYerel(e.hareket, g.h, window.rates);
  const para = kalemParasi(kalemNesnesi(g.h));
  if (!confirm('Bu ödeme (' + fmtA(yerel, para) + ') geri alınacak. Kalemden yalnız bu tutar düşülür. Emin misin?')) return;
  window.Store.tx(() => {
    _uygula(e.hareket.ref, -yerel, null, e.hareket.paidId);
    window.Store.mutateItem(e, { hareket: { ...e.hareket, iptal: new Date().toISOString(), iptalNeden: 'kisi' } });
  });
  window.closeMov('HRKMOD');
  _yenile(_hrkPerson);
}

// 🗑 KAYDI SİL: iz sistemden gider (PIN). Ödeme hâlâ geçerliyse ÖNCE geri alınır —
// planda "ödendi" görünüp kaydı olmayan hayalet ödeme bırakılmaz.
// sadeceIz=true: kalemi zaten yok (silinmiş/yapılandırılmış) -> yalnız log satırı gider.
async function kaydiSilHareket(eid, sadeceIz) {
  eid = eid || document.getElementById('HRK_EID').value;
  const e = (window.actLog || []).find(x => String(x.id) === String(eid));
  if (!e || !e.hareket) return;
  const aktif = !e.hareket.iptal && !sadeceIz;
  let g = null;
  if (aktif) {
    g = geriAlinabilir(e.hareket, window.pays, window.creds, window.rates);
    if (!g.ok) { alert(g.neden); return; }
  }
  const yerel = g ? hareketYerel(e.hareket, g.h, window.rates) : 0;
  const para = g ? kalemParasi(kalemNesnesi(g.h)) : 'TRY';
  const ack = window.esc(e.detail || '') + '<br><br>'
    + (aktif
      ? '<b>Bu ödeme hâlâ geçerli.</b> Kayıt silinince ödeme de geri alınır: ' + fmtA(yerel, para) + ' kalemden düşülür, ay ödenmemiş görünür.'
      : 'Kayıt kalıcı olarak silinir. Plana dokunulmaz.')
    + '<br>Onaylamak için şifreni gir.';
  const ok = window.pinOnay ? await window.pinOnay('Kaydı <span>Sil</span>', ack) : confirm('Kayıt silinsin mi?');
  if (!ok) return;
  window.Store.tx(() => {
    if (aktif) _uygula(e.hareket.ref, -yerel, null, e.hareket.paidId);
    window.Store.removeWhere('actLog', x => x === e || String(x.id) === String(e.id));
  });
  window.closeMov('HRKMOD');
  _yenile(_hrkPerson);
}

function _yenile(personId) {
  const pid = _hrkPerson || personId;
  if (pid && window.openPersonHist) window.openPersonHist(pid);
  if (window.curTab === 7 && window.renderActLog) window.renderActLog();
}

window.Hareket = { planOdemesiLogla, kalemHareketleriniKapat, kisiHareketleri, geriAlinabilir, hareketYerel, payKisiye, credKisiye, refKey, refEsit, tamTutar, durumHesapla };
window.openHareket    = openHareket;
window.hrkKisiDegisti = hrkKisiDegisti;
// Yeni ödemede kalem değişince tutar = kalan önerilir; düzenlemede girilen tutar korunur (taşıma).
window.hrkKalemDegisti = () => {
  _birimYaz();
  if (!document.getElementById('HRK_EID').value) document.getElementById('HRK_AMT').value = _yuvarla(_kalanOf(), _paraSecili());
};
window.saveHareket    = saveHareket;
window.geriAlHareket  = geriAlHareket;
window.kaydiSilHareket = kaydiSilHareket;
