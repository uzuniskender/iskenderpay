// js/ui-plan-actions.js — iskenderpay (v8.152)
// Hücre/satır CRUD + odendi-ay toggle.
// ui-plan.js'ten v8.150'de ayrıştırıldı; convertToCredit + editByKey
// v8.152'de detail.js'e taşındı (dialog-flow orchestrator'ları).
// Cross-module çağrılar: window.getAllItems / window.buildMx (render.js),
// window.closeDV / window.openCell (detail.js).

import { toTRY } from './util.js';
import { kalemOzet, odemePatch, tamOdePatch } from './para.js';

// ── HÜCRE CRUD ──────────────────────────────
function addToMonth(keyEnc,month) {
  const amt=parseFloat(document.getElementById('ECA').value)||0;
  const cur=document.getElementById('ECC').value;
  const date=document.getElementById('ECD').value;
  if(!amt||!date){alert('Tutar ve tarih zorunlu');return;}
  const key=decodeURIComponent(keyEnc);
  const all=window.getAllItems(),mx=window.buildMx(all);
  const name=mx[key]?._name||key.replace(/^(g_|pay_)/,'');
  const groupId=key.startsWith('g_')?key.replace('g_',''):null;
  const refItem=groupId?window.findPaysByGroup(groupId)[0]:window.pays.find(p=>p.name===name);
  const newGroupId=groupId||String(Date.now());
  window.Store.push('pays', {id:Date.now()+Math.random(), groupId:newGroupId, name, amount:amt, currency:cur, date, category:refItem?refItem.category||'Diğer':'Diğer', status:'pending', paid:0});
  window.addLog('plan_add', 'Kayıt eklendi', name+' · '+window.fmtAmt(amt,cur), 0, {groupId: newGroupId, personId: refItem && refItem.personId});
  window.closeDV();
}

// v8.172: paidItems linkage — kredi taksitlerinin benzersiz id'si yok (sadece _cid+_ii).
// Kredi ise _cid+_ii (benzersiz). -1 = bulunamadi.
//
// v8.229 (20 Agu 2026) — TARIH BAGI TUZAGI KAPATILDI:
//   Kredi-disi eslesme  id + TARIH  ikilisiyle yapiliyordu. Bir kalemin ODEME ISARETLENDIKTEN
//   SONRA tarihi duzenlenirse (savePay date'i patch'ler) bag kopuyor ve:
//     · undoCell / resetPartial  -> paidItems satirini SILEMIYOR (defterde hayalet "odendi" kalir)
//     · doPartial                -> mevcut satiri guncellemek yerine YENI satir push ediyor (defter sisiyor)
//   Saha kaniti (Serdar verisi, 20 Agu): EMRAH TASTAN ve AYKUT OKTAY satirlarinda defter tarihi
//   04-05 / 05-05, kalem tarihi 08-07 -> iki satir da bagsiz kalmisti.
//   COZUM: id ZATEN TEK KIMLIK — findPayById / markOk / undoCell hepsi p.id ile calisiyor (DRY).
//   Once TAM eslesme (id+tarih) denenir; bulunamazsa id ile yedek eslesme. Boylece calisan
//   hicbir durumun davranisi degismez, yalniz kopmus baglar yeniden kurulur.
//   Gecmis veriye DOKUNULMAZ — eski kayitlar oldugu gibi kalir, bundan sonrasi dogru calisir.
function _findPaidIdx(p) {
  const liste = window.paidItems || [];
  if (p._cid != null) {
    return liste.findIndex(x => x._cid === p._cid && x._ii === p._ii);
  }
  const tam = liste.findIndex(x =>
    x._cid == null && String(x.id) === String(p.id) && x.date === p.date);
  if (tam >= 0) return tam;
  return liste.findIndex(x => x._cid == null && String(x.id) === String(p.id));
}

// Plan kaleminin (getAllItems elemanı) SAKLANAN nesnesi: pay objesi veya kredi taksiti
function _saklanan(p) {
  if (p._cid) { const c = window.findCredById(p._cid); return c ? c.pays.find(x => x.idx === p._ii) : null; }
  return window.findPayById(p.id);
}

