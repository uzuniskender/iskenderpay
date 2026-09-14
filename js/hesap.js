// js/hesap.js — iskenderpay (v1.0)
// Merkezi hesap modulu. Plan matrisi, ayarlar paneli ve kredi kart paneli
// ayni hesaplari (bu ay ozeti, toplam bekleyen, kredi listesi, trend)
// burada ortak yapar — tutarsizlik kalmaz.
//
// API:
//   Hesap.buAyOzeti({all?, refDate?}) -> { tot, ok, bek, gec, okN, bekN, gecN, itemCount }
//   Hesap.toplamOzeti()               -> { paysBekleyen, krediBekleyen, toplam }
//   Hesap.krediler()                  -> [{ cred, dispName, paid, total, remaining, bekleyen, pct, nextPay, nextDays, overdueCount, lastDate, done }]
//   Hesap.trend(n)                    -> [{ lbl, tot, monthKey, count }]
//
// Display name yardimcilari (paylasilan):
//   Hesap._baseOf(name)               -> sondaki sayiyi soyer ("QNB 1" -> "QNB")
//   Hesap._displayNames(mx, keys?)    -> { rawKey: displayName } haritasi

import { todayMidnight, toTRY, toLocalISO } from './util.js';

function _all() {
  if (typeof window.getAllItems === 'function') return window.getAllItems();
  const credPays = [];
  (window.creds||[]).forEach(c => (c.pays||[]).forEach(p =>
    credPays.push({...p, name:c.name, currency:'TRY', _cid:c.id, _ii:p.idx})));
  return [...(window.pays||[]), ...credPays];
}

function _mx() {
  if (typeof window.buildMx === 'function') return window.buildMx(_all());
  return {};
}

function _baseOf(name) {
  const n = name || '';
  return n.replace(/ \d+$/, '').trim() || n;
}

// Disambiguated display name map — v8.229 KOK COZUM (20 Agu 2026).
//
// ESKI DAVRANIS ve NEDEN BOZUKTU:
//   Uc ayri adlandirma kolu (personId / legacy noPid / cred) TEK isim alanina yaziyor
//   ama birbirinin ciktisini gormuyordu; dnMap uzerinde son bir benzersizlik kapisi yoktu.
//   Ustune legacy kol _baseOf ile kullanicinin YAZDIGI soneki soyup countMap/idxMap ile
//   YENIDEN numaraliyordu (idx-1). Saha sonucu (Serdar verisi, 40 satir):
//     ham "ZELIHA 1" -> ekranda "ZELIHA (Kredi)"
//     ham "ZELIHA 2" -> ekranda "ZELIHA 1 (Kredi)"   <-- BASKA KALEMIN NUMARASI
//     ham "ZELIHA 3" -> ekranda "ZELIHA"
//   ve 3 cift satir birebir ayni etiketi tasiyordu (gercek gecikmis borclar karistirilabilirdi).
//
// YENI KURAL — TEK ISIM ALANI, TEK KAPI:
//   1) TABAN AD = KULLANICININ YAZDIGI AD. Gosterimde _baseOf CAGRILMAZ.
//      (_baseOf gruplama icin yerinde duruyor: ui-pay#_resolvePersonId, ui-persons, app.js
//       backfill. Orasi kisi eslestirmesi, gosterim degil — DOKUNULMADI.)
//   2) cred satiri "(Kredi)" tasir (v8.125 davranisi korunur).
//   3) Cakisma varsa KADEMELI ayirt et; her kademe yalnizca GEREKTIGINDE devreye girer:
//        a) ayirt edici etiket (desc / kategori)
//        b) cred ise taksit sayisi
//        c) SIRADAKI ODENMEMIS AY  (gecmis degil, "anlik ve sonrasi" — Serdar)
//        d) son care: satir anahtarinin son 4 hanesi (anahtarlar benzersiz -> KAPANIS GARANTILI)
//   Ek bilgi yalniz gerektiginde eklenir; ayrimi olmayan satirlar sade kalir.
function _displayNames(mx, keys) {
  const allKeys = (keys && keys.length)
    ? keys
    : Object.keys(mx).filter(k => mx[k]._name !== undefined);

  // Her rowKey icin meta: kisi, ayirt edici etiket, taksit sayisi, zaman capasi
  const meta = {};
  allKeys.forEach(k => {
    const aylar = Object.keys(mx[k]).filter(x => !x.startsWith('_')).sort();
    const ilk = aylar.length ? mx[k][aylar[0]].items[0] : null;
    // CAPA: sıradaki ODENMEMIS ay; hepsi odendiyse son ay. Gecmise degil one bakar.
    const acik = aylar.find(m => (mx[k][m].status || 'pending') !== 'paid');
    meta[k] = {
      tag:  ilk ? (ilk.desc || ilk.category || null) : null,
      taksit: aylar.reduce((s, m) => s + (mx[k][m].items || []).length, 0),
      capa: acik || aylar[aylar.length - 1] || null
    };
  });

  // (1) Taban ad = ham ad (kullanicinin yazdigi)
  const dnMap = {};
  allKeys.forEach(k => { dnMap[k] = mx[k]._name || k; });

  // (2) Kredi satirlari "(Kredi)" tasir
  // v8.231: cari karttan aciklama verilmis kredi kendi adiyla gorunur ("ALI (Araç)"), yoksa "(Kredi)"
  allKeys.forEach(k => { if (k.startsWith('cred_')) dnMap[k] = dnMap[k] + ' (' + (meta[k].tag || 'Kredi') + ')'; });

  // (3) TEK BENZERSIZLIK KAPISI — kademeli, her kademe sonrasi yeniden gruplanir
  const cakisanlar = () => {
    const g = {};
    allKeys.forEach(k => { (g[dnMap[k]] = g[dnMap[k]] || []).push(k); });
    return Object.keys(g).map(x => g[x]).filter(x => x.length > 1);
  };
  const kademe = (secici) => {
    cakisanlar().forEach(ks => {
      const d = ks.map(secici);
      if (new Set(d).size < 2) return;          // bu kademe ayirt etmiyor -> dokunma
      ks.forEach((k, i) => { if (d[i]) dnMap[k] = dnMap[k] + d[i]; });
    });
  };
  kademe(k => meta[k].tag ? ' (' + meta[k].tag + ')' : '');
  kademe(k => k.startsWith('cred_') ? ' · ' + meta[k].taksit + ' taksit' : '');
  kademe(k => meta[k].capa ? ' · ' + meta[k].capa.slice(5) + '/' + meta[k].capa.slice(0, 4) : '');
  kademe(k => ' #' + k.slice(-4));              // kapanis: anahtar benzersiz

  return dnMap;
}

