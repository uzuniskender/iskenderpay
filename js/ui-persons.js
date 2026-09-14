// js/ui-persons.js — iskenderpay
// Kişiler ve geçmiş
// Event delegation (v8.166): PRL (kişi kartı + Düzenle/Sil)
// renderHist + HL delegation (v8.188): T4 sekmesi kaldirildi, defter Log ledger'inda

import { todayMidnight, toTRY } from './util.js';

let _prlHandlersAttached = false;

function renderPersons() {
  const pl = document.getElementById('PRL');
  updateDatalist();
  if (!window.persons.length) {
    pl.innerHTML='<div class="empty"><div class="ico">👥</div><p>Henüz kişi yok.<br>+ Kişi Ekle ile başlayın.</p></div>';
    return;
  }
  const sortedPersons = [...(window.persons||[])].sort((a,b) => a.name.localeCompare(b.name,'tr'));
  pl.innerHTML = `<div style="max-width:480px">` + sortedPersons.map(p => {
    const origIdx = (window.persons||[]).indexOf(p);
    const pid = p.id || '';
    const cursorStyle = pid ? 'cursor:pointer;' : '';
    // v8.231: listede kisinin bekleyen/gecikmis borcu (cari kart ozetiyle ayni kaynak)
    let ozetHtml = '';
    try {
      const s = _buildPersonSummary(pid, p.name);
      if (s.bekleyen > 0.5) ozetHtml = `<span style="color:${s.gecikmis>0.5?'var(--danger)':'var(--ora)'};font-family:'IBM Plex Mono',monospace;font-weight:600">${window.fmt(s.bekleyen)}</span> bekleyen${s.gecikmis>0.5?' · ⚠ '+window.fmt(s.gecikmis)+' gecikmiş':''}`;
    } catch(e) {}
    return `<div data-person-id="${pid}" style="${cursorStyle}background:var(--surf);border:1px solid var(--bdr);border-radius:var(--rs);padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.name)}</div>
        ${p.desc?`<div style="font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.desc)}</div>`:''}
        ${ozetHtml?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${ozetHtml}</div>`:''}
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button data-edit-idx="${origIdx}" style="background:rgba(192,132,252,.15);color:var(--acc2);border:1px solid rgba(192,132,252,.2);border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer">Düzenle</button>
        <button data-del-idx="${origIdx}" style="background:rgba(248,113,113,.12);color:var(--danger);border:1px solid rgba(248,113,113,.2);border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer">Sil</button>
      </div>
    </div>`;
  }).join('') + `</div>`;

  if (!_prlHandlersAttached) {
    pl.addEventListener('click', (e) => {
      const editBtn = e.target.closest('button[data-edit-idx]');
      if (editBtn) { editPerson(parseInt(editBtn.dataset.editIdx)); return; }
      const delBtn = e.target.closest('button[data-del-idx]');
      if (delBtn) { delPerson(parseInt(delBtn.dataset.delIdx)); return; }
      const card = e.target.closest('[data-person-id]');
      if (card && card.dataset.personId) openPersonHist(card.dataset.personId);
    });
    _prlHandlersAttached = true;
  }
}

// v8.231: Kisiler sekmesi acikken borc degisirse (cari karttan) listedeki ozet tazelenir
window.addEventListener('store:change', e => {
  if (window.curTab !== 2) return;
  if (window.Store && window.Store._affects(e.detail, ['persons','pays','creds'])) renderPersons();
});

function updateDatalist() {
  const dl = document.getElementById('PNLIST');
  if (!dl) return;
  const usedNames = window.pays.filter(p => !p._cid).map(p => p.name);
  const options = window.persons.map(p => {
    if (!usedNames.includes(p.name)) return p.name;
    let i=2; while(usedNames.includes(p.name+' '+i)) i++;
    return p.name+' '+i;
  }).sort();
  dl.innerHTML = options.map(n => `<option value="${n}">`).join('');
}

function openAddPerson() {
  document.getElementById('PREID').value = '';
  document.getElementById('PRMT').innerHTML = 'Kişi <span>Ekle</span>';
  document.getElementById('PRNAME').value = '';
  document.getElementById('PRDESC').value = '';
  ModalManager.open('PRM');
}

function editPerson(i) {
  const p = persons[i];
  document.getElementById('PREID').value = i;
  document.getElementById('PRMT').innerHTML = 'Kişi <span>Düzenle</span>';
  document.getElementById('PRNAME').value = p.name;
  document.getElementById('PRDESC').value = p.desc||'';
  ModalManager.open('PRM');
}

function savePerson() {
  const name = document.getElementById('PRNAME').value.trim();
  const desc = document.getElementById('PRDESC').value.trim();
  if (!name) { alert('İsim zorunlu'); return; }
  const eid = document.getElementById('PREID').value;
  if (eid !== '') {
    const idx = parseInt(eid);
    const existing = window.persons[idx];
    const oldName = existing.name;
    const pid = existing.id || null;
    if (oldName !== name) {
      window.pays.forEach(p => {
        if ((pid && p.personId === pid) || (!p.personId && p.name === oldName))
          window.Store.mutateItem(p, {name});
      });
      // v8.231: kisinin kredileri + kredi defter kayitlari da yeni adi alir (tek yerden yonetim)
      (window.creds || []).forEach(c => {
        if ((pid && c.personId === pid) || (!c.personId && c.name === oldName)) {
          (window.paidItems || []).forEach(pi => { if (pi._cid === c.id) window.Store.mutateItem(pi, {name}); });
          window.Store.mutateItem(c, {name});
        }
      });
      if (pid) window.addLog('plan_edit', 'Kişi adı değişti', oldName + ' → ' + name, 2, {personId: pid});
    }
    const newObj = {name, desc};
    if (pid) newObj.id = pid;
    window.Store.spliceAt('persons', idx, 1, newObj);
  } else {
    let finalName = name;
    const existingNames = window.persons.map(p => p.name);
    if (existingNames.includes(name)) { let i=2; while(existingNames.includes(name+' '+i)) i++; finalName=name+' '+i; }
    const newId = 'per_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
    window.Store.push('persons', {id:newId, name:finalName, desc});
  }
  window.closeMov('PRM'); renderPersons();
}

function delPerson(i) {
  // v8.231: borcu/kredisi olan kisi silinemez (kayitlar sahipsiz kalmasin)
  const pr = window.persons[i];
  if (pr && pr.id && window.Hareket) {
    const bagli = (window.pays || []).filter(p => window.Hareket.payKisiye(p, pr, window.Hesap._baseOf)).length
      + (window.creds || []).filter(c => window.Hareket.credKisiye(c, pr, window.Hesap._baseOf)).length;
    if (bagli) { alert('"' + pr.name + '" kişisinin plan kayıtları var. Önce cari kartından borçlarını sil.'); return; }
  }
  if (!confirm('Bu kişiyi silmek istiyor musunuz?')) return;
  window.Store.spliceAt('persons', i, 1);
  renderPersons();
}

// ── KİŞİ GEÇMİŞ MODAL (v8.143, v8.164 özet eklendi) ──────────────────────────
// _buildPersonSummary: kişiye ait pays/paidItems üzerinden borç/ödeme özeti (v8.164)
// Öncelik: personId match > legacy name match (personId yoksa).
// Bekleyen tanımı: tüm aktif (paid değil) borç; gecikmiş alt-küme ayrı raporlanır.
function _buildPersonSummary(personId, personName) {
  const today = todayMidnight();
  // v8.167: çoklu grup + kredi fix.
  //  (1) İsim eşleşmesi taban-isim üzerinden (suffix soyulur) → "QNB 1"/"QNB (Kira)" gibi
  //      legacy/disambigue satırlar da yakalanır (eski: tam eşleşme, suffix'liler kaçıyordu).
  //  (2) Kredi taksitleri ayrıca taranır — cred objesinde personId yok, bağ yalnız isim;
  //      bekleyen kredi taksitleri eskiden hiç sayılmıyordu (ödenmişler paidItems'tan geliyordu → asimetri).
  const baseOf = window.Hesap ? window.Hesap._baseOf : (n => (n || '').replace(/ \d+$/, '').trim() || n);
  // v8.170: kalan tutar + gecikmiş tek kaynaktan (Hesap.kalan / isOD) — toplamOzeti/krediler ile birebir.
  const kalan = (window.Hesap && window.Hesap.kalan)
    ? window.Hesap.kalan
    : ((a, pd, c) => Math.max(0, (c ? toTRY(a, c, window.rates) : (a || 0)) - (pd || 0)));
  const isOverdue = (p) => window.isOD ? window.isOD(p) : (p.date && window.parseLocalDate(p.date) < today);
  const baseName = baseOf(personName);
  const matches = (p) => (personId && p.personId === personId) || (!p.personId && baseOf(p.name) === baseName);
  let bekleyen = 0, gecikmis = 0, bekleyenCount = 0, gecikmisCount = 0;
  // v8.169: bekleyen tutarı yükümlülük bazında (pay grubu / kredi) ayrı raporla.
  const breakdownMap = {}; // key -> { label, bekleyen, gecikmis }
  const addPending = (remaining, overdue, key, label) => {
    bekleyen += remaining;
    bekleyenCount++;
    if (overdue) { gecikmis += remaining; gecikmisCount++; }
    if (!breakdownMap[key]) breakdownMap[key] = { label, bekleyen: 0, gecikmis: 0 };
    breakdownMap[key].bekleyen += remaining;
    if (overdue) breakdownMap[key].gecikmis += remaining;
  };
  // (1) Normal pays — yükümlülük = groupId (yoksa pay id'si)
  // v8.190: etiket plan matrisi gibi ayristirilir (desc || category) — coklu grupta "QNB" x3 cakismasini onler.
  (window.pays || []).filter(matches).forEach(p => {
    if ((p.status || 'pending') === 'paid') return;
    const tag = p.desc || p.category;
    const label = (p.name || personName) + (tag ? ' (' + tag + ')' : '');
    addPending(kalan(p.amount, p.paid, p.currency || 'TRY'), isOverdue(p), p.groupId || ('pay:' + p.id), label);
  });
  // (2) Kredi taksitleri (cred.pays.amount zaten TRY — toplamOzeti ile tutarlı). Yükümlülük = kredi.
  (window.creds || []).forEach(c => {
    // v8.231: kredi personId tasiyorsa KESIN bag; yoksa (eski kredi) taban-isim
    if (c.personId ? c.personId !== personId : baseOf(c.name) !== baseName) return;
    (c.pays || []).forEach(p => {
      if ((p.status || 'pending') === 'paid') return;
      addPending(kalan(p.amount, p.paid), isOverdue(p), 'cred:' + c.id, c.name + ' (kredi)');
    });
  });
  const personPaidItems = (window.paidItems || []).filter(matches);
  const odenmisToplam = personPaidItems.reduce((s, pi) => s + (pi.paid || 0), 0);
  // v8.190: tag eklendikten sonra hala ayni etikete sahip gruplar kalirsa (ayni isim+kategori, desc yok)
  // sayisal disambiguator ekle — hicbir iki satir birebir ayni gorunmesin ("kayip/mukerrer" hissi).
  const _seenLabel = {};
  Object.values(breakdownMap).forEach(b => {
    const n = (_seenLabel[b.label] = (_seenLabel[b.label] || 0) + 1);
    if (n > 1) b.label = b.label + ' #' + n;
  });
  const breakdown = Object.values(breakdownMap)
    .filter(b => b.bekleyen > 0.005)
    .sort((a, b) => b.bekleyen - a.bekleyen);
  return {
    bekleyen, bekleyenCount,
    gecikmis, gecikmisCount,
    odenmisToplam, odenmisCount: personPaidItems.length,
    breakdown
  };
}

// v8.231: kisi karti = CARI KART (js/cari.js). Eski gecmis modal govdesi oraya tasindi.
function openPersonHist(personId) { window.openCari(personId); }

function editHistItem(idx) {
  const p=window.hist[idx];if(!p)return;
  document.getElementById('HIIDX').value=idx;
  document.getElementById('HINAM').value=p.name||'';
  document.getElementById('HIAMT').value=p.amount||'';
  document.getElementById('HIDAT').value=p.date||'';
  ModalManager.open('HIMOD');
}

function saveHistItem() {
  const idx=parseInt(document.getElementById('HIIDX').value);
  const p=window.hist[idx];if(!p)return;
  const newName=document.getElementById('HINAM').value.trim();
  const newAmt=parseFloat(document.getElementById('HIAMT').value);
  const newDate=document.getElementById('HIDAT').value;
  const _patch={};
  if(newName) _patch.name=newName;
  if(!isNaN(newAmt)&&newAmt>0) _patch.amount=newAmt;
  if(newDate.match(/^\d{4}-\d{2}-\d{2}$/)) _patch.date=newDate;
  if(Object.keys(_patch).length) window.Store.mutateItem(p, _patch);
  ModalManager.close('HIMOD'); if(window.curTab===7)window.renderActLog();
}

function restoreFromHist(i) {
  const p=window.hist[i];if(!p)return;
  // v8.182: taksit-ozel alanlari soy. Silinen kredinin taksitleri hist'e idx/_cid/_ii ile
  // dusuyordu; geri yuklenince window.pays'e sizip zombi taksit uretiyordu.
  const restored={...p};delete restored.delAt;delete restored.idx;delete restored._cid;delete restored._ii;
  restored.status='pending';restored.paid=0;
  if(restored.id==null) restored.id=Date.now()+Math.random();
  if(!restored.groupId) restored.groupId=String(Date.now());
  window.Store.push('pays', restored);window.Store.spliceAt('hist', i, 1);
  if(window.curTab===7)window.renderActLog();
}

function delHist(i) { window.Store.spliceAt('hist', i, 1); if(window.curTab===7)window.renderActLog(); }

function clrHist()  { if(!confirm('Tüm geçmişi sil?'))return; window.Store.replace('hist', []); if(window.curTab===7)window.renderActLog(); }


// ── GLOBAL COMPAT ──────────────────────────────────────────────────────────
// editPerson/delPerson/openPersonHist/editHistItem/restoreFromHist/delHist export'ları
// silindi (v8.166) — yalnız PRL/HL event delegation'dan çağrılıyorlar, statik caller yok.
window.renderPersons      = renderPersons;
window.updateDatalist     = updateDatalist;
window.openAddPerson      = openAddPerson;
window.savePerson         = savePerson;
window.saveHistItem       = saveHistItem;
window.clrHist            = clrHist;
window.editHistItem       = editHistItem;
window.restoreFromHist    = restoreFromHist;
window.delHist            = delHist;
window.openPersonHist     = openPersonHist;   // log.js logJumpPerson / hareket.js -> cari kart
window.editPerson         = editPerson;       // cari kart "✏️ Kişi"
