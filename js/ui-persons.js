// js/ui-persons.js — iskenderpay
// Kişiler ve geçmiş
// Event delegation (v8.166): PRL (kişi kartı + Düzenle/Sil)
// renderHist + HL delegation (v8.188): T4 sekmesi kaldirildi, defter Log ledger'inda

import { todayMidnight, toTRY } from './util.js';
import { kalemOzet, paraTopla } from './para.js';

let _prlHandlersAttached = false;

function renderPersons() {
  const pl = document.getElementById('PRL');
  updateDatalist();
  if (!window.persons.length) {
    pl.innerHTML='<div class="empty"><div class="ico">👥</div><p>Henüz kişi yok.<br>+ Kişi Ekle ile başlayın.</p></div>';
    return;
  }
  // v8.234: Kişiler = Rehber + cari hesaplar TEK liste. Arama ad / telefon / şirket / IBAN üzerinde.
  const qEl = document.getElementById('KISI_ARA');
  const q = qEl ? window.araNormalize(qEl.value || '') : '';
  const qRakam = q.replace(/\D/g, '');
  const filtre = document.getElementById('KISI_FILTRE') ? document.getElementById('KISI_FILTRE').value : 'hepsi';
  const eslesir = p => !q
    || window.araNormalize(p.name).includes(q)
    || window.araNormalize(p.company || '').includes(q)
    || window.araNormalize(p.desc || '').includes(q)
    || (qRakam.length >= 3 && (p.phones || []).some(t => String(t.num || '').replace(/\D/g, '').includes(qRakam)));
  const ozetler = new Map();
  const ozetOf = p => { if (!ozetler.has(p.id)) { try { ozetler.set(p.id, _buildPersonSummary(p.id, p.name)); } catch (e) { ozetler.set(p.id, null); } } return ozetler.get(p.id); };
  let aktif = [...(window.persons||[])].filter(p => !p.arsiv && eslesir(p));
  if (filtre === 'borclu') aktif = aktif.filter(p => { const s = ozetOf(p); return s && s.bekleyen > 0.5; });
  if (filtre === 'gecikmis') aktif = aktif.filter(p => { const s = ozetOf(p); return s && s.gecikmis > 0.5; });
  // v8.236: sıralama seçimi (cihazda hatırlanır)
  const siraEl = document.getElementById('KISI_SIRA');
  if (siraEl && !siraEl.dataset.yuklendi) {
    siraEl.dataset.yuklendi = '1';
    try { const k = localStorage.getItem('ipay-kisi-sira'); if (k && [...siraEl.options].some(o => o.value === k)) siraEl.value = k; } catch (e) {}
  }
  const sira = siraEl ? siraEl.value : 'borc';
  try { localStorage.setItem('ipay-kisi-sira', sira); } catch (e) {}
  const ad = (a, b) => a.name.localeCompare(b.name, 'tr');
  const bek = p => { const s = ozetOf(p); return s ? s.bekleyen : 0; };
  const gec = p => { const s = ozetOf(p); return s ? s.gecikmis : 0; };
  const yakin = p => { const s = ozetOf(p); return (s && s.yakin) || '9999-99-99'; };
  const siralar = {
    borc: (a, b) => (bek(b) - bek(a)) || ad(a, b),
    borcAz: (a, b) => { const x = bek(a) > 0.5, y = bek(b) > 0.5; if (x !== y) return x ? -1 : 1; return (bek(a) - bek(b)) || ad(a, b); },
    ad,
    adZA: (a, b) => ad(b, a),
    gecikmis: (a, b) => (gec(b) - gec(a)) || (bek(b) - bek(a)) || ad(a, b),
    yakin: (a, b) => yakin(a).localeCompare(yakin(b)) || ad(a, b),
  };
  aktif.sort(siralar[sira] || siralar.borc);
  const arsivdekiler = [...(window.persons||[])].filter(p => p.arsiv && eslesir(p)).sort((a,b) => a.name.localeCompare(b.name,'tr'));
  const borclu = aktif.filter(p => { const s = ozetOf(p); return s && s.bekleyen > 0.5; }).length;
  pl.innerHTML = `<div style="max-width:560px">`
  + `<div style="font-size:11px;color:var(--muted);margin:0 2px 8px">${aktif.length} kişi · ${borclu} borçlu</div>`
  + aktif.map(p => {
    const origIdx = (window.persons||[]).indexOf(p);
    const pid = p.id || '';
    const s = ozetOf(p);
    let ozetHtml = '';
    if (s && s.bekleyen > 0.5) {
      const dov = s.para && Object.keys(s.para).some(k => k !== 'TRY');
      ozetHtml = `<span style="color:${s.gecikmis>0.5?'var(--danger)':'var(--ora)'};font-family:'IBM Plex Mono',monospace;font-weight:600">${window.fmt(s.bekleyen)}</span> bekleyen${s.gecikmis>0.5?' · ⚠ '+window.fmt(s.gecikmis)+' gecikmiş':''}${dov?' · '+window.esc(window.Para.paraYazi(s.para, window.fmtA)):''}`;
    }
    const tel = (p.phones || []).find(t => t.num);
    const alt = [p.company, p.desc, tel && tel.num].filter(Boolean).map(window.esc).join(' · ');
    return `<div data-person-id="${pid}" style="${pid?'cursor:pointer;':''}background:var(--surf);border:1px solid var(--bdr);border-radius:var(--rs);padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(p.name)}</div>
        ${alt?`<div style="font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${alt}</div>`:''}
        ${ozetHtml?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${ozetHtml}</div>`:''}
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${tel?`<a href="tel:${encodeURIComponent(tel.num)}" data-tel="1" style="background:rgba(74,222,128,.12);color:var(--ok);border:1px solid rgba(74,222,128,.25);border-radius:6px;padding:4px 8px;font-size:12px;text-decoration:none">📞</a>`:''}
        <button data-edit-idx="${origIdx}" style="background:rgba(192,132,252,.15);color:var(--acc2);border:1px solid rgba(192,132,252,.2);border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer">Düzenle</button>
      </div>
    </div>`;
  }).join('')
  // v8.233: ARSIV — gecmisi korunan kisiler (geri getir / kalici sil)
  + (arsivdekiler.length ? `<details class="kisi-arsiv"><summary>🗄 Arşiv (${arsivdekiler.length}) — geçmişi korunuyor</summary>`
      + arsivdekiler.map(p => `<div data-person-id="${p.id}" class="kisi-arsiv-satir">
          <div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:600">${window.esc(p.name)}</div>
          <div style="font-size:11px;color:var(--muted)">arşiv · ${window.fmtD(String(p.arsiv).slice(0,10))}</div></div>
          <button data-geri="${p.id}" class="kisi-mini">↩ Geri Getir</button>
          <button data-kalici="${p.id}" class="kisi-mini sil">🗑</button></div>`).join('')
      + `</details>` : '')
  + `</div>`;

  if (!_prlHandlersAttached) {
    pl.addEventListener('click', (e) => {
      if (e.target.closest('a[data-tel]')) return;
      const editBtn = e.target.closest('button[data-edit-idx]');
      if (editBtn) { editPerson(parseInt(editBtn.dataset.editIdx)); return; }
      const geriBtn = e.target.closest('button[data-geri]');
      if (geriBtn) { window.kisiGeriGetir(geriBtn.dataset.geri); return; }
      const kaliciBtn = e.target.closest('button[data-kalici]');
      if (kaliciBtn) { window.kisiKaliciSil(kaliciBtn.dataset.kalici); return; }
      const card = e.target.closest('[data-person-id]');
      if (card && card.dataset.personId) openPersonHist(card.dataset.personId);
    });
    _prlHandlersAttached = true;
  }
  if (window.renderSaglamaBar) window.renderSaglamaBar();
}

// v8.231: Kisiler sekmesi acikken borc degisirse (cari karttan) listedeki ozet tazelenir
window.addEventListener('store:change', e => {
  if (window.curTab !== 2) return;
  if (window.Store && window.Store._affects(e.detail, ['persons','pays','creds'])) renderPersons();
});

// v8.234: öneri listesi = kişilerin KENDİ adları. Eskiden "AD 2", "AD 3" gibi numaralı adlar
// öneriyordu; kişiye bağlanamayan "ZELİHA 1 / ZELİHA 2" kayıtlarının kaynağı buydu.
function updateDatalist() {
  const dl = document.getElementById('PNLIST');
  if (!dl) return;
  dl.innerHTML = (window.persons || []).filter(p => !p.arsiv).map(p => p.name)
    .sort((a, b) => a.localeCompare(b, 'tr')).map(n => `<option value="${window.esc(n)}">`).join('');
}

const _val = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
const _set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };

