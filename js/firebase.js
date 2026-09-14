// js/firebase.js — iskenderpay
// Firebase init, auth, Firestore yardımcıları.
// ── FİREBASE MODULAR v10 ─────────────────────────────────────────────────────
import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signInWithRedirect,
         getRedirectResult, onAuthStateChanged,
         signOut }                                from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc }      from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import { Session } from './session.js';

const firebaseConfig = {
  apiKey: "AIzaSyCZOvzCp4l0y2rJS2xFS1pSwoDWGcnUY6E",
  authDomain: "iskenderpay-a23d1.firebaseapp.com",
  projectId: "iskenderpay-a23d1",
  storageBucket: "iskenderpay-a23d1.firebasestorage.app",
  messagingSenderId: "916658036032",
  appId: "1:916658036032:web:ad44e5d591e1adfc49aea5",
  measurementId: "G-SPPX7F1BDY"
};

const _app    = initializeApp(firebaseConfig);

// WO-13: App Check (reCAPTCHA v3) — yalniz gercek uygulama orneginden gelen istekler
// Firebase'e ulasir (bot/abuse + kota-drenaji savunmasi). Site key PUBLIC; secret Google'da.
// Enforcement Console'da (Firestore -> App Check): once Monitor, sonra Enforce.
// try/catch: reCAPTCHA online yuklenir -> offline boot'ta hata uygulamayi BOZMASIN.
try {
  initializeAppCheck(_app, {
    provider: new ReCaptchaV3Provider('6Lcx2QUtAAAAAAZVUMoAESSOttnWYmaBWl2XcXR7'),
    isTokenAutoRefreshEnabled: true
  });
} catch (e) {
  console.warn('App Check init basarisiz (offline olabilir):', e && (e.message || e));
}

const _auth   = getAuth(_app);
const _db     = getFirestore(_app);

// ── FIRESTORE YARDIMCI ────────────────────────────────────────────────────────
function _planDoc(planId) {
  return doc(_db, 'users', window.Store.fbUid + '_' + (planId || window.Store.planId));
}
function _metaDoc() {
  return doc(_db, 'users', window.Store.fbUid + '_meta');
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
let _redirectChecked = false;

getRedirectResult(_auth).then((result) => {
  if (result && result.user) console.log('Redirect ile giriş başarılı:', result.user.email);
}).catch(e => console.warn('redirect result error:', e)).finally(() => { _redirectChecked = true; });

onAuthStateChanged(_auth, (user) => {
  const loadEl = document.getElementById('LOAD');
  if (loadEl) loadEl.style.display = 'none';

  const glsEl = document.getElementById('GLS');
  const psEl  = document.getElementById('PS');
  const appEl = document.getElementById('APP');

  if (user) {
    window.Store.fbUid = user.uid;
    if (glsEl) glsEl.style.display = 'none';
    const plsEl   = document.getElementById('PLS');
    const plsUser = document.getElementById('PLS_USER');
    if (plsUser) plsUser.textContent = '👤 ' + (user.displayName || user.email);
    if (plsEl) plsEl.style.display = 'flex';
    if (psEl)  { psEl.style.display = 'none'; psEl.classList.remove('active'); }
    window.renderPlanNames();
  } else {
    window.Store.fbUid = null;
    // Signout: sync interval'i durdur — _fbStopListen aksi halde orphan
    if (window._fbStopListen) window._fbStopListen();
    setTimeout(() => {
      if (!window.Store.fbUid) {
        if (glsEl) glsEl.style.display = 'flex';
        const plsEl = document.getElementById('PLS');
        if (plsEl) plsEl.style.display = 'none';
        if (psEl)  { psEl.style.display = 'none'; psEl.classList.remove('active'); }
        if (appEl) appEl.style.display = 'none';
      }
    }, 2000);
  }
});

// _planDoc/_metaDoc firestore.js closure ile yakalar.
window._planDoc      = _planDoc;
window._metaDoc      = _metaDoc;

// Google ile giriş — popup kullan
window.doGoogleLogin = async function() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(_auth, provider);
  } catch(e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      try { await signInWithRedirect(_auth, new GoogleAuthProvider()); } catch(e2) { alert('Giriş başarısız: ' + e2.message); }
    } else {
      alert('Giriş başarısız: ' + e.message);
    }
  }
};

// Çıkış
window.doGoogleSignOut = async function() {
  if (!confirm('Çıkış yapmak istiyor musunuz?')) return;
  // v8.187: cikista oturum sirlarini bellekten temizle (cryptoKey/plainPin).
  // Onceki davranis: signOut sonrasi sirlar reload'a kadar bellekte kaliyordu.
  Session.clear();
  await signOut(_auth);
};
