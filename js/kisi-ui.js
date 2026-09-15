// js/kisi-ui.js — iskenderpay
// Kişi = cari hesap ekranları (v8.234):
//   • Açılış düzenlemesi: Rehber kişilere katılır, bağsız borçlar kişiye bağlanır, karışık para
//     birimli borç ayrılır. Para DEĞİŞMEZ (kisi-veri.js kontrol eder), öncesi şifreli kopyalanır.
//   • ⇄ Birleştir: başka kişiyi (ya da hiçbir karta bağlı olmayan borcu) bu cari karta al.
//   • ↪ Taşı: tek bir borcu başka kişinin kartına taşı.
//   • 🧮 Sağlama: toplamlar tutuyor mu, kişiye bağlı olmayan / şüpheli kayıt var mı.
// Hesap çekirdeği: js/kisi-veri.js + js/para.js (saf, testli). Bu dosya yalnız ekran + Store yazımı.

import { veriDuzenle, kisiBirlestir, borcTasi, bakiyeler, saglama, adAnahtari } from './kisi-veri.js';
import { paraYazi, paraTL } from './para.js';

const $ = id => document.getElementById(id);
const esc = s => window.esc(s);

const _veri = () => ({
  persons: [...(window.persons || [])], pays: [...(window.pays || [])], creds: [...(window.creds || [])],
  paidItems: [...(window.paidItems || [])], hist: [...(window.hist || [])], actLog: [...(window.actLog || [])],
  rehber: [...(window.rehber || [])]
});

const _bugun = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function _yaz(d, anahtarlar) {
  window.Store.tx(() => { anahtarlar.forEach(k => window.Store.replace(k, d[k])); });
}

// Veri yapısını değiştiren işlemden önce cihazdaki ŞİFRELİ veri bir kez ayrı anahtara kopyalanır.
function _guvenlikKopyasi(etiket) {
  try {
    const plan = window.Store.planId;
    const k = 'ipay-guvenlik-oncesi-' + etiket + '-' + plan;
    if (localStorage.getItem(k)) return;
    const eski = localStorage.getItem('v5-data-' + plan);
    if (eski) localStorage.setItem(k, eski);
  } catch (e) { console.warn('[kisi] güvenlik kopyası alınamadı:', e); }
}

// ── Açılış düzenlemesi ────────────────────────────────────────────────────
export function kisiVeriDuzenle() {
  if (!window.Store) return null;
  let r;
  try { r = veriDuzenle(_veri(), window.rates); }
  catch (e) { console.warn('[kisi] düzenleme uygulanmadı:', e.message); return null; }
  if (!r.degisti) return r.rapor;
  _guvenlikKopyasi('v8.234');
  _yaz(r.d, ['persons', 'pays', 'creds']);
  // Sahada (15 Eyl) girişten hemen sonra düzenleme bellekte uygulandı ama ilk senkron turu eski
  // veriyi geri yükledi (kayıp yok, düzenleme kaybolmuştu). Bekleyen değişiklik işaretlenir ve
  // hemen kaydedilir: senkron "bekleyen değişiklik var" görüp ezmez.
  window.Store.dirty = true;
  if (window.saveSecureNow) window.saveSecureNow().catch(e => console.warn('[kisi] kayıt hatası:', e));
  const x = r.rapor, parca = [];
  if (x.rehberdenYeni) parca.push(x.rehberdenYeni + ' rehber kaydı kişi oldu');
  if (x.rehberEslesen) parca.push(x.rehberEslesen + ' rehber kaydı mevcut kişiye eklendi');
  if (x.odemeBaglandi + x.krediBaglandi) parca.push((x.odemeBaglandi + x.krediBaglandi) + ' borç kişisine bağlandı');
  if (x.paraAyrildi) parca.push(x.paraAyrildi + ' karışık para birimli borç ayrıldı');
  window.addLog('plan_edit', 'Kişiler düzenlendi', parca.join(' · ') + ' · bakiye değişmedi', 2);
  console.log('[kisi] açılış düzenlemesi:', x);
  return x;
}

// ── ⇄ BİRLEŞTİR ───────────────────────────────────────────────────────────
let _hedef = null;

function _bakiyeYazi(b) {
  return b && Object.keys(b).length ? paraYazi(b, window.fmtA) : 'borç yok';
}

export function openBirlestir(hedefId) {
  const hedef = (window.persons || []).find(p => p.id === hedefId);
  if (!hedef) return;
  _hedef = hedefId;
  $('BRL_HEDEF').textContent = hedef.name;
  $('BRL_ARA').value = '';
  _birlestirListe();
  ModalManager.open('BIRLES');
  setTimeout(() => { try { $('BRL_ARA').focus(); } catch (e) {} }, 120);
}

