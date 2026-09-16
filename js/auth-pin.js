// js/auth-pin.js — iskenderpay (v1.0)
// PIN dogrulama (doLogin) + sifre degistir (chPass) akislari.
// db.js'ten ayristirildi (v8.110) — auth concern'leri tek dosyada.
// Bagimliliklar: crypto.js, compat.js, persist.js (loadSecure), firestore.js (PIN/wrappedKey helpers).
// v8.187: oturum sirlari Store.session -> Session closure (js/session.js).
//   - cryptoKey her iki yolda da NON-EXTRACTABLE olarak resident tutulur.
//   - dataKeyRaw ARTIK resident DEGIL; chPass re-wrap'i ham anahtari mevcut PIN ile
//     wrapped-blob'tan anlik unwrap edip kullanir (ephemeral key wrap).
// WO-15 (2026-05-30): "yeni kullanici" dali GUVENLIK KILIDI. Offline/FB-okuma-hatasi
//   veya mevcut verisi/anahtari olan bir planda ASLA rastgele yeni data key uretilmez
//   (aksi halde mevcut veri kalici kilitlenir — bkz. 2026-05-30 veri kurtarma vakasi).

import { Session } from './session.js';
import { shouldMintNewKey } from './keyguard.js';   // WO-15 invaryant (saf, test edilir)
import { wrapDataKey, unwrapDataKey } from './crypto.js';
import { oturumKaydet } from './oturum-hatirla.js';   // v8.238 açık kalsın

// ── doLogin ───────────────────────────────────────────────────────────────────

async function doLogin() {
  const val = document.getElementById('PI').value;
  if (!val) return;

  if (Session.hasKey() && Session.verifyPin(val)) {
    try { await window.loadSecure(); window.enterApp && window.enterApp(); return; } catch(e) {}
  }

  const pinSalt = await window.getSaltAsync('v5-pin-salt');

  let storedHash = null;
  let fbReadOk   = false;   // WO-15: Firebase pinHash okumasi GERCEKTEN basarili oldu mu?
  if (window._fbLoadPinHash) {
    try { storedHash = await window._fbLoadPinHash(); fbReadOk = true; } catch(e) { fbReadOk = false; }
  }

  if (!storedHash) {
    // ── WO-15 GUVENLIK KILIDI (karar TEK KAYNAK: keyguard.js#shouldMintNewKey) ──
    // Asagidaki "yeni kullanici" dali RASTGELE yeni bir data key uretir ve hem
    // localStorage hem Firebase'deki sarili anahtari EZER. Mevcut verisi olan bir
    // plana yanlislikla calisirsa (ornegin offline'da pinHash okunamayinca) veriyi
    // KALICI olarak kilitler (2026-05-30 vakasi). Bu yuzden mint kararini saf+testli
    // shouldMintNewKey verir; yalniz online + FB-OK + veri YOK + anahtar YOK iken true.
    const _planId    = window.Store.planId;
    const _hasLocal  = !!(localStorage.getItem('v5-data-' + _planId) || localStorage.getItem('v5-data'));
    let   _fbWrapped = null;
    // _fbWrapped'i YALNIZ online + fbReadOk iken sorgula (offline'da network cagrisi yapma).
    if (navigator.onLine && fbReadOk) {
      try { _fbWrapped = await window._loadWrappedKeyFirebase(); } catch(e) {}
    }
    if (!shouldMintNewKey({ online: navigator.onLine, fbReadOk, hasLocalData: _hasLocal, hasWrappedKey: !!_fbWrapped })) {
      // Mint GUVENLI degil -> nedene gore kullaniciyi bilgilendir, ASLA yeni anahtar uretme.
      if (!navigator.onLine || !fbReadOk) {
        window.showPinErr && window.showPinErr('Bağlantı yok — giriş/kurulum için internet gerekli. Lütfen çevrimiçi olup tekrar deneyin.');
      } else {
        window.showPinErr && window.showPinErr('Bu plan için şifre kaydı okunamadı, ancak mevcut veri var. Güvenlik için yeni anahtar üretilmedi. Lütfen internet bağlantısıyla tekrar deneyin.');
      }
      return;
    }
    // ── Buradan sonrasi: GERCEK yeni kullanici kurulumu (online, bos plan) ──────
    if (val.length < 6 || new Set(val).size < 2) { window.showPinErr && window.showPinErr('En az 6 karakter ve en az 2 farkli karakter girmelisiniz!'); return; }  // WO-04
    const hash = await window.hashPin(val, pinSalt);
    if (window._fbSavePinHash) { try { await window._fbSavePinHash(hash); } catch(e) {} }
    const dataKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    const wrappedB64 = await wrapDataKey(dataKeyRaw, val, pinSalt);
    window._saveWrappedKeyLocal(wrappedB64);
    await window._saveWrappedKeyFirebase(wrappedB64);
    // importDataKey -> NON-EXTRACTABLE CryptoKey; dataKeyRaw fonksiyon scope'unda
    // kalir, return sonrasi GC'ye birakilir (resident tutulmaz).
    const yeniKey = await window.importDataKey(dataKeyRaw);
    Session.set({ cryptoKey: yeniKey, plainPin: val });
    await window.loadSecure();
    await oturumKaydet(yeniKey);
    window.enterApp && window.enterApp();
    return;
  }

  const hash = await window.hashPin(val, pinSalt);
  if (hash !== storedHash) {
    const inp = document.getElementById('PI');
    inp.classList.add('err');
    document.getElementById('PE').textContent = 'Hatalı şifre!';
    setTimeout(() => { inp.classList.remove('err'); document.getElementById('PE').textContent=''; inp.value=''; }, 1400);
    return;
  }

  let wrappedB64 = await window._loadWrappedKeyFirebase() || window._getWrappedKey();
  if (!wrappedB64) { window.showPinErr && window.showPinErr('Şifreleme anahtarı bulunamadı. Lütfen çıkış yapıp tekrar giriş yapın.'); return; }

  let unwrapped;
  try { unwrapped = await unwrapDataKey(wrappedB64, val, pinSalt); }
  catch(e) { window.showPinErr && window.showPinErr('Veri çözülemedi — şifre eşleşmiyor.'); return; }

  // unwrapDataKey extractable key + rawBytes verir; resident anahtari
  // NON-EXTRACTABLE olarak re-import ediyoruz. rawBytes + extractable key
  // bu scope'ta kalir ve return sonrasi GC'ye birakilir (resident tutulmaz).
  const oturumKey = await window.importDataKey(unwrapped.rawBytes);
  Session.set({
    cryptoKey: oturumKey,
    plainPin:  val
  });
  // WO-04: eski 100k anahtar login'de sessizce 600k'ya yukseltilir (unwrap needsRewrap sinyali).
  // chPass ile ayni re-wrap deseni; basarisiz olursa login DEVAM eder (opsiyonel sertlestirme).
  if (unwrapped.needsRewrap) {
    try {
      const upgraded = await wrapDataKey(unwrapped.rawBytes, val, pinSalt);
      window._saveWrappedKeyLocal(upgraded);
      await window._saveWrappedKeyFirebase(upgraded);
      console.log('[WO-04] wrappedKey 100k -> 600k yukseltildi (login)');
    } catch (e) {
      console.warn('[WO-04] login re-wrap hatasi (login devam):', e);
      window._saveWrappedKeyLocal(wrappedB64);
    }
  } else {
    window._saveWrappedKeyLocal(wrappedB64);
  }

  try {
    await window.loadSecure();
  } catch(e) {
    const otherPlan = window.Store.planId === 'plan1' ? 'plan2' : 'plan1';
    const origPlan  = window.Store.planId;
    window.Store.planId = otherPlan;
    try {
      await window.loadSecure();
    } catch(e2) {
      window.Store.planId = origPlan;
      window.showPinErr && window.showPinErr('Veri çözülemedi. Lütfen tekrar deneyin.'); return;
    }
  }
  await oturumKaydet(oturumKey);   // v8.238: plan kesinleştikten sonra (yenilemede şifre sorulmaz)
  window.enterApp && window.enterApp();
}

