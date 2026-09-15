// js/kisi-veri.js — iskenderpay
// KİŞİ = CARİ HESAP. Veri modelinin saf çekirdeği (DOM yok, Store yok, test edilir).
//
// Neden (v8.234): kişi ile borç arasındaki bağ İSİMLE kuruluyordu. "ZELİHA 1", "ZELİHA 2" gibi
// numaralı adlar kişiye bağlanamıyor, Rehber ayrı bir liste olarak kişilerle eşleşmiyor,
// aynı insanın borçları farklı kartlara dağılıyordu. Yeni kural:
//   • Her borç (ödeme grubu / kredi) `personId` ile TEK bir kişiye bağlıdır. İsim yalnız etikettir.
//   • Rehber ile Kişiler tek listedir: telefon, IBAN, e-posta, not kişinin üstündedir.
//     Borcu olmayan kişi de kişidir.
//   • Bir borç tek para birimindedir. TL + altın + euro karışık grup ayrı borçlara bölünür
//     (kişinin cari kartında üç ayrı sekme).
//   • Birleştirme / taşıma PARA DEĞİŞTİRMEZ: işlemden önce ve sonra her para biriminde toplam
//     kalan borç karşılaştırılır, kuruş farkı varsa işlem uygulanmaz (hata fırlatır).
//
// Bütün fonksiyonlar girdiyi DEĞİŞTİRMEZ; yeni diziler döner.

import { araNormalize } from './util.js';
import { kalemOzet, paraTopla, tolerans, PARALAR } from './para.js';

// ── Yardımcılar ───────────────────────────────────────────────────────────
export function adAnahtari(name) {
  return araNormalize(String(name || '')).replace(/\s+/g, ' ').trim().replace(/ \d+$/, '').trim();
}

const _kopya = d => ({
  persons: (d.persons || []).map(x => ({ ...x })),
  pays: (d.pays || []).map(x => ({ ...x })),
  creds: (d.creds || []).map(x => ({ ...x, pays: (x.pays || []).map(t => ({ ...t })) })),
  paidItems: (d.paidItems || []).map(x => ({ ...x })),
  hist: (d.hist || []).map(x => ({ ...x })),
  actLog: (d.actLog || []).map(x => ({ ...x })),
  rehber: d.rehber || []
});

export function borcAnahtari(p) {
  return p.groupId ? 'g_' + p.groupId : 'pay_' + String(Math.floor(Number(p.id)));
}

let _sayac = 0;
const _yeniId = (onEk) => onEk + Date.now().toString(36) + '_' + (++_sayac).toString(36) + Math.random().toString(36).slice(2, 5);

function _telefonBirlestir(a, b) {
  const out = [...(a || [])];
  const var_ = new Set(out.map(t => String(t.num || '').replace(/\D/g, '')));
  (b || []).forEach(t => {
    const k = String(t.num || '').replace(/\D/g, '');
    if (k && !var_.has(k)) { out.push({ ...t }); var_.add(k); }
  });
  return out;
}

// İletişim alanlarını hedefe ekler (hedefte dolu olan alanın üstüne YAZMAZ)
function _iletisimEkle(hedef, kaynak) {
  hedef.phones = _telefonBirlestir(hedef.phones, kaynak.phones);
  ['iban', 'email', 'company'].forEach(k => { if (!hedef[k] && kaynak[k]) hedef[k] = kaynak[k]; });
  const notlar = [hedef.note, kaynak.note].filter(Boolean);
  if (notlar.length) hedef.note = [...new Set(notlar)].join('\n');
  const rids = [...(hedef.rehberIds || []), ...(kaynak.rehberIds || [])];
  if (rids.length) hedef.rehberIds = [...new Set(rids.map(String))];
  return hedef;
}

