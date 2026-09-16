// js/plan.js — iskenderpay
// Plan adı, plan seçimi, plan geçişi

function getPlanName(planId) {
  return localStorage.getItem('v6-name-' + planId) || (planId === 'plan1' ? 'Plan 1' : 'Plan 2');
}

function editPlanName(planId) {
  const elId = planId === 'plan1' ? 'PLS_NAME1' : 'PLS_NAME2';
  const el = document.getElementById(elId);
  if (!el || el.querySelector('input')) return;
  const current = el.textContent;
  el.innerHTML = '';
  const inp = document.createElement('input');
  inp.value = current;
  inp.style.cssText = 'background:rgba(255,255,255,.1);border:1px solid var(--acc);border-radius:6px;color:var(--txt);font-size:14px;font-weight:600;padding:2px 8px;width:140px;outline:none';
  el.appendChild(inp);
  inp.focus(); inp.select();
  function save() {
    const val = inp.value.trim();
    if (val) localStorage.setItem('v6-name-' + planId, val);
    renderPlanNames();
  }
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { inp.blur(); }
    if (e.key === 'Escape') { inp.value = current; inp.blur(); }
  });
}

function renderPlanNames() {
  const n1 = getPlanName('plan1');
  const n2 = getPlanName('plan2');
  const el1 = document.getElementById('PLS_NAME1');
  const el2 = document.getElementById('PLS_NAME2');
  if (el1) el1.textContent = n1;
  if (el2) el2.textContent = n2;
}

// v8.238: Chrome "Masaüstü sitesi" açıkken telefon sayfayı ~980px genişlikte çizer ve
// giriş kutusu küçücük kalır. Dokunmatik cihazda sayfa ekrandan belirgin genişse içerik büyütülür.
function _pinOlcek(psEl) {
  let oran = 1;
  try {
    if (matchMedia('(pointer:coarse)').matches && screen.width > 0) oran = window.innerWidth / screen.width;
  } catch (e) {}
  psEl.style.setProperty('--pin-zoom', oran > 1.3 ? String(Math.min(oran, 3).toFixed(2)) : '1');
}

function selectPlan(planId) {
  window.Store.planId = planId;
  // Veri dizilerini sıfırla — oturum anahtarı (Session) KORUNUR; Store.clearAll
  // yalnız veri dizilerini sıfırlar, oturum sırları js/session.js closure'ındadır.
  if (window.Store) {
    window.Store.clearAll();
  } else {
    window.pays=[]; window.creds=[]; window.hist=[]; window.persons=[];
    window.notes=[]; window.paidItems=[]; window.rehber=[]; window.actLog=[];
  }
  document.getElementById('PLS').style.display = 'none';
  const psEl = document.getElementById('PS');
  psEl.style.display = '';
  psEl.classList.add('active');
  _pinOlcek(psEl);
  if (window.pinEkraniParmak) window.pinEkraniParmak();
  const planName = getPlanName(planId);
  const subEl = document.querySelector('.pin-sub');
  if (subEl) subEl.textContent = planName + ' şifresini girin';
  const pi = document.getElementById('PI');
  if (pi) pi.value = '';
  if (window.refreshGoldPreview) window.refreshGoldPreview();
}

function switchPlan() {
  if (!confirm('Plan değiştirilecek. Mevcut plan kaydedildi.')) return;
  document.getElementById('APP').style.display = 'none';
  document.getElementById('PLS').style.display = 'flex';
}


// ── PLAN TAM EKRAN (v8.222+) ────────────────────────────────────────────────
// Aylik Plan matrisini (#PLANWRAP) tum ekrana yayar: body.plan-fs-on class'i
// CSS ile mwrap'i fixed inset:0 yapar + cevreyi gizler. Opsiyonel gercek
// Fullscreen API (tarayici sekmesinde adres cubugunu da gizler; PWA'da zaten
// tam ekran, zararsiz). Kapatma: ust-sag ✕ butonu, ESC, veya sistem geri tusu.
function togglePlanFs() {
  const on = document.body.classList.toggle('plan-fs-on');
  if (on) {
    // 1) Tam ekran -> 2) ekrani YATAYA kilitle. orientation.lock() yalniz fullscreen
    //    icinde calistigi icin once requestFullscreen, sonra lock (sirayla).
    const el = document.documentElement;
    const fsReq = (el.requestFullscreen && el.requestFullscreen()) || Promise.resolve();
    Promise.resolve(fsReq).then(() => {
      try {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) {}
    }).catch(() => {});
    // Mevcut aya kaydir (donme + fullscreen otursun diye biraz gecikme)
    setTimeout(() => {
      const wrap = document.getElementById('PLANWRAP');
      const curTh = wrap && wrap.querySelector('th[style*="var(--acc)"]');
      if (wrap && curTh) wrap.scrollLeft = Math.max(0, curTh.offsetLeft - 160);
    }, 300);
  } else {
    // Cikis: yatay kilidini birak + fullscreen'den cik
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {}
  }
}

// Sistem geri tusu / ESC ile fullscreen'den cikilirsa class'i senkronla
function _planFsSync() {
  if (!document.fullscreenElement && document.body.classList.contains('plan-fs-on')) {
    document.body.classList.remove('plan-fs-on');
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
  }
}
document.addEventListener('fullscreenchange', _planFsSync);
// ESC (fullscreen API tetiklenmese bile) ile cikis
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('plan-fs-on')) togglePlanFs();
});


// ── GLOBAL COMPAT ──────────────────────────────────────────────────────────
window.getPlanName        = getPlanName;
window.editPlanName       = editPlanName;
window.renderPlanNames    = renderPlanNames;
window.selectPlan         = selectPlan;
window.switchPlan         = switchPlan;
window.togglePlanFs       = togglePlanFs;
