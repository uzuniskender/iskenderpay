// sw.js — iskenderpay PWA cache (v8.214: salt-freeze.js — B0 auth-bagimsiz PIN salt)

const CACHE = 'ip-static-f95c530';
const STATIC = [
  './',
  './index.html',
  './app.css',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
  './version.json',
  './shared/date.js',
  './shared/text.js',
  './js/firebase.js',
  './js/store.js',
  './js/state.js',
  './js/util.js',
  './js/compat.js',
  './js/crypto.js',
  './js/salt-freeze.js',
  './js/session.js',
  './js/modal.js',
  './js/data.js',
  './js/firestore.js',
  './js/conflict.js',
  './js/snapshot.js',
  './js/keyguard.js',
  './js/audit.js',
  './js/validate.js',
  './js/integrity.js',
  './js/persist.js',
  './js/auth-pin.js',
  './js/app.js',
  './js/plan.js',
  './js/sync.js',
  './js/kur.js',
  './js/backup.js',
  './js/version.js',
  './js/ui-plan-render.js',
  './js/ui-plan-detail.js',
  './js/ui-plan-actions.js',
  './js/hesap.js',
  './js/ui-pay.js',
  './js/ui-persons.js',
  './js/ui-notes.js',
  './js/rehber.js',
  './js/log.js',
  './js/hareket.js',
  './js/cari.js',
  './js/mobil.js',
  './js/search.js',
  './js/rates-core.js',
  './js/altin-onizleme.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(e => console.warn('[SW] Cache hatasi:', e))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => {
      self.clients.claim();
      // Tüm açık sayfalara güncelleme mesajı gönder
      return self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(clients => {
        clients.forEach(c => c.postMessage({type: 'SW_UPDATED', cache: CACHE}));
      });
    })
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // WO-12: Firebase SDK (gstatic) -> CACHE-FIRST. Ilk ONLINE yuklemede SDK + transitif
  // chunk'lar cache'lenir; sonraki OFFLINE acilislarda cache'ten servis edilir (offline
  // ilk acilis kirilmaz). Bu branch bypass'tan ONCE -> gstatic asla network-only kalmaz.
  // CANLI veri/auth (firestore.googleapis.com / *.firebaseapp.com vb.) ASAGIDA bypass'ta.
  if (url.includes('gstatic.com/firebasejs/')) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(resp => {
          if (resp && resp.ok) { const cl = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
          return resp;
        }).catch(() => caches.match(e.request))
      )
    );
    return;
  }

  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('exchangerate-api') ||
    url.includes('gold-api')
  ) return;

  if (url.endsWith('/') || url.endsWith('index.html') || url.endsWith('version.json')) {
    const noCache = new Request(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    e.respondWith(
      fetch(noCache).then(resp => {
        if (resp.ok && url.includes('version.json')) {
          caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // JS modülleri ve CSS: her zaman network'ten al, HTTP cache atla
  if (url.includes('/js/') || url.endsWith('.css')) {
    e.respondWith(fetch(new Request(url, {cache: 'no-cache'})).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