function openAddPerson() {
  document.getElementById('PREID').value = '';
  document.getElementById('PRMT').innerHTML = 'Kişi <span>Ekle</span>';
  ['PRNAME','PRDESC','PRTEL','PRIBAN','PRMAIL','PRFIRMA','PRNOT'].forEach(id => _set(id, ''));
  ModalManager.open('PRM');
}

function editPerson(i) {
  const p = persons[i];
  document.getElementById('PREID').value = i;
  document.getElementById('PRMT').innerHTML = 'Kişi <span>Düzenle</span>';
  document.getElementById('PRNAME').value = p.name;
  document.getElementById('PRDESC').value = p.desc||'';
  _set('PRTEL', (p.phones || []).map(t => t.num).filter(Boolean).join(', '));
  _set('PRIBAN', p.iban || '');
  _set('PRMAIL', p.email || '');
  _set('PRFIRMA', p.company || '');
  _set('PRNOT', p.note || '');
  ModalManager.open('PRM');
}

// Formdaki iletişim alanları (form alanı yoksa undefined -> mevcut değer korunur)
function _iletisimFormu(eski) {
  const out = {};
  const tel = _val('PRTEL');
  if (tel !== undefined) {
    const eskiTel = (eski && eski.phones) || [];
    out.phones = tel.split(/[,;\n]/).map(x => x.trim()).filter(Boolean).map(num => {
      const n = window.normPhone ? window.normPhone(num) : num;
      const var_ = eskiTel.find(t => String(t.num).replace(/\D/g, '') === n.replace(/\D/g, ''));
      return { lbl: (var_ && var_.lbl) || 'Cep', num: n };
    });
  }
  const iban = _val('PRIBAN'); if (iban !== undefined) out.iban = iban.toLocaleUpperCase('tr').replace(/\s+/g, '');
  const mail = _val('PRMAIL'); if (mail !== undefined) out.email = mail.trim();
  const firma = _val('PRFIRMA'); if (firma !== undefined) out.company = firma.trim();
  const not = _val('PRNOT'); if (not !== undefined) out.note = not.trim();
  return out;
}