// v8.234: tutar hesabı js/para.js'ten. Dövizli kalemde ödenen KALEMİN PARASINDA yazılır
// (38 gr altın ödendiyse paid=38 gr); defter (paidItems) ise o günün TL karşılığını tutar.
function markOk(keyEnc,month) {
  const key=decodeURIComponent(keyEnc);
  const all=window.getAllItems(),mx=window.buildMx(all);
  const items=(mx[key]?.[month]?.items)||[];
  items.forEach(p=>{
    const obj=_saklanan(p); if(!obj) return;
    const oncesi=kalemOzet(p._cid?{...obj,_cid:p._cid}:obj, window.rates);
    if(oncesi.kalan===0) return;                       // zaten ödenmiş kalem: ikinci kez yazma
    const eklenen=oncesi.tam-oncesi.odenen;             // kalemin parasında
    const eklenenTL=oncesi.kalanTL;
    Object.assign(obj, tamOdePatch(p._cid?{...obj,_cid:p._cid}:obj, window.rates));
    const tamTL=oncesi.tamTL;
    // Kismi odenmis kalem tamamlaniyorsa mevcut defter kaydini tamamla (ikinci kayit acma).
    const _pi=oncesi.odenen>0?_findPaidIdx(p):-1;
    let _paidId;
    if(_pi>=0){const ex=window.paidItems[_pi];_paidId=ex.paidId;window.Store.mutateItem(ex,{status:'paid',paid:(ex.paid||0)+eklenenTL});}
    else{_paidId='pi_'+Date.now()+'_'+Math.random();window.Store.push('paidItems', {...p, paidId:_paidId, status:'paid', paid:tamTL, paidAt:new Date().toISOString()});}
    // Hareket logu: kaleme bu islemle eklenen tutar (kisi kartinda duzenlenebilir)
    try{
      if(window.Hareket) window.Hareket.planOdemesiLogla(p, eklenen, _paidId, false);
      else window.addLog('paid','Ödeme yapıldı',(p.name||'')+' · '+window.fmtA(eklenen,oncesi.para),1,{groupId:p.groupId, personId:p.personId});
    }catch(e){}
  });
  window.Store.touch(); window.closeDV();
}

function undoCell(keyEnc,month) {
  const key=decodeURIComponent(keyEnc);
  const all=window.getAllItems(),mx=window.buildMx(all);
  const items=(mx[key]?.[month]?.items)||[];
  items.forEach(p=>{
    const obj=_saklanan(p);
    if(obj){obj.status='pending';obj.paid=0;delete obj.odenenPara;}
    const pidx=_findPaidIdx(p);
    if(pidx>=0) window.Store.spliceAt('paidItems', pidx, 1);
    if(window.Hareket) window.Hareket.kalemHareketleriniKapat(p);
    try{window.addLog('plan_undo','Ödeme geri alındı',(p.name||'')+' · ₺'+Number(toTRY(p.amount,p.currency||'TRY',window.rates)).toLocaleString('tr-TR',{maximumFractionDigits:0}),1,{groupId:p.groupId, personId:p.personId});}catch(e){}
  });
  window.Store.touch(); window.closeDV();
}

// v8.234: kısmi ödeme TEK kaleme yazılır ve kalemin parasındadır (altında gram, euroda €).
// Eskiden hücredeki HER kaleme aynı tutar ekleniyordu: iki kalemli ayda 5.000 girince 10.000 düşüyordu.
function doPartial() {
  const amt=parseFloat(document.getElementById('KA').value)||0;
  if(!(amt>0)){alert('Tutar girin');return;}
  const key=decodeURIComponent(window.partialCtx.keyEnc), month=window.partialCtx.month;
  const all=window.getAllItems(),mx=window.buildMx(all);
  const items=((mx[key]?.[month]?.items)||[]).filter(p=>kalemOzet(p,window.rates).kalan>0);
  const secim=document.getElementById('KA_ITEM');
  const p=items.length===1?items[0]:items.find(x=>String(x._cid?('c|'+x._cid+'|'+x._ii):('p|'+x.id))===(secim&&secim.value));
  if(!p){alert('Hangi kaleme ödeme yazılacağını seçin.');return;}
  const obj=_saklanan(p); if(!obj) return;
  const oncesi=kalemOzet(p._cid?{...obj,_cid:p._cid}:obj, window.rates);
  if(amt>oncesi.kalan+(oncesi.para==='TRY'?0.5:0.005)){alert('Tutar bu kalemin kalanından ('+window.fmtA(oncesi.kalan,oncesi.para)+') büyük olamaz.');return;}
  const patch=odemePatch(p._cid?{...obj,_cid:p._cid}:obj, amt, window.rates);
  Object.assign(obj, patch);
  const amtTL=amt*(oncesi.para==='TRY'?1:(window.rates[oncesi.para]||0));
  const _pi=_findPaidIdx(p); const existing=_pi>=0?window.paidItems[_pi]:null;
  let _paidId;
  if(existing){_paidId=existing.paidId;existing.paid=(existing.paid||0)+amtTL;existing.status=patch.status;}
  else{_paidId='pi_'+Date.now()+'_'+Math.random();window.Store.push('paidItems', {...p, paidId:_paidId, status:patch.status, paid:amtTL, paidAt:new Date().toISOString()});}
  try{if(window.Hareket) window.Hareket.planOdemesiLogla(p, amt, _paidId, patch.status!=='paid');}catch(e){}
  window.Store.touch(); window.closeMov('KM');
}

function saveCellAmt(keyEnc,month) {
  const v=parseFloat(document.getElementById('CEA').value)||0;
  if(!v){alert('Geçerli tutar girin');return;}
  const key=decodeURIComponent(keyEnc);
  const all=window.getAllItems(),mx=window.buildMx(all);
  const items=(mx[key]?.[month]?.items)||[];
  // v8.234: hücrede birden çok kalem varsa girilen tutar her birine yazılıp toplamı katlıyordu.
  if(items.length>1){alert('Bu ayda '+items.length+' ayrı kalem var. Tutarı tek tek değiştirmek için kişinin cari kartında o ayı aç.');return;}
  items.forEach(p=>{
    if(p._cid){const c=window.findCredById(p._cid);if(c){const i=c.pays.find(x=>x.idx===p._ii);if(i)i.amount=v;}}
    else{const orig=window.findPayById(p.id);if(orig)orig.amount=v;}
  });
  window.Store.touch(); window.openCell(keyEnc, month);
}

