# WA Blast

Promo WhatsApp (foto + teks) untuk outlet restoran. Setiap outlet memakai nomor WhatsApp captain-nya sendiri.

- `web/`: dashboard (Vite + React, file statis). Captain login, upload kontak Excel, buat promo, tekan NYALAKAN.
- `agent/`: `WABlast.exe` (Python + GOWA) yang jalan di PC outlet dan mengirim pesan.
- `supabase/migrations/`: database (jalankan berurutan).
- Panduan: [docs/guides/panduan-captain.md](docs/guides/panduan-captain.md), [docs/guides/pengaturan-backend.md](docs/guides/pengaturan-backend.md).

## Setup

1. Salin `.env.example` ke `.env.local`, lalu isi URL dan publishable key Supabase.
2. Dashboard: `cd web && npm ci && npm run build`. Hasilnya di `web/dist`.
3. Exe: unduh rilis Windows dari
   [go-whatsapp-web-multidevice v9.6.0](https://github.com/aldinokemal/go-whatsapp-web-multidevice/releases/tag/v9.6.0),
   taruh `gowa.exe` di `tools/gowa/` (SHA-256 `23e7f8d22ab377174b54b11e13f2f7e6fded56f389c091971aa2976ee7173f4c`),
   lalu jalankan `agent\build.bat`.

Risiko blokir WhatsApp tidak bisa nol: kirim hanya ke pelanggan yang memberikan nomornya.