function savePerson() {
  const name = document.getElementById('PRNAME').value.trim();
  const desc = document.getElementById('PRDESC').value.trim();
  if (!name) { alert('İsim zorunlu'); return; }
  const eid = document.getElementById('PREID').value;
  const ak = window.KisiVeri ? window.KisiVeri.adAnahtari : (n => n);
  if (eid !== '') {
    const idx = parseInt(eid);
    const existing = window.persons[idx];
    const oldName = existing.name;
    const pid = existing.id || null;
    const ayniAd = (window.persons || []).find((p, i) => i !== idx && ak(p.name) === ak(name));
    if (ayniAd && ak(oldName) !== ak(name)) {
      alert('"' + ayniAd.name + '" adında başka bir kişi zaten var.\n\nAynı kişiyse birleştir: onun cari kartını aç → ⇄ Birleştir.');
      return;
    }
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
    // v8.234: nesnenin DİĞER alanları (arşiv, telefon, IBAN...) korunur — eskiden {name,desc,id} ile eziliyordu
    const newObj = Object.assign({}, existing, {name, desc}, _iletisimFormu(existing));
    if (pid) newObj.id = pid;
    window.Store.spliceAt('persons', idx, 1, newObj);
  } else {
    const ayniAd = (window.persons || []).find(p => ak(p.name) === ak(name));
    if (ayniAd) {
      alert('"' + ayniAd.name + '" zaten kayıtlı. Aynı kişiye ikinci kart açılmaz; mevcut kartı açıyorum.');
      window.closeMov('PRM');
      if (ayniAd.id && window.openCari) window.openCari(ayniAd.id);
      return;
    }
    const newId = 'per_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
    window.Store.push('persons', Object.assign({id:newId, name, desc}, _iletisimFormu(null)));
  }
  window.closeMov('PRM'); renderPersons();
}

