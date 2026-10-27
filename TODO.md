# TODO — WA Blast Promo (pilot 1 outlet)

Rencana lengkap: [docs/plans/implementation_plan.md](docs/plans/implementation_plan.md).
Susunan: dashboard web (Vite, file statis) + `WABlast.exe` (Python + GOWA) di PC tiap outlet + Supabase. Gratis, tanpa VPS.
Aturan: kerjakan phase berurutan. Kotak ⏳ = menunggu data/aksi dari pemilik, dikerjakan begitu tersedia.

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
- [ ] ⏳ Hapus access token Supabase setelah setup (supabase.com/dashboard/account/tokens)
- [ ] ⏳ Scan QR nomor captain pilot
- [ ] ⏳ Kirim 1 foto + teks ke HP tim → masuk

## Phase 2 — Mesin Kirim Python
- [x] `config.py`, `session.py` (login akun outlet sekali, sesi tersimpan; kata sandi salah diminta ulang)
- [x] `gowa.py` (jalankan GOWA, status, QR, logout, kirim teks/gambar, error non-JSON ditangani)
- [x] `worker.py`: detak, commands, sinkron QR, claim → kirim → complete, pemulihan pesan tersangkut
- [x] Jeda acak, batas harian, jam kirim dibaca dari tabel `outlets` (di DB, tanpa `sleep`)
- [x] Webhook lokal "STOP" dengan verifikasi HMAC
- [x] 11 test (3 unit + 8 integrasi ke Supabase lokal + GOWA asli) lolos; ruff, mypy, pyright, vulture bersih
- [ ] ⏳ Tes kirim sungguhan ke 3 nomor tim (butuh WA tersambung)

## Phase 3 — Dashboard (bahasa sederhana)
- [x] Halaman Masuk
- [x] Tab WhatsApp: status PC, status WA, QR + langkah scan, tombol Ganti nomor
- [x] Tab Kontak: upload Excel/CSV, ringkasan masuk/salah/dobel, cari, hapus
- [x] Tab Promo: foto + pesan + `{nama}`, NYALAKAN/MATIKAN, progres, daftar gagal
- [x] Tab Pengaturan: batas harian, jeda, jam kirim
- [x] 17 test; biome, tsc, knip bersih; build produksi 72 KB gzip
- [x] Uji klik di browser (Playwright, lebar HP 390px): login salah/benar, QR asli tampil, upload Excel, cari nama & nomor, hapus, buat promo, NYALAKAN, MATIKAN, konflik versi (pesan jelas), validasi pengaturan, PC mati terdeteksi, keluar
- [x] Kontras WCAG AA semua teks, tombol ≥ 44px, keyboard + fokus terlihat, tanpa scroll samping
- [ ] ⏳ Arah desain (`DESIGN.md`: warna/brand/logo). Sekarang berstatus "draft tanpa arah desain"
- [ ] ⏳ Pilih hosting (Vercel Hobby / Netlify / Cloudflare Pages) lalu deploy

## Phase 4 — Bungkus jadi `WABlast.exe`
- [x] `build.bat` → PyInstaller one-file, GOWA di dalamnya, tanpa jendela konsol (39 MB)
- [x] Autostart Windows lewat `WABlast.exe --autostart` (sekali saat instalasi)
- [x] Exe hasil build dijalankan ke Supabase lokal: login tersimpan, QR terbit, detak jalan, berhenti bersih tanpa proses tertinggal
- [ ] ⏳ Tes di PC outlet: install → login → QR di web → scan → restart PC → tetap tersambung

## Phase 4c — Login Username + Akun Supervisor
- [x] Login pakai nama pengguna (`sunset` jadi `sunset@wablast.local`) di dashboard dan exe
- [x] Migration `20261027020000_supervisors.sql`: tabel `supervisors`, `owns_outlet()` mengizinkan supervisor; kirim pesan tetap hanya akun outlet
- [x] Dashboard: pilihan outlet untuk supervisor; exe memilih outlet milik akunnya sendiri
- [x] Test: agent 22, web 19; uji klik pilihan outlet (lokal) dan login online
- [x] Panduan akun + ganti kata sandi di `docs/guides/pengaturan-backend.md`
- [x] Build ulang `WABlast.exe` (login username); `agent/dist/wablast.env` sudah berisi URL + publishable key online

## Phase 4b — Pengaman Risiko Blokir (bisa diatur per outlet di dashboard dan backend)
- [x] Migration `supabase/migrations/20261027010000_risk_controls.sql` (kolom pengaturan di `outlets`, default aman)
- [x] Pemanasan nomor baru: batas harian naik tiap hari sejak nomor tersambung (`effective_daily_limit`, `mark_number_linked`)
- [x] Cek nomor punya WhatsApp sebelum kirim (GOWA `/user/check`); nomor tanpa WA dilewati selamanya
- [x] Berhenti otomatis setelah N gagal berturut-turut, dan saat WhatsApp terputus; peringatan kuning di dashboard
- [x] Batas 1 promo per pelanggan per N hari
- [x] Kalimat berhenti langganan otomatis di akhir pesan + kata STOP diatur dari database
- [x] Tab Pengaturan: bagian "Pengaman nomor"; tab Promo: contoh pesan persis seperti yang diterima pelanggan; tab Kontak: penanda "Tidak punya WhatsApp"
- [x] Test: agent 20 (termasuk 9 test baru ke Supabase lokal + GOWA asli), web 18; uji klik browser + lebar HP 375px
- [x] Bug ketemu & diperbaiki: zona waktu `Asia/Jakarta` tidak ada di Windows (tanggal sekarang dihitung di database); scrollbar tab; tab "Pengaturan" terpotong di HP
- [x] Exe dibuild ulang dan dites ke Supabase lokal
- [x] Panduan: [docs/guides/panduan-captain.md](docs/guides/panduan-captain.md), [docs/guides/pengaturan-backend.md](docs/guides/pengaturan-backend.md)

## Phase 5 — Pilot 1 Outlet
- [ ] ⏳ Install exe di PC outlet pilot
- [ ] ⏳ Import Excel asli
- [ ] ⏳ Kirim batch kecil dulu (30-50 kontak), pantau 2-3 hari
- [ ] ⏳ Naikkan batas harian bertahap kalau aman
- [ ] ⏳ Catat hasil ke `MEMORY.md`

## Phase 6 — Quality Gates 1..10
- [x] Perbaiki bug `.agents/`: runner memecah `(cd A && x) && (cd B && y)` per folder; probe Gate 8 pakai `python`; vulture tidak memindai `.venv` (8 test regresi di `.agents/tests/test_while_loop_runner.py`)
- [x] `python .agents/scripts/while_loop_runner.py --run --report` → 10/10 lolos berturut-turut
- [ ] Pasang `trivy` untuk scan dependency (belum terpasang di laptop)

## Phase 7 — Rollout 5 Outlet Lain
- [ ] Buat akun + baris `outlets` untuk 5 outlet
- [ ] Install exe di tiap PC (`WABlast.exe --autostart`), scan QR dari dashboard
- [x] Panduan 1 halaman untuk captain
- [ ] Bagikan panduan + link dashboard ke 5 captain

## Batasan yang diketahui
- Kalau `WABlast.exe` ditutup paksa lewat Task Manager, proses GOWA di dalamnya bisa tertinggal dan menahan port 3100. Restart PC menyelesaikannya.
- Risiko blokir WhatsApp tidak bisa nol (nomor biasa + gateway tidak resmi).
