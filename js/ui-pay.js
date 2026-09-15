// js/ui-pay.js — iskenderpay
// Ödeme ve kredi CRUD

import { toLocalISO } from './util.js';
import { grupYapilandirPlani, grupKapatPlani, grupAcikKalan } from './cari.js';
import { kalemOzet, tamOdePatch } from './para.js';

// v8.237: Yapılandır / Erken Kapat HER BORÇTA. Anahtar 'cred_<id>' ya da çıplak kredi id'si -> kredi;
// 'g_<groupId>' / 'pay_<id>' -> düzenli ödeme grubu (Akbank gibi krediler de çoğu zaman böyle kayıtlı).
function _borcHedef(anahtar) {
  const k = String(anahtar || '');
  if (k.startsWith('g_') || k.startsWith('pay_')) {
    const kalemler = (window.pays || []).filter(p => (p.groupId ? 'g_' + p.groupId : 'pay_' + String(Math.floor(Number(p.id)))) === k);
    return kalemler.length ? { tip: 'grup', key: k, kalemler, ad: kalemler[0].name + ((kalemler[0].desc || kalemler[0].category) ? ' (' + (kalemler[0].desc || kalemler[0].category) + ')' : ''), para: kalemler[0].currency || 'TRY' } : null;
  }
  const c = window.findCredById(k.startsWith('cred_') ? k.slice(5) : k);
  return c ? { tip: 'kredi', key: 'cred_' + c.id, cred: c, ad: c.name + (c.desc ? ' (' + c.desc + ')' : ''), para: 'TRY' } : null;
}
const _birim = para => para === 'EUR' ? '€' : para === 'GOLD' ? 'gr' : '₺';
const _yaz = (a, para) => window.fmtA(a, para);

function _grupUygula(h, plan, logTip, logBaslik, logDetay) {
  const iso = new Date().toISOString();
  window.Store.tx(() => {
    plan.arsiv.forEach(p => window.Store.unshift('hist', { ...p, restructAt: iso, _yapilandirmaGrup: p.groupId }));
    const silIds = new Set(plan.arsiv.map(p => String(p.id)));
    window.Store.removeWhere('pays', p => silIds.has(String(p.id)));
    plan.guncelle.forEach(g => { const p = window.findPayById(g.id); if (p) window.Store.mutateItem(p, g.patch); });
    (plan.yeni || []).forEach(r => window.Store.push('pays', r));
    if (plan.kapama) {
      const k = plan.kapama;
      window.Store.push('pays', k);
      const oz = kalemOzet(k, window.rates);
      Object.assign(k, tamOdePatch(k, window.rates));
      const paidId = 'pi_' + Date.now() + '_' + Math.random();
      window.Store.push('paidItems', { ...k, paidId, status: 'paid', paid: oz.tamTL, paidAt: iso });
      try { if (window.Hareket) window.Hareket.planOdemesiLogla(k, k.amount, paidId, false); } catch (e) {}
    }
    const ilk = h.kalemler[0];
    window.addLog(logTip, logBaslik, logDetay, 0, { personId: ilk.personId, groupId: ilk.groupId });
  });
}

