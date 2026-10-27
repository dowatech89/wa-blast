# Pengaturan per Outlet (Backend)

Semua pengaturan kirim dan pengaman nomor disimpan per outlet di tabel `outlets` (Supabase). Ada dua cara mengubahnya:

- **Dashboard**: menu **Pengaturan** (captain atau admin yang login sebagai outlet itu).
- **Supabase**: Table Editor, tabel `outlets`, ubah langsung di barisnya. Atau lewat SQL Editor, contoh di bawah.

`WABlast.exe` membaca ulang pengaturan setiap tick (default 3 detik), jadi perubahan berlaku tanpa restart PC.

## Daftar pengaturan

| Kolom | Default | Arti |
| :--- | :--- | :--- |
| `daily_limit` | (diisi saat outlet dibuat) | Maksimal pesan terkirim per hari, setelah pemanasan selesai. |
| `delay_min_sec`, `delay_max_sec` | (diisi saat outlet dibuat) | Jeda acak antar pesan, dalam detik. |
| `send_start`, `send_end` | (diisi saat outlet dibuat) | Jam kirim, dihitung dengan zona waktu di kolom `timezone`. |
| `warmup_enabled` | `true` | Pemanasan nomor baru aktif. |
| `warmup_start_limit` | `10` | Batas pesan pada hari pertama nomor tersambung. |
| `warmup_daily_increase` | `5` | Tambahan batas setiap hari, sampai mencapai `daily_limit`. |
| `check_number_first` | `true` | Cek nomor punya WhatsApp sebelum kirim. Nomor tanpa WhatsApp dilewati selamanya (`contacts.not_on_whatsapp`). |
| `pause_after_failures` | `3` | Semua promo dihentikan setelah sekian kali gagal berturut-turut. `0` = tidak pernah. |
| `min_days_between_promos` | `3` | Satu pelanggan maksimal menerima 1 promo dalam sekian hari. `0` = tanpa batas. |
| `optout_footer` | `Balas STOP kalau tidak mau menerima promo lagi.` | Kalimat yang ditambahkan di akhir setiap promo. Kosongkan untuk mematikan. |
| `stop_keywords` | `{STOP,BERHENTI,UNSUBSCRIBE}` | Balasan pelanggan yang membuatnya berhenti langganan. Tidak membedakan huruf besar/kecil. |

## Kolom yang diisi sistem (jangan diubah manual, kecuali disebut di bawah)

| Kolom | Isi |
| :--- | :--- |
| `wa_connected_since` | Tanggal nomor sekarang pertama tersambung. Dasar hitungan pemanasan. Ubah ke tanggal lama untuk melewati pemanasan nomor yang memang sudah lama dipakai. |
| `consecutive_failures` | Jumlah gagal berturut-turut sekarang. Kembali ke 0 setelah 1 pesan terkirim atau promo dinyalakan lagi. |
| `pause_reason` | Alasan pengiriman dihentikan otomatis. Tampil sebagai kotak kuning di dashboard. Kosong saat captain menekan **Mengerti** atau menyalakan promo lagi. |

## Akun login

Captain login cukup pakai **nama pengguna** (misalnya `sunset`). Dashboard dan `WABlast.exe` otomatis menambahkan `@wablast.local`, jadi di Supabase akunnya tersimpan sebagai `sunset@wablast.local`.

- **Akun outlet**: satu akun untuk satu outlet. Hanya bisa melihat outletnya sendiri. Akun inilah yang diisi di `WABlast.exe` di PC outlet.
- **Akun supervisor**: bisa melihat dan mengatur semua outlet dari dashboard. Ada pilihan outlet di bagian atas. Akun ini tidak dipakai di `WABlast.exe`, dan tidak bisa mengirim pesan sendiri.

Pendaftaran umum dimatikan, jadi akun hanya bisa dibuat oleh admin.

Buat akun outlet baru:
1. Supabase, menu **Authentication**, **Users**, **Add user**, **Create new user**. Email `<nama>@wablast.local`, isi kata sandi, centang **Auto Confirm User**.
2. SQL Editor:
```sql
insert into public.outlets
  (name, owner_user_id, gowa_device_id, daily_limit, delay_min_sec, delay_max_sec, send_start, send_end, timezone)
select 'Nama Outlet', id, 'nama-outlet', 50, 30, 90, '09:00', '20:00', 'Asia/Jakarta'
  from auth.users where email = 'nama@wablast.local';
```

Jadikan akun sebagai supervisor (akunnya dibuat dulu seperti langkah 1):
```sql
insert into public.supervisors (user_id) select id from auth.users where email = 'supervisor@wablast.local';
```

Ganti kata sandi:
```sql
update auth.users set encrypted_password = extensions.crypt('kata-sandi-baru', extensions.gen_salt('bf'))
 where email = 'sunset@wablast.local';
```
Setelah kata sandi diganti, `WABlast.exe` di PC outlet tetap jalan, karena sesinya sudah tersimpan.

## Contoh SQL

Pengaturan yang lebih hati-hati untuk satu outlet:
```sql
update outlets
   set daily_limit = 40, delay_min_sec = 45, delay_max_sec = 120,
       min_days_between_promos = 7, pause_after_failures = 2
 where name = 'Outlet Pilot';
```

Nomor lama yang sudah lama dipakai, jadi tidak perlu pemanasan:
```sql
update outlets set wa_connected_since = '2020-01-01' where name = 'Outlet Pilot';
```

Lihat batas hari ini setiap outlet:
```sql
select name, daily_limit, public.effective_daily_limit(o) as batas_hari_ini, wa_connected_since
  from outlets o order by name;
```

Kontak yang ternyata punya WhatsApp (misalnya salah deteksi) dan mau dikirimi lagi:
```sql
update contacts set not_on_whatsapp = false where phone = '6281234567890';
```
