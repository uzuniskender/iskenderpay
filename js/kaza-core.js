// js/kaza-core.js — iskenderpay (v8.247)
// Kaza namazı takvimi SAF hesapları (DOM / Firestore bilmez; tests/kaza.test.js).
//
// Veri: { baslangic: 'YYYY-MM-DD', g: { 'YYYY-MM-DD': maske } }
//   maske 5 bit: bit0 Sabah, bit1 Öğle, bit2 İkindi, bit3 Akşam, bit4 Yatsı. 0 olan gün yazılmaz.

export const VAKITLER = ['Sabah', 'Öğle', 'İkindi', 'Akşam', 'Yatsı'];
export const TAM = 31;

const pad = n => String(n).padStart(2, '0');
export const isoGun = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const gunTarih = s => { const [y, m, g] = String(s).split('-').map(Number); return new Date(y, m - 1, g); };

export function bosVeri(baslangic = '1994-01-01') { return { baslangic, g: {} }; }

export function bitSay(m) { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }

// Bir vakti aç/kapat; yeni veri döner (girdi değişmez)
export function vakitDegistir(veri, iso, vakit) {
  const g = { ...(veri.g || {}) };
  const yeni = (g[iso] || 0) ^ (1 << vakit);
  if (yeni) g[iso] = yeni; else delete g[iso];
  return { ...veri, g };
}

// Başlangıçtan bugüne (dahil) toplam / kılınan / vakit başına kalan
export function ozet(veri, bugun) {
  const bas = gunTarih(veri.baslangic), son = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
  const gunSayisi = son < bas ? 0 : Math.round((son - bas) / 864e5) + 1;
  const vakit = [0, 0, 0, 0, 0];
  const basIso = isoGun(bas), sonIso = isoGun(son);
  for (const [iso, m] of Object.entries(veri.g || {})) {
    if (iso < basIso || iso > sonIso) continue;
    for (let i = 0; i < 5; i++) if (m & (1 << i)) vakit[i]++;
  }
  const kilinan = vakit.reduce((a, b) => a + b, 0);
  return { gunSayisi, toplam: gunSayisi * 5, kilinan, kalan: gunSayisi * 5 - kilinan, vakitKalan: vakit.map(v => gunSayisi - v) };
}

// İlk (geriden=false) ya da son (geriden=true) eksik gün; yoksa null
export function eksikGun(veri, bugun, geriden) {
  const bas = gunTarih(veri.baslangic), son = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
  const d = geriden ? new Date(son) : new Date(bas);
  while (geriden ? d >= bas : d <= son) {
    if (((veri.g || {})[isoGun(d)] || 0) !== TAM) return new Date(d);
    d.setDate(d.getDate() + (geriden ? -1 : 1));
  }
  return null;
}

// Kayıttan gelen veriyi doğrula (bozuk alanlar atılır)
export function veriTemizle(ham) {
  const out = bosVeri();
  if (ham && /^\d{4}-\d{2}-\d{2}$/.test(ham.baslangic || '')) out.baslangic = ham.baslangic;
  for (const [iso, m] of Object.entries((ham && ham.g) || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isInteger(m) && m > 0 && m <= TAM) out.g[iso] = m;
  }
  return out;
}
