import { useEffect, useState } from "react";
import { db, isPcOnline, type Outlet, QR_BUCKET } from "./supabase";

export function ConnectTab({ outlet }: { outlet: Outlet }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pcOn = isPcOnline(outlet);

  // The agent overwrites the same file with each new QR, so fetch a fresh signed URL on every poll.
  useEffect(() => {
    if (outlet.wa_status !== "waiting_qr" || !outlet.qr_image_path) return setQrUrl(null);
    db.storage
      .from(QR_BUCKET)
      .createSignedUrl(outlet.qr_image_path, 60)
      .then(({ data, error }) => {
        if (error) setError("Kode QR gagal dimuat. Tunggu sebentar.");
        else setQrUrl(`${data.signedUrl}&v=${outlet.last_seen_at}`);
      });
  }, [outlet.wa_status, outlet.qr_image_path, outlet.last_seen_at]);

  async function changeNumber() {
    if (!confirm("Ganti nomor WhatsApp? Nomor yang sekarang akan dikeluarkan dari WA Blast.")) return;
    setBusy(true);
    const { error } = await db.from("commands").insert({ outlet_id: outlet.id, type: "relogin" });
    setBusy(false);
    setError(error ? "Gagal mengirim perintah. Coba lagi." : null);
  }

  if (!pcOn) {
    return (
      <section className="card stack">
        <h2>PC outlet belum menyala</h2>
        <p>Nyalakan PC outlet. Aplikasi WA Blast di PC akan jalan sendiri, lalu kode QR muncul di sini.</p>
      </section>
    );
  }

  if (outlet.wa_status === "connected") {
    return (
      <section className="card stack">
        <h2>WhatsApp sudah tersambung</h2>
        <p>
          Nomor pengirim: <strong>{outlet.wa_number ? `+${outlet.wa_number}` : "sedang dibaca..."}</strong>
        </p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="secondary" onClick={changeNumber} disabled={busy}>
          Ganti nomor
        </button>
      </section>
    );
  }

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>Sambungkan WhatsApp</h2>
        <p>Cukup sekali. Setelah itu PC boleh dimatikan dan dinyalakan lagi.</p>
      </div>
      <div className="qr-layout">
        {qrUrl ? (
          <img src={qrUrl} alt="Kode QR untuk menyambungkan WhatsApp" className="qr" />
        ) : (
          <p className="muted">Menyiapkan kode QR...</p>
        )}
        <ol className="steps">
          <li>Buka WhatsApp di HP captain.</li>
          <li>
            Ketuk <strong>titik tiga</strong> (Android) atau <strong>Pengaturan</strong> (iPhone), lalu{" "}
            <strong>Perangkat tertaut</strong>.
          </li>
          <li>
            Ketuk <strong>Tautkan perangkat</strong>, lalu arahkan kamera HP ke kode ini.
          </li>
        </ol>
      </div>
      <p className="hint">Kode berganti sendiri setiap 30 detik. Kalau gagal, scan saja kode yang baru.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
