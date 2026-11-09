# TODO — WA Blast Promo (pilot 1 outlet)

Rencana lengkap: [docs/plans/implementation_plan.md](docs/plans/implementation_plan.md).
Susunan: dashboard web (Vite, file statis) + `WABlast.exe` (Python + GOWA) di PC tiap outlet + Supabase. Gratis, tanpa VPS.
Aturan: kerjakan phase berurutan. Kotak ⏳ = menunggu data/aksi dari pemilik, dikerjakan begitu tersedia.

## Sisa pekerjaan (urut, per 2026-11-03)
Pemilik = kamu, Claude = dikerjakan di sini.

**A. Cek dashboard baru (pemilik, di Vercel)**
1. [ ] Login pakai dropdown outlet; dowa/supervisor lewat "Lainnya"
2. [ ] Promo: ketik pesan + pilih foto, lihat pratinjau chat berbingkai HP; Simpan muncul notifikasi "Tersimpan"
3. [ ] Promo draf: **Ubah promo**; promo selesai: **Pakai lagi (salin & ubah)**
4. [ ] Kontak: **Izinkan kirim lagi** untuk Faras (login supervisor)
5. [ ] WhatsApp: status + titik hijau/merah di menu; kotak **Nama pengirim**

**B. Nama pengirim di WhatsApp**
6. [ ] Pemilik: jalankan `agent\dist\WABlast.exe` (build 2026-11-03), cek nama profil nomor Sunset jadi "Sunset Grill"; Claude cek `sender_name_applied` di database
7. [ ] Pemilik, di HP outlet: pasang logo sebagai foto profil, lalu Privasi, Foto profil, Semua orang

**C. Pilot Sunset Grill**
8. [ ] Pasang `WABlast.exe` di PC Sunset (cek 64-bit), login `sunset`, pilih Yes untuk nyala otomatis, scan QR, restart PC, pastikan tetap tersambung
9. [ ] Upload Excel kontak asli, kirim 30-50 kontak, pantau 2-3 hari (blokir, STOP, gagal)
10. [ ] Naikkan batas harian bertahap kalau aman; catat hasil di `MEMORY.md`