// ── Kişinin bakiyesi (kesin bağ: personId) ────────────────────────────────
// Dönüş: { kisiler: {pid: {TRY,EUR,GOLD}}, bagsiz: [{key, tip, ad, bakiye}], toplam: {TRY,EUR,GOLD} }
export function bakiyeler(d, rates) {
  const kisiler = {};
  const bagsizMap = new Map();
  const toplamOz = [];
  const kisiVar = new Set((d.persons || []).map(p => p.id));
  const ekle = (pid, key, tip, ad, oz) => {
    toplamOz.push(oz);
    if (pid && kisiVar.has(pid)) {
      const t = kisiler[pid] = kisiler[pid] || {};
      if (oz.kalan > 0) t[oz.para] = (t[oz.para] || 0) + oz.kalan;
    } else {
      if (!bagsizMap.has(key)) bagsizMap.set(key, { key, tip, ad, personId: pid || null, ozetler: [] });
      bagsizMap.get(key).ozetler.push(oz);
    }
  };
  (d.pays || []).forEach(p => ekle(p.personId, borcAnahtari(p), 'odeme', p.name, kalemOzet(p, rates)));
  (d.creds || []).forEach(c => (c.pays || []).forEach(t =>
    ekle(c.personId, 'cred_' + c.id, 'kredi', c.name, kalemOzet({ ...t, _cid: c.id }, rates))));
  const bagsiz = [...bagsizMap.values()].map(b => ({ key: b.key, tip: b.tip, ad: b.ad, personId: b.personId, bakiye: paraTopla(b.ozetler) }));
  return { kisiler, bagsiz, toplam: paraTopla(toplamOz) };
}

export function bakiyeEsit(a, b) {
  return PARALAR.every(p => Math.abs((a[p] || 0) - (b[p] || 0)) <= tolerans(p) / 10);
}

// ── 1) Rehberi kişilere kat (idempotent) ─────────────────────────────────
export function rehberiKat(d) {
  const persons = (d.persons || []).map(x => ({ ...x }));
  const kullanilan = new Set(persons.flatMap(p => (p.rehberIds || []).map(String)));
  let eklenen = 0, eslesen = 0;
  (d.rehber || []).forEach(r => {
    if (!r || r.id == null || kullanilan.has(String(r.id))) return;
    const ad = (r.name || ((r.firstName || '') + ' ' + (r.lastName || ''))).trim();
    if (!ad) return;
    const key = adAnahtari(ad);
    const iletisim = { phones: r.phones || [], iban: r.iban || '', email: r.email || '', company: r.company || '', note: r.note || '', rehberIds: [String(r.id)] };
    const mevcut = persons.find(p => adAnahtari(p.name) === key);
    if (mevcut) { _iletisimEkle(mevcut, iletisim); eslesen++; }
    else {
      persons.push(_iletisimEkle({ id: 'per_r' + String(r.id).replace(/[^\w]/g, ''), name: ad, desc: '' }, iletisim));
      eklenen++;
    }
    kullanilan.add(String(r.id));
  });
  return { persons, eklenen, eslesen };
}

// ── 2) Bağsız borçları isimle KESİN eşleşen kişiye bağla ─────────────────
// Yalnız tek aday varsa bağlar; belirsizse bağsız bırakır (kullanıcı cari karttan taşır).
export function baglariKur(d) {
  const persons = d.persons || [];
  const kisiIdVar = new Set(persons.map(p => p.id));
  const adaylar = new Map();
  persons.forEach(p => {
    if (!p.id) return;
    const k = adAnahtari(p.name);
    adaylar.set(k, adaylar.has(k) ? null : p.id);   // aynı anahtarlı iki kişi -> belirsiz
  });
  const bul = name => adaylar.get(adAnahtari(name)) || null;
  let odeme = 0, kredi = 0;
  const pays = (d.pays || []).map(p => {
    if (p.personId && kisiIdVar.has(p.personId)) return p;
    const pid = bul(p.name);
    if (!pid) return p;
    odeme++;
    return { ...p, personId: pid };
  });
  const creds = (d.creds || []).map(c => {
    if (c.personId && kisiIdVar.has(c.personId)) return c;
    const pid = bul(c.name);
    if (!pid) return c;
    kredi++;
    return { ...c, personId: pid };
  });
  return { pays, creds, odeme, kredi };
}

