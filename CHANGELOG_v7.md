# Ödeme Takvimi v7.0 — Değişiklik Günlüğü

## 1. Recurring Sistemi Kaldırıldı
- `rec`, `rp`, `rs`, `rm` alanları tüm kayıtlardan silindi
- Her ödeme artık bağımsız, tekil kayıt
- `genRec()` fonksiyonu devre dışı bırakıldı (compat için boş fonksiyon olarak duruyor)
- Eski "Aylık Tekrarlayan" toggle kaldırıldı

## 2. "Kaç Aya Kopyalansın" Özelliği
- Ödeme modalında yeni sayı girişi: 0 = sadece bu ay, N = N ay sonrasına kadar kopyala
- Her kopya bağımsız kayıt olarak oluşturuluyor
- Tüm kopyalar aynı `groupId`'yi paylaşıyor → matris tablosunda tek satırda görünüyor

## 3. groupId ile Satır Gruplama
- Her ödeme kaydına `groupId` alanı eklendi
- Aynı groupId'ye sahip ödemeler matriste tek satırda birleşiyor
- Farklı groupId'ye sahip aynı isimli ödemeler ayrı satırlarda kalıyor
- Migrasyon: eski `rp` bağlantısından `groupId` türetiliyor (aynı parent → aynı satır)

## 4. Otomatik İsim Numaralandırma
- Aynı isimle birden fazla satır varsa otomatik numaralandırma: "Hakan Akçay 1", "Hakan Akçay 2"
- Tek satır varsa numarasız görünüyor

## 5. Üç Bağımsız Veri Katmanı
- **Plan** (`pays`) — ana ödeme planı, matris tablosu
- **Yapılan Ödemeler** (`paidItems`) — ayrı veri, düzenle/sil butonları, plan'a etkisi yok
- **Geçmiş** (`hist`) — ayrı veri, düzenle butonu, düzenlenmiş haliyle geri alma seçeneği
- Ödeme "ödendi" işaretlendiğinde plan'da ✓ görünüyor + paidItems'a bağımsız kopya ekleniyor
- Geri alma: plan'dan status sıfırlanıyor + paidItems'dan kaldırılıyor

## 6. Plan 2 Bug Fix
- localStorage key'leri plan-bağımsızdı (`v5-data`, `v5-rates`)
- Plan 1 ve Plan 2 aynı key'i paylaşıyordu → Plan 2 verileri kayboluyordu
- Düzeltme: `v5-data-plan1`, `v5-data-plan2` olarak ayrıldı, eski key'lere fallback korundu

## 7. Sıralama Seçenekleri
- Plan sayfasına "📅 Tarihe Göre" / "🔤 İsme Göre" dropdown eklendi

## 8. buildMx Status Logic Fix
- Eski: tek bir paid item tüm hücreyi "paid" olarak işaretliyordu
- Yeni: tümü paid → paid, herhangi partial → partial, herhangi overdue → overdue

## 9. encryptData Büyük Veri Fix
- `btoa(String.fromCharCode(...buf))` büyük verilerle stack overflow yapıyordu
- Chunk'lı (8KB) btoa dönüşümü ile düzeltildi

## 10. UYS v3 Yapısal İyileştirmeler

### debounce (400ms)
- `saveSecure` artık 400ms debounce ile çalışıyor
- Art arda çağrılarda Firebase'e tek write gidiyor
- `saveSecureNow()` → kritik işlemler (migrasyon, şifre değiştir) için anında kayıt

### _suppressSave
- Batch işlemlerde (migrasyon, restore) ara kayıtları engelliyor
- İşlem bitince `_suppressSave = false` + `saveSecureNow()` ile tek seferde kaydediyor

### Lookup Maps
- `findPayById(id)` → O(1) ID ile ödeme bulma
- `findCredById(id)` → O(1) ID ile kredi bulma
- `findPaysByGroup(gid)` → O(1) groupId ile grup bulma
- Lazy rebuild: `invalidateLookups()` ile sadece veri değiştiğinde yeniden oluşturuyor
- Eski `pays.find(x=>String(x.id)===...)` pattern'ları tamamen kaldırıldı

### invalidateLookups
- `saveSecure()` ve `render()` başında otomatik çağrılıyor
- Veri tutarlılığı garanti altında

## Migrasyon (migrateToV7)
- İlk girişte otomatik çalışıyor
- `rec/rp/rs/rm` alanlarını siliyor
- Eski `rp` bağlantısından `groupId` oluşturuyor
- Mevcut paid/partial kayıtlardan `paidItems` dizisi oluşturuyor
- `_suppressSave` ile batch olarak çalışıp tek seferde kaydediyor
- `v7-migrated-{uid}-{planId}` flag'i ile tekrar çalışmayı önlüyor

## Dokunulmayan Alanlar
- Firebase yapısı (auth, Firestore doc format) değişmedi
- Kripto altyapısı (AES-256-GCM, PBKDF2) değişmedi
- CSS/UI tasarımı değişmedi
- Kredi (creds) sistemi değişmedi
- Kişiler ve Notlar sistemi değişmedi
- Backup/Restore formatı geriye uyumlu (v7 + eski v5 dosyalarını okuyabiliyor)

## 11. _displayName Key Filter Fix
- `_displayName` key'i matris ay key filtrelerinden geçiyordu
- `x!=='_name'&&x!=='_rootId'` → `!x.startsWith('_')` olarak güncellendi (tüm 6 yerde)
- Bu fix olmadan ay sütunları ve gün numaraları hatalı hesaplanıyordu