function openPay() {
  document.getElementById('EID').value='';
  document.getElementById('PMT').innerHTML='Yeni Ödeme <span>Ekle</span>';
  const _nd=new Date();document.getElementById('PD').value=toLocalISO(_nd.getFullYear(),_nd.getMonth(),_nd.getDate());
  ['PN','PA'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('PC').value='TRY';
  document.getElementById('COPYMO').value=0;
  window.updateDatalist();
  ModalManager.open('PM2');
}

function editPay(id) {
  const p=window.findPayById(id);if(!p)return;
  document.getElementById('EID').value=id;
  document.getElementById('PMT').innerHTML='Ödeme <span>Düzenle</span>';
  document.getElementById('PN').value=p.name;
  document.getElementById('PA').value=p.amount;
  document.getElementById('PC').value=p.currency||'TRY';
  document.getElementById('PD').value=p.date;
  document.getElementById('PK').value=p.category||'Diğer';
  document.getElementById('COPYMO').value=0;
  ModalManager.open('PM2');
}

// v8.234: ad eşleşmesi aksan/büyük-küçük/sondaki numaradan bağımsız ve TEK aday şartıyla
// ("zeliha çelik" = "Zeliha ÇELİK"). İki kişi aynı anahtara düşerse bağlamaz (yanlış kişiye yazmaz).
function _resolvePersonId(name) {
  const ak = window.KisiVeri ? window.KisiVeri.adAnahtari : (n => (window.Hesap ? window.Hesap._baseOf(n) : n));
  const adaylar = (window.persons || []).filter(p => ak(p.name) === ak(name));
  const person = adaylar.length === 1 ? adaylar[0] : null;
  if (!person) return null;
  // v8.111: legacy person (v8.109 öncesi eklenmiş) id'siz olabilir — lazy üret
  if (!person.id && window.Store) {
    window.Store.mutateItem(person, {
      id: 'per_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)
    });
  }
  return person.id || null;
}

function savePay() {
  let name=document.getElementById('PN').value.trim();
  const amount=parseFloat(document.getElementById('PA').value);
  const currency=document.getElementById('PC').value;
  const date=document.getElementById('PD').value;
  const category=document.getElementById('PK').value;
  const copyMonths=parseInt(document.getElementById('COPYMO').value)||0;
  if(!name||!amount||!date){alert('Ad, tutar ve tarih zorunlu');return;}
  const personId=_resolvePersonId(name);
  // v8.234: kayıt kişinin KENDİ adıyla yazılır (numaralı/farklı yazımlı ad oluşmaz)
  const _kisi=personId?(window.persons||[]).find(p=>p.id===personId):null;
  if(_kisi) name=_kisi.name;
  const eid=document.getElementById('EID').value;
  // v8.197: Kişiler'de eşleşme yoksa kayıt REDDEDİLİR (sert engel). Yeni kayıt veya isim
  // değişiminde uygulanır; mevcut kayıtsız kaydın (isim aynı) tutar/tarih düzenlemesi
  // tuzağa düşmesin diye geçer (grandfather). Önce kişiyi Kişiler'e ekle.
  if (!personId && name) {
    const nameChanged = !eid || (window.findPayById(eid)?.name !== name);
    if (nameChanged) {
      alert('"'+name+'" Kişiler listesinde yok.\n\nKayıt yapılmadı. Önce bu kişiyi Kişiler sekmesinden ekleyin, sonra ödemeyi oluşturun.');
      return;
    }
  }
  let savedGroupId=null;
  if(eid){
    const p=window.findPayById(eid);
    if(p){
      savedGroupId=p.groupId;
      const oldName=p.name, oldCat=p.category;
      const patch={name,amount,currency,date,category};
      if(personId) patch.personId=personId;
      window.Store.mutateItem(p, patch);
      // İsim veya kategori değiştiyse aynı gruptaki tüm kayıtları güncelle
      if(oldName!==name || oldCat!==category){
        const groupPatch={name,category};
        if(personId) groupPatch.personId=personId;
        window.pays.filter(x=>x.groupId===p.groupId && String(x.id)!==String(p.id))
          .forEach(x=>window.Store.mutateItem(x, groupPatch));
      }
    }
  } else {
    const groupId=String(Date.now());
    savedGroupId=groupId;
    const[py,pm,pd]=date.split('-').map(Number);
    for(let i=0;i<=copyMonths;i++){
      const totalMo=(pm-1)+i;
      const yr=py+Math.floor(totalMo/12),mo=totalMo%12;
      const lastDay=new Date(yr,mo+1,0).getDate();
      const rec={id:Date.now()+Math.random(),groupId,name,amount,currency,date:toLocalISO(yr,mo,Math.min(pd,lastDay)),category,status:'pending',paid:0};
      if(personId) rec.personId=personId;
      window.Store.push('pays', rec);
    }
  }
  // Fonksiyonun başında okunan değişkenler kullanılır — DOM tekrar okunmaz
  const logCtx={personId, groupId: savedGroupId};
  if(eid){ window.addLog('plan_edit','Kayıt düzenlendi', name+' · '+window.fmtAmt(amount,currency), 0, logCtx); }
  else   { window.addLog('plan_add', 'Kayıt eklendi',    name+' · '+window.fmtAmt(amount,currency), 0, logCtx); }
  window.closeMov('PM2');
}

function editCred(id) {
  const c=window.findCredById(id);if(!c)return;
  document.getElementById('CEID').value=id;
  document.getElementById('CN').value=c.name;
  document.getElementById('CT').value=c.total;
  document.getElementById('CI').value=c.inst;
  document.getElementById('CM2').value=c.monthly;
  document.getElementById('CS').value=c.start;
  ModalManager.open('CM');
}

function saveCred() {
  const name=document.getElementById('CN').value.trim();
  const total=parseFloat(document.getElementById('CT').value)||0;
  const inst=parseInt(document.getElementById('CI').value)||0;
  let monthly=parseFloat(document.getElementById('CM2').value)||0;
  const start=document.getElementById('CS').value;
  if(!name||!inst||!start){alert('Ad, taksit sayısı ve tarih zorunlu');return;}
  const personId=_resolvePersonId(name);
  // v8.197: Kişiler'de eşleşme yoksa kredi REDDEDİLİR (sert engel). Yeni kayıt veya isim
  // değişiminde; mevcut kayıtsız kredinin (isim aynı) düzenlemesi grandfather edilir.
  {
    const _eid=document.getElementById('CEID').value;
    const _nameChanged = !_eid || (window.findCredById(_eid)?.name !== name);
    if (!personId && name && _nameChanged) {
      alert('"'+name+'" Kişiler listesinde yok.\n\nKayıt yapılmadı. Önce bu kişiyi Kişiler sekmesinden ekleyin, sonra krediyi oluşturun.');
      return;
    }
  }
  if(!monthly){alert('Aylık taksit tutarını girin');return;}
  const[startYr,startMo0,startDay]=start.split('-').map(Number);
  const startMo=startMo0-1;
  const pArr=Array.from({length:inst},(_,i)=>{const totalMo=startMo+i;const yr=startYr+Math.floor(totalMo/12),mo=totalMo%12;const lastDay=new Date(yr,mo+1,0).getDate();return{idx:i+1,date:toLocalISO(yr,mo,Math.min(startDay,lastDay)),amount:monthly,status:'pending',paid:0};});
  const eid=document.getElementById('CEID').value;
  if(eid){
    const cr=window.findCredById(eid);
    if(cr){
      const nameChanged=cr.name!==name;
      const structureChanged=cr.inst!==inst||cr.start!==start;
      cr.name=name; cr.total=total||monthly*inst; cr.monthly=monthly; cr.inst=inst; cr.start=start;
      if(personId) cr.personId=personId;   // v8.231: kredi-kisi kesin bag (cari kart)
      if(structureChanged){
        // v8.234: Taksit sayısı veya tarih değişti. Ödeme bilgisi AYNI AYA taşınır (sıra numarasına göre
        // DEĞİL). Eskiden i. taksitin ödemesi yeni planın i. taksitine kopyalanıyordu; başlangıç bir ay
        // kayınca "ödendi" yanlış aya geçiyordu. Yeni planda karşılığı olmayan ödenmiş ay varsa işlem durur.
        const ayOf=d=>String(d).slice(0,7);
        const odemeli=cr.pays.filter(o=>(o.status||'pending')!=='pending'||(o.paid||0)>0);
        const kayip=odemeli.filter(o=>!pArr.some(n=>ayOf(n.date)===ayOf(o.date)));
        if(kayip.length){alert('Bu değişiklik '+kayip.length+' ödenmiş taksiti planın dışında bırakıyor ('+kayip.map(o=>ayOf(o.date)).join(', ')+').\n\nKaydedilmedi. Kalan borcu yeniden planlamak için cari karttan "Yapılandır" kullan.');return;}
        pArr.forEach(newP=>{
          const old=odemeli.find(o=>ayOf(o.date)===ayOf(newP.date));
          if(old){newP.status=old.status;newP.paid=old.paid||0;}
        });
        cr.pays=pArr;
      } else {
        // Sadece ad/tutar değişti — status/paid koru, tutarı güncelle
        cr.pays.forEach(p=>{p.amount=monthly;});
      }
      // paidItems'daki eski adı güncelle
      if(nameChanged){(window.paidItems||[]).forEach(pi=>{if(pi._cid===cr.id)pi.name=name;});}
    }
    window.addLog('plan_edit','Kredi düzenlendi',name+' · '+inst+' taksit · '+window.fmtAmt(monthly,'TRY'),0,{personId,credId:eid});
  }
  else{
    const newCred={id:'c'+Date.now(),name,total:total||monthly*inst,monthly,inst,start,pays:pArr};
    if(personId) newCred.personId=personId;   // v8.231: kredi-kisi kesin bag (cari kart)
    window.Store.push('creds', newCred);
    window.addLog('cred_add','Kredi eklendi',name+' · '+inst+' taksit · '+window.fmtAmt(monthly,'TRY'),0,{personId,credId:newCred.id});
    const srcKey=window._convertSourceKey;
    if(srcKey){
      // Odeme durumlarini yeni kredi taksitlerine isle
      const srcPays=window._convertSourcePays||[];
      const newCred=window.creds[window.creds.length-1];
      if(newCred&&srcPays.length){
        srcPays.forEach((sp,i)=>{
          const taksit=newCred.pays[i];
          if(!taksit)return;
          if(sp.status==='paid'){taksit.status='paid';taksit.paid=taksit.amount;}
          else if(sp.status==='partial'&&sp.paid>0){taksit.status='partial';taksit.paid=sp.paid;}
        });
      }
      // Eski pays grubunu sil
      if(srcKey.startsWith('g_')){const gid=srcKey.replace('g_','');window.Store.removeWhere('pays', p => p.groupId===gid);}
      else if(srcKey.startsWith('pay_')){const pid=srcKey.replace('pay_','');window.Store.removeWhere('pays', p => String(Math.floor(Number(p.id)))===pid);}
      window._convertSourceKey=null;
      window._convertSourcePays=null;
    }
  }
  window.Store.touch(); window.closeMov('CM');
}

function updLP() {
  const t=parseFloat(document.getElementById('CT').value)||0;
  const i=parseInt(document.getElementById('CI').value)||0;
  const m=parseFloat(document.getElementById('CM2').value)||(t&&i?Math.round(t/i):0);
  const s=document.getElementById('CS').value;
  const lp=document.getElementById('LP');
  if((t||m)&&i&&s){
    lp.classList.add('show');
    const[sy,sm0]=s.split('-').map(Number);const totalEndMo=(sm0-1)+(i-1);const endYr=sy+Math.floor(totalEndMo/12),endMo=totalEndMo%12;
    document.getElementById('LPT').textContent=window.fmt(t||m*i);
    document.getElementById('LPM').textContent=window.fmt(m);
    document.getElementById('LPC').textContent=i+' taksit';
    document.getElementById('LPE').textContent=new Date(endYr,endMo,1).toLocaleDateString('tr-TR',{month:'long',year:'numeric'});
  } else lp.classList.remove('show');
}


// ── KREDİ YAPILANDIRMA (v8.208) ──────────────────────────────────────────────
// "Yapılandır" -> mevcut krediyi seç, başlangıç + taksit + miktar gir, kredinin
// pays dizisi SIFIRDAN yeni plana dönüşür (hepsi pending). Geçmiş ödenmiş
// taksitler pays'e taşınmaz: hist'e arşivlenir + paidItems donar (trend korunur)
// + actLog'a yapılandırma kaydı düşer. Saf çekirdek: Hesap.yapilandirPlan /
// Hesap.dondurKrediPaidItems.
function openRestructure(anahtar) {
  const h = _borcHedef(anahtar);
  if (!h) { alert('Borç bulunamadı.'); return; }
  const lbl = document.getElementById('YPA_LBL');
  if (h.tip === 'grup') {
    const acik = h.kalemler.filter(p => kalemOzet(p, window.rates).kalan > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!acik.length) { alert('Bu borçta ödenmemiş ay yok.'); return; }
    const kalan = grupAcikKalan(h.kalemler, window.rates);
    document.getElementById('YPC').value = h.key;
    document.getElementById('YPN').textContent = h.ad + ' — ' + h.kalemler.length + ' ay (' + (h.kalemler.length - acik.length) + ' ödendi, ' + acik.length + ' açık) · kalan ' + _yaz(kalan, h.para);
    document.getElementById('YPS').value = acik[0].date;
    document.getElementById('YPI').value = acik.length;
    document.getElementById('YPA').value = Math.round((kalan / acik.length) * 100) / 100;
    if (lbl) lbl.textContent = 'Aylık Tutar (' + _birim(h.para) + ')';
    updYP();
    ModalManager.open('YPM');
    return;
  }
  const c = h.cred, credId = c.id;
  if (lbl) lbl.textContent = 'Aylık Taksit (₺)';
  document.getElementById('YPC').value = credId;
  const paidN = (c.pays || []).filter(p => (p.status || 'pending') === 'paid').length;
  const pendN = (c.pays || []).length - paidN;
  document.getElementById('YPN').textContent =
    c.name + ' — mevcut: ' + (c.pays || []).length + ' taksit (' + paidN + ' ödendi, ' + pendN + ' bekliyor)';
  // Varsayılanlar: ilk ödenmemiş taksit tarihi / kalan taksit sayısı / mevcut aylık
  const nextPay = (c.pays || []).find(p => (p.status || 'pending') !== 'paid');
  const _nd = new Date();
  document.getElementById('YPS').value = nextPay ? nextPay.date : toLocalISO(_nd.getFullYear(), _nd.getMonth(), _nd.getDate());
  document.getElementById('YPI').value = pendN || (c.pays || []).length || '';
  document.getElementById('YPA').value = Math.round(c.monthly || 0) || '';
  updYP();
  ModalManager.open('YPM');
}

function updYP() {
  const _h = _borcHedef(document.getElementById('YPC').value);
  const _p = _h ? _h.para : 'TRY';
  const i = parseInt(document.getElementById('YPI').value) || 0;
  const m = parseFloat(document.getElementById('YPA').value) || 0;
  const s = document.getElementById('YPS').value;
  const lp = document.getElementById('YPL');
  if (i && m && s) {
    lp.classList.add('show');
    const [sy, sm0] = s.split('-').map(Number);
    const totalEndMo = (sm0 - 1) + (i - 1);
    const endYr = sy + Math.floor(totalEndMo / 12), endMo = ((totalEndMo % 12) + 12) % 12;
    document.getElementById('YPLT').textContent = _yaz(m * i, _p)
      + (_h && _h.tip === 'grup' ? ' (kalan ' + _yaz(grupAcikKalan(_h.kalemler, window.rates), _p) + ')' : '');
    document.getElementById('YPLM').textContent = _yaz(m, _p);
    document.getElementById('YPLC').textContent = i + ' taksit';
    document.getElementById('YPLE').textContent = new Date(endYr, endMo, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  } else lp.classList.remove('show');
}

function saveRestructure() {
  const _h = _borcHedef(document.getElementById('YPC').value);
  if (!_h) { alert('Borç bulunamadı.'); return; }
  const start = document.getElementById('YPS').value;
  const inst = parseInt(document.getElementById('YPI').value) || 0;
  const monthly = parseFloat(document.getElementById('YPA').value) || 0;
  if (!start || !inst || !monthly) { alert('Başlangıç, taksit sayısı ve aylık tutar zorunlu'); return; }
  if (_h.tip === 'grup') {
    let plan;
    try { plan = grupYapilandirPlani(_h.kalemler, { start, adet: inst, tutar: monthly }, window.rates); } catch (e) { alert(e.message); return; }
    const yeniToplam = monthly * inst;
    if (!confirm(_h.ad + ' yapılandırılacak.\n\nKalan borç ' + _yaz(plan.kalan, _h.para) + ' → ' + inst + ' × ' + _yaz(monthly, _h.para) + ' = ' + _yaz(yeniToplam, _h.para)
        + (Math.abs(yeniToplam - plan.kalan) > (_h.para === 'TRY' ? 0.5 : 0.005) ? ' (fark ' + _yaz(yeniToplam - plan.kalan, _h.para) + ')' : '')
        + '.\nÖdenmiş aylar aynen kalır' + (plan.guncelle.length ? ', kısmi ödenmiş ' + plan.guncelle.length + ' ayın ödenen kısmı ödenmiş olarak kalır' : '') + '.\n\nEmin misin?')) return;
    _grupUygula(_h, plan, 'cred_restructure', 'Borç yapılandırıldı',
      _h.ad + ' · kalan ' + _yaz(plan.kalan, _h.para) + ' → ' + inst + ' × ' + _yaz(monthly, _h.para) + ' · ilk ' + start);
    window.closeMov('YPM');
    return;
  }
  const c = _h.cred, credId = c.id;

  const prevInst = (c.pays || []).length;
  const prevPaid = (c.pays || []).filter(p => (p.status || 'pending') === 'paid').length;
  if (!confirm(c.name + ' yapılandırılacak.\n\nMevcut ' + prevInst + ' taksitlik plan kaldırılıp ' +
      inst + ' taksitlik (₺' + Math.round(monthly).toLocaleString('tr-TR') + ') yeni plan kurulacak.\n' +
      'Geçmiş ödemeler kayıtlarda (loglar + trend) kalır.\n\nEmin misin?')) return;

  const iso = new Date().toISOString();

  // 1) Eski planı hist'e arşivle (tam geri-alınabilirlik)
  (c.pays || []).forEach(p =>
    window.Store.unshift('hist', { ...p, name: c.name, currency: 'TRY', restructAt: iso, _restructuredFrom: c.id }));

  // 2) Eski krediye bağlı paidItems'ı dondur (yeni idx çakışması önlenir; trend korunur)
  const { result } = window.Hesap.dondurKrediPaidItems(window.paidItems, c.id, iso);
  window.Store.replace('paidItems', result);

  // 3) Yeni planı kur (hepsi pending) + kredi alanlarını güncelle
  c.pays = window.Hesap.yapilandirPlan(start, inst, monthly);
  c.start = start;
  c.inst = inst;
  c.monthly = monthly;
  c.total = monthly * inst;
  c.restructuredAt = iso;
  c.restructCount = (c.restructCount || 0) + 1;

  // 4) Log (geçmiş loglarda kalır)
  const personId = _resolvePersonId(c.name);
  window.addLog('cred_restructure', 'Kredi yapılandırıldı',
    c.name + ' · ' + prevInst + '→' + inst + ' taksit · ' + window.fmtAmt(monthly, 'TRY') +
    (prevPaid ? (' · ' + prevPaid + ' ödenmiş taksit geçmişte kaldı') : ''),
    0, { personId, credId: c.id });

  window.Store.touch();
  window.closeMov('YPM');
}

// ── KREDİ ERKEN KAPATMA (v8.208+) ────────────────────────────────────────────
// "Erken Kapat" -> kalan (ödenmemiş) taksitler TEK kapama ödemesine indirilir.
// Kalan borç = Σ ödenmemiş taksit (amount - paid). Kullanıcı daha düşük bir
// kapatma tutarı girer; fark tasarruf olarak loglanır. Ödenmiş taksitler +
// paidItems/trend KORUNUR. Ödenmemiş taksitler hist'e arşivlenir (geri-alınabilir).
function _kalanBorc(c) {
  return (c.pays || []).reduce((s, p) => {
    if ((p.status || 'pending') === 'paid') return s;
    return s + Math.max(0, (p.amount || 0) - (p.paid || 0));
  }, 0);
}

function openCloseCredit(anahtar) {
  const h = _borcHedef(anahtar);
  if (!h) { alert('Borç bulunamadı.'); return; }
  const klbl = document.getElementById('KCA_LBL');
  if (h.tip === 'grup') {
    const kalan = grupAcikKalan(h.kalemler, window.rates);
    if (!(kalan > 0)) { alert('Bu borçta ödenmemiş ay yok — kapatılacak bir şey yok.'); return; }
    const acikN = h.kalemler.filter(p => kalemOzet(p, window.rates).kalan > 0).length;
    document.getElementById('KCC').value = h.key;
    document.getElementById('KCN').textContent = h.ad + ' — kalan ' + acikN + ' ay · ' + _yaz(kalan, h.para) + ' kalan borç';
    document.getElementById('KCA').value = Math.round(kalan * 100) / 100;
    if (klbl) klbl.textContent = 'Kapatma Tutarı (' + _birim(h.para) + ')';
    const _d0 = new Date();
    document.getElementById('KCD').value = toLocalISO(_d0.getFullYear(), _d0.getMonth(), _d0.getDate());
    updKC();
    ModalManager.open('KCM');
    return;
  }
  const c = h.cred, credId = c.id;
  if (klbl) klbl.textContent = 'Kapatma Tutarı (₺)';
  if (c.closed) { alert('Bu kredi zaten kapatılmış.'); return; }
  const pend = (c.pays || []).filter(p => (p.status || 'pending') !== 'paid');
  if (!pend.length) { alert('Bu kredide ödenmemiş taksit yok — kapatılacak bir şey yok.'); return; }
  const kalan = Math.round(_kalanBorc(c));
  document.getElementById('KCC').value = credId;
  document.getElementById('KCN').textContent =
    c.name + ' — kalan ' + pend.length + ' taksit · ₺' + kalan.toLocaleString('tr-TR') + ' kalan borç';
  document.getElementById('KCA').value = kalan;
  const _d = new Date();
  document.getElementById('KCD').value = toLocalISO(_d.getFullYear(), _d.getMonth(), _d.getDate());
  updKC();
  ModalManager.open('KCM');
}

function updKC() {
  const h = _borcHedef(document.getElementById('KCC').value);
  const para = h ? h.para : 'TRY';
  const kalan = !h ? 0 : h.tip === 'grup' ? grupAcikKalan(h.kalemler, window.rates) : Math.round(_kalanBorc(h.cred));
  const pay = parseFloat(document.getElementById('KCA').value) || 0;
  const save = Math.max(0, kalan - pay);
  document.getElementById('KCL').classList.add('show');
  document.getElementById('KCLK').textContent = _yaz(kalan, para);
  document.getElementById('KCLP').textContent = _yaz(pay, para);
  document.getElementById('KCLS').textContent = _yaz(save, para);
}

function saveCloseCredit() {
  const _h = _borcHedef(document.getElementById('KCC').value);
  if (!_h) { alert('Borç bulunamadı.'); return; }
  if (_h.tip === 'grup') {
    const tutar = parseFloat(document.getElementById('KCA').value) || 0;
    const tarih = document.getElementById('KCD').value;
    let plan;
    try { plan = grupKapatPlani(_h.kalemler, { tutar, tarih }, window.rates); } catch (e) { alert(e.message); return; }
    if (!confirm(_h.ad + ' erken kapatılacak.\n\nKalan ' + _yaz(plan.kalan, _h.para) + ' tek ' + _yaz(tutar, _h.para) + ' ödemeyle kapanır'
        + (plan.tasarruf > 0 ? ' (' + _yaz(plan.tasarruf, _h.para) + ' tasarruf)' : '') + '.\nÖdenmiş aylar aynen kalır.\n\nEmin misin?')) return;
    _grupUygula(_h, plan, 'cred_close', 'Borç kapatıldı',
      _h.ad + ' · ' + _yaz(plan.kalan, _h.para) + ' → ' + _yaz(tutar, _h.para) + (plan.tasarruf > 0 ? ' · ' + _yaz(plan.tasarruf, _h.para) + ' tasarruf' : ''));
    window.closeMov('KCM');
    return;
  }
  const c = _h.cred, credId = c.id;
  const kalan = Math.round(_kalanBorc(c));
  const pay = Math.round(parseFloat(document.getElementById('KCA').value) || 0);
  const _d = new Date();
  const date = document.getElementById('KCD').value || toLocalISO(_d.getFullYear(), _d.getMonth(), _d.getDate());
  if (pay <= 0) { alert('Kapatma tutarı 0’dan büyük olmalı.'); return; }
  if (pay > kalan) { alert('Kapatma tutarı kalan borçtan (₺' + kalan.toLocaleString('tr-TR') + ') büyük olamaz.'); return; }
  const pend = (c.pays || []).filter(p => (p.status || 'pending') !== 'paid');
  if (!pend.length) { alert('Ödenmemiş taksit yok.'); return; }
  const save = kalan - pay;
  if (!confirm(c.name + ' erken kapatılacak.\n\nKalan ' + pend.length + ' taksit (₺' + kalan.toLocaleString('tr-TR') +
      ') tek ₺' + pay.toLocaleString('tr-TR') + ' kapama ödemesine indirilecek.' +
      (save > 0 ? ('\n₺' + save.toLocaleString('tr-TR') + ' tasarruf.') : '') +
      '\nÖdenmiş taksitler ve geçmiş kayıtlarda kalır.\n\nEmin misin?')) return;

  const iso = new Date().toISOString();

  // 1) Ödenmemiş taksitleri hist'e arşivle (tam geri-alınabilirlik)
  pend.forEach(p =>
    window.Store.unshift('hist', { ...p, name: c.name, currency: 'TRY', closeAt: iso, _closedFrom: c.id }));

  // 2) Ödenmiş taksitleri koru; ödenmemişleri TEK kapama taksitiyle değiştir
  const paidKept = (c.pays || []).filter(p => (p.status || 'pending') === 'paid');
  const maxIdx = (c.pays || []).reduce((m, p) => Math.max(m, p.idx || 0), 0);
  const closePay = { idx: maxIdx + 1, date, amount: pay, status: 'paid', paid: pay, _close: true };
  c.pays = [...paidKept, closePay];
  c.closed = true;
  c.closedAt = iso;
  c.closeAmount = pay;
  c.savedAmount = save;
  c.monthly = 0;
  c.inst = c.pays.length;
  c.total = paidKept.reduce((s, p) => s + (p.amount || 0), 0) + pay;

  // 3) Log (geçmiş loglarda kalır)
  const personId = _resolvePersonId(c.name);
  window.addLog('cred_close', 'Kredi kapatıldı',
    c.name + ' · ₺' + kalan.toLocaleString('tr-TR') + ' → ₺' + pay.toLocaleString('tr-TR') +
    (save > 0 ? (' · ₺' + save.toLocaleString('tr-TR') + ' tasarruf') : ''),
    0, { personId, credId: c.id });

  window.Store.touch();
  window.closeMov('KCM');
}


// ── GLOBAL COMPAT ──────────────────────────────────────────────────────────
window.openPay            = openPay;
window.editPay            = editPay;
window.savePay            = savePay;
window.editCred           = editCred;
window.saveCred           = saveCred;
window.openCloseCredit    = openCloseCredit;
window.updKC              = updKC;
window.saveCloseCredit    = saveCloseCredit;
window.updLP              = updLP;
window.openRestructure    = openRestructure;
window.updYP              = updYP;
window.saveRestructure    = saveRestructure;

// ── KREDİ ÖZET PANELİ ────────────────────────────────────────────────────────
function renderCredSummary() {
  const el = document.getElementById('CRED_SUM');
  if (!el || !window.creds || !window.creds.length) {
    if (el) el.style.display = 'none';
    return;
  }
  // Tum hesap + display name Hesap.krediler'a delege (plan matrisiyle tutarli)
  const list = window.Hesap.krediler();
  const cards = list.map(({cred, dispName, remaining, bekleyen, pct, nextPay, nextDays, overdueCount, lastDate, done}) => {
    const pctColor = pct>=80?'var(--ok)':pct>=50?'var(--blue)':'var(--ora)';
    const nextStr  = nextPay?window.fmtD(nextPay.date):'✓';
    // Sayac badge: done > overdue > yaklasan(<=7) > uzak (v8.158)
    let badge = '';
    if (done) {
      badge = '<span style="color:var(--ok);font-weight:600">✓ Tamamlandı</span>';
    } else if (overdueCount > 0) {
      badge = '<span style="color:var(--danger);font-weight:600">⚠ '+overdueCount+' gecikti</span>';
    } else if (nextDays !== null && nextDays >= 0 && nextDays <= 7) {
      badge = '<span style="color:#fcd34d;font-weight:600">⚡ '+(nextDays===0?'Bugün':nextDays===1?'Yarın':nextDays+' gün')+'</span>';
    } else if (nextDays !== null && nextDays > 7) {
      badge = '<span style="color:var(--muted)">'+nextDays+' gün sonra</span>';
    }
    // Kredi bitis: son taksitin "Ay YYYY" formatinda (Ara 27 gibi)
    let lastStr = '';
    if (lastDate) {
      const d = window.parseLocalDate(lastDate);
      lastStr = d.toLocaleDateString('tr-TR',{month:'short'}) + ' ' + String(d.getFullYear()).slice(-2);
    }
    return `<div data-cred-id="${cred.id}" style="background:var(--surf2);border:1px solid var(--bdr);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;min-width:0;cursor:pointer">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
        <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.esc(dispName)}</div>
        <div style="font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace;flex-shrink:0">${done?'✓':remaining+' kaldı'}</div>
      </div>
      <div style="height:3px;background:var(--surf);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:2px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;font-weight:700;font-family:'IBM Plex Mono',monospace;color:${done?'var(--ok)':'var(--danger)'}">${done?'✓':window.fmt(bekleyen)}</div>
        <div style="font-size:10px;color:var(--muted)">${nextStr}</div>
      </div>
      ${(lastStr||badge)?`<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;gap:6px;min-width:0">
        <div style="color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lastStr?(done?'Bitti: '+lastStr:'Bitiş: '+lastStr):''}</div>
        <div style="flex-shrink:0">${badge}</div>
      </div>`:''}
    </div>`;
  }).join('');
  el.style.display = '';
  el.innerHTML = `<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.8px;margin-bottom:8px">KREDİLER</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">${cards}</div>`;
  // v8.165: cred karta click → plan DV modal (openRow) — taksit takvimi zaten orada
  if (!_credSumHandlerAttached) {
    el.addEventListener('click', e => {
      const card = e.target.closest('[data-cred-id]');
      if (card && card.dataset.credId && window.openRow) {
        window.openRow(encodeURIComponent('cred_'+card.dataset.credId));
      }
    });
    _credSumHandlerAttached = true;
  }
}
let _credSumHandlerAttached = false;
window.renderCredSummary = renderCredSummary;

// ── STORE EVENT LISTENER (v9.0) ─────────────────────────────────────────────
// Plan sekmesi aktifken pays/creds degisirse kredi panelini yenile
window.addEventListener('store:change', e => {
  if (window.curTab !== 0) return;
  if (window.Store && window.Store._affects(e.detail, ['pays','creds'])) renderCredSummary();
});
