// js/log.js — iskenderpay
// Aktivite logu render, filtre, sil

import { toTRY } from './util.js';

const LOG_ICONS = {
  plan_add:{icon:'📅',bg:'rgba(96,165,250,.15)'},
  plan_del:{icon:'🗑️',bg:'rgba(248,113,113,.15)'},
  plan_edit:{icon:'✏️',bg:'rgba(251,191,36,.15)'},
  paid:{icon:'✅',bg:'rgba(74,222,128,.15)'},
  rhb_add:{icon:'👤',bg:'rgba(167,139,250,.15)'},
  rhb_edit:{icon:'✏️',bg:'rgba(251,191,36,.15)'},
  rhb_del:{icon:'🗑️',bg:'rgba(248,113,113,.15)'},
  rhb_import:{icon:'📥',bg:'rgba(96,165,250,.15)'},
  hist_del:{icon:'🗑️',bg:'rgba(248,113,113,.15)'},
  restore:{icon:'↩️',bg:'rgba(74,222,128,.15)'},
  cred_add:{icon:'💳',bg:'rgba(251,191,36,.15)'},
  cred_restructure:{icon:'🔁',bg:'rgba(251,146,60,.15)'},
  default:{icon:'📋',bg:'rgba(255,255,255,.07)'},
};
let _logDelMode = 'range';
let _logSelected = new Set();
let _logFilter = 'all'; // 'all' | 'today' | 'week' | 'month'
let _logPersonFilter = ''; // '' = tum kisiler; personId = sadece o kisi (v8.141)
let _logGroupFilter = '';  // '' = tum gruplar;  groupId  = sadece o grup  (v8.156)
let _logCredFilter = '';   // '' = tum krediler; credId   = sadece o kredi

function _passesPersonFilter(entry) {
  return !_logPersonFilter || entry.personId === _logPersonFilter;
}

function _passesGroupFilter(entry) {
  return !_logGroupFilter || entry.groupId === _logGroupFilter;
}

function _passesCredFilter(entry) {
  return !_logCredFilter || entry.credId === _logCredFilter;
}

// Dropdown options'i actLog'taki benzersiz credId'ler + Hesap dispName join ile uret
// groupId filter pattern'inin aynisi — isim + count
function _renderLogCredFilterOptions() {
  const sel = document.getElementById('LOG_FILT_CRED');
  if (!sel) return;
  const credIdsInLog = new Set();
  (window.actLog || []).forEach(e => { if (e.credId) credIdsInLog.add(e.credId); });
  const credLabel = new Map();
  let krediler = [];
  try { krediler = (window.Hesap && typeof window.Hesap.krediler === 'function') ? window.Hesap.krediler() : []; }
  catch (e) { krediler = []; }
  const dispByCid = new Map(krediler.map(k => [k.cred && k.cred.id, k.dispName]));
  credIdsInLog.forEach(cid => {
    let name = dispByCid.get(cid);
    if (!name) {
      const c = (window.creds || []).find(cr => cr.id === cid);
      name = c ? c.name : '(silinmiş kredi)';
    }
    credLabel.set(cid, name);
  });
  const sortedCids = [...credIdsInLog].sort((a, b) =>
    (credLabel.get(a) || '~').localeCompare(credLabel.get(b) || '~', 'tr'));
  const opts = ['<option value=""' + (!_logCredFilter ? ' selected' : '') + '>Tüm krediler / loglar</option>'];
  sortedCids.forEach(cid => {
    const name = credLabel.get(cid);
    const count = (window.actLog || []).filter(e => e.credId === cid).length;
    const isSel = cid === _logCredFilter ? ' selected' : '';
    opts.push('<option value="' + window.esc(cid) + '"' + isSel + '>' + window.esc(name) + ' (' + count + ')</option>');
  });
  sel.innerHTML = opts.join('');
}

function setLogCredFilter(cid) {
  _logCredFilter = cid || '';
  // Filter degisince stale index'leri temizle (gorunmez kayitlarda selection olmasin)
  _logSelected.clear();
  renderActLog();
}