// ── 3) Karışık para birimli grubu ayır ───────────────────────────────────
// Bir grupta TL + altın + euro varsa: grubun ilk kalemi hangi paradaysa o grupta kalır,
// diğer paralar "<groupId>-<PARA>" grubuna geçer. Kalem id'leri (hareket/defter bağı) DEĞİŞMEZ.
export function paraGruplariniAyir(pays) {
  const gruplar = new Map();
  (pays || []).forEach(p => { if (p.groupId) { if (!gruplar.has(p.groupId)) gruplar.set(p.groupId, []); gruplar.get(p.groupId).push(p); } });
  const tasinan = new Map();   // pay id -> yeni groupId
  let ayrilan = 0;
  gruplar.forEach((liste, gid) => {
    const paralar = [...new Set(liste.map(p => p.currency || 'TRY'))];
    if (paralar.length < 2) return;
    const sirali = [...liste].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const ana = sirali[0].currency || 'TRY';
    liste.forEach(p => { const c = p.currency || 'TRY'; tasinan.set(String(p.id), c !== ana ? gid + '-' + c : gid); });
    ayrilan++;
  });
  if (!tasinan.size) return { pays: pays || [], ayrilan: 0 };
  // Ayrılan borç kendi etiketini alır: planda "VELİ KAYA (Altın)", cari kartta "Altın" sekmesi
  const ETIKET = { GOLD: 'Altın', EUR: 'Euro', TRY: 'TL' };
  return { pays: pays.map(p => tasinan.has(String(p.id))
    ? { ...p, groupId: tasinan.get(String(p.id)), ...(p.desc ? {} : { desc: ETIKET[p.currency] || p.currency }) }
    : p), ayrilan };
}

// ── Açılış düzenlemesi: 1+2+3 birlikte, para değişmedi garantisiyle ───────
export function veriDuzenle(d, rates) {
  const once = bakiyeler(d, rates).toplam;
  const r1 = rehberiKat(d);
  const r3 = paraGruplariniAyir(d.pays);
  const r2 = baglariKur({ persons: r1.persons, pays: r3.pays, creds: d.creds });
  const yeni = { ...d, persons: r1.persons, pays: r2.pays, creds: r2.creds };
  const sonra = bakiyeler(yeni, rates).toplam;
  if (!bakiyeEsit(once, sonra)) throw new Error('Düzenleme toplam bakiyeyi değiştirdi — uygulanmadı.');
  const degisti = r1.eklenen + r1.eslesen + r2.odeme + r2.kredi + r3.ayrilan > 0;
  return { d: yeni, degisti, rapor: { rehberdenYeni: r1.eklenen, rehberEslesen: r1.eslesen, odemeBaglandi: r2.odeme, krediBaglandi: r2.kredi, paraAyrildi: r3.ayrilan } };
}