// ── ŞİFRE DEĞİŞTİR ────────────────────────────────────────────────────────────

async function chPass() {
  const cur = document.getElementById('CP').value;
  const nw  = document.getElementById('NP').value;
  const nw2 = document.getElementById('NP2').value;
  const msg = document.getElementById('PM');

  const pinSalt = await window.getSaltAsync('v5-pin-salt');

  let storedHash = null;
  if (window._fbLoadPinHash) {
    try { storedHash = await window._fbLoadPinHash(); } catch(e) {}
  }

  const curHash = await window.hashPin(cur, pinSalt);
  if (curHash !== storedHash) { msg.style.color='var(--danger)'; msg.textContent='❌ Mevcut şifre yanlış'; return; }
  if (!nw || nw.length < 6 || new Set(nw).size < 2)  { msg.style.color='var(--danger)'; msg.textContent='❌ En az 6 karakter, en az 2 farkli'; return; }  // WO-04
  if (nw !== nw2)             { msg.style.color='var(--danger)'; msg.textContent='❌ Şifreler eşleşmiyor'; return; }

  // Ephemeral re-wrap: data key DEGISMEZ, yalniz sarmalama (wrap) yenilenir.
  // dataKeyRaw resident tutulmadigindan, ham anahtari MEVCUT PIN (cur) ile
  // depodaki wrapped-blob'tan ANLIK unwrap edip kullaniyoruz; islem sonrasi
  // ham bytes GC'ye birakilir. Once re-wrap'i dogrula, SONRA hash'i kaydet
  // (boylece unwrap fail olursa pin-hash / wrapped-key tutarsizligi olmaz).
  const curWrappedB64 = await window._loadWrappedKeyFirebase() || window._getWrappedKey();
  if (!curWrappedB64) { msg.style.color='var(--danger)'; msg.textContent='❌ Şifreleme anahtarı bulunamadı'; return; }
  let unwrapped;
  try { unwrapped = await unwrapDataKey(curWrappedB64, cur, pinSalt); }
  catch(e) { msg.style.color='var(--danger)'; msg.textContent='❌ Mevcut anahtar çözülemedi'; return; }
  const newWrappedB64 = await wrapDataKey(unwrapped.rawBytes, nw, pinSalt);

  const newHash = await window.hashPin(nw, pinSalt);
  if (window._fbSavePinHash) {
    try { await window._fbSavePinHash(newHash); } catch(e) {}
  }
  window._saveWrappedKeyLocal(newWrappedB64);
  await window._saveWrappedKeyFirebase(newWrappedB64);
  Session.setPin(nw);

  msg.style.color='var(--ok)'; msg.textContent='✅ Şifre güncellendi!';
  ['CP','NP','NP2'].forEach(id => document.getElementById(id).value='');
  setTimeout(() => msg.textContent='', 3000);
}

// ── Global compat ─────────────────────────────────────────────────────────────
window.doLogin = doLogin;
window.chPass  = chPass;