// ── Tek "kalan tutar" kaynagi (v8.170) ─────────────────────────────────────
// Bir kalemin bekleyen tutari = max(0, TRY tutar - kismi odenen). Partial paid'i
// hesaba katar. currency verilirse toTRY ile cevrilir; cred taksitleri amount
// zaten TRY oldugundan currency'siz cagrilir. toplamOzeti / krediler /
// _buildPersonSummary HEPSI bunu kullanir -> formul tek yerde, sapamaz.
function kalan(amount, paid, currency) {
  const t = currency ? toTRY(amount, currency, window.rates) : (amount || 0);
  return Math.max(0, t - (paid || 0));
}

// ── KREDİ YAPILANDIRMA — saf çekirdek (v8.208) ─────────────────────────────
// Gerçek yapılandırma: kredinin kalan planı yerine SIFIRDAN yeni taksit planı
// kurulur. editCred'in "index ile paid koru" mantığından BİLİNÇLİ farklı — yeni
// plan ileriye dönük ve temiz (hepsi pending); geçmiş ödenmiş taksitler pays'e
// taşınmaz, loglar + paidItems (trend) tarafında korunur.
//
// saveCred'deki pArr tarih mantığının AYNISI (ay/yıl taşması + ay-sonu clamp);
// tek kaynak burada -> saveCred ile yapılandırma sapmaz.
function yapilandirPlan(start, inst, monthly) {
  const [sy, sm0, sd] = String(start).split('-').map(Number);
  const sm = sm0 - 1;
  return Array.from({ length: inst }, (_, i) => {
    const totalMo = sm + i;
    const yr = sy + Math.floor(totalMo / 12);
    const mo = ((totalMo % 12) + 12) % 12;
    const lastDay = new Date(yr, mo + 1, 0).getDate();
    return { idx: i + 1, date: toLocalISO(yr, mo, Math.min(sd, lastDay)), amount: monthly, status: 'pending', paid: 0 };
  });
}

// Eski krediye bağlı paidItems'ı DONDURUR: _cid/_ii bağını koparır.
// GEREKÇE: kredi taksiti ödenince paidItems'a (_cid + _ii=idx) düşer; yeni plan
// idx'i 1'den başlattığı için eski paidItems (aynı _cid, _ii=1) ile ÇAKIŞIR ->
// _findPaidIdx (ui-plan-actions) yanlış kaydı bulur, geri-al bozulur. Bağı
// koparınca çakışma biter; trend() date+paid kullandığından geçmiş bozulmaz.
// Saf: girdiyi MUTATE ETMEZ, yeni dizi döner (caller Store.replace ile yazar).
function dondurKrediPaidItems(paidItems, credId, iso) {
  let frozen = 0;
  const result = (paidItems || []).map(pi => {
    if (pi && pi._cid != null && String(pi._cid) === String(credId)) {
      frozen++;
      return { ...pi, _cid: null, _ii: null, _restructuredFrom: credId, _restructAt: iso };
    }
    return pi;
  });
  return { frozen, result };
}

