// js/ui-plan-render.js — iskenderpay (v8.150)
// Veri toplama (getAllItems, buildMx), ana matris render'ı, hafta widget'ı,
// store:change event listener. ui-plan.js'ten v8.150'de ayrıştırıldı.

import { todayMidnight, toTRY, maxAheadMonths, araNormalize } from './util.js';

// ── DATA / HESAPLAMA ─────────────────────────
function getAllItems() {
  const credPays = [];
  // v8.231: kredi aciklamasi (cari kart) plan satirinda ayirt edici etiket olur ("ALI (Araç)")
  window.creds.forEach(c => c.pays.forEach((p,ii) => credPays.push({...p, name:c.name, currency:'TRY', _cid:c.id, _ii:p.idx, ...(c.desc?{desc:c.desc}:{})})));
  return [...window.pays, ...credPays];
}

function buildMx(all) {
  const mx = {};
  all.forEach(p => {
    const d = window.parseLocalDate(p.date);
    const mk = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const rawKey = p._cid ? 'cred_'+p._cid : (p.groupId ? 'g_'+p.groupId : 'pay_'+String(Math.floor(Number(p.id))));
    if (!mx[rawKey]) mx[rawKey] = {_name:p.name};
    if (!mx[rawKey][mk]) mx[rawKey][mk] = {items:[], status:'pending', try:0};
    mx[rawKey][mk].items.push(p);
    mx[rawKey][mk].try += toTRY(p.amount, p.currency||'TRY', window.rates);
  });
  // Durum hesabı düzeltme (item bazlı)
  Object.keys(mx).forEach(rk => {
    Object.keys(mx[rk]).filter(k=>!k.startsWith('_')).forEach(mk => {
      const cell = mx[rk][mk];
      const items = cell.items;
      if (items.every(p => (p.status||'pending')==='paid')) cell.status='paid';
      else if (items.some(p => (p.status||'pending')==='partial')) cell.status='partial';
      else if (items.some(p => (p.status||'pending')!=='paid' && window.isOD(p))) cell.status='overdue';
      else cell.status='pending';
    });
  });
  return mx;
}

// ── RENDER HELPER'LARI (v8.154) ──────────
// Özet bölgesi: OC (4 kart) + OHS (progress bar) + OD (tarih)
function _renderSummaryCards(ozet, yaklaşanN, now) {
  const {tot, ok, bek, gec, okN, bekN, gecN, itemCount} = ozet;
  document.getElementById('OC').innerHTML=`
    <div class="ocard t"><div class="lbl">Bu Ay Toplam</div><div class="val mono">${window.fmt(tot)}</div><div class="sub">${itemCount} ödeme</div></div>
    <div class="ocard p"><div class="lbl">Ödendi</div><div class="val">${window.fmt(ok)}</div><div class="sub">${okN} ödeme</div></div>
    <div class="ocard b"><div class="lbl">Bekliyor</div><div class="val">${window.fmt(bek)}</div><div class="sub">${yaklaşanN>0?`<span style="color:var(--ora)">⚡ ${yaklaşanN} bu hafta</span>`:bekN+' ödeme'}</div></div>
    <div class="ocard g"><div class="lbl">Gecikmiş</div><div class="val">${window.fmt(gec)}</div><div class="sub">${gecN} ödeme</div></div>`;
  const pct = tot>0 ? Math.round((ok/tot)*100) : 0;
  const pctColor = pct>=100?'var(--ok)':pct>=60?'var(--blue)':pct>=30?'var(--ora)':'var(--danger)';
  document.getElementById('OHS').innerHTML = `<div style="display:flex;align-items:center;gap:8px">
    <div style="flex:1;height:4px;background:var(--surf2);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:2px;transition:width .4s"></div>
    </div>
    <span style="font-size:10px;font-family:'IBM Plex Mono',monospace;color:${pctColor};font-weight:600;flex-shrink:0">${pct}%</span>
  </div>`;
  document.getElementById('OD').textContent = now.toLocaleDateString('tr-TR',{day:'numeric',month:'short',year:'numeric'});
}

