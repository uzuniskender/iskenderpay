// js/modal.js — iskenderpay (v1.0)
// Modal yönetim sistemi. index.html'den taşındı.

const _open = new Set();

// ── PENCERE BOYUTU (v8.233) ────────────────────────────────────────────────
// Her pencerenin sağ üstünde boyut düğmeleri: ▭ Normal · ▢ Geniş · ⛶ Tam ekran (+ telefonda ↻ Yatay).
// Bilgisayarda sağ-alt köşeden sürükleyerek serbest boyut. Seçim pencere başına hatırlanır.
const _BOYUT_KEY = 'ipay-pencere:';
const _kaba = () => !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
function _boyutOku(id) { try { const v = localStorage.getItem(_BOYUT_KEY + id); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function _boyutYaz(id, v) { try { if (!v) localStorage.removeItem(_BOYUT_KEY + id); else localStorage.setItem(_BOYUT_KEY + id, JSON.stringify(v)); } catch (e) {} }

function _boyutUygula(el, v) {
  const m = el.querySelector(':scope > .modal');
  if (!m) return;
  el.classList.toggle('pen-g', !!v && v.mod === 'g');
  el.classList.toggle('pen-t', !!v && v.mod === 't');
  const serbest = !!v && v.mod === 's' && !_kaba();
  m.style.width = serbest ? v.w + 'px' : '';
  m.style.maxWidth = serbest ? 'none' : '';
  m.style.height = serbest && v.h ? v.h + 'px' : '';
  m.style.maxHeight = serbest && v.h ? 'none' : '';
  el.querySelectorAll('.pen-boyut [data-boyut]').forEach(b => b.classList.toggle('on', (v ? v.mod : 'n') === b.dataset.boyut));
}

function _boyutAraci(el) {
  const m = el.querySelector(':scope > .modal');
  if (!m || m.querySelector(':scope > .pen-boyut') || el.dataset.boyutYok !== undefined) return;
  const bar = document.createElement('div');
  bar.className = 'pen-boyut';
  bar.innerHTML = '<button type="button" data-boyut="n" title="Normal boyut">▭</button>'
    + '<button type="button" data-boyut="g" title="Geniş">▢</button>'
    + '<button type="button" data-boyut="t" title="Tam ekran">⛶</button>'
    + '<button type="button" data-boyut="y" class="pen-yatay" title="Yatay çevir">↻</button>';
  bar.addEventListener('click', ev => {
    const b = ev.target.closest('[data-boyut]');
    if (!b) return;
    ev.stopPropagation();
    const mod = b.dataset.boyut;
    if (mod === 'y') { _yatay(el); return; }
    const v = mod === 'n' ? null : { mod };
    _boyutYaz(el.id, v);
    _boyutUygula(el, v);
  });
  m.insertBefore(bar, m.firstChild);
  const tut = document.createElement('div');
  tut.className = 'pen-tutamac';
  tut.title = 'Sürükleyerek boyutlandır';
  tut.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    const r = m.getBoundingClientRect();
    const x0 = ev.clientX, y0 = ev.clientY;
    const tasi = e2 => {
      m.style.maxWidth = 'none'; m.style.maxHeight = 'none';
      m.style.width = Math.max(320, Math.min(window.innerWidth - 16, r.width + (e2.clientX - x0) * 2)) + 'px';
      m.style.height = Math.max(240, Math.min(window.innerHeight - 16, r.height + (e2.clientY - y0) * 2)) + 'px';
    };
    const birak = () => {
      window.removeEventListener('pointermove', tasi);
      window.removeEventListener('pointerup', birak);
      const v = { mod: 's', w: Math.round(m.getBoundingClientRect().width), h: Math.round(m.getBoundingClientRect().height) };
      el.classList.remove('pen-g', 'pen-t');
      _boyutYaz(el.id, v);
      _boyutUygula(el, v);
    };
    window.addEventListener('pointermove', tasi);
    window.addEventListener('pointerup', birak);
  });
  m.appendChild(tut);
}

// Telefonda tam ekran + yatay kilit (Android destekler; iOS'ta telefonu yan çevirmek yeterli)
async function _yatay(el) {
  const v = { mod: 't' };
  _boyutYaz(el.id, v);
  _boyutUygula(el, v);
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) {
    if (window.showWarnToast) showWarnToast('Telefonu yan çevir — pencere tam ekran açık');
  }
}

function _yatayBirak() {
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) {}
}

function open(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('mov')) { _boyutAraci(el); _boyutUygula(el, _boyutOku(id)); }
  el.classList.add('open');
  _open.add(id);
  document.body.style.overflow = 'hidden';
}

function close(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  _open.delete(id);
  if (_open.size === 0) _yatayBirak();
  if (_open.size === 0) document.body.style.overflow = '';
}

function closeAll() {
  _open.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  });
  _open.clear();
  document.body.style.overflow = '';
}

// Click-outside + data-modal-open/close attribute desteği
document.addEventListener('click', e => {
  if ((e.target.classList.contains('mov') || e.target.classList.contains('dov')) && e.target.id) {
    close(e.target.id);
    return;
  }
  const openBtn = e.target.closest('[data-modal-open]');
  if (openBtn) { open(openBtn.dataset.modalOpen); return; }
  const closeBtn = e.target.closest('[data-modal-close]');
  if (closeBtn) { close(closeBtn.dataset.modalClose); return; }
});

// ESC tuşu — en üstteki modalı kapat
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _open.size > 0) close([..._open].pop());
});

export const ModalManager = { open, close, closeAll };

// ── TOAST: kısa süreli uyarı (engelleyici değil) ────────────────────────────
// #warn-toast element'ine textContent inject + show class + auto-hide.
// Rapid-fire safe: önceki timer cleanup.
function showWarnToast(msg) {
  const t = document.getElementById('warn-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Global compat — index.html inline kodu ModalManager.open/close/closeAll kullanıyor
window.ModalManager = ModalManager;
window.closeMov = (id) => close(id);
window.showWarnToast = showWarnToast;
