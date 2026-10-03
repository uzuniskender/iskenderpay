// js/util.js — iskenderpay
// Saf yardimci fonksiyonlar; side-effect yok. Dis bagimlilik: @ozler/shared
// (TR tarih cekirdegi date.js + TR arama normalize text.js, Faz C / Yol B).
// parseLocalDate + fmtD + araNormalize shared'e koprulendi; tarayicida
// @ozler/shared / @ozler/shared/text, index.html import-map ile ./shared/'a cozulur.

import { parseLocalDateTR, formatDateTR } from '@ozler/shared';
import { araNormalize as _araNormalizeShared } from '@ozler/shared/text';

// ── HTML kaçış ───────────────────────────────────────────────────────────────
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

// ── Para formatları ──────────────────────────────────────────────────────────
export function fmt(n) {
  return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtA(a, c) {
  if (c === 'EUR')  return '€' + Number(a).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c === 'GOLD') return Number(a).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'gr';
  return window.fmt(a);
}

export function fmtAmt(a, c) {
  return (c && c !== 'TRY' ? c + ' ' : '₺') + Number(a).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
}

// rates dışarıdan geçirilir — util.js bağımlılık almaz
export function toTRY(a, c, rates) {
  if (c === 'EUR'  && rates?.EUR)  return a * rates.EUR;
  if (c === 'GOLD' && rates?.GOLD) return a * rates.GOLD;
  return Number(a);
}

// ── Tarih yardımcıları ───────────────────────────────────────────────────────
export function parseLocalDate(s) {
  return parseLocalDateTR(s); // @ozler/shared — yerel gece yarisi, TZ-guvenli
}

export function toLocalISO(yr, mo, day) {
  return yr + '-' + String(mo + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

export function fmtD(s) {
  return formatDateTR(s, 'daymonth'); // @ozler/shared — "12 Mayis" / "1 Ocak"
}

export function fmtLogTime(iso) {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = now - d;
  if (diff < 60000)    return 'Az önce';
  if (diff < 3600000)  return Math.floor(diff / 60000)   + ' dk önce';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' sa önce';
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mn = d.getMinutes().toString().padStart(2, '0');
  return dd + '.' + mm + ' ' + hh + ':' + mn;
}

// ── Turkce-duyarli arama normalizasyonu ──────────────────────────────────────
// Faz C / Yol B: @ozler/shared/text#araNormalize'e koprulendi (TEK kanonik kaynak;
// UYS de ayni kaynagi kullanir). Onceki yerel kopya text.js'e tasindi.
// Iki tarafa da uygulanmali: araNormalize(metin).includes(araNormalize(sorgu)).
export function araNormalize(s) {
  return _araNormalizeShared(s); // @ozler/shared/text — aksana duyarsiz
}

export function todayMidnight() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// 'Tumu' ay filtresi: mevcut aydan EN UZAK odemeye kadarki ileri ay sayisi
// (mevcut ay dahil). Ornek: en uzak odeme bugunden 17 ay sonra -> 18 doner
// (render dongusu i=0..17 -> 18 ay gosterir, son taksit dahil). Bos/gecmis-only
// veri -> 1 (mevcut ay). parseLocalDate ile TZ-guvenli ay farki.
export function maxAheadMonths(all, now) {
  const ref  = now || new Date();
  const nowY = ref.getFullYear(), nowM = ref.getMonth();
  let maxDiff = 0;
  (all || []).forEach(p => {
    if (!p || !p.date) return;
    const d = parseLocalDate(p.date);
    const diff = (d.getFullYear() - nowY) * 12 + (d.getMonth() - nowM);
    if (diff > maxDiff) maxDiff = diff;
  });
  return maxDiff + 1;
}

// v8.244: Aylık Plan penceresi. aheadRaw: 'all' | '3' | '18' ...
// Sayısal pencerede (N ay) pencereyi aşan ödeme varsa ilk N-1 ay ayrı sütun,
// N. sütun "Sonrası" (o aydan itibaren tüm aylar toplamı). Aşan yoksa N ay ayrı.
// Dönüş: { tekAy: ayrı gösterilecek ileri ay sayısı (bu ay dahil), sinirMK: 'YYYY-MM' | null }
export const PLAN_VARSAYILAN_AY = 18;
export function planPenceresi(all, now, aheadRaw) {
  const ref = now || new Date();
  const enUzak = maxAheadMonths(all, ref);
  if (aheadRaw === 'all') return { tekAy: enUzak, sinirMK: null };
  const n = parseInt(aheadRaw) || PLAN_VARSAYILAN_AY;
  if (enUzak <= n) return { tekAy: n, sinirMK: null };
  const d = new Date(ref.getFullYear(), ref.getMonth() + n - 1, 1);
  return { tekAy: n - 1, sinirMK: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') };
}

// ── Ödeme durum yardımcıları ─────────────────────────────────────────────────
export function isOD(p) {
  return (p.status || 'pending') !== 'paid' && parseLocalDate(p.date) < todayMidnight();
}

export function sCls(s, over) {
  return s === 'paid' ? 'cp' : s === 'partial' ? 'ck' : over ? 'cg' : 'cb';
}

export function sLbl(s, over) {
  return s === 'paid' ? 'Ödendi' : s === 'partial' ? 'Kısmi' : over ? 'Gecikmiş' : 'Bekliyor';
}

