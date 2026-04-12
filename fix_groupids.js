// ═══════════════════════════════════════════════════════════════
// KONSOLA YAPISTIR — GroupId düzeltme scripti
// Aynı isimli ödemeleri ay çakışmasına göre otomatik gruplar
// Çakışma yoksa → tek satır, çakışma varsa → ayrı satır
// ═══════════════════════════════════════════════════════════════

(function fixGroupIds() {
  const byName = {};
  pays.forEach(p => {
    if (!byName[p.name]) byName[p.name] = [];
    byName[p.name].push(p);
  });

  let fixed = 0;

  Object.keys(byName).forEach(name => {
    const entries = byName[name];
    if (entries.length <= 1) {
      // Tek entry — kendi groupId'si
      entries[0].groupId = String(Math.floor(Number(entries[0].id)));
      return;
    }

    // Tarihe göre sırala
    entries.sort((a, b) => a.date.localeCompare(b.date));

    // Ay çakışmasına göre gruplara ayır
    const groups = [];

    entries.forEach(entry => {
      const entryMonth = entry.date.substring(0, 7);
      let placed = false;

      for (const group of groups) {
        const usedMonths = new Set(group.map(e => e.date.substring(0, 7)));
        if (!usedMonths.has(entryMonth)) {
          group.push(entry);
          placed = true;
          break;
        }
      }

      if (!placed) {
        groups.push([entry]);
      }
    });

    // Her gruba ortak groupId ata
    groups.forEach((group, i) => {
      const gid = String(Math.floor(Number(group[0].id)));
      group.forEach(entry => {
        entry.groupId = gid;
        fixed++;
      });
    });

    console.log(name + ': ' + entries.length + ' kayıt → ' + groups.length + ' satır');
  });

  // Kaydet ve yenile
  invalidateLookups();
  saveSecureNow().then(() => {
    render();
    console.log('✅ Toplam ' + fixed + ' kayıt düzeltildi');
  });
})();