function resetPartial(keyEnc,month) {
  const key=decodeURIComponent(keyEnc);
  const all=window.getAllItems(),mx=window.buildMx(all);
  const items=(mx[key]?.[month]?.items)||[];
  items.forEach(p=>{
    const obj=_saklanan(p);
    if(obj){obj.status='pending';obj.paid=0;delete obj.odenenPara;}
    const pidx=_findPaidIdx(p);
    if(pidx>=0) window.Store.spliceAt('paidItems', pidx, 1);
    if(window.Hareket) window.Hareket.kalemHareketleriniKapat(p);
  });
  window.Store.touch(); window.closeDV();
}

// ── SATIR / AY SİL ──────────────────────────
function delByKey(keyEnc) {
  const key=decodeURIComponent(keyEnc);
  const all=window.getAllItems(),mx=window.buildMx(all);
  const dispName=mx[key]?._displayName||mx[key]?._name||key;
  if(!confirm(dispName+' — tüm aylar silinecek. Emin misin?'))return;
  if(key.startsWith('cred_')){
    const credId=key.replace('cred_','');
    const c=window.findCredById(credId);
    if(c){c.pays.forEach(p=>window.Store.unshift('hist',{...p,name:c.name,currency:'TRY',delAt:new Date().toISOString()}));try{window.addLog('plan_del','Kredi silindi',c.name+' · '+c.pays.length+' taksit',0);}catch(e){}}
    window.Store.removeWhere('creds', x => String(x.id)===credId);
  } else if(key.startsWith('g_')){
    const gid=key.replace('g_','');
    const toDelete=window.pays.filter(p=>p.groupId===gid);
    toDelete.forEach(p=>window.Store.unshift('hist',{...p,delAt:new Date().toISOString()}));
    try{window.addLog('plan_del','Kayıt silindi',dispName+' · '+toDelete.length+' ödeme',0,{groupId:gid, personId:toDelete[0]&&toDelete[0].personId});}catch(e){}
    window.Store.removeWhere('pays', p => p.groupId===gid);
  } else {
    const pid=key.replace('pay_','');
    const toDelete=window.pays.filter(p=>String(Math.floor(Number(p.id)))===pid);
    toDelete.forEach(p=>window.Store.unshift('hist',{...p,delAt:new Date().toISOString()}));
    try{if(toDelete.length)window.addLog('plan_del','Kayıt silindi',toDelete[0].name+' · '+window.fmtAmt(toDelete[0].amount,toDelete[0].currency||'TRY'),0,{groupId:toDelete[0].groupId, personId:toDelete[0].personId});}catch(e){}
    window.Store.removeWhere('pays', p => String(Math.floor(Number(p.id)))===pid);
  }
  window.closeDV();
}

function delMonthEntry(idEnc) {
  const id=decodeURIComponent(idEnc);
  if(!confirm('Bu aya ait kayıt silinecek. Diğer aylar etkilenmez. Emin misin?'))return;
  const p=window.findPayById(id);
  if(p){try{window.addLog('plan_del','Kayıt silindi',p.name+' · '+window.fmtAmt(p.amount,p.currency||'TRY'),0,{groupId:p.groupId, personId:p.personId});}catch(e){};window.Store.unshift('hist',{...p,delAt:new Date().toISOString()});window.Store.removeWhere('pays', x => String(x.id)===id);}
  window.closeDV();
}

function delCellItems(keyEnc,month) {
  const key=decodeURIComponent(keyEnc);
  if(!confirm('Bu aydaki kayıtlar silinecek. Emin misin?'))return;
  const all=window.getAllItems(),mx=window.buildMx(all);
  const items=(mx[key]?.[month]?.items)||[];
  items.forEach(p=>{
    if(p._cid) return;
    window.Store.unshift('hist',{...p,delAt:new Date().toISOString()});
    window.Store.removeWhere('pays', x => String(x.id)===String(p.id));
  });
  window.closeDV();
}

// ── ÖDENDİ AY TOGGLE ─────────────────────────
function togglePaidMonths() {
  const current = localStorage.getItem('v8-show-paid') === '1';
  localStorage.setItem('v8-show-paid', current ? '0' : '1');
  window.render();
}

// ── GLOBAL COMPAT ──────────────────────────
window.addToMonth       = addToMonth;
window.markOk           = markOk;
window.undoCell         = undoCell;
window.doPartial        = doPartial;
window.saveCellAmt      = saveCellAmt;
window.resetPartial     = resetPartial;
window.delByKey         = delByKey;
window.delMonthEntry    = delMonthEntry;
window.delCellItems     = delCellItems;
window.togglePaidMonths = togglePaidMonths;