// ── Borç taşı: tek bir borcu (grup / tekil ödeme / kredi) başka kişiye ────
// borcKey: 'g_<gid>' | 'pay_<id>' | 'cred_<id>'
export function borcTasi(d, borcKey, hedefId, rates) {
  const hedef = (d.persons || []).find(p => p.id === hedefId);
  if (!hedef) throw new Error('Hedef kişi bulunamadı.');
  const once = bakiyeler(d, rates);
  const n = _kopya(d);
  const tasinanPayIds = new Set();
  let credId = null, eskiAd = null;
  if (borcKey.startsWith('cred_')) {
    credId = borcKey.slice(5);
    const c = n.creds.find(x => String(x.id) === credId);
    if (!c) throw new Error('Kredi bulunamadı.');
    eskiAd = c.name;
    if (!c.desc && adAnahtari(c.name) !== adAnahtari(hedef.name)) c.desc = c.name;
    c.personId = hedef.id; c.name = hedef.name;
  } else {
    const liste = n.pays.filter(p => borcAnahtari(p) === borcKey);
    if (!liste.length) throw new Error('Borç bulunamadı.');
    liste.forEach(p => {
      eskiAd = eskiAd || p.name;
      if (!p.desc && adAnahtari(p.name) !== adAnahtari(hedef.name)) p.desc = p.name;
      p.personId = hedef.id; p.name = hedef.name;
      tasinanPayIds.add(String(p.id));
    });
  }
  const kaleminMi = x => x && ((credId != null && String(x._cid) === credId)
    || (credId != null && String(x._restructuredFrom) === credId) || (credId != null && String(x._closedFrom) === credId)
    || (x._cid == null && tasinanPayIds.has(String(x.id))));
  n.paidItems.forEach(x => { if (kaleminMi(x)) { x.personId = hedef.id; x.name = hedef.name; } });
  n.hist.forEach(x => { if (kaleminMi(x)) { x.personId = hedef.id; x.name = hedef.name; } });
  n.actLog.forEach(e => {
    const ref = e.hareket && e.hareket.ref;
    const refBu = ref && (ref.k === 'cred' ? String(ref.cid) === credId : tasinanPayIds.has(String(ref.id)));
    if (refBu || (credId != null && String(e.credId) === credId)) e.personId = hedef.id;
  });
  const sonra = bakiyeler(n, rates);
  if (!bakiyeEsit(once.toplam, sonra.toplam)) throw new Error('Taşıma toplam bakiyeyi değiştirdi — uygulanmadı.');
  return { d: n, eskiAd };
}

// ── Kişileri birleştir: kaynak kişilerin HER ŞEYİ hedefe geçer, kaynaklar silinir ──
export function kisiBirlestir(d, kaynakIds, hedefId, rates) {
  const kaynaklar = new Set((kaynakIds || []).filter(id => id && id !== hedefId));
  if (!kaynaklar.size) throw new Error('Birleştirilecek kişi seçilmedi.');
  const hedef0 = (d.persons || []).find(p => p.id === hedefId);
  if (!hedef0) throw new Error('Hedef kişi bulunamadı.');
  kaynaklar.forEach(id => { if (!(d.persons || []).some(p => p.id === id)) throw new Error('Kaynak kişi bulunamadı.'); });
  const once = bakiyeler(d, rates);
  const beklenen = { ...(once.kisiler[hedefId] || {}) };
  kaynaklar.forEach(id => Object.entries(once.kisiler[id] || {}).forEach(([p, v]) => { beklenen[p] = (beklenen[p] || 0) + v; }));

  const n = _kopya(d);
  const hedef = n.persons.find(p => p.id === hedefId);
  const kaynakAd = {};
  n.persons.filter(p => kaynaklar.has(p.id)).forEach(p => { kaynakAd[p.id] = p.name; _iletisimEkle(hedef, p); if (p.desc && !hedef.desc) hedef.desc = p.desc; });
  const etiketle = (x) => { if (!x.desc && adAnahtari(x.name) !== adAnahtari(hedef.name)) x.desc = x.name; };
  const tasinanCred = new Set(), tasinanPay = new Set();
  n.pays.forEach(p => { if (kaynaklar.has(p.personId)) { etiketle(p); p.personId = hedefId; p.name = hedef.name; tasinanPay.add(String(p.id)); } });
  n.creds.forEach(c => { if (kaynaklar.has(c.personId)) { etiketle(c); c.personId = hedefId; c.name = hedef.name; tasinanCred.add(String(c.id)); } });
  const bagli = x => x && (kaynaklar.has(x.personId)
    || (x._cid != null && tasinanCred.has(String(x._cid)))
    || (x._restructuredFrom != null && tasinanCred.has(String(x._restructuredFrom)))
    || (x._closedFrom != null && tasinanCred.has(String(x._closedFrom)))
    || (x._cid == null && tasinanPay.has(String(x.id))));
  n.paidItems.forEach(x => { if (bagli(x)) { x.personId = hedefId; x.name = hedef.name; } });
  n.hist.forEach(x => { if (bagli(x)) { x.personId = hedefId; x.name = hedef.name; } });
  n.actLog.forEach(e => { if (kaynaklar.has(e.personId) || (e.credId != null && tasinanCred.has(String(e.credId)))) e.personId = hedefId; });
  n.persons = n.persons.filter(p => !kaynaklar.has(p.id));

  const sonra = bakiyeler(n, rates);
  if (!bakiyeEsit(once.toplam, sonra.toplam)) throw new Error('Birleştirme toplam bakiyeyi değiştirdi — uygulanmadı.');
  if (!bakiyeEsit(beklenen, sonra.kisiler[hedefId] || {})) throw new Error('Hedef kişinin bakiyesi beklenenle tutmadı — uygulanmadı.');
  return { d: n, kaynakAdlar: Object.values(kaynakAd), bakiye: sonra.kisiler[hedefId] || {} };
}