function _birlestirListe() {
  const d = _veri();
  const b = bakiyeler(d, window.rates);
  const hedef = d.persons.find(p => p.id === _hedef);
  if (!hedef) return;
  const q = window.araNormalize($('BRL_ARA').value || '');
  const hk = adAnahtari(hedef.name).split(' ')[0];
  // Öneri: adı hedefle aynı kelimeyle başlayanlar önce ("ZELİHA" -> "Zeliha ÇELİK")
  const benzer = p => adAnahtari(p.name).split(' ')[0] === hk;
  const bagsiz = b.bagsiz.filter(x => Object.keys(x.bakiye).length && (!q || window.araNormalize(x.ad).includes(q)));
  bagsiz.sort((a, c) => (adAnahtari(c.ad).startsWith(hk) ? 1 : 0) - (adAnahtari(a.ad).startsWith(hk) ? 1 : 0));
  const kisiler = d.persons.filter(p => p.id !== _hedef && (!q || window.araNormalize(p.name).includes(q)))
    .sort((a, c) => (benzer(c) - benzer(a)) || a.name.localeCompare(c.name, 'tr'));
  let h = '';
  if (bagsiz.length) {
    h += '<div class="brl-baslik">Hiçbir karta bağlı olmayan borçlar</div>'
      + bagsiz.map(x => '<label class="brl-satir' + (adAnahtari(x.ad).startsWith(hk) ? ' oneri' : '') + '"><input type="checkbox" data-borc="' + esc(x.key) + '">'
        + '<span class="brl-ad">' + (x.tip === 'kredi' ? '💳 ' : '📅 ') + esc(x.ad) + '</span><span class="brl-tutar">' + esc(_bakiyeYazi(x.bakiye)) + '</span></label>').join('');
  }
  h += '<div class="brl-baslik">Kişiler — seçilen kişinin HER ŞEYİ bu karta geçer, kişi silinir</div>'
    + (kisiler.length ? kisiler.slice(0, 80).map(p => '<label class="brl-satir' + (benzer(p) ? ' oneri' : '') + '"><input type="checkbox" data-kisi="' + esc(p.id) + '">'
      + '<span class="brl-ad">' + esc(p.name) + (p.arsiv ? ' <small>(arşiv)</small>' : '') + '</span><span class="brl-tutar">' + esc(_bakiyeYazi(b.kisiler[p.id])) + '</span></label>').join('')
      : '<div class="brl-bos">Eşleşen kişi yok.</div>');
  $('BRL_LISTE').innerHTML = h;
  _birlestirOnizle();
}

function _secili() {
  const kisi = [...$('BRL_LISTE').querySelectorAll('input[data-kisi]:checked')].map(i => i.dataset.kisi);
  const borc = [...$('BRL_LISTE').querySelectorAll('input[data-borc]:checked')].map(i => i.dataset.borc);
  return { kisi, borc };
}

function _uygulaBirlestir(d, sec) {
  let n = d;
  sec.borc.forEach(k => { n = { ...n, ...borcTasi(n, k, _hedef, window.rates).d }; });
  if (sec.kisi.length) n = { ...n, ...kisiBirlestir(n, sec.kisi, _hedef, window.rates).d };
  return n;
}

function _birlestirOnizle() {
  const sec = _secili();
  const el = $('BRL_ONIZLE');
  if (!sec.kisi.length && !sec.borc.length) { el.innerHTML = 'Bu karta alınacak kişiyi veya borcu seç.'; $('BRL_OK').disabled = true; return; }
  const d = _veri();
  try {
    const once = bakiyeler(d, window.rates);
    const n = _uygulaBirlestir(d, sec);
    const sonra = bakiyeler(n, window.rates);
    const ad = d.persons.find(p => p.id === _hedef).name;
    el.innerHTML = '<b>' + esc(ad) + '</b> kartı: ' + esc(_bakiyeYazi(once.kisiler[_hedef])) + ' → <b>' + esc(_bakiyeYazi(sonra.kisiler[_hedef])) + '</b>'
      + '<br>Genel toplam değişmez: ' + esc(_bakiyeYazi(sonra.toplam))
      + (sec.kisi.length ? '<br>' + sec.kisi.length + ' kişi bu karta katılıp listeden kalkar (telefon, IBAN, geçmiş, hareketler taşınır).' : '');
    $('BRL_OK').disabled = false;
  } catch (e) {
    el.innerHTML = '<span style="color:var(--danger)">' + esc(e.message) + '</span>';
    $('BRL_OK').disabled = true;
  }
}