// Alt widget'lar (hafta + sıradaki)
function _renderWidgets(all, now, soon7) {
  renderHaftaWidget(all, now, soon7);
  if (window.renderSiradaki) window.renderSiradaki();
}

// ── ANA RENDER ────────────────────────────
function render() {
  const all = getAllItems();
  const now = new Date();
  const curMK = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const ozet = window.Hesap.buAyOzeti({all});
  const tot = ozet.tot, ok = ozet.ok, bek = ozet.bek, gec = ozet.gec;
  const okN = ozet.okN, bekN = ozet.bekN, gecN = ozet.gecN;
  // Sayfa başlığında geciken ödeme sayısı
  document.title = gecN > 0 ? `(${gecN} gecikmiş) iskenderpay` : 'iskenderpay';

  // Mobil nav badge — Plan butonuna gecikmiş sayısı
  const navPlan = document.getElementById('m0');
  if (navPlan) {
    navPlan.innerHTML = gecN > 0
      ? `📊 Plan <span style="background:var(--danger);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:3px">${gecN}</span>`
      : '📊 Plan';
  }

  // 7 gün içi yaklaşan ödemeleri hesapla
  const today0 = todayMidnight();
  const soon7 = new Date(today0.getTime() + 7*24*60*60*1000);
  const yaklaşanN = all.filter(p => {
    if((p.status||'pending')==='paid') return false;
    if(p._cid) return false;
    const d = window.parseLocalDate(p.date);
    return d >= today0 && d <= soon7;
  }).length;

  _renderSummaryCards(ozet, yaklaşanN, now);
  const mx = buildMx(all);
  // v5-ahead === 'all' -> ileri pencere = en uzak odemeye kadar (maxAheadMonths).
  // Sayisal deger -> o kadar ay. Eski/bozuk deger -> 6 guvenli geri-cekilme.
  const aheadRaw = localStorage.getItem('v5-ahead') || 'all';
  const aheadVal = aheadRaw === 'all'
    ? maxAheadMonths(all, now)
    : (parseInt(aheadRaw) || 6);
  const monthSet = new Set();
  const nowY=now.getFullYear(), nowM=now.getMonth();
  for(let i=0;i<aheadVal;i++){const d=new Date(nowY,nowM+i,1);monthSet.add(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));}
  all.forEach(p=>{const d=window.parseLocalDate(p.date);const mk=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const pY=d.getFullYear(),pM=d.getMonth();if(pY<nowY||(pY===nowY&&pM<nowM))monthSet.add(mk);});
  const fltEl = document.getElementById('FLT');
  const fltVal = fltEl ? araNormalize(fltEl.value) : '';
  let rowKeys = Object.keys(mx).filter(k=>mx[k]._name!==undefined);
  if(window.sortMode==='name'){
    rowKeys.sort((a,b)=>(mx[a]._name||'').localeCompare(mx[b]._name||'','tr'));
  } else {
    rowKeys.sort((a,b)=>{
      const dayOf=k=>{const mks=Object.keys(mx[k]).filter(x=>!x.startsWith('_')).sort();if(!mks.length)return 99;const items=mx[k][mks[0]]?.items||[];return items[0]?window.parseLocalDate(items[0].date).getDate():99;};
      const da=dayOf(a),db=dayOf(b);
      if(da!==db)return da-db;
      return (mx[a]._name||'').localeCompare(mx[b]._name||'','tr');
    });
  }
  if(fltVal) rowKeys=rowKeys.filter(k=>araNormalize(mx[k]._name).includes(fltVal));
  // Tüm ayları ödenmiş satırları gizle (v8.146 fix — önceki kod yanlışlıkla ay-bazlı filter yapıyordu)
  const showPaid = localStorage.getItem('v8-show-paid') === '1';
  if (!showPaid) {
    rowKeys = rowKeys.filter(k => {
      const monthKeys = Object.keys(mx[k]).filter(x => !x.startsWith('_'));
      if (!monthKeys.length) return true;
      return monthKeys.some(mk => mx[k][mk].status !== 'paid');
    });
  }
  // Display name (paylasilan logic — kredi paneliyle ayni)
  const dnMap = window.Hesap._displayNames(mx, rowKeys);
  rowKeys.forEach(k => { mx[k]._displayName = dnMap[k]; });
  const allMonths=Array.from(monthSet).sort();
  // v8.180: ay sutunu, gorunur satirlarda odenmemis (status!=='paid') kayit varsa gosterilir.
  // showPaid kapaliyken tamami odenmis aylar gizlenir; toggle acikken kayit olan tum aylar gorunur.
  const months = allMonths.filter(m => rowKeys.some(k => {
    const c = mx[k]?.[m];
    if (!c?.items?.length) return false;
    return showPaid ? true : c.status !== 'paid';
  }));
  // Toggle buton görünümü
  const tb = document.getElementById('PAID_TOGGLE');
  if (tb) {
    tb.style.background = showPaid ? 'rgba(74,222,128,.15)' : 'var(--surf2)';
    tb.style.color = showPaid ? 'var(--ok)' : 'var(--muted)';
    tb.style.borderColor = showPaid ? 'rgba(74,222,128,.3)' : 'var(--bdr)';
    tb.textContent = showPaid ? '✓ Ödendiler gizle' : '✓ Ödendiler';
  }
  const mLbls=months.map(m=>{const[y,mo]=m.split('-');return new Date(+y,+mo-1,1).toLocaleDateString('tr-TR',{month:'short',year:'2-digit'});});
  const colTot=months.map(m=>rowKeys.reduce((s,k)=>{const c=mx[k]&&mx[k][m];if(!c)return s;if(c.status==='paid')return s;if(c.status==='partial')return s+(c.try-c.items.reduce((a,p)=>a+(p.paid||0),0));return s+c.try;},0));
  let html='<table class="mtbl"><thead><tr><th class="rh">Ödeme</th><th style="min-width:32px;max-width:36px;width:32px">Gün</th>';
  months.forEach((m,i)=>html+=`<th${m===curMK?' style="color:var(--acc);font-weight:700"':''}>${mLbls[i]}</th>`);
  html+='<th>Toplam</th></tr></thead><tbody>';
  rowKeys.forEach(k=>{
    const dispName=mx[k]._displayName||mx[k]._name||k;
    const _firstMk=Object.keys(mx[k]).filter(x=>!x.startsWith('_')).sort()[0];
    const _dayNum=_firstMk&&mx[k][_firstMk]?.items?.[0]?.date?window.parseLocalDate(mx[k][_firstMk].items[0].date).getDate():'';
    html+=`<tr data-row-key="${k}"><td class="rh" onclick="openRow('${encodeURIComponent(k)}')" title="${window.esc(dispName)}">${window.esc(dispName)}</td><td style="text-align:center;font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace;min-width:32px;max-width:36px;width:32px">${_dayNum}</td>`;
    months.forEach(m=>{
      const c=mx[k]?.[m];
      if(!c||!c.items){html+=`<td class="ce" onclick="openEmptyCell('${encodeURIComponent(k)}','${m}')" style="cursor:pointer;opacity:.35" title="Bu aya ekle">+</td>`;return;}
      const isSoon=c.status!=='paid'&&c.items.some(p=>{const d=window.parseLocalDate(p.date);return d>=today0&&d<=soon7;});
      const cls=c.status==='paid'?'cp':c.status==='partial'?'ck':c.status==='overdue'?'cg':isSoon?'cy':'cb';
      const orig=c.items.find(x=>x.currency&&x.currency!=='TRY');
      const totalPaid=c.items.reduce((a,p)=>a+(p.paid||0),0);
      const kalan=c.try-totalPaid;
      let cellContent;
      if(c.status==='paid'){cellContent=`<span style="font-size:14px">✓</span>`;}
      else if(c.status==='partial'){const ob2=orig?`<span class="orig-small">${window.fmtA(orig.amount,orig.currency)}</span>`:'';cellContent=`${window.fmt(kalan)}${ob2}`;}
      else{const ob2=orig?`<span class="orig-small">${window.fmtA(orig.amount,orig.currency)}</span>`:'';cellContent=`${window.fmt(c.try)}${ob2}`;}
      html+=`<td class="${cls}" onclick="openCell('${encodeURIComponent(k)}','${m}')">${cellContent}</td>`;
    });
    const rKalan=months.reduce((acc,m)=>{const c=mx[k]?.[m];if(!c)return acc;if(c.status==='paid')return acc;if(c.status==='partial')return acc+(c.try-c.items.reduce((a,p)=>a+(p.paid||0),0));return acc+c.try;},0);
    html+=`<td style="font-weight:600;color:${rKalan===0?'var(--ok)':'var(--txt)'}">${rKalan===0?'✓':window.fmt(rKalan)}</td></tr>`;
  });
  html+=`<tr class="tot"><td class="rh">TOPLAM</td><td></td>`;
  colTot.forEach(t=>html+=`<td>${window.fmt(t)}</td>`);
  html+=`<td>${window.fmt(colTot.reduce((a,b)=>a+b,0))}</td></tr></tbody></table>`;
  document.getElementById('MAT').innerHTML = rowKeys.length ? html : '<div class="empty"><div class="ico">📋</div><p>Henüz ödeme yok.<br>+ butonuyla ekleyin.</p></div>';

  // Mevcut aya scroll
  requestAnimationFrame(() => {
    const mwrap = document.querySelector('.mwrap');
    const curTh = document.querySelector('.mtbl th[style*="color:var(--acc)"]');
    if (mwrap && curTh) {
      const thLeft = curTh.offsetLeft;
      const mwrapW = mwrap.offsetWidth;
      mwrap.scrollLeft = Math.max(0, thLeft - 180); // sticky rh sütunu payı
    }
  });

  // Alt widget'lar (hafta + sıradaki)
  _renderWidgets(all, now, soon7);
  // renderCredSummary decoupled (v9.0): ui-pay.js listener cagiriyor
}

