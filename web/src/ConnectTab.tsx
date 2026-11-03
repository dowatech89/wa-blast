import { type FormEvent, useEffect, useState } from "react";
import { db, isPcOnline, type Outlet, QR_BUCKET } from "./supabase";
import { toast } from "./toast";

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
    const linked = outlet.wa_status === "connected" && outlet.wa_number;
    return (
      <section className="card stack">
        <div className="card-head">
          <h2>Status WhatsApp</h2>
          <p>PC outlet sedang mati, jadi status di bawah adalah keadaan terakhir sebelum PC mati.</p>
        </div>
        <ul className="checks">
          <li>
            PC outlet <b className="no">Mati</b>
          </li>
          <li>
            WhatsApp{" "}
            <b className={linked ? "yes" : "no"}>{linked ? `Tersambung, +${outlet.wa_number}` : "Belum tersambung"}</b>
          </li>
        </ul>
        <p className="hint">
          {linked
            ? "Nyalakan PC outlet. WA Blast jalan sendiri dan langsung memakai nomor ini, tidak perlu scan ulang."
            : "Nyalakan PC outlet. WA Blast jalan sendiri, lalu kode QR untuk menyambungkan muncul di sini."}
        </p>
      </section>
    );
  }

  if (outlet.wa_status === "connected") {
    return (
      <div className="stack-lg">
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
        <SenderName outlet={outlet} />
      </div>
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

const PUSH_NAME_MAX = 25; // WhatsApp's limit, same as agent/wablast/worker.py

/** The "~Name" people see when they have not saved the number. The PC applies it through GOWA. */
function SenderName({ outlet }: { outlet: Outlet }) {
  const wanted = (outlet.sender_name || outlet.name).slice(0, PUSH_NAME_MAX);
  const [name, setName] = useState(wanted);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const migrated = outlet.sender_name_applied !== undefined;
  const applied = outlet.sender_name_applied === wanted;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const trimmed = name.trim();
    // Empty or the outlet name itself = follow the outlet name.
    const value = trimmed && trimmed !== outlet.name ? trimmed : null;
    const { error } = await db.from("outlets").update({ sender_name: value }).eq("id", outlet.id);
    setBusy(false);
    if (error) setMessage({ ok: false, text: "Gagal menyimpan. Coba lagi." });
    else {
      setMessage(null);
      toast("Nama tersimpan. PC outlet memasangnya dalam beberapa detik.");
    }
  }

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>Nama pengirim</h2>
        <p>Nama yang dilihat pelanggan yang belum menyimpan nomor ini, misalnya +62 812... ~{wanted}.</p>
      </div>
      {migrated ? (
        <form onSubmit={save} className="stack">
          <label>
            Nama di WhatsApp
            <input required maxLength={PUSH_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="hint">
            {applied ? "Sudah terpasang di WhatsApp." : "Menunggu PC outlet memasangnya..."} Logo dan foto profil tetap
            diatur dari HP: Setelan, Privasi, Foto profil, pilih Semua orang.
          </p>
          {message && (
            <p className={message.ok ? "ok" : "error"} role="status">
              {message.text}
            </p>
          )}
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            {busy ? "Menyimpan..." : "Simpan nama"}
          </button>
        </form>
      ) : (
        <p className="hint">Fitur ini aktif setelah admin menjalankan pembaruan database (sender_name).</p>
      )}
    </section>
  );
}