async function birlestirKaydet() {
  const sec = _secili();
  if (!sec.kisi.length && !sec.borc.length) return;
  const d = _veri();
  let n;
  try { n = _uygulaBirlestir(d, sec); } catch (e) { alert(e.message); return; }
  const hedef = d.persons.find(p => p.id === _hedef);
  const kaynakAd = sec.kisi.map(id => (d.persons.find(p => p.id === id) || {}).name).filter(Boolean);
  const borcAd = sec.borc.map(k => ((bakiyeler(d, window.rates).bagsiz.find(x => x.key === k)) || {}).ad).filter(Boolean);
  if (sec.kisi.length) {
    const ack = '<b>' + esc(kaynakAd.join(', ')) + '</b> → <b>' + esc(hedef.name) + '</b><br>' + esc($('BRL_ONIZLE').textContent) + '<br><br>Onaylamak için şifreni gir.';
    if (!(await window.pinOnay('Kişileri <span>Birleştir</span>', ack))) return;
  } else if (!confirm(borcAd.join(', ') + ' → ' + hedef.name + ' kartına alınacak. Bakiye değişmez. Devam?')) return;
  _guvenlikKopyasi('birlestir-' + Date.now());
  _yaz(n, ['persons', 'pays', 'creds', 'paidItems', 'hist', 'actLog']);
  window.addLog('plan_edit', 'Cari kart birleştirildi', [...kaynakAd, ...borcAd].join(', ') + ' → ' + hedef.name + ' · yeni bakiye ' + _bakiyeYazi(bakiyeler(n, window.rates).kisiler[_hedef]), 2, { personId: _hedef });
  ModalManager.close('BIRLES');
  if (window.openCari) window.openCari(_hedef);
  if (window.curTab === 2 && window.renderPersons) window.renderPersons();
}

// ── ↪ BORÇ TAŞI ───────────────────────────────────────────────────────────
let _tasi = null;

export function openBorcTasi(kaynakPid, borcKey, etiket) {
  _tasi = { kaynakPid, borcKey };
  $('BT_BORC').textContent = etiket || borcKey;
  const kisiler = [...(window.persons || [])].filter(p => p.id && p.id !== kaynakPid && !p.arsiv).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  $('BT_HEDEF').innerHTML = '<option value="">— kişi seç —</option>' + kisiler.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('');
  $('BT_INFO').textContent = 'Yalnız bu borç (bütün ayları, ödemeleri ve hareketleri) seçtiğin kişinin kartına geçer. Tutarlar değişmez.';
  ModalManager.open('BTASI');
}

function borcTasiKaydet() {
  const hedefId = $('BT_HEDEF').value;
  if (!hedefId || !_tasi) { alert('Kişi seç.'); return; }
  const d = _veri();
  let r;
  try { r = borcTasi(d, _tasi.borcKey, hedefId, window.rates); } catch (e) { alert(e.message); return; }
  const hedef = d.persons.find(p => p.id === hedefId);
  _yaz({ ...d, ...r.d }, ['pays', 'creds', 'paidItems', 'hist', 'actLog']);
  window.addLog('plan_edit', 'Borç taşındı', (r.eskiAd || '') + ' → ' + hedef.name, 2, { personId: hedefId });
  ModalManager.close('BTASI');
  if (window.openCari) window.openCari(hedefId);
}

// ── 🧮 SAĞLAMA ────────────────────────────────────────────────────────────
function _saglamaHesap() {
  const d = _veri();
  const s = saglama(d, window.rates, _bugun());
  // Plan tablosu toplamı ile kişi bakiyeleri toplamı aynı mı (iki ayrı yol, aynı sonuç olmalı)
  let planTL = 0;
  if (window.getAllItems && window.buildMx) {
    const mx = window.buildMx(window.getAllItems());
    Object.keys(mx).forEach(k => Object.keys(mx[k]).forEach(m => { if (!m.startsWith('_')) planTL += mx[k][m].kalan || 0; }));
  }
  const kisiTL = paraTL(s.bakiye.toplam, window.rates);
  if (Math.abs(planTL - kisiTL) > 1) {
    s.uyarilar.unshift({ seviye: 'hata', baslik: 'Plan toplamı kişi toplamını tutmuyor', detay: 'Plan ' + window.fmt(planTL) + ' · kişiler ' + window.fmt(kisiTL) });
  }
  const genelTL = window.Hesap ? window.Hesap.toplamOzeti().toplam : kisiTL;
  if (Math.abs(genelTL - kisiTL) > 1) {
    s.uyarilar.unshift({ seviye: 'hata', baslik: 'Özet toplamı kişi toplamını tutmuyor', detay: 'Özet ' + window.fmt(genelTL) + ' · kişiler ' + window.fmt(kisiTL) });
  }
  s.planTL = planTL; s.kisiTL = kisiTL;
  return s;
}

