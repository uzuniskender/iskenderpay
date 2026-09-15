// js/rehber.js — iskenderpay
// Rehber CRUD, CSV import/export, telefon normalleştirme

let _rhbPhones = [];
const RHB_LBL_OPTS = ['Cep','İş','Özel','Ev','Şirket','Diğer'];

function normPhone(raw) {
  let d=raw.replace(/[^\d]/g,'');
  if(d.startsWith('90')&&d.length===12) d='0'+d.slice(2);
  if(d.length===10&&d.startsWith('5')) d='0'+d;
  if(d.length===11&&d.startsWith('05')) return d.slice(0,4)+' '+d.slice(4,7)+' '+d.slice(7,9)+' '+d.slice(9,11);
  return raw.trim();
}

function rhbGetName(p) { if(p.name)return p.name;return((p.firstName||'')+' '+(p.lastName||'')).trim(); }

function rhbGetInitials(p) {
  const n=rhbGetName(p);const parts=n.split(' ').filter(Boolean);
  if(parts.length>=2)return(parts[0][0]+parts[parts.length-1][0]).toUpperCase();
  return(parts[0]?.[0]||'?').toUpperCase();
}

function renderRhb() {
  const q=window.araNormalize(document.getElementById('RHB_SRCH')?.value||'');
  let list=[...window.rehber];
  if(q)list=list.filter(p=>window.araNormalize(rhbGetName(p)).includes(q)||window.araNormalize(p.company).includes(q)||(p.phones||[]).some(ph=>ph.num.includes(q)));
  const sort=document.getElementById('RHB_SORT')?.value||'name';
  list.sort((a,b)=>{
    if(sort==='lastname'){const la=rhbGetName(a).trim().split(' ').pop()||'';const lb=rhbGetName(b).trim().split(' ').pop()||'';return la.localeCompare(lb,'tr')||rhbGetName(a).localeCompare(rhbGetName(b),'tr');}
    if(sort==='company'){const ca=(a.company||'\uffff').toLocaleLowerCase('tr');const cb=(b.company||'\uffff').toLocaleLowerCase('tr');return ca.localeCompare(cb,'tr')||rhbGetName(a).localeCompare(rhbGetName(b),'tr');}
    return rhbGetName(a).localeCompare(rhbGetName(b),'tr');
  });
  const coSet=[...new Set(window.rehber.map(p=>p.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
  const dlEl=document.getElementById('RHB_CO_LIST');
  if(dlEl)dlEl.innerHTML=coSet.map(c=>`<option value="${window.esc(c)}">`).join('');
  const el=document.getElementById('RHB_LIST');if(!el)return;  // v8.234: Rehber sekmesi kaldırıldı -> no-op
  if(!list.length){el.innerHTML='<div class="empty"><div class="ico">📒</div><p>Kişi bulunamadı.<br>+ Ekle ile başlayın.</p></div>';return;}
  el.innerHTML=list.map(p=>{
    const initials=rhbGetInitials(p);
    const firstPhone=p.phones?.[0]?.num||'';
    const subParts=[];
    if(p.company)subParts.push(`<span>${window.esc(p.company)}</span>`);
    if(firstPhone)subParts.push(`<span style="font-family:'IBM Plex Mono',monospace">${window.esc(firstPhone)}</span>`);
    const sub=subParts.join('<span style="color:var(--bdr);margin:0 4px">·</span>');
    return `<div class="rhb-card" data-detail-id="${p.id}">
      <div class="rhb-avatar">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(rhbGetName(p))}</div>
        ${sub?`<div style="font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>`:''}
      </div>
      <div style="color:var(--muted);font-size:16px;font-weight:300">›</div>
    </div>`;
  }).join('');
  if (!_rhbListHandlerAttached) {
    el.addEventListener('click', e => {
      const card = e.target.closest('.rhb-card[data-detail-id]');
      if (card) openRhbDetail(card.dataset.detailId);
    });
    _rhbListHandlerAttached = true;
  }
}

function openRhbDetail(id) {
  const p=window.rehber.find(x=>String(x.id)===String(id));if(!p)return;
  const initials=rhbGetInitials(p);
  let h=`<div style="text-align:center;margin-bottom:18px">
    <div class="rhb-avatar" style="width:56px;height:56px;font-size:20px;margin:0 auto 10px">${initials}</div>
    <div style="font-size:18px;font-weight:700">${window.esc(rhbGetName(p))} <button class="rhb-copy-btn" data-copy="${window.esc(rhbGetName(p))}" style="vertical-align:middle;font-size:13px">📋</button></div>
    ${p.company?`<div style="font-size:12px;color:var(--muted);margin-top:3px">🏢 ${window.esc(p.company)}</div>`:''}
  </div>`;
  if(p.phones?.length){p.phones.filter(ph=>ph.num).forEach(ph=>{h+=`<div class="rhb-field"><div style="min-width:0;flex:1">${ph.lbl?`<div class="rhb-field-lbl">${window.esc(ph.lbl)}</div>`:'<div class="rhb-field-lbl">Telefon</div>'}<div class="rhb-field-val mono">${window.esc(ph.num)}</div></div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:10px"><a href="tel:${encodeURIComponent(ph.num)}" class="rhb-call-btn">📞</a><button class="rhb-copy-btn" data-copy="${window.esc(ph.num)}">📋</button></div></div>`;});}
  if(p.email){h+=`<div class="rhb-field"><div style="min-width:0;flex:1"><div class="rhb-field-lbl">E-posta</div><div class="rhb-field-val" style="word-break:break-all">${window.esc(p.email)}</div></div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:10px"><a href="mailto:${encodeURIComponent(p.email)}" class="rhb-call-btn">✉️</a><button class="rhb-copy-btn" data-copy="${window.esc(p.email)}">📋</button></div></div>`;}
  if(p.iban){h+=`<div class="rhb-field"><div style="min-width:0;flex:1"><div class="rhb-field-lbl">IBAN</div><div class="rhb-field-val mono" style="word-break:break-all">${window.esc(p.iban)}</div></div><div style="display:flex;gap:6px;flex-shrink:0;margin-left:10px"><button class="rhb-copy-btn" data-copy="${window.esc(p.iban)}">📋</button></div></div>`;}
  if(p.note){h+=`<div style="background:var(--surf2);border-radius:9px;padding:10px 12px;margin-bottom:10px;border:1px solid var(--bdr)"><div class="rhb-field-lbl" style="margin-bottom:5px">Not</div><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${window.esc(p.note)}</div></div>`;}
  h+=`<div class="dacts"><button class="dact da-edit" data-edit-id="${p.id}">Düzenle</button><button class="dact da-del" data-del-id="${p.id}">Sil</button><button class="dact da-close" data-close>Kapat</button></div>`;
  document.getElementById('RDET_C').innerHTML=h;
  if (!_rdetHandlerAttached) {
    document.getElementById('RDET_C').addEventListener('click', e => {
      const copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) { rhbCopy(copyBtn.dataset.copy, copyBtn); return; }
      const editBtn = e.target.closest('[data-edit-id]');
      if (editBtn) { openRhbEdit(editBtn.dataset.editId); return; }
      const delBtn  = e.target.closest('[data-del-id]');
      if (delBtn)  { rhbDel(delBtn.dataset.delId); return; }
      if (e.target.closest('[data-close]')) closeRDET();
    });
    _rdetHandlerAttached = true;
  }
  ModalManager.open('RDET');
}

function rhbExport() {
  const data=JSON.stringify(rehber,null,2);const blob=new Blob([data],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rehber_'+new Date().toISOString().slice(0,10)+'.json';a.click();
}

function rhbImport() {
  const inp=document.createElement('input');inp.type='file';inp.accept='.json,.csv,text/csv';
  inp.onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      const text=await file.text();let data=[];
      if(file.name.toLowerCase().endsWith('.csv')||file.type.includes('csv')){data=rhbParseCsv(text);}
      else{
        data=JSON.parse(text);if(!Array.isArray(data)){alert('Geçersiz JSON formatı');return;}
        data=data.map(p=>{if(!p.name&&(p.firstName||p.lastName))p.name=((p.firstName||'')+' '+(p.lastName||'')).trim();return p;});
      }
      if(!data.length){alert('Aktarılacak kayıt bulunamadı.');return;}
      data.forEach(p=>{p.name=(p.name||'').toLocaleUpperCase('tr');p.company=(p.company||'').toLocaleUpperCase('tr');if(p.phones)p.phones=p.phones.map(ph=>({...ph,num:normPhone(ph.num)}));});
      const existKey=new Set(window.rehber.map(p=>rhbGetName(p)+'|'+(p.phones?.[0]?.num||'')));
      let added=0,skipped=0;
      data.forEach(p=>{const key=rhbGetName(p)+'|'+(p.phones?.[0]?.num||'');if(existKey.has(key)){skipped++;return;}p.id=p.id||Date.now()+added;window.Store.push('rehber', p);added++;existKey.add(key);});
      renderRhb();
      // v8.234: içe aktarılan rehber kayıtları hemen kişilere katılır (aynı adlıya telefon eklenir)
      if(added>0&&window.kisiVeriDuzenle){window.kisiVeriDuzenle();if(window.curTab===2&&window.renderPersons)window.renderPersons();}
      if(added>0)window.addLog('rhb_import','Rehber içe aktarıldı',added+' kişi eklendi'+(skipped>0?', '+skipped+' atlandı':''),6);
      alert(added+' kişi eklendi'+(skipped>0?', '+skipped+' zaten mevcut':'')+'.');
    }catch(err){alert('Dosya okunamadı: '+err.message);}
  };inp.click();
}

function rhbParseCsv(text) {
  const lines=text.split(/\r?\n/).filter(l=>l.trim());if(lines.length<2)return[];
  const headers=rhbCsvRow(lines[0]).map(h=>h.trim().toLowerCase());
  const idx=k=>headers.findIndex(h=>h.includes(k));
  const iFirst=idx('first name'),iMiddle=idx('middle name'),iLast=idx('last name'),iOrg=idx('organization');
  const iEmail=idx('e-mail')>=0?idx('e-mail'):idx('email'),iNote=idx('note');
  const phoneValCols=headers.map((h,i)=>h.includes('value')&&h.includes('phone')?i:-1).filter(i=>i>=0);
  const phoneLblCols=headers.map((h,i)=>h.includes('label')&&h.includes('phone')?i:-1).filter(i=>i>=0);
  const contacts=[];
  for(let r=1;r<lines.length;r++){
    const cols=rhbCsvRow(lines[r]);if(!cols.length)continue;
    const firstName=(cols[iFirst]||'').trim(),middleName=iMiddle>=0?(cols[iMiddle]||'').trim():'',lastName=iLast>=0?(cols[iLast]||'').trim():'';
    let name='';
    if(middleName&&lastName){name=(middleName+' '+lastName).trim();}
    else if(firstName&&lastName){name=(firstName+' '+lastName).trim();}
    else{const parts=firstName.split(' ').filter(Boolean);name=parts.length>1?parts.slice(1).join(' '):firstName;}
    if(!name)continue;
    const orgVal=iOrg>=0?(cols[iOrg]||'').trim():'';
    let company=orgVal||'';
    const phones=[];const lblMap={'work':'İş','home':'Ev','mobile':'Cep','cell':'Cep','other':'Diğer','main':'İş'};
    phoneValCols.forEach((vi,n)=>{
      const rawNums=(cols[vi]||'').split(':::').map(s=>s.trim()).filter(Boolean);
      const lblRaw=phoneLblCols[n]>=0?(cols[phoneLblCols[n]]||'').toLowerCase():'';
      const lbl=Object.entries(lblMap).find(([k])=>lblRaw.includes(k))?.[1]||'Cep';
      const seen=new Set();
      rawNums.forEach(num=>{const n2=normPhone(num.split(':::')[0].trim());if(!seen.has(n2)){phones.push({lbl,num:n2});seen.add(n2);}});
    });
    contacts.push({id:Date.now()+r,name,company,phones,email:iEmail>=0?(cols[iEmail]||'').trim():'',note:iNote>=0?(cols[iNote]||'').trim():''});
  }
  return contacts;
}

function rhbCsvRow(line) {
  const res=[];let cur='';let inQ=false;
  for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){inQ=!inQ;continue;}if(c===','&&!inQ){res.push(cur);cur='';continue;}cur+=c;}
  res.push(cur);return res;
}

function rhbCopy(text,btn){if(navigator.clipboard){navigator.clipboard.writeText(text).then(()=>rhbCopyFeedback(btn)).catch(()=>rhbCopyFallback(text,btn));}else{rhbCopyFallback(text,btn);}}

function rhbCopyFallback(text,btn){const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0;top:0;left:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);rhbCopyFeedback(btn);}

