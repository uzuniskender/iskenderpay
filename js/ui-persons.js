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
    return `<div data-person-id="${pid}" style="${cursorStyle}background:var(--surf);border:1px solid var(--bdr);border-radius:var(--rs);padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.name)}</div>
        ${p.desc?`<div style="font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.desc)}</div>`:''}
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
    if (baseOf(c.name) !== baseName) return;
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

function openPersonHist(personId) {
  if (!personId) { alert('Bu kişinin ID\'si yok'); return; }
  const person = (window.persons||[]).find(p => p.id === personId);
  if (!person) return;
  document.getElementById('PHIST_T').innerHTML = window.esc(person.name) + ' <span>Geçmişi</span>';
  // v8.164: özet bloğu — başlığın hemen altı, list'in üstü
  const s = _buildPersonSummary(personId, person.name);
  const summaryHTML = '<div style="margin-bottom:12px;padding:10px 12px;background:var(--surf2);border-radius:9px;border:1px solid var(--bdr)">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +   '<div>'
    +     '<div style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px">Bekleyen</div>'
    +     '<div style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;color:var(--ora);font-size:14px">'+window.fmt(s.bekleyen)+'</div>'
    +     '<div style="font-size:10px;color:var(--muted)">'+s.bekleyenCount+' ödeme</div>'
    +   '</div>'
    +   '<div>'
    +     '<div style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px">Ödenen</div>'
    +     '<div style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;color:var(--ok);font-size:14px">'+window.fmt(s.odenmisToplam)+'</div>'
    +     '<div style="font-size:10px;color:var(--muted)">'+s.odenmisCount+' ödeme</div>'
    +   '</div>'
    + '</div>'
    + (s.breakdown && s.breakdown.length > 1 ?
        '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bdr)">'
        + s.breakdown.map(b =>
            '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:2px 0">'
            + '<span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+window.esc(b.label)+'</span>'
            + '<span style="font-family:\'IBM Plex Mono\',monospace;font-weight:600;color:'+(b.gecikmis>0?'var(--danger)':'var(--txt)')+';white-space:nowrap">'+window.fmt(b.bekleyen)+'</span>'
            + '</div>'
          ).join('')
        + '</div>'
      : '')
    + (s.gecikmis > 0 ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bdr);font-size:12px;color:var(--danger);font-weight:600">⚠ Gecikmiş: '+window.fmt(s.gecikmis)+' ('+s.gecikmisCount+' ödeme)</div>' : '')
    + '</div>';
  // ── HAREKETLER (düzenlenebilir ödemeler, hareket.js) ──
  // Dokununca yalnız o hareket değişir: tutar eski kalemden düşülür, seçilen kaleme eklenir.
  const pidJs = window.esc(personId).replace(/'/g, '&#39;');
  const hareketler = window.Hareket ? window.Hareket.kisiHareketleri(personId) : [];
  const hrkHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 6px">'
    + '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px">Hareketler ('+hareketler.length+')</div>'
    + '<button onclick="openHareket(\''+pidJs+'\')" class="add-btn" style="font-size:12px;padding:5px 10px">+ Ödeme Gir</button>'
    + '</div>'
    + (hareketler.length ? hareketler.map(e => {
        const h = e.hareket;
        const iptal = !!h.iptal;
        const eidJs = window.esc(String(e.id));
        return '<div '+(iptal?'':'onclick="openHareket(\''+pidJs+'\',\''+eidJs+'\')" ')+'style="display:flex;gap:10px;align-items:center;padding:9px 6px;border-bottom:1px solid var(--bdr);'+(iptal?'opacity:.45':'cursor:pointer')+'">'
          + '<div style="flex:1;min-width:0">'
          +   '<div style="font-size:12px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'+(iptal?';text-decoration:line-through':'')+'">'+window.esc(e.detail||'')+'</div>'
          +   '<div style="font-size:10px;color:var(--muted);margin-top:2px">'+window.esc(window.fmtD(h.tarih))
          +     (iptal ? ' · geri alındı' : (h.duzenlendi ? ' · düzenlendi' : ''))+'</div>'
          + '</div>'
          + '<div style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;font-size:13px;color:'+(iptal?'var(--muted)':'var(--ok)')+';white-space:nowrap">'+window.fmt(h.tutar)+'</div>'
          + (iptal ? '' : '<div style="font-size:14px;color:var(--muted)">›</div>')
          + '</div>';
      }).join('')
      : '<div style="font-size:12px;color:var(--muted);padding:8px 0 12px">Henüz hareket yok. Bundan sonraki ödemeler burada görünür ve dokunarak düzenlenir.</div>');

  // ── ESKİ KAYITLAR (salt-okunur metin loglar) ──
  // v8.167: personId-siz eski/cred entry'lerini de yakala — _buildPersonSummary taban-isim mantığıyla tutarlı
  const baseName = window.Hesap._baseOf(person.name);
  const entries = (window.actLog||[]).filter(e => {
    if (e.hareket) return false;
    if ((e.type||'').startsWith('rhb_')) return false;
    if (e.personId === personId) return true;
    if (!e.personId && e.detail) {
      return window.Hesap._baseOf((e.detail.split(' · ')[0]) || '') === baseName;
    }
    return false;
  });
  const list = document.getElementById('PHIST_LIST');
  const eskiHTML = !entries.length ? '' :
    '<details style="margin-top:12px"><summary style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;cursor:pointer">Eski kayıtlar ('+entries.length+') — salt okunur</summary>'
    + entries.map(e => {
      const time = e.at ? window.fmtLogTime(e.at) : '';
      const title = window.esc(e.title || '');
      const detail = e.detail ? window.esc(e.detail) : '';
      return '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--bdr)">'
        + '<div style="font-size:11px;color:var(--muted);min-width:75px;flex-shrink:0">'+time+'</div>'
        + '<div style="flex:1;min-width:0">'
        +   '<div style="font-size:12px;font-weight:600;color:#e2e8f0">'+title+'</div>'
        +   (detail ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">'+detail+'</div>' : '')
        + '</div>'
        + '</div>';
    }).join('')
    + '</details>';
  list.innerHTML = summaryHTML + hrkHTML + eskiHTML;
  ModalManager.open('PHIST');
}

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
window.openPersonHist     = openPersonHist;   // hareket.js kaydettikten sonra karti yeniler