export function renderSaglamaBar() {
  const el = $('SAGLAMA_BAR');
  if (!el || !window.persons) return;
  let s;
  try { s = _saglamaHesap(); } catch (e) { el.innerHTML = ''; console.warn('[saglama]', e); return; }
  const hata = s.uyarilar.filter(u => u.seviye === 'hata').length;
  const uyari = s.uyarilar.filter(u => u.seviye === 'uyari').length;
  el.className = 'saglama-bar ' + (hata ? 'hata' : uyari ? 'uyari' : 'ok');
  el.innerHTML = '<span class="sg-ikon">' + (hata ? '⚠' : uyari ? '🔎' : '✓') + '</span>'
    + '<span class="sg-metin"><b>' + (hata ? hata + ' sorun' : uyari ? uyari + ' kontrol' : 'Hesap tutarlı') + '</b> · Toplam ' + window.fmt(s.kisiTL)
    + '<small>' + esc(paraYazi(s.bakiye.toplam, window.fmtA)) + '</small></span><span class="sg-ok">›</span>';
  el.onclick = openSaglama;
}

export function openSaglama() {
  const s = _saglamaHesap();
  const ad = new Map((window.persons || []).map(p => [p.id, p.name]));
  const kisiSatir = Object.entries(s.bakiye.kisiler).filter(([, b]) => Object.keys(b).length)
    .map(([pid, b]) => ({ pid, ad: ad.get(pid) || pid, b, tl: paraTL(b, window.rates) }))
    .sort((a, c) => c.tl - a.tl);
  let h = '<div class="sg-toplam"><div><span>Plan tablosu</span><b>' + window.fmt(s.planTL) + '</b></div>'
    + '<div><span>Kişilerin toplamı</span><b>' + window.fmt(s.kisiTL) + '</b></div>'
    + '<div><span>Para birimi</span><b>' + esc(paraYazi(s.bakiye.toplam, window.fmtA)) + '</b></div></div>';
  h += s.uyarilar.length
    ? s.uyarilar.map(u => '<div class="sg-uyari ' + u.seviye + '"><div><b>' + esc(u.baslik) + '</b><div>' + esc(u.detay || '') + '</div></div>'
        + (u.baslik === 'Kişiye bağlı değil' && u.key ? '<button class="cari-btn" data-sg-bagla="' + esc(u.key) + '" data-sg-ad="' + esc((u.detay || '').split(' — ')[0]) + '">Kişiye bağla</button>' : '')
        + '</div>').join('')
    : '<div class="sg-uyari ok"><b>Sorun bulunmadı.</b> Her borç bir kişiye bağlı; plan, özet ve kişi toplamları aynı.</div>';
  h += '<div class="brl-baslik">Kişi bakiyeleri (' + kisiSatir.length + ')</div>'
    + kisiSatir.map(k => '<div class="brl-satir" data-sg-kisi="' + esc(k.pid) + '" style="cursor:pointer"><span class="brl-ad">' + esc(k.ad) + '</span><span class="brl-tutar">' + esc(paraYazi(k.b, window.fmtA)) + (Object.keys(k.b).some(x => x !== 'TRY') ? ' ≈ ' + window.fmt(k.tl) : '') + '</span></div>').join('');
  $('SG_ICERIK').innerHTML = h;
  ModalManager.open('SAGLAMA');
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-sg-bagla]');
  if (b) { ModalManager.close('SAGLAMA'); openBorcTasi(null, b.dataset.sgBagla, b.dataset.sgAd); return; }
  const k = e.target.closest('[data-sg-kisi]');
  if (k) { ModalManager.close('SAGLAMA'); window.openCari && window.openCari(k.dataset.sgKisi); return; }
  if (e.target.closest('#BRL_LISTE input')) _birlestirOnizle();
});

window.addEventListener('store:change', () => { if (window.curTab === 2) renderSaglamaBar(); });

window.kisiVeriDuzenle = kisiVeriDuzenle;
window.openBirlestir = openBirlestir;
window.birlestirAra = _birlestirListe;
window.birlestirKaydet = birlestirKaydet;
window.openBorcTasi = openBorcTasi;
window.borcTasiKaydet = borcTasiKaydet;
window.renderSaglamaBar = renderSaglamaBar;
window.openSaglama = openSaglama;
