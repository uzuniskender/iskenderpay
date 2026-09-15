// js/para.js — iskenderpay
// PARA ÇEKİRDEĞİ — bir kalemin tutar / ödenen / kalan hesabının TEK kaynağı.
// Plan tablosu, özet kartları, cari kart, telefon ana sayfası, sağlama hepsi bunu kullanır;
// iki ekranın aynı borç için farklı rakam göstermesi yapısal olarak imkânsız olur.
//
// KURAL (v8.234):
//   • Borç kendi para biriminde tutulur: TRY / EUR / GOLD (gram). Kredi taksiti her zaman TRY.
//   • Ödenen de KALEMİN PARA BİRİMİNDE tutulur. 2 gr altının 1 gramı ödendiyse kalan 1 gr'dır;
//     kur değişince kalan gram DEĞİŞMEZ, yalnız TL karşılığı değişir.
//   • Eski kayıtlar: dövizli kalemde `paid` TL olarak yazılmıştı. `odenenPara` işareti olmayan
//     dövizli kalemin `paid`'i TL kabul edilip bugünkü kurla çevrilir (geçmiş veriye dokunmadan).
//     Yeni yazmalar `odenenPara` işaretini koyar.
//   • TL karşılığı = kalan × bugünkü kur. Kur yoksa `kurYok` döner (ekran uyarır, sessizce 1 saymaz).

export const PARALAR = ['TRY', 'EUR', 'GOLD'];

// Para birimine göre "sıfır sayılır" toleransı: TL'de 50 kuruş, gram/euroda 0,005
export function tolerans(para) { return para === 'TRY' ? 0.5 : 0.005; }

export function kalemParasi(p) {
  if (!p) return 'TRY';
  if (p._cid != null) return 'TRY';
  return p.currency || 'TRY';
}

// 1 birimin TL değeri; TRY=1. Kur yoksa null.
export function kur(para, rates) {
  if (para === 'TRY') return 1;
  const r = rates && rates[para];
  return r > 0 ? r : null;
}

const _yuvarla = (x, para) => {
  const k = para === 'TRY' ? 100 : 10000;
  return Math.round(x * k) / k;
};

// Kalemdeki ödenen tutar, kalemin kendi parasında
export function odenenYerel(p, rates) {
  const para = kalemParasi(p);
  const pd = Number(p && p.paid) || 0;
  if (para === 'TRY' || p.odenenPara === para) return pd;
  const r = kur(para, rates);
  return r ? pd / r : 0;       // eski kayıt: paid TL yazılmış
}

// Kalemin tam özeti. Tüm ekranlar bunu okur.
export function kalemOzet(p, rates) {
  const para = kalemParasi(p);
  const tam = Number(p && p.amount) || 0;
  const st = (p && p.status) || 'pending';
  let odenen = odenenYerel(p, rates);
  if (st === 'paid' && odenen < tam) odenen = tam;          // eski "ödendi" (paid alanı eksik) = tamamı
  const kalanHam = Math.max(0, tam - odenen);
  const kalan = st === 'paid' || kalanHam <= tolerans(para) ? 0 : kalanHam;
  const r = kur(para, rates);
  const tl = x => (r == null ? 0 : x * r);
  const durum = kalan === 0 ? 'paid' : odenen > tolerans(para) ? 'partial' : 'pending';
  return { para, tam, odenen, kalan, tamTL: tl(tam), odenenTL: tl(Math.min(odenen, tam)), kalanTL: tl(kalan), durum, kurYok: r == null };
}

// Kaleme kendi parasında delta ekle/çıkar -> yazılacak alanlar. Saf.
export function odemePatch(p, deltaYerel, rates) {
  const para = kalemParasi(p);
  const tam = Number(p && p.amount) || 0;
  const onceki = ((p && p.status) === 'paid' && !(Number(p.paid) > 0)) ? tam : odenenYerel(p, rates);
  let yeni = _yuvarla(Math.max(0, onceki + deltaYerel), para);
  const tol = tolerans(para);
  if (yeni <= tol / 100) yeni = 0;
  const status = yeni <= 0 ? 'pending' : (yeni >= tam - tol ? 'paid' : 'partial');
  const patch = { paid: yeni, status };
  if (para !== 'TRY') patch.odenenPara = para;
  return patch;
}

// Kalemi tamamen ödenmiş yap
export function tamOdePatch(p, rates) {
  const oz = kalemOzet(p, rates);
  return odemePatch(p, oz.tam - oz.odenen, rates);
}

// Para birimi bazında toplam: {TRY:x, EUR:y, GOLD:z}
export function paraTopla(ozetler) {
  const t = {};
  ozetler.forEach(o => { if (o.kalan > 0) t[o.para] = (t[o.para] || 0) + o.kalan; });
  return t;
}

export function paraTL(toplam, rates) {
  return Object.keys(toplam).reduce((s, para) => s + toplam[para] * (kur(para, rates) || 0), 0);
}

// "₺140.000 + 38 gr + €5.820"
export function paraYazi(toplam, fmtA) {
  const sira = PARALAR.filter(p => toplam[p] > tolerans(p));
  if (!sira.length) return fmtA(0, 'TRY');
  return sira.map(p => fmtA(toplam[p], p)).join(' + ');
}

if (typeof window !== 'undefined') {
  window.Para = { kalemParasi, kur, odenenYerel, kalemOzet, odemePatch, tamOdePatch, paraTopla, paraTL, paraYazi, tolerans, PARALAR };
}