// Dropdown options'i actLog'taki benzersiz groupId'ler + pays.name join ile uret (v8.156)
// personId filter pattern'inin aynisi — sadece isim + count (disambiguation yok)
function _renderLogGroupFilterOptions() {
  const sel = document.getElementById('LOG_FILT_GROUP');
  if (!sel) return;
  const groupIdsInLog = new Set();
  (window.actLog || []).forEach(e => { if (e.groupId) groupIdsInLog.add(e.groupId); });
  const groupLabel = new Map();
  groupIdsInLog.forEach(gid => {
    const first = (typeof window.findPaysByGroup === 'function')
      ? window.findPaysByGroup(gid)[0]
      : (window.pays || []).find(p => p.groupId === gid);
    groupLabel.set(gid, first ? first.name : '(silinmiş grup)');
  });
  const sortedGids = [...groupIdsInLog].sort((a, b) =>
    (groupLabel.get(a) || '~').localeCompare(groupLabel.get(b) || '~', 'tr'));
  const opts = ['<option value=""' + (!_logGroupFilter ? ' selected' : '') + '>Tüm kayıt grupları / loglar</option>'];
  sortedGids.forEach(gid => {
    const name = groupLabel.get(gid);
    const count = (window.actLog || []).filter(e => e.groupId === gid).length;
    const isSel = gid === _logGroupFilter ? ' selected' : '';
    opts.push('<option value="' + window.esc(gid) + '"' + isSel + '>' + window.esc(name) + ' (' + count + ')</option>');
  });
  sel.innerHTML = opts.join('');
}

function setLogGroupFilter(gid) {
  _logGroupFilter = gid || '';
  // Filter degisince stale index'leri temizle (gorunmez kayitlarda selection olmasin)
  _logSelected.clear();
  renderActLog();
}

// ── TÜR (kategori) FİLTRESİ (v8.173) ───────────────────────────────────────
const LOG_TYPE_CAT = {
  paid:'odeme',
  plan_add:'eklenen', cred_add:'eklenen',
  plan_del:'silinen', hist_del:'silinen', rhb_del:'silinen',
  restore:'geri', plan_undo:'geri',
  plan_edit:'duzenleme', rhb_edit:'duzenleme', cred_restructure:'duzenleme',
  rhb_add:'rehber', rhb_import:'rehber',
};
const LOG_CAT_LABELS = { odeme:'Ödemeler', eklenen:'Eklenenler', silinen:'Silinenler', geri:'Geri alma', duzenleme:'Düzenleme', rehber:'Rehber' };
let _logTypeFilter = '';

function _passesTypeFilter(entry) {
  return !_logTypeFilter || LOG_TYPE_CAT[entry.type] === _logTypeFilter;
}

function _renderLogTypeFilterOptions() {
  const sel = document.getElementById('LOG_FILT_TYPE');
  if (!sel) return;
  const catCount = {};
  (window.actLog || []).forEach(e => { const c = LOG_TYPE_CAT[e.type]; if (c) catCount[c] = (catCount[c]||0)+1; });
  // v8.183: ledger-li kategoriler gercek defter uzunlugunu gosterir (dropdown sayisi = ledger satir sayisi).
  catCount.odeme = (window.paidItems || []).length;
  catCount.silinen = (window.hist || []).length;
  const order = ['odeme','eklenen','silinen','geri','duzenleme','rehber'];
  const opts = ['<option value=""' + (!_logTypeFilter ? ' selected' : '') + '>Tüm türler / loglar</option>'];
  order.forEach(cat => {
    if (!catCount[cat]) return;
    const isSel = cat === _logTypeFilter ? ' selected' : '';
    opts.push('<option value="' + cat + '"' + isSel + '>' + LOG_CAT_LABELS[cat] + ' (' + catCount[cat] + ')</option>');
  });
  sel.innerHTML = opts.join('');
}

function setLogTypeFilter(cat) {
  _logTypeFilter = cat || '';
  _logSelected.clear();
  renderActLog();
}

