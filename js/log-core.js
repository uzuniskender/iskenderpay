// js/log-core.js — iskenderpay (v8.239)
// Log ekranının SAF çekirdeği (DOM/Store yok -> test edilir).
//
// Sade model (Serdar, 16 Eyl: "o kadar çok filtre var ki kafa karıştırıyor"):
//   - tek arama kutusu (kişi, kalem, tutar, açıklama)
//   - zaman: tümü / bugün / 7 gün / 30 gün
//   - tür:   tümü / ödemeler / değişiklikler   (+ ayrı "silinen kayıtlar" görünümü)
//   - kişi:  satırdaki 👤'e dokununca gelen, kaldırılabilir tek etiket
// Liste güne göre gruplanır ("Bugün", "Dün", "12 Eylül Cuma").

import { araNormalize } from './util.js';

export const ZAMANLAR = [
  { k: 'tum', ad: 'Tümü' }, { k: 'bugun', ad: 'Bugün' }, { k: '7', ad: '7 gün' }, { k: '30', ad: '30 gün' },
];
export const TURLER = [
  { k: 'tum', ad: 'Tümü' }, { k: 'odeme', ad: '💰 Ödemeler' }, { k: 'degisiklik', ad: '✏️ Değişiklikler' }, { k: 'silinen', ad: '🗑 Silinen kayıtlar' },
];

export function logTuru(e) { return e && e.type === 'paid' ? 'odeme' : 'degisiklik'; }

// Ödeme logunun durumu: 'aktif' (plana yazılı) | 'geri' (geri alınmış) | 'eski' (hareketsiz eski kayıt) | null
export function odemeDurumu(e) {
  if (!e || e.type !== 'paid') return null;
  if (!e.hareket) return 'eski';
  return e.hareket.iptal ? 'geri' : 'aktif';
}

function _gunBasi(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function zamandaMi(iso, zaman, simdi) {
  if (!zaman || zaman === 'tum') return true;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return false;
  const bugun = _gunBasi(simdi);
  if (zaman === 'bugun') return t >= bugun;
  const gun = Number(zaman);
  if (!gun) return true;
  const bas = new Date(bugun); bas.setDate(bas.getDate() - (gun - 1));
  return t >= bas;
}

// f: {ara, zaman, tur, kisi}; kisiAdi: personId -> ad (aramada kişi adı da eşleşsin)
export function logFiltrele(liste, f, simdi, kisiAdi) {
  f = f || {};
  const q = araNormalize(String(f.ara || '').trim());
  return (liste || []).filter(e => {
    if (!e) return false;
    if (f.kisi && e.personId !== f.kisi) return false;
    if (f.tur && f.tur !== 'tum' && logTuru(e) !== f.tur) return false;
    if (!zamandaMi(e.at, f.zaman, simdi)) return false;
    if (q) {
      const ad = kisiAdi ? kisiAdi(e.personId) || '' : '';
      const tutar = e.hareket ? String(e.hareket.tutar) : '';
      const metin = araNormalize([e.title, e.detail, e.not, ad, tutar].join(' '));
      if (!q.split(/\s+/).every(p => metin.includes(p))) return false;
    }
    return true;
  });
}

export function gunEtiketi(iso, simdi) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Tarihsiz';
  const fark = Math.round((_gunBasi(simdi) - _gunBasi(d)) / 86400000);
  if (fark === 0) return 'Bugün';
  if (fark === 1) return 'Dün';
  const opt = { day: 'numeric', month: 'long', weekday: 'long' };
  if (d.getFullYear() !== new Date(simdi).getFullYear()) opt.year = 'numeric';
  return d.toLocaleDateString('tr-TR', opt);
}

// Yeni -> eski sıralı, güne göre grup: [{etiket, kayitlar}]
export function gunGrupla(liste, simdi) {
  const sirali = [...(liste || [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const gruplar = [];
  let son = null;
  sirali.forEach(e => {
    const et = gunEtiketi(e.at, simdi);
    if (!son || son.etiket !== et) { son = { etiket: et, kayitlar: [] }; gruplar.push(son); }
    son.kayitlar.push(e);
  });
  return gruplar;
}

export function saatYaz(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// Toplu silme planı. geriAl=true: aktif ödemeler önce geri alınır; geri alınamayan
// (kalemi silinmiş/değişmiş) kayıt SİLİNMEZ, "atla" listesine nedeniyle düşer (hayalet/eksi para yok).
// kontrol(hareket) -> {ok, neden}
export function silmePlani(kayitlar, geriAl, kontrol) {
  const plan = { sil: [], geriAl: [], atla: [] };
  (kayitlar || []).forEach(e => {
    if (!e) return;
    if (geriAl && odemeDurumu(e) === 'aktif') {
      const g = kontrol ? kontrol(e.hareket) : { ok: true };
      if (!g.ok) { plan.atla.push({ e, neden: g.neden }); return; }
      plan.geriAl.push(e);
    }
    plan.sil.push(e);
  });
  return plan;
}