**D. Rollout 6 akun lain** (D'Spa `dspa`, D'Bistro `dbistro`, Dragon Beach Club `dbc`, Rooms `rooms`, D'Bar `dbar`, Dowa `dowa`)
11. [ ] Cek tiap PC Windows 10 64-bit, pasang exe, login akun outlet, Yes nyala otomatis, scan QR
12. [ ] Bagikan ke tiap captain: link dashboard, kata sandi, `docs/guides/panduan-captain.md`
13. [ ] Outlet baru dari menu Admin: Claude tambahkan barisnya di `web/src/login.ts` supaya muncul di dropdown login

**E. Teknis (Claude, perlu login Supabase sekali: `npx supabase@2.120.0 login`)**
14. [ ] Deploy ulang fungsi `admin` (default jam kirim 10:00-18:00 untuk outlet baru)

**F. Opsional / terbuka**
15. [ ] Pemilik: pastikan kontak promo sudah setuju menerima (opt-in); kirim contoh Excel asli
16. [x] `trivy` v0.76.1 terpasang (checksum + attestation cocok); scan 2026-11-03: certifi CRITICAL diperbaiki ke 2026.10.18, sisanya 0
17. [ ] Logo per outlet (sekarang logo WA Blast)
18. [ ] Tombol pesan WhatsApp (eksperimen GOWA, hanya Android): uji ke HP tim dulu kalau mau

## Phase 0 — Diskusi & Riset
- [x] Kumpulkan kebutuhan (6 outlet, 1 nomor captain per outlet, foto + teks, kontak dari Excel, tombol nyalakan)
- [x] Riset engine WA open source di GitHub (GOWA, WAHA, Evolution API, Baileys, Cloud API resmi)
- [x] Pilih engine: go-whatsapp-web-multidevice (GOWA), MIT
- [x] Putuskan susunan: gratis, tanpa VPS, dashboard web + exe per PC + Supabase
- [x] Susun implementation plan lewat `.agents/scripts/plan_architect.py` (valid 100%)
- [x] Pemilik setujui plan (2026-10-27)
- [ ] ⏳ Jawab Open Questions: kontak opt-in? contoh file Excel asli?

## Phase 1 — Fondasi
- [x] Download GOWA v9.6.0 Windows (checksum SHA-256 cocok) → `tools/gowa/gowa.exe`
- [x] Jalankan GOWA di laptop (hanya 127.0.0.1, basic auth, MCP mati), buat device `outlet-pilot`
- [x] `.gitignore`, `.env.example`, `.env.local`, `.gitleaks.toml`
- [x] Tulis `supabase/migrations/20261027000000_init.sql` (tabel, RLS, OCC → HTTP 409, antrean, bucket, view progres)
- [x] Tes migration di Supabase lokal (`npx supabase start`): antrean, jeda, batas harian, STOP, OCC 409, RLS antar outlet, pemulihan crash
- [x] Project Supabase online `wnnxiprxasbiptpvwsmz` (Singapore); URL + publishable key di `.env.local`
- [x] 3 migration dijalankan lewat Management API; pendaftaran umum dimatikan
- [x] Akun `sunset` (outlet Sunset Grill, device `sunset-grill`) + akun `supervisor`; kata sandi di `.env.admin.local`
- [x] Cek online: tamu ditolak, daftar akun ditolak, captain hanya lihat outletnya, login dashboard produksi lolos
- [x] Access token Supabase sudah tidak berlaku (2026-11-03); migration berikutnya dijalankan di SQL Editor
- [x] Scan QR nomor pilot dari dashboard online (laptop, GOWA v9.8.0) → tersambung
- [x] GOWA naik ke v9.8.0: v9.6.0 kena "can't link new devices" padahal WhatsApp Web bisa; 26 test lolos, exe dibuild ulang
- [x] Kirim foto + teks + {nama} ke 3 nomor tim dari dashboard online (2026-10-30): 3 terkirim, promo otomatis Selesai

## Phase 2 — Mesin Kirim Python
- [x] `config.py`, `session.py` (login akun outlet sekali, sesi tersimpan; kata sandi salah diminta ulang)
- [x] `gowa.py` (jalankan GOWA, status, QR, logout, kirim teks/gambar, error non-JSON ditangani)
- [x] `worker.py`: detak, commands, sinkron QR, claim → kirim → complete, pemulihan pesan tersangkut
- [x] Jeda acak, batas harian, jam kirim dibaca dari tabel `outlets` (di DB, tanpa `sleep`)
- [x] Webhook lokal "STOP" dengan verifikasi HMAC
- [x] 11 test (3 unit + 8 integrasi ke Supabase lokal + GOWA asli) lolos; ruff, mypy, pyright, vulture bersih
- [x] Tes kirim sungguhan ke 3 nomor tim; balasan STOP tercatat ±17 detik setelah terkirim
- [x] STOP dibalas saat WABlast mati tetap tercatat: masuk 5 detik setelah WABlast dinyalakan lagi

## Phase 3 — Dashboard (bahasa sederhana)
- [x] Halaman Masuk
- [x] Tab WhatsApp: status PC, status WA, QR + langkah scan, tombol Ganti nomor
- [x] Tab Kontak: upload Excel/CSV, ringkasan masuk/salah/dobel, cari, hapus
- [x] Tab Kontak: unduh template Excel, nomor 08/8/+62 otomatis jadi 62, daftar nomor salah (baris, nama, nomor) tetap tampil setelah simpan
- [x] Tab Promo: foto + pesan + `{nama}`, NYALAKAN/MATIKAN, progres, daftar gagal
- [x] Tab Pengaturan: batas harian, jeda, jam kirim
- [x] 17 test; biome, tsc, knip bersih; build produksi 72 KB gzip
- [x] Uji klik di browser (Playwright, lebar HP 390px): login salah/benar, QR asli tampil, upload Excel, cari nama & nomor, hapus, buat promo, NYALAKAN, MATIKAN, konflik versi (pesan jelas), validasi pengaturan, PC mati terdeteksi, keluar
- [x] Kontras WCAG AA semua teks, tombol ≥ 44px, keyboard + fokus terlihat, tanpa scroll samping
- [x] Arah desain di `DESIGN.md` (warna, font Plus Jakarta Sans, spasi, radius); ringkasan bento "Siap kirim?" di atas semua menu
- [x] Halaman **Semua outlet** untuk supervisor: kartu tiap outlet (PC, WhatsApp, terkirim hari ini, promo berjalan), yang bermasalah di atas; `outlet_overview()` dipasang online
- [x] Gaya baru (referensi Pinterest 2026-11-02): teal kalem, kartu berbayang, menu kotak ikon di HP, sidebar teal di laptop; dicek 360px dan 1366px
- [ ] ⏳ Logo outlet/brand (opsional)
- [x] Tombol **Ubah promo** (judul, foto, pesan) saat belum dikirim atau berhenti sementara; database menolak edit promo yang sedang mengirim atau selesai (`20261102000000_edit_promo.sql`, dipasang online)
- [x] Repo publik https://github.com/dowatech89/wa-blast (tanpa `.agents/`, kunci, dan binary)
- [x] Deploy dashboard ke Vercel dari repo GitHub: https://wa-blast-dowa1.vercel.app (Vercel Authentication dimatikan)

## Phase 4 — Bungkus jadi `WABlast.exe`
- [x] `build.bat` → PyInstaller one-file, GOWA di dalamnya, tanpa jendela konsol (39 MB)
- [x] Autostart Windows lewat `WABlast.exe --autostart` (sekali saat instalasi)
- [x] Exe 1 file: GOWA + `wablast.env` di dalam exe (file `wablast.env` di sebelah exe tetap bisa menimpa)
- [x] Setelah login pertama: kotak "sudah jalan di belakang layar" + pilihan nyala otomatis (Yes/No); memilih No tidak lagi crash
- [x] Menu Admin (Edge Function `admin`), lihat/ulangi kata sandi; test agent 30, web 19
- [x] Exe hasil build dijalankan ke Supabase lokal: login tersimpan, QR terbit, detak jalan, berhenti bersih tanpa proses tertinggal
- [ ] ⏳ Tes di PC outlet: install → login → QR di web → scan → restart PC → tetap tersambung

## Phase 4c — Login Username + Akun Supervisor
- [x] Login pakai nama pengguna (`sunset` jadi `sunset@wablast.local`) di dashboard dan exe
- [x] Migration `20261027020000_supervisors.sql`: tabel `supervisors`, `owns_outlet()` mengizinkan supervisor; kirim pesan tetap hanya akun outlet
- [x] Dashboard: pilihan outlet untuk supervisor; exe memilih outlet milik akunnya sendiri
- [x] Test: agent 22, web 19; uji klik pilihan outlet (lokal) dan login online
- [x] Panduan akun + ganti kata sandi di `docs/guides/pengaturan-backend.md`
- [x] Build ulang `WABlast.exe` (login username); `agent/dist/wablast.env` sudah berisi URL + publishable key online

## Phase 4d — Menu Admin (tanpa buka Supabase)
- [x] Edge Function `admin`: tambah outlet + akun, tambah supervisor, ganti kata sandi (hanya supervisor)
- [x] Dashboard: menu **Admin** untuk supervisor, **Kata sandi saya** di Pengaturan untuk semua akun
- [x] Migration `20261027040000_admin.sql` (`is_supervisor()`); `20261027030000_durable_opt_outs.sql` (STOP tidak bisa hilang)
- [x] Tombol **Izinkan kirim lagi** (supervisor saja) untuk kontak yang membalas STOP; migration `20261030000000_allow_again.sql` dipasang online
- [x] Test: agent 29 (6 test fungsi admin), web 19; uji klik lokal: buat outlet, ganti kata sandi, captain tidak lihat Admin
- [x] Dipasang online: migration + fungsi; cek online: tamu 401, captain 403, supervisor bisa

## Phase 4b — Pengaman Risiko Blokir (bisa diatur per outlet di dashboard dan backend)
- [x] Migration `supabase/migrations/20261027010000_risk_controls.sql` (kolom pengaturan di `outlets`, default aman)
- [x] Pemanasan nomor baru: batas harian naik tiap hari sejak nomor tersambung (`effective_daily_limit`, `mark_number_linked`)
- [x] Cek nomor punya WhatsApp sebelum kirim (GOWA `/user/check`); nomor tanpa WA dilewati selamanya
- [x] Berhenti otomatis setelah N gagal berturut-turut, dan saat WhatsApp terputus; peringatan kuning di dashboard
- [x] `20261103000000_fixed_send_delay.sql` dan `20261103010000_sender_name.sql` dijalankan di SQL Editor (dicek online 2026-11-03: jeda 30-90 terkunci, kolom nama pengirim ada)
- [x] Jeda antar pesan otomatis: kolom jeda dihapus dari Pengaturan
- [x] **Nama pengirim** di menu WhatsApp: WABlast memasang nama profil WhatsApp lewat GOWA `/user/pushname` (default nama outlet, ulang otomatis untuk nomor baru); gagal pasang tidak menghentikan kirim
- [x] Jam kirim semua outlet 10:00-18:00 (diubah online 2026-11-03); default outlet baru di fungsi admin juga 10:00-18:00
- [ ] ⏳ Deploy ulang fungsi admin supaya default 10:00-18:00 berlaku: `npx supabase@2.120.0 login`, lalu `npx supabase@2.120.0 functions deploy admin --project-ref wnnxiprxasbiptpvwsmz --use-api --no-verify-jwt`
- [x] Menu WhatsApp menampilkan status (tersambung/belum) walau PC mati; titik hijau/merah di menu WhatsApp
- [x] Promo selesai: tombol **Pakai lagi** (salinan jadi draf yang bisa diubah); pratinjau chat selalu tampil di samping form (bingkai HP)
- [x] Keluar di bawah sidebar (laptop); "Lihat kontak" jadi "Daftar kontak"
- [x] Login: pilih outlet dari daftar (dowa dan supervisor lewat "Lainnya"); daftar ada di `web/src/login.ts`, tambah baris saat outlet baru dibuat
- [x] Isian `{outlet}` di pesan promo
- [x] Tampilan: logo + favicon, login dengan panel teal, ikon status di "Siap kirim?", lingkaran progres, pratinjau chat WhatsApp, avatar inisial (kontak, outlet), kolom cari berikon, notifikasi "Tersimpan"
- [x] `WABlast.exe` dibuild ulang 2026-11-03 (nama pengirim); dites jalan ke database online yang belum dimigrasi
- [x] Jeda N hari kalender antar promo per pelanggan; promo berikutnya menunggu, tidak dilewati (`20261030010000_defer_promo_gap.sql`, dipasang online)
- [x] Kalimat berhenti langganan otomatis di akhir pesan + kata STOP diatur dari database
- [x] Tab Pengaturan: bagian "Pengaman nomor"; tab Promo: contoh pesan persis seperti yang diterima pelanggan; tab Kontak: penanda "Tidak punya WhatsApp"
- [x] Test: agent 20 (termasuk 9 test baru ke Supabase lokal + GOWA asli), web 18; uji klik browser + lebar HP 375px
- [x] Bug ketemu & diperbaiki: zona waktu `Asia/Jakarta` tidak ada di Windows (tanggal sekarang dihitung di database); scrollbar tab; tab "Pengaturan" terpotong di HP
- [x] Exe dibuild ulang dan dites ke Supabase lokal
- [x] Panduan: [docs/guides/panduan-captain.md](docs/guides/panduan-captain.md), [docs/guides/pengaturan-backend.md](docs/guides/pengaturan-backend.md)

## Phase 4e — Integrasi Telegram, Media Video/PDF, Anti-Ban & Laporan Harian (2026-11-09)
- [x] Webhook pesan masuk WhatsApp mengirimkan notifikasi chat ke bot Telegram admin (@dowalabsbot) lengkap dengan nama pengirim dan tautan balas `wa.me/`
- [x] Peringatan WhatsApp terputus / logout langsung dikirim ke Telegram
- [x] Notifikasi startup saat `WABlast.exe` pertama kali dinyalakan di PC outlet
- [x] Rekap harian otomatis ke Telegram setiap pukul 18:00 (pesan terkirim, gagal, STOP, total kontak) dengan proteksi duplikasi tanggal
- [x] Simulasi anti-ban status typing ("sedang mengetik...") 1.5–3.0 detik sebelum pesan dikirim
- [x] Tab Promo mendukung lampiran media Video (`.mp4`, `.webm`, `.mov`) dan dokumen brosur (`.pdf`) selain foto, diarahkan ke GOWA `/send/video` dan `/send/file`
- [x] Tab Kontak: filter "✓ Sudah Di-chat", tombol unduh file Excel (`.xlsx`), dan salin nomor ke clipboard
- [x] Template pesan: variabel salam waktu otomatis `{salam}` (Selamat pagi/siang/sore/malam) dan tombol cepat sisipkan `{salam}`, `{nama}`, `{outlet}`
- [x] Unit test (Python 16/16 lolos, Frontend 28/28 lolos), Ruff linter lolos, exe dibuild ulang via `agent/build.bat`

## Phase 5 — Pilot 1 Outlet
- [ ] ⏳ Install exe di PC outlet pilot
- [ ] ⏳ Import Excel asli
- [ ] ⏳ Kirim batch kecil dulu (30-50 kontak), pantau 2-3 hari
- [ ] ⏳ Naikkan batas harian bertahap kalau aman
- [ ] ⏳ Catat hasil ke `MEMORY.md`

## Phase 6 — Quality Gates 1..10
- [x] Perbaiki bug `.agents/`: runner memecah `(cd A && x) && (cd B && y)` per folder; probe Gate 8 pakai `python`; vulture tidak memindai `.venv` (8 test regresi di `.agents/tests/test_while_loop_runner.py`)
- [x] `python .agents/scripts/while_loop_runner.py --run --report` → 10/10 lolos berturut-turut
- [x] `trivy` terpasang di `~/.local/bin`; perintah scan ada di README

## Phase 7 — Rollout 5 Outlet Lain + Dowa
Outlet (nama pengguna usulan): D'Spa (`dspa`), D'Bistro (`dbistro`), Dragon Beach Club (`dbc`), Rooms (`rooms`), D'Bar (`dbar`).
Plus akun Dowa (`dowa`): akun outlet biasa khusus pemilik pribadi (nomor WA dan kontak sendiri).
Semua PC outlet Windows 10 (2026-11-02). Cek tiap PC 64-bit: exe hanya 64-bit.
- [x] 6 akun dibuat lewat menu Admin (2026-11-02): dbar, dbistro, dspa, dowa (nama "dowalabs"), dbc, rooms
- [ ] Install exe di tiap PC (`WABlast.exe --autostart`), scan QR dari dashboard
- [x] Panduan 1 halaman untuk captain
- [ ] Bagikan panduan + link dashboard ke 5 captain

## Batasan yang diketahui
- `WABlast.exe` hanya jalan 1 kali per PC; klik kedua menampilkan "sudah jalan di belakang layar".
- Kalau `WABlast.exe` ditutup paksa lewat Task Manager, proses GOWA di dalamnya bisa tertinggal dan menahan port 3100. Restart PC menyelesaikannya.
- Risiko blokir WhatsApp tidak bisa nol (nomor biasa + gateway tidak resmi).