// ── LEDGER-VIEW (v8.174) ───────────────────────────────────────────────────
function _renderLogLedgerPaid(el) {
  const _all = (window.paidItems || []).slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
  const items = _all.filter(p => _ledgerPassesFilters(p, 'date'));
  const _flt = _ledgerFltActive();
  const cntEl = document.getElementById('LOG_CNT'); if (cntEl) cntEl.textContent = (_flt && items.length !== _all.length) ? (items.length + ' / ' + _all.length + ' ödeme') : (items.length + ' ödeme');
  if (!items.length) { el.innerHTML = '<div class="empty"><div class="ico">' + (_flt ? '🔍' : '💰') + '</div><p>' + (_flt ? 'Bu filtreye uyan ödeme yok.' : 'Yapılan ödeme yok.') + '</p></div>'; return; }
  // v8.189: p.paid ayarliysa onu kullan (markOk her zaman paid=toTRY(amount) yazar; savePaidItem
  // duzenlemede paid'i gunceller). Eskiden status==='paid' icin p.amount'tan yeniden hesaplaniyordu
  // -> duzenleme gorunmuyordu + FX kalemlerde guncel kura gore kayiyordu. Artik odeme anindaki deger sabit.
  const paidOf = p => p.paid != null ? p.paid : (p.status==='paid' ? toTRY(p.amount,p.currency||'TRY',window.rates) : 0);
  const totAll = items.reduce((s,p)=>s+paidOf(p),0);
  const now=new Date(); const curMk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const grouped={}; items.forEach(p=>{const d=window.parseLocalDate(p.date);const mk=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');(grouped[mk]=grouped[mk]||[]).push(p);});
  const totCur=(grouped[curMk]||[]).reduce((s,p)=>s+paidOf(p),0);
  let html='<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<div style="flex:1;background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Bu ay ödenen</div><div style="font-family:&#39;IBM Plex Mono&#39;,monospace;font-weight:700;color:#4ade80;font-size:15px">'+window.fmt(totCur)+'</div></div>'
    + '<div style="flex:1;background:var(--surf);border:1px solid var(--bdr);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Toplam ('+items.length+')</div><div style="font-family:&#39;IBM Plex Mono&#39;,monospace;font-weight:700;color:#e2e8f0;font-size:15px">'+window.fmt(totAll)+'</div></div></div>';
  Object.keys(grouped).sort().reverse().forEach(mk=>{
    const [y,mo]=mk.split('-');
    const lbl=new Date(+y,+mo-1,1).toLocaleDateString('tr-TR',{month:'long',year:'numeric'});
    const mTot=grouped[mk].reduce((s,p)=>s+paidOf(p),0);
    html+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;padding:10px 0 6px;border-top:1px solid var(--bdr);display:flex;justify-content:space-between"><span>'+lbl+'</span><span style="color:#4ade80;font-family:&#39;IBM Plex Mono&#39;,monospace">'+window.fmt(mTot)+'</span></div>';
    grouped[mk].forEach(p=>{
      const tryAmt=toTRY(p.amount,p.currency||'TRY',window.rates); const pd=paidOf(p); const isPartial=p.status==='partial'; const pid=window.esc(p.paidId||'');
      html+='<div style="display:flex;gap:8px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);align-items:center">'
        + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+window.esc(p.name||'')+'</div><div style="font-size:11px;color:#94a3b8">'+window.fmtD(p.date)+'</div></div>'
        + '<div style="text-align:right;flex-shrink:0"><div style="font-family:&#39;IBM Plex Mono&#39;,monospace;font-weight:600;font-size:13px;color:'+(isPartial?'var(--ora)':'#4ade80')+'">'+window.fmt(pd)+'</div>'+(isPartial?'<div style="font-size:10px;color:#94a3b8">'+window.fmt(tryAmt-pd)+' kaldı</div>':'')+'</div>'
        + '<button onclick="openPaidEdit(&#39;'+pid+'&#39;)" style="background:rgba(192,132,252,.15);color:var(--acc2);border:1px solid rgba(192,132,252,.2);border-radius:6px;padding:4px 7px;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0">Düzenle</button>'
        + '<button onclick="delPaidItem(&#39;'+pid+'&#39;)" style="background:rgba(248,113,113,.12);color:var(--danger);border:1px solid rgba(248,113,113,.2);border-radius:6px;padding:4px 7px;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0">Sil</button></div>';
    });
  });
  el.innerHTML=html;
}

function _renderLogLedgerHist(el) {
  const _all = (window.hist || []);
  const items = _all.map((p, oi) => ({ p, oi })).filter(o => _ledgerPassesFilters(o.p, 'delAt'));
  const _flt = _ledgerFltActive();
  const cntEl = document.getElementById('LOG_CNT'); if (cntEl) cntEl.textContent = (_flt && items.length !== _all.length) ? (items.length + ' / ' + _all.length + ' silinmiş') : (items.length + ' silinmiş');
  if (!items.length) { el.innerHTML = '<div class="empty"><div class="ico">' + (_flt ? '🔍' : '🗑️') + '</div><p>' + (_flt ? 'Bu filtreye uyan silinmiş kayıt yok.' : 'Silinmiş kayıt yok.') + '</p></div>'; return; }
  const totAll=items.reduce((s,o)=>s+toTRY(o.p.amount,o.p.currency||'TRY',window.rates),0)
  let html='<div style="display:flex;gap:8px;margin-bottom:10px;align-items:stretch">'
    + '<div style="flex:1;background:var(--surf);border:1px solid var(--bdr);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Silinmiş ('+items.length+')</div><div style="font-family:&#39;IBM Plex Mono&#39;,monospace;font-weight:700;color:#94a3b8;font-size:15px">'+window.fmt(totAll)+'</div></div>'
    + '<button onclick="if(window.clrHist){clrHist();}" style="background:rgba(248,113,113,.12);color:var(--danger);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:0 14px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap">Tümünü temizle</button></div>';
  html+=items.map(({p,oi})=>{
    const amt=window.fmt(toTRY(p.amount,p.currency||'TRY',window.rates));
    const when=p.delAt?window.fmtLogTime(p.delAt):(p.date||'');
    return '<div style="display:flex;gap:8px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);align-items:center">'
      + '<div style="width:30px;height:30px;border-radius:50%;background:rgba(248,113,113,.15);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">🗑️</div>'
      + '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+window.esc(p.name||'')+'</div><div style="font-size:11px;color:#94a3b8">silindi · '+when+'</div></div>'
      + '<div style="font-family:&#39;IBM Plex Mono&#39;,monospace;font-weight:600;color:#94a3b8;font-size:13px;white-space:nowrap">'+amt+'</div>'
      + '<button onclick="editHistItem('+oi+')" style="background:rgba(192,132,252,.15);color:var(--acc2);border:1px solid rgba(192,132,252,.2);border-radius:6px;padding:4px 7px;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0">Düzenle</button>'
      + '<button onclick="restoreFromHist('+oi+')" style="background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.3);color:#4ade80;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;flex-shrink:0;white-space:nowrap">↩️ Geri</button>'
      + '<button onclick="delHist('+oi+')" style="background:none;border:none;cursor:pointer;font-size:14px;opacity:.7;flex-shrink:0">🗑</button></div>';
  }).join('');
  el.innerHTML=html;
}

// Dropdown options'i actLog'tan benzersiz personId'ler + persons.name join ile uret (v8.141)
function _renderLogPersonFilterOptions() {
  const sel = document.getElementById('LOG_FILT_PERSON');
  if (!sel) return;
  const personIdsInLog = new Set();
  (window.actLog || []).forEach(e => { if (e.personId) personIdsInLog.add(e.personId); });
  const personById = new Map((window.persons || []).map(p => [p.id, p.name]));
  const sortedPids = [...personIdsInLog].sort((a, b) =>
    (personById.get(a) || '~').localeCompare(personById.get(b) || '~', 'tr'));
  const opts = ['<option value=""' + (!_logPersonFilter ? ' selected' : '') + '>Tüm kişiler / loglar</option>'];
  sortedPids.forEach(pid => {
    const name = personById.get(pid) || '(silinmiş kişi)';
    const count = (window.actLog || []).filter(e => e.personId === pid).length;
    const isSel = pid === _logPersonFilter ? ' selected' : '';
    opts.push('<option value="' + window.esc(pid) + '"' + isSel + '>' + window.esc(name) + ' (' + count + ')</option>');
  });
  sel.innerHTML = opts.join('');
}

function setLogPersonFilter(pid) {
  _logPersonFilter = pid || '';
  // Filter degisince stale index'leri temizle (gorunmez kayitlarda selection olmasin)
  _logSelected.clear();
  renderActLog();
}

// v8.186: tarih filtre mantigi tek kaynak — actLog (entry.at) + ledger (p.date/p.delAt) paylasir
function _passesDateVal(dateVal) {
  if (_logFilter === 'all') return true;
  const t = new Date(dateVal);
  if (isNaN(t.getTime())) return false;
  const now = new Date();
  if (_logFilter === 'today') return t.toDateString() === now.toDateString();
  if (_logFilter === 'week') {
    const wkStart = new Date(now);
    const dow = (wkStart.getDay() + 6) % 7; // Pzt=0, Paz=6
    wkStart.setHours(0,0,0,0);
    wkStart.setDate(wkStart.getDate() - dow);
    return t >= wkStart;
  }
  if (_logFilter === 'month') return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth();
  return true;
}

function _passesLogFilter(entry) { return _passesDateVal(entry.at); }

// v8.186: ledger (Odemeler/Silinenler) kisi+grup+tarih filtre kombinasyonu.
// paidItems/hist spread'le personId/groupId'yi miras alir; tarih alani parametrik.
// Cred filtresi ledger'da N/A.
function _ledgerFltActive() { return !!_logPersonFilter || !!_logGroupFilter || _logFilter !== 'all'; }
function _ledgerPassesFilters(item, dateField) {
  if (_logPersonFilter && item.personId !== _logPersonFilter) return false;
  if (_logGroupFilter  && item.groupId  !== _logGroupFilter)  return false;
  if (_logFilter !== 'all' && !_passesDateVal(item[dateField])) return false;
  return true;
}

function setLogFilter(mode) {
  _logFilter = mode;
  ['all','today','week','month'].forEach(m => {
    const b = document.getElementById('LOG_FILTER_' + m.toUpperCase());
    if (!b) return;
    const active = (m === mode);
    b.style.background  = active ? 'rgba(96,165,250,.15)' : '';
    b.style.color       = active ? 'var(--blue)'          : '';
    b.style.borderColor = active ? 'rgba(96,165,250,.3)'  : '';
  });
  _logSelected.clear();
  renderActLog();
}

function renderActLog() {
  const el=document.getElementById('ACT_LOG_LIST');if(!el)return;
  _renderLogPersonFilterOptions();
  _renderLogGroupFilterOptions();
  _renderLogCredFilterOptions();
  _renderLogTypeFilterOptions();
  if (_logTypeFilter === 'odeme')   { _renderLogLedgerPaid(el); return; }
  if (_logTypeFilter === 'silinen') { _renderLogLedgerHist(el); return; }
  const total=window.actLog.length;
  // Date + person + group + cred + tur filter birlikte uygulanir (v8.141 + v8.156 + v8.173, AND-combine)
  const entries=window.actLog.map((e,i)=>({e,i})).filter(({e})=>_passesLogFilter(e)&&_passesPersonFilter(e)&&_passesGroupFilter(e)&&_passesCredFilter(e)&&_passesTypeFilter(e));
  const shown=entries.length;
  const filterActive=(_logFilter!=='all')||!!_logPersonFilter||!!_logGroupFilter||!!_logCredFilter||!!_logTypeFilter;
  const cntEl=document.getElementById('LOG_CNT');
  if(cntEl){
    cntEl.textContent=(!filterActive||shown===total)
      ? total+' hareket'
      : shown+' / '+total+' hareket';
  }
  if(!total){el.innerHTML='<div class="empty"><div class="ico">📋</div><p>Henüz kayıt yok.</p></div>';return;}
  if(!shown){
    const msg=_logCredFilter?'Bu krediye ait kayıt yok.':_logGroupFilter?'Bu kayıt grubuna ait kayıt yok.':_logPersonFilter?'Bu kişiye ait kayıt yok.':'Bu aralıkta kayıt yok.';
    el.innerHTML='<div class="empty"><div class="ico">🔍</div><p>'+msg+'</p></div>';return;
  }
  const selMode=_logDelMode==='select';
  try {
    el.innerHTML=entries.map(({e,i})=>{
      try {
        const cfg=(LOG_ICONS&&LOG_ICONS[e.type])||{icon:'📋',bg:'rgba(255,255,255,.07)'};
        const time=e.at?window.fmtLogTime(e.at):'';
        const nav=(typeof e.navTab==='number'&&e.navTab>=0)?e.navTab:-1;
        const title=(e.title?String(e.title):'(başlık yok)')+(e.hareket&&e.hareket.iptal?' · geri alındı':(e.hareket&&e.hareket.duzenlendi?' · düzenlendi':''));
        const detail=e.detail?String(e.detail):'';
        const isSel=_logSelected.has(i);
        const rowBg=isSel?'rgba(96,165,250,.08)':'transparent';
        const cbHtml=selMode?'<input type="checkbox" id="LOG_CB_'+i+'" '+(isSel?'checked':'')+' onchange="toggleLogItem('+i+')" onclick="event.stopPropagation()" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;margin-top:8px">':'';
        const rowClick=selMode?'toggleLogItem('+i+')':'logNav('+nav+')';
        return '<div onclick="'+rowClick+'" style="display:flex;gap:11px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);cursor:pointer;align-items:flex-start;background:'+rowBg+';border-radius:6px;margin:0 -4px;padding-left:4px;padding-right:4px">'
          +cbHtml
          +'<div style="width:32px;height:32px;border-radius:50%;background:'+cfg.bg+';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">'+cfg.icon+'</div>'
          +'<div style="flex:1;min-width:0;padding-right:8px">'
          +'<div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:2px">'
          +  title
          +  (e.personId?`<span class="log-jump" onclick="event.stopPropagation();logJumpPerson('${e.personId}')" title="Kişiyi göster">👤</span>`:'')
          +  (e.groupId?`<span class="log-jump" onclick="event.stopPropagation();logJumpGroup('${e.groupId}')" title="Plan matrisinde göster">📋</span>`:'')
          +'</div>'
          +(detail?'<div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+detail+'</div>':'')
          +'</div>'
          +'<div style="font-size:10px;color:#64748b;flex-shrink:0;margin-top:3px;white-space:nowrap">'+time+'</div>'
          +'</div>';
      } catch(itemErr){return '<div style="padding:8px;color:orange;font-size:11px">Hata '+i+': '+String(itemErr)+'</div>';}
    }).join('');
    if(selMode) _updateLogSelCount();
  } catch(renderErr){el.innerHTML='<div style="padding:12px;color:red">Render hatası: '+String(renderErr)+'</div>';}
}

function logNav(tab) { if(tab>=0) go(tab); }

// v8.144: log ikonlarindan plan matrisine / kisilere jump + flash highlight
function logJumpGroup(groupId) {
  go(0);
  setTimeout(() => {
    let row = document.querySelector(`tr[data-row-key="g_${groupId}"]`);
    if (!row) row = document.querySelector(`tr[data-row-key="pay_${groupId}"]`);
    if (!row) return;
    row.scrollIntoView({behavior:'smooth', block:'center'});
    row.classList.add('jump-flash');
    setTimeout(() => row.classList.remove('jump-flash'), 1500);
  }, 100);
}

function logJumpPerson(personId) {
  go(2);
  setTimeout(() => {
    const card = document.querySelector(`[data-person-id="${personId}"]`);
    if (!card) return;
    card.scrollIntoView({behavior:'smooth', block:'center'});
    card.classList.add('jump-flash');
    setTimeout(() => card.classList.remove('jump-flash'), 1500);
  }, 100);
}

function setLogDelMode(mode) {
  _logDelMode=mode;
  document.getElementById('LOG_RANGE_PANEL').style.display=mode==='range'?'':'none';
  document.getElementById('LOG_SEL_PANEL').style.display=mode==='select'?'':'none';
  const personPanel=document.getElementById('LOG_PERSON_PANEL');
  if(personPanel) personPanel.style.display=mode==='person'?'':'none';
  const groupPanel=document.getElementById('LOG_GROUP_PANEL');
  if(groupPanel) groupPanel.style.display=mode==='group'?'':'none';
  // Mod butonu stilleri
  const setBtnStyle=(id,active)=>{
    const el=document.getElementById(id); if(!el) return;
    el.style.background=active?'rgba(96,165,250,.15)':'';
    el.style.color=active?'var(--blue)':'';
    el.style.borderColor=active?'rgba(96,165,250,.3)':'';
  };
  setBtnStyle('LOG_MODE_RANGE', mode==='range');
  setBtnStyle('LOG_MODE_SEL',   mode==='select');
  setBtnStyle('LOG_MODE_PERSON',mode==='person');
  setBtnStyle('LOG_MODE_GROUP', mode==='group');
  if(mode==='person') _populateLogPersonSelect();
  if(mode==='group') _populateLogGroupSelect();
  if(mode==='select'){_logSelected.clear();renderActLog();}else{renderActLog();}
}

function _populateLogPersonSelect() {
  const sel=document.getElementById('LOG_PERSON_SEL'); if(!sel) return;
  const persons=(window.persons||[]).filter(p => p.id)
    .sort((a,b) => (a.name||'').localeCompare(b.name||'','tr'));
  if(!persons.length){
    sel.innerHTML='<option value="">Listede id\'li kişi yok</option>';
    sel.disabled=true;
    return;
  }
  sel.disabled=false;
  sel.innerHTML='<option value="">— Kişi seçin —</option>'+
    persons.map(p => '<option value="'+p.id+'">'+window.esc(p.name)+'</option>').join('');
}

function _populateLogGroupSelect() {
  const sel=document.getElementById('LOG_GROUP_SEL'); if(!sel) return;
  // actLog'taki benzersiz groupId'ler — pays.name ile etiketle
  const groupIdsInLog=new Set();
  (window.actLog||[]).forEach(e => { if(e.groupId) groupIdsInLog.add(e.groupId); });
  const groupLabel=new Map();
  groupIdsInLog.forEach(gid => {
    const first=(typeof window.findPaysByGroup==='function')
      ? window.findPaysByGroup(gid)[0]
      : (window.pays||[]).find(p => p.groupId===gid);
    groupLabel.set(gid, first?first.name:'(silinmiş grup)');
  });
  const sortedGids=[...groupIdsInLog].sort((a,b) =>
    (groupLabel.get(a)||'~').localeCompare(groupLabel.get(b)||'~','tr'));
  if(!sortedGids.length){
    sel.innerHTML='<option value="">Loglarda kayıt grubu yok</option>';
    sel.disabled=true;
    return;
  }
  sel.disabled=false;
  sel.innerHTML='<option value="">— Kayıt grubu seçin —</option>'+
    sortedGids.map(gid => {
      const count=(window.actLog||[]).filter(e => e.groupId===gid).length;
      return '<option value="'+window.esc(gid)+'">'+window.esc(groupLabel.get(gid))+' ('+count+')</option>';
    }).join('');
}

function toggleSelectAllLogs(checked) {
  if(checked){window.actLog.forEach((e,i)=>{if(_passesLogFilter(e)&&_passesPersonFilter(e)&&_passesGroupFilter(e)&&_passesCredFilter(e)&&_passesTypeFilter(e))_logSelected.add(i);});}else{_logSelected.clear();}
  renderActLog();_updateLogSelCount();
}

function toggleLogItem(idx) {
  if(_logSelected.has(idx))_logSelected.delete(idx);else _logSelected.add(idx);
  _updateLogSelCount();
  const cb=document.getElementById('LOG_CB_'+idx);if(cb)cb.checked=_logSelected.has(idx);
  const allCb=document.getElementById('LOG_SEL_ALL');
  if(allCb){
    const visibleCount=window.actLog.filter(e=>_passesLogFilter(e)&&_passesPersonFilter(e)&&_passesGroupFilter(e)&&_passesCredFilter(e)&&_passesTypeFilter(e)).length;
    allCb.checked=_logSelected.size===visibleCount && visibleCount>0;
  }
}

function _updateLogSelCount() {
  const el=document.getElementById('LOG_SEL_CNT');if(el)el.textContent=_logSelected.size+' seçili';
}

function openLogDel() {
  const bar=document.getElementById('LOG_DEL_BAR');if(!bar)return;
  const wasHidden=bar.style.display==='none';
  bar.style.display=wasHidden?'':'none';
  if(!wasHidden){closeLogDel();return;}
  _logDelMode='range';setLogDelMode('range');
  const now=new Date();const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),d=String(now.getDate()).padStart(2,'0');
  document.getElementById('LOG_D1').value=y+'-'+m+'-01T00:00';
  document.getElementById('LOG_D2').value=y+'-'+m+'-'+d+'T23:59';
}

function closeLogDel() {
  const bar=document.getElementById('LOG_DEL_BAR');if(bar)bar.style.display='none';
  _logSelected.clear();_logDelMode='range';renderActLog();
}

// v8.233 KORUMALI LOG SILME: toplu silme PIN ister ve GECERLI (geri alinmamis) odeme
// hareketlerine DOKUNMAZ — o kayit silinirse plan "odendi" kalir ama izi kaybolur (hayalet odeme).
// Onlar kisi kartindan "Geri Al" veya "Kaydi Sil" ile yonetilir.
const _aktifHrk = e => !!(e && e.hareket && !e.hareket.iptal);

async function _logSilKorumali(sec, baslik) {
  const aday = window.actLog.map((e,i)=>({e,i})).filter(({e,i}) => sec(e,i));
  if (!aday.length) { alert('Silinecek kayıt bulunamadı.'); return; }
  const korunan = aday.filter(({e}) => _aktifHrk(e)).length;
  const silinecek = aday.length - korunan;
  if (!silinecek) { alert(korunan+' kaydın hepsi geçerli ödeme hareketi — korunuyor.\n\nBunları kişi kartından "Geri Al" veya "Kaydı Sil" ile yönet.'); return; }
  const ack = '<b>'+silinecek+'</b> log kaydı kalıcı silinecek.'
    + (korunan ? '<br>'+korunan+' geçerli ödeme hareketi <b>korunuyor</b> (plana bağlı; kişi kartından yönetilir).' : '')
    + '<br>Plan ve ödemeler değişmez. Onaylamak için şifreni gir.';
  const ok = window.pinOnay ? await window.pinOnay(baslik, ack) : confirm(silinecek+' kayıt silinecek. Emin misin?');
  if (!ok) return;
  const silSet = new Set(aday.filter(({e}) => !_aktifHrk(e)).map(({i}) => i));
  window.Store.removeWhere('actLog', (_, i) => silSet.has(i));
  _logSelected.clear(); renderActLog(); closeLogDel();
  if (window.showWarnToast) window.showWarnToast(silinecek+' kayıt silindi'+(korunan?' · '+korunan+' ödeme korundu':''));
}

function doLogDel() {
  const d1=document.getElementById('LOG_D1').value;const d2=document.getElementById('LOG_D2').value;
  if(!d1||!d2){alert('Tarih aralığı seçin');return;}
  const from=new Date(d1).getTime(),to=new Date(d2).getTime();
  if(isNaN(from)||isNaN(to)){alert('Geçersiz tarih');return;}
  _logSilKorumali(e => { const t=new Date(e.at).getTime(); return !(t<from||t>to); }, 'Aralığı <span>Sil</span>');
}

function doLogDelSelected() {
  if(!_logSelected.size){alert('Önce silinecek kayıtları seçin.');return;}
  const sec=new Set(_logSelected);
  _logSilKorumali((_, i) => sec.has(i), 'Seçilileri <span>Sil</span>');
}

function doLogDelAll() {
  _logSilKorumali(() => true, 'Tüm Logu <span>Sil</span>');
}

function doLogDelByPerson() {
  const sel=document.getElementById('LOG_PERSON_SEL');
  const pid=sel?sel.value:'';
  if(!pid){alert('Kişi seçin');return;}
  _logSilKorumali(e => e.personId===pid, 'Kişinin Loglarını <span>Sil</span>');
}

function doLogDelByGroup() {
  const sel=document.getElementById('LOG_GROUP_SEL');
  const gid=sel?sel.value:'';
  if(!gid){alert('Kayıt grubu seçin');return;}
  _logSilKorumali(e => e.groupId===gid, 'Grubun Loglarını <span>Sil</span>');
}


// ── GLOBAL COMPAT ──────────────────────────────────────────────────────────
window.renderActLog       = renderActLog;
window.setLogFilter       = setLogFilter;
window.setLogPersonFilter = setLogPersonFilter;
window.setLogGroupFilter  = setLogGroupFilter;
window.setLogCredFilter   = setLogCredFilter;
window.setLogTypeFilter   = setLogTypeFilter;
window.logNav             = logNav;
window.logJumpGroup       = logJumpGroup;
window.logJumpPerson      = logJumpPerson;
window.setLogDelMode      = setLogDelMode;
window.toggleSelectAllLogs= toggleSelectAllLogs;
window.toggleLogItem      = toggleLogItem;
window._updateLogSelCount = _updateLogSelCount;
window.openLogDel         = openLogDel;
window.closeLogDel        = closeLogDel;
window.doLogDel           = doLogDel;
window.doLogDelSelected   = doLogDelSelected;
window.doLogDelAll        = doLogDelAll;
window.doLogDelByPerson   = doLogDelByPerson;
window.doLogDelByGroup    = doLogDelByGroup;
window._populateLogPersonSelect = _populateLogPersonSelect;
window._populateLogGroupSelect  = _populateLogGroupSelect;