export const Hesap = {
  // ── Bu ay ozeti ──────────────────────────────────────────────────────────
  // opts.all  — caller'in zaten hesapladigi all items (perf)
  // opts.refDate — varsayilan: new Date() (bugun)
  buAyOzeti(opts) {
    opts = opts || {};
    const all = opts.all || _all();
    const ref = opts.refDate || new Date();
    const rY = ref.getFullYear(), rM = ref.getMonth();
    const buAy = all.filter(p => {
      const d = window.parseLocalDate(p.date);
      return d.getFullYear() === rY && d.getMonth() === rM;
    });
    let tot = 0, ok = 0, bek = 0, gec = 0, okN = 0, bekN = 0, gecN = 0;
    buAy.forEach(p => {
      const t = toTRY(p.amount, p.currency || 'TRY', window.rates);
      tot += t;
      const s = p.status || 'pending';
      if (s === 'paid')        { ok += t; okN++; }
      else if (window.isOD(p)) { gec += t; gecN++; }
      else                     { bek += t; bekN++; }
    });
    return { tot, ok, bek, gec, okN, bekN, gecN, itemCount: buAy.length };
  },

  // ── Tum bekleyen borc ────────────────────────────────────────────────────
  // pays.paid TRY cinsinden (markOk -> toTRY yapiyor); cred.pays.amount zaten TRY.
  toplamOzeti() {
    const paysBekleyen = (window.pays || [])
      .filter(p => (p.status || 'pending') !== 'paid')
      .reduce((s, p) => s + kalan(p.amount, p.paid, p.currency || 'TRY'), 0);
    const krediBekleyen = (window.creds || [])
      .reduce((s, c) => s + (c.pays || [])
        .filter(p => (p.status || 'pending') !== 'paid')
        .reduce((a, p) => a + kalan(p.amount, p.paid), 0), 0);
    return {
      paysBekleyen,
      krediBekleyen,
      toplam: paysBekleyen + krediBekleyen
    };
  },

  // ── Kredi kart paneli icin hazir liste ───────────────────────────────────
  // Display name plan matrisiyle ayni (suffix mantigi paylasilan).
  krediler() {
    const mx = _mx();
    const dnMap = _displayNames(mx);
    const today = todayMidnight();
    return (window.creds || []).map(cr => {
      const credKey = 'cred_' + cr.id;
      const dispName = dnMap[credKey] || _baseOf(cr.name);
      const items = cr.pays || [];
      const paid = items.filter(p => (p.status || 'pending') === 'paid').length;
      const total = items.length;
      const remaining = total - paid;
      const bekleyen = items
        .filter(p => (p.status || 'pending') !== 'paid')
        .reduce((s, p) => s + kalan(p.amount, p.paid), 0);
      const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
      const nextPay = items.find(p => (p.status || 'pending') !== 'paid');
      const done = paid === total;
      const lastDate = items.length ? items[items.length - 1].date : null;
      // Gecikmiş taksit sayısı: status!=='paid' && tarih < bugün
      const overdueCount = items.filter(p => window.isOD(p)).length;
      // Bir sonraki ödenmemiş taksit için gün farkı (negatif=geçmiş, 0=bugün, pozitif=gelecek)
      const nextDays = nextPay && nextPay.date
        ? Math.round((window.parseLocalDate(nextPay.date) - today) / 86400000)
        : null;
      return { cred: cr, dispName, paid, total, remaining, bekleyen, pct, nextPay, nextDays, overdueCount, lastDate, done };
    });
  },

  // ── Son N ay gerceklesen odeme trendi ────────────────────────────────────
  // Bugunden geriye dogru n ay (bugun dahil): trend(3) = [iki ay onceki, gecen ay, bu ay]
  trend(n) {
    n = n || 3;
    const now = new Date();
    const nowY = now.getFullYear(), nowM = now.getMonth();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const tM = new Date(nowY, nowM - i, 1);
      const tY = tM.getFullYear(), tMo = tM.getMonth();
      const mk = tY + '-' + String(tMo + 1).padStart(2, '0');
      const mPays = (window.paidItems || []).filter(p => {
        const d = window.parseLocalDate(p.date);
        return d.getFullYear() === tY && d.getMonth() === tMo;
      });
      const tot = mPays.reduce((s, p) =>
        s + (p.paid || toTRY(p.amount, p.currency || 'TRY', window.rates)), 0);
      out.push({
        lbl: tM.toLocaleDateString('tr-TR', { month: 'short' }),
        tot,
        monthKey: mk,
        count: mPays.length
      });
    }
    return out;
  },

  // ── Paylasilan yardimcilar ────────────────────────────────────────────────
  kalan,
  _baseOf,
  _displayNames,
  yapilandirPlan,
  dondurKrediPaidItems
};

window.Hesap = Hesap;
console.log('[Hesap] hazir.');
