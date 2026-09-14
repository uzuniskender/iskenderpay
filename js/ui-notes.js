// js/ui-notes.js — iskenderpay
// Notlar ve yapılan ödemeler
// Event delegation (v8.166): NL (not Düzenle/Sil)
// renderPaid + PL delegation (v8.188): T1 sekmesi kaldirildi, defter Log ledger'inda

let _nlHandlersAttached = false;

function renderNotes() {
  const nl=document.getElementById('NL');
  if(!window.notes.length){nl.innerHTML='<div class="empty"><div class="ico">📝</div><p>Henüz not yok.<br>+ Not Ekle ile başlayın.</p></div>';return;}
  window.notes.forEach((n,i)=>{if(!n.nid)n.nid='n'+(Date.now()+i)+'_'+Math.random().toString(36).slice(2,7);});
  const catColors={'Banka / IBAN':'var(--blue)','Şifre / Hesap':'var(--danger)','Telefon / İletişim':'var(--ok)','Genel Not':'var(--muted)'};
  nl.innerHTML=window.notes.map(n=>`
    <div style="background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r);padding:14px;margin-bottom:9px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:700">${window.esc(n.title)}</div>
          <div style="font-size:10px;color:${catColors[n.cat]||'var(--muted)'};font-weight:600;margin-top:2px;text-transform:uppercase;letter-spacing:.8px">${window.esc(n.cat||'')}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button data-note-edit="${n.nid}" style="background:rgba(192,132,252,.15);color:var(--acc2);border:1px solid rgba(192,132,252,.2);border-radius:6px;padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer">Düzenle</button>
          <button data-note-del="${n.nid}" style="background:rgba(248,113,113,.12);color:var(--danger);border:1px solid rgba(248,113,113,.2);border-radius:6px;padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer">Sil</button>
        </div>
      </div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--txt);white-space:pre-wrap;background:var(--surf2);border-radius:7px;padding:10px;line-height:1.7;border:1px solid var(--bdr)">${window.esc(n.content)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">${new Date(n.at).toLocaleDateString('tr-TR',{day:'numeric',month:'short',year:'numeric'})}</div>
    </div>`).join('');

  if (!_nlHandlersAttached) {
    nl.addEventListener('click', (e) => {
      const editBtn = e.target.closest('button[data-note-edit]');
      if (editBtn) { editNote(editBtn.dataset.noteEdit); return; }
      const delBtn = e.target.closest('button[data-note-del]');
      if (delBtn) delNote(delBtn.dataset.noteDel);
    });
    _nlHandlersAttached = true;
  }
}

function openNoteModal() {
  document.getElementById('NEID').value='';
  document.getElementById('NMT').innerHTML='Yeni <span>Not</span>';
  document.getElementById('NTIT').value='';
  document.getElementById('NCONT').value='';
  document.getElementById('NCAT').value='Banka / IBAN';
  ModalManager.open('NM');
}

function editNote(nid) {
  const n=window.notes.find(x=>x.nid===nid);if(!n){console.error('editNote: not bulunamadı',nid);return;}
  document.getElementById('NEID').value=nid;
  document.getElementById('NMT').innerHTML='Not <span>Düzenle</span>';
  document.getElementById('NTIT').value=n.title||'';
  document.getElementById('NCONT').value=n.content||'';
  document.getElementById('NCAT').value=n.cat||'Genel Not';
  ModalManager.open('NM');
}

function saveNote() {
  const title=document.getElementById('NTIT').value.trim();
  const content=document.getElementById('NCONT').value.trim();
  const cat=document.getElementById('NCAT').value;
  if(!title||!content){alert('Başlık ve içerik zorunlu');return;}
  const eid=document.getElementById('NEID').value;
  if(eid!==''){const idx=window.notes.findIndex(x=>x.nid===eid);if(idx!==-1){window.Store.mutateItem(window.notes[idx],{title,content,cat,upd:new Date().toISOString()});}}
  else{const nid='n'+Date.now()+'_'+Math.random().toString(36).slice(2,7);window.Store.unshift('notes',{nid,title,content,cat,at:new Date().toISOString()});}
  window.closeMov('NM'); renderNotes();
}

function delNote(nid) {
  if(!confirm('Bu notu silmek istiyor musun?'))return;
  const idx=window.notes.findIndex(x=>x.nid===nid);if(idx!==-1)window.Store.spliceAt('notes', idx, 1);
  renderNotes();
}

function openPaidEdit(paidId) {
  const p=window.paidItems.find(x=>x.paidId===paidId);if(!p)return;
  document.getElementById('PIEID').value=paidId;
  document.getElementById('PINAM').value=p.name||'';
  document.getElementById('PIAMT').value=p.paid!=null?p.paid:(p.amount||'');
  document.getElementById('PIDAT').value=p.date||'';
  ModalManager.open('PIMOD');
}

function savePaidItem() {
  const paidId=document.getElementById('PIEID').value;
  const p=window.paidItems.find(x=>x.paidId===paidId);if(!p)return;
  const name=document.getElementById('PINAM').value.trim();
  const amt=parseFloat(document.getElementById('PIAMT').value);
  const date=document.getElementById('PIDAT').value;
  if(!name){alert('Ödeme adı boş olamaz');return;}
  if(isNaN(amt)||amt<0){alert('Geçerli bir tutar girin');return;}
  if(!date.match(/^\d{4}-\d{2}-\d{2}$/)){alert('Tarih YYYY-AA-GG formatında olmalı');return;}
  window.Store.mutateItem(p, {name, paid:amt, date});
  window.closeMov('PIMOD');if(window.curTab===7)window.renderActLog();
}

function delPaidItem(paidId) {
  const p=window.paidItems.find(x=>x.paidId===paidId);if(!p)return;
  // v8.233: gecerli odeme hareketine bagli defter kaydi buradan silinmez (plan ile kopar)
  if((window.actLog||[]).some(e=>e&&e.hareket&&!e.hareket.iptal&&e.hareket.paidId===paidId)){alert('Bu ödeme kişi kartındaki bir hareketle bağlı. Kişinin kartından "Geri Al" veya "Kaydı Sil" kullan.');return;}
  if(!confirm(p.name+' yapılan ödemelerden silinecek. Plan etkilenmez. Emin misin?'))return;
  const idx=window.paidItems.indexOf(p);if(idx!==-1)window.Store.spliceAt('paidItems', idx, 1);
  if(window.curTab===7)window.renderActLog();
}


// ── GLOBAL COMPAT ──────────────────────────────────────────────────────────
// editNote/delNote/openPaidEdit/delPaidItem export'ları silindi (v8.166) —
// yalnız NL/PL event delegation'dan çağrılıyorlar, statik caller yok.
window.renderNotes        = renderNotes;
window.openNoteModal      = openNoteModal;
window.saveNote           = saveNote;
window.savePaidItem       = savePaidItem;
window.openPaidEdit       = openPaidEdit;
window.delPaidItem        = delPaidItem;