// ── SAĞLAMA: veri doğru mu? (salt okuma) ─────────────────────────────────
// seviye: 'hata' (para yanlış olabilir) | 'uyari' (kontrol et) | 'bilgi'
export function saglama(d, rates, bugunISO) {
  const u = [];
  const ekle = (seviye, baslik, detay, key) => u.push({ seviye, baslik, detay, key: key || null });
  const kisiAd = new Map((d.persons || []).map(p => [p.id, p.name]));
  const b = bakiyeler(d, rates);

  b.bagsiz.forEach(x => {
    if (!Object.keys(x.bakiye).length) return;
    ekle('hata', 'Kişiye bağlı değil', x.ad + ' — bu borç hiçbir cari kartta görünmüyor. Cari karttan "Borç taşı / birleştir" ile doğru kişiye bağla.', x.key);
  });

  const kalemler = [];
  (d.pays || []).forEach(p => kalemler.push({ o: p, ad: p.name, key: borcAnahtari(p), tl: false }));
  (d.creds || []).forEach(c => (c.pays || []).forEach(t => kalemler.push({ o: { ...t, _cid: c.id }, ad: c.name + ' ' + t.idx + '. taksit', key: 'cred_' + c.id })));
  kalemler.forEach(({ o, ad, key }) => {
    const oz = kalemOzet(o, rates);
    const st = o.status || 'pending';
    if (!(Number(o.amount) > 0)) ekle('hata', 'Tutarı sıfır/boş kalem', ad + ' · ' + o.date, key);
    if (oz.kurYok && st !== 'paid') ekle('hata', 'Kur yok', ad + ' · ' + oz.para + ' kuru alınamadı, TL karşılığı hesaplanamıyor.', key);
    if (oz.odenen > oz.tam + tolerans(oz.para)) ekle('hata', 'Fazla ödenmiş', ad + ' · ' + o.date + ' · borç ' + oz.tam + ', ödenen ' + Math.round(oz.odenen * 100) / 100, key);
    if (st === 'pending' && (Number(o.paid) || 0) > tolerans(oz.para)) ekle('uyari', 'Durum tutarsız', ad + ' · ' + o.date + ' · "bekliyor" ama üzerinde ödeme var', key);
    if (st === 'partial' && !((Number(o.paid) || 0) > 0)) ekle('uyari', 'Durum tutarsız', ad + ' · ' + o.date + ' · "kısmi" ama ödeme tutarı yok', key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.date || ''))) ekle('hata', 'Tarihi bozuk kalem', ad + ' · "' + o.date + '"', key);
  });

  // Aynı borçta aynı ayda birden çok kalem (mükerrer olabilir)
  const ayKalem = new Map();
  (d.pays || []).forEach(p => {
    if ((p.status || 'pending') === 'paid') return;
    const k = borcAnahtari(p) + '|' + String(p.date).slice(0, 7);
    if (!ayKalem.has(k)) ayKalem.set(k, []);
    ayKalem.get(k).push(p);
  });
  ayKalem.forEach((liste, k) => {
    if (liste.length < 2) return;
    ekle('uyari', 'Aynı ayda birden çok ödeme', liste[0].name + ' · ' + String(liste[0].date).slice(0, 7) + ' · ' + liste.map(p => p.amount + (p.currency && p.currency !== 'TRY' ? ' ' + p.currency : '')).join(' + ') + ' — gerçekten ayrı ödemeler mi?', k.split('|')[0]);
  });

  // Karışık para birimli grup
  const grpPara = new Map();
  (d.pays || []).forEach(p => { if (p.groupId) { if (!grpPara.has(p.groupId)) grpPara.set(p.groupId, new Set()); grpPara.get(p.groupId).add(p.currency || 'TRY'); } });
  grpPara.forEach((s, g) => { if (s.size > 1) ekle('uyari', 'Bir borçta birden çok para birimi', 'Grup ' + g + ': ' + [...s].join(', '), 'g_' + g); });

  // Kredi taksit düzeni
  (d.creds || []).forEach(c => {
    const idx = (c.pays || []).map(t => t.idx);
    if (new Set(idx).size !== idx.length) ekle('hata', 'Kredide tekrar eden taksit no', c.name, 'cred_' + c.id);
    const tarihler = (c.pays || []).map(t => t.date).filter(Boolean);
    const sirali = [...tarihler].sort();
    if (tarihler.join() !== sirali.join()) ekle('uyari', 'Kredi taksit tarihleri sırasız', c.name, 'cred_' + c.id);
  });

  // Ödeme hareketleri kalemle tutarlı mı
  const hrk = new Map();
  (d.actLog || []).forEach(e => {
    if (!e || !e.hareket || e.hareket.iptal) return;
    const r = e.hareket.ref;
    const k = r.k === 'cred' ? 'c|' + r.cid + '|' + r.ii : 'p|' + r.id;
    hrk.set(k, (hrk.get(k) || 0) + (Number(e.hareket.tutar) || 0));
  });
  hrk.forEach((tutar, k) => {
    const [t, a, bb] = k.split('|');
    let o = null;
    if (t === 'c') { const c = (d.creds || []).find(x => String(x.id) === a); o = c && (c.pays || []).find(x => x.idx === Number(bb)); }
    else o = (d.pays || []).find(x => String(x.id) === a);
    if (!o) return;       // kalem silinmiş/yapılandırılmış: hareket salt-okunur, parayı etkilemez
    if (tutar > (Number(o.paid) || 0) + 0.5 && (o.currency || 'TRY') === 'TRY') ekle('uyari', 'Hareket kalemden büyük', k + ' · hareket ' + tutar + ', kalemde ' + (o.paid || 0));
  });

  // Aynı adlı iki kişi
  const adlar = new Map();
  (d.persons || []).forEach(p => { const k = adAnahtari(p.name); if (!adlar.has(k)) adlar.set(k, []); adlar.get(k).push(p.name); });
  adlar.forEach(l => { if (l.length > 1) ekle('uyari', 'Aynı adlı kişiler', l.join(' / ') + ' — aynı kişiyse birleştir.'); });

  // Gecikmiş (bilgi)
  let gecN = 0;
  kalemler.forEach(({ o }) => { if (kalemOzet(o, rates).kalan > 0 && String(o.date) < bugunISO) gecN++; });
  if (gecN) ekle('bilgi', 'Gecikmiş ödeme', gecN + ' kalemin tarihi geçmiş ve ödenmemiş görünüyor. Ödediysen "Öde" ile işaretle; plan buna göre düzelir.');

  const sira = { hata: 0, uyari: 1, bilgi: 2 };
  u.sort((a, b2) => sira[a.seviye] - sira[b2.seviye]);
  return { bakiye: b, uyarilar: u, kisiAd };
}

if (typeof window !== 'undefined') {
  window.KisiVeri = { adAnahtari, borcAnahtari, bakiyeler, bakiyeEsit, rehberiKat, baglariKur, paraGruplariniAyir, veriDuzenle, borcTasi, kisiBirlestir, saglama };
}