// ── HAFTA WİDGET ──────────────────────────
function renderGecWidget(all) {
  const el = document.getElementById('HAFTA');
  if (!el) return null; // HAFTA elementini paylaşıyoruz, gecikmiş önce render edilecek
  const today = todayMidnight();
  const gecikmiş = all.filter(p => {
    if ((p.status||'pending') === 'paid') return false;
    if (p._cid) return false;
    return window.parseLocalDate(p.date) < today;
  }).sort((a,b) => window.parseLocalDate(a.date) - window.parseLocalDate(b.date));
  return gecikmiş;
}

function renderHaftaWidget(all, now, soon7) {
  const el = document.getElementById('HAFTA');
  if (!el) return;
  const today = todayMidnight();
  const soon7mid = new Date(today.getTime() + 7*24*60*60*1000);
  const yaklaşan = all.filter(p => {
    if ((p.status||'pending') === 'paid') return false;
    if (p._cid) return false; // kredi taksitlerini ayrı gösterme (matriste zaten var)
    const d = window.parseLocalDate(p.date);
    return d >= today && d <= soon7mid;
  }).sort((a,b) => window.parseLocalDate(a.date) - window.parseLocalDate(b.date));

  if (!yaklaşan.length) { el.innerHTML = ''; return; }

  const rows = yaklaşan.map(p => {
    const d = window.parseLocalDate(p.date);
    const gun = d.getDate(), ay = d.toLocaleDateString('tr-TR',{month:'short'});
    const kalan = Math.round((d - today) / 86400000);
    const kalanStr = kalan === 0 ? '<span style="color:var(--danger);font-weight:700">Bugün!</span>'
      : kalan === 1 ? '<span style="color:var(--ora)">Yarın</span>'
      : `<span style="color:#fcd34d">${kalan} gün</span>`;
    const tryAmt = toTRY(p.amount, p.currency||'TRY', window.rates);
    const rawKey = p.groupId ? 'g_'+p.groupId : 'pay_'+String(Math.floor(Number(p.id)));
    const keyEnc = encodeURIComponent(rawKey);
    const mKey = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:var(--surf2);border-radius:8px;cursor:pointer" onclick="openCell('${keyEnc}','${mKey}')">
      <div style="min-width:36px;text-align:center;background:rgba(252,211,77,.15);border-radius:6px;padding:3px 0">
        <div style="font-size:13px;font-weight:700;color:#fcd34d">${gun}</div>
        <div style="font-size:9px;color:var(--muted)">${ay}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.name)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:600;font-family:'IBM Plex Mono',monospace">${window.fmt(tryAmt)}</div>
        <div style="font-size:10px">${kalanStr}</div>
      </div>
    </div>`;
  }).join('');

  const gecList = renderGecWidget(all);
  let gecHTML = '';
  if (gecList && gecList.length) {
    const gecRows = gecList.slice(0,12).map(p => {
      const d = window.parseLocalDate(p.date);
      const gun = d.getDate(), ay = d.toLocaleDateString('tr-TR',{month:'short'});
      const gecGun = Math.round((todayMidnight() - d) / 86400000);
      const tryAmt = toTRY(p.amount, p.currency||'TRY', window.rates);
      const rawKey = p.groupId ? 'g_'+p.groupId : 'pay_'+String(Math.floor(Number(p.id)));
      const mKey = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:rgba(248,113,113,.08);border-radius:8px;cursor:pointer" onclick="openCell('${encodeURIComponent(rawKey)}','${mKey}')">
        <div style="min-width:36px;text-align:center;background:rgba(248,113,113,.2);border-radius:6px;padding:3px 0">
          <div style="font-size:13px;font-weight:700;color:#fca5a5">${gun}</div>
          <div style="font-size:9px;color:var(--muted)">${ay}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.name)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:12px;font-weight:600;font-family:'IBM Plex Mono',monospace;color:#fca5a5">${window.fmt(tryAmt)}</div>
          <div style="font-size:10px;color:var(--danger)">${gecGun} gün gecikti</div>
        </div>
      </div>`;
    }).join('');
    const artı = gecList.length > 12 ? `<div style="font-size:10px;color:var(--muted);text-align:center;padding-top:6px">+${gecList.length-12} daha</div>` : '';
    gecHTML = `<div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25);border-radius:10px;padding:10px 12px;margin:0 0 8px">
      <div style="font-size:10px;font-weight:700;color:#fca5a5;letter-spacing:.8px;margin-bottom:8px">⚠ GECİKMİŞ — ${gecList.length} ödeme</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px">${gecRows}</div>${artı}
    </div>`;
  }

  el.innerHTML = gecHTML + (yaklaşan.length ? `<div style="background:rgba(252,211,77,.08);border:1px solid rgba(252,211,77,.2);border-radius:10px;padding:10px 12px;margin:0 0 10px">
    <div style="font-size:10px;font-weight:700;color:#fcd34d;letter-spacing:.8px;margin-bottom:8px">⚡ BU HAFTA — ${yaklaşan.length} ödeme</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px">${rows}</div>
  </div>` : '');
}

// ── EVENT LISTENER ───────────────────────
window.addEventListener('store:change', e => {
  if (window.curTab !== 0) return;
  if (window.Store && window.Store._affects(e.detail, ['pays','creds','paidItems'])) render();
});

// ── GLOBAL COMPAT ──────────────────────────
window.getAllItems       = getAllItems;
window.buildMx           = buildMx;
window.render            = render;
window.renderHaftaWidget = renderHaftaWidget;
window.renderGecWidget   = renderGecWidget;