function delPerson(i) {
  // v8.233: silme = secim penceresi — Arsivle (gecmis kalir) / Kalici Sil (PIN, her seyiyle)
  const pr = window.persons[i];
  if (pr && pr.id && window.kisiSilSec) { window.kisiSilSec(pr.id); return; }
  if (!confirm('Bu kişiyi silmek istiyor musunuz?')) return;
  window.Store.spliceAt('persons', i, 1);
  renderPersons();
}

// ── KİŞİ GEÇMİŞ MODAL (v8.143, v8.164 özet eklendi) ──────────────────────────
// _buildPersonSummary: kişiye ait pays/paidItems üzerinden borç/ödeme özeti (v8.164)
// Öncelik: personId match > legacy name match (personId yoksa).
// Bekleyen tanımı: tüm aktif (paid değil) borç; gecikmiş alt-küme ayrı raporlanır.
function _buildPersonSummary(personId, personName) {
  // v8.234: tutarlar js/para.js#kalemOzet'ten (cari kart, plan, sağlama ile aynı kaynak).
  // Bağ: personId KESİN; personId'siz eski kayıt için taban-isim (açılış düzenlemesi sonrası nadir).
  const baseOf = window.Hesap ? window.Hesap._baseOf : (n => (n || '').replace(/ \d+$/, '').trim() || n);
  const bugunISO = (() => { const t = todayMidnight(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); })();
  const baseName = baseOf(personName);
  const matches = (p) => (personId && p.personId === personId) || (!p.personId && baseOf(p.name) === baseName);
  let bekleyen = 0, gecikmis = 0, bekleyenCount = 0, gecikmisCount = 0;
  const paraOz = [];
  const breakdownMap = {};
  const addPending = (oz, overdue, key, label) => {
    paraOz.push(oz);
    bekleyen += oz.kalanTL;
    bekleyenCount++;
    if (overdue) { gecikmis += oz.kalanTL; gecikmisCount++; }
    if (!breakdownMap[key]) breakdownMap[key] = { label, bekleyen: 0, gecikmis: 0 };
    breakdownMap[key].bekleyen += oz.kalanTL;
    if (overdue) breakdownMap[key].gecikmis += oz.kalanTL;
  };
  (window.pays || []).filter(matches).forEach(p => {
    const oz = kalemOzet(p, window.rates);
    if (oz.kalan === 0) return;
    const tag = p.desc || p.category;
    const label = (p.name || personName) + (tag ? ' (' + tag + ')' : '');
    addPending(oz, String(p.date) < bugunISO, p.groupId || ('pay:' + p.id), label);
  });
  (window.creds || []).forEach(c => {
    if (c.personId ? c.personId !== personId : baseOf(c.name) !== baseName) return;
    (c.pays || []).forEach(p => {
      const oz = kalemOzet({ ...p, _cid: c.id }, window.rates);
      if (oz.kalan === 0) return;
      addPending(oz, String(p.date) < bugunISO, 'cred:' + c.id, c.name + ' (kredi)');
    });
  });
  // En yakın ödenmemiş kalemin tarihi (sıralama: "yaklaşan ödeme")
  let yakin = null;
  (window.pays || []).filter(matches).forEach(p => { if (kalemOzet(p, window.rates).kalan > 0 && (!yakin || String(p.date) < yakin)) yakin = String(p.date); });
  (window.creds || []).forEach(c => {
    if (c.personId ? c.personId !== personId : baseOf(c.name) !== baseName) return;
    (c.pays || []).forEach(t => { if (kalemOzet({ ...t, _cid: c.id }, window.rates).kalan > 0 && (!yakin || String(t.date) < yakin)) yakin = String(t.date); });
  });
  const personPaidItems = (window.paidItems || []).filter(matches);
  const odenmisToplam = personPaidItems.reduce((s, pi) => s + (pi.paid || 0), 0);
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
    breakdown,
    yakin,
    para: paraTopla(paraOz)
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