function rhbCopyFeedback(btn){const orig=btn.innerHTML;btn.innerHTML='✓';btn.style.color='var(--ok)';setTimeout(()=>{btn.innerHTML=orig;btn.style.color='';},1600);}

function openRhbAdd() {
  document.getElementById('RMOD_ID').value='';
  document.getElementById('RMOD_T').innerHTML='Kişi <span>Ekle</span>';
  ['RMOD_NAME','RMOD_COMPANY','RMOD_EMAIL','RMOD_IBAN','RMOD_NOTE'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  _rhbPhones.splice(0,_rhbPhones.length,{lbl:'Cep',num:''});renderRhbPhones();
  ModalManager.open('RMOD');
}

function openRhbEdit(id) {
  const p=window.rehber.find(x=>String(x.id)===String(id));if(!p)return;
  window.closeRDET();
  document.getElementById('RMOD_ID').value=id;
  document.getElementById('RMOD_T').innerHTML='Kişi <span>Düzenle</span>';
  const nameEl=document.getElementById('RMOD_NAME');if(nameEl)nameEl.value=p.name||((p.firstName||'')+' '+(p.lastName||'')).trim();
  const coEl=document.getElementById('RMOD_COMPANY');if(coEl)coEl.value=p.company||'';
  document.getElementById('RMOD_EMAIL').value=p.email||'';
  const ibanEl=document.getElementById('RMOD_IBAN');if(ibanEl)ibanEl.value=p.iban||'';
  document.getElementById('RMOD_NOTE').value=p.note||'';
  _rhbPhones.splice(0,_rhbPhones.length, ...(p.phones?.length?p.phones.map(x=>({...x})):[{lbl:'',num:''}]));
  renderRhbPhones();
  setTimeout(()=>ModalManager.open('RMOD'),100);
}

let _phoneHandlersAttached = false;
let _rhbListHandlerAttached = false;
let _rdetHandlerAttached = false;

function renderRhbPhones() {
  const cont = document.getElementById('RMOD_PHONES');
  if (!cont) return;
  cont.innerHTML = _rhbPhones.map((ph,i) => {
    const cur = ph.lbl || 'Cep';
    const opts = RHB_LBL_OPTS.map(o => `<option${o===cur?' selected':''}>${o}</option>`).join('');
    return `<div class="rhb-phone-row" data-i="${i}">
      <select class="fi rhb-phone-lbl" style="flex:0.65;padding:9px 8px;font-size:13px">${opts}</select>
      <input class="fi mono-inp rhb-phone-num" type="tel" placeholder="05XX XXX XX XX" value="${window.esc(ph.num)}" style="flex:1">
      ${_rhbPhones.length>1?`<button class="rhb-phone-del" style="background:rgba(248,113,113,.15);color:var(--danger);border:1px solid rgba(248,113,113,.2);border-radius:7px;padding:7px 9px;font-size:12px;cursor:pointer;flex-shrink:0">✕</button>`:''}
    </div>`;
  }).join('');
  if (_phoneHandlersAttached) return;
  // Event delegation: tek bir kez container'a bagli. Modal close/reopen'da
  // innerHTML degisir ama container element sabit, listener'lar persistent.
  cont.addEventListener('change', e => {
    if (!e.target.classList.contains('rhb-phone-lbl')) return;
    const i = +e.target.closest('.rhb-phone-row').dataset.i;
    _rhbPhones[i].lbl = e.target.value;
  });
  cont.addEventListener('input', e => {
    if (!e.target.classList.contains('rhb-phone-num')) return;
    const i = +e.target.closest('.rhb-phone-row').dataset.i;
    _rhbPhones[i].num = e.target.value;
  });
  cont.addEventListener('click', e => {
    if (!e.target.classList.contains('rhb-phone-del')) return;
    const i = +e.target.closest('.rhb-phone-row').dataset.i;
    _rhbPhones.splice(i, 1);
    renderRhbPhones();
  });
  _phoneHandlersAttached = true;
}

function rhbAddPhone() { _rhbPhones.push({lbl:'Cep',num:''}); renderRhbPhones(); }

function rhbSavePerson() {
  const name=(document.getElementById('RMOD_NAME')?.value.trim()||'').toLocaleUpperCase('tr');
  const company=(document.getElementById('RMOD_COMPANY')?.value.trim()||'').toLocaleUpperCase('tr');
  if(!name){alert('İsim Soyisim girin');return;}
  const phones=_rhbPhones.filter(ph=>ph.num.trim()).map(ph=>({...ph,num:normPhone(ph.num)}));
  const email=document.getElementById('RMOD_EMAIL').value.trim();
  const iban=(document.getElementById('RMOD_IBAN')?.value.trim()||'').toLocaleUpperCase('tr').replace(/\s+/g,'');
  const note=document.getElementById('RMOD_NOTE').value.trim();
  const eid=document.getElementById('RMOD_ID').value;
  if(eid){const p=window.rehber.find(x=>String(x.id)===String(eid));if(p)window.Store.mutateItem(p,{name,company,phones,email,iban,note});window.addLog('rhb_edit','Kişi düzenlendi',name+(company?' · '+company:''),6);}
  else{window.Store.push('rehber',{id:Date.now(),name,company,phones,email,iban,note});window.addLog('rhb_add','Kişi eklendi',name+(company?' · '+company:'')+(phones[0]?' · '+phones[0].num:''),6);}
  window.closeMov('RMOD');renderRhb();
}

function rhbDel(id) {
  const p=window.rehber.find(x=>String(x.id)===String(id));
  if(!confirm(rhbGetName(p)+' silinecek. Emin misin?'))return;
  window.addLog('rhb_del','Kişi silindi',rhbGetName(p||{})+(p?.company?' · '+p.company:''),6);
  window.Store.removeWhere('rehber', x => String(x.id)===String(id));
  window.closeRDET();renderRhb();
}


// ── GLOBAL COMPAT ──────────────────────────────────────────────────────────
window.normPhone          = normPhone;
window.rhbGetName         = rhbGetName;
window.rhbGetInitials     = rhbGetInitials;
window.renderRhb          = renderRhb;
window.rhbExport          = rhbExport;
window.rhbImport          = rhbImport;
window.rhbParseCsv        = rhbParseCsv;
window.rhbCsvRow          = rhbCsvRow;
window.openRhbAdd         = openRhbAdd;
window.renderRhbPhones    = renderRhbPhones;
window.rhbAddPhone        = rhbAddPhone;
window.rhbSavePerson      = rhbSavePerson;
