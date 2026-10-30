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
   [go-whatsapp-web-multidevice v9.8.0](https://github.com/aldinokemal/go-whatsapp-web-multidevice/releases/tag/v9.8.0),
   ganti nama `windows-amd64.exe` jadi `gowa.exe` di `tools/gowa/` (SHA-256 `3f428c9b51d59fa10e4bfdf39a6e178d0f5e722b34abf74b76fcece1768c0e5e`),
   salin `agent\wablast.env.example` ke `agent\wablast.env` (isi URL + publishable key), lalu jalankan `agent\build.bat`.
   Hasilnya 1 file `agent\dist\WABlast.exe` yang sudah berisi GOWA dan alamat Supabase.

Risiko blokir WhatsApp tidak bisa nol: kirim hanya ke pelanggan yang memberikan nomornya.
