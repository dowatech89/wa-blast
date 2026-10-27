import { type FormEvent, useCallback, useEffect, useState } from "react";
import { usePoll } from "./App";
import { composeCaption } from "./caption";
import { type Campaign, db, IMAGE_BUCKET, isConflict, isPcOnline, type Outlet, type Progress } from "./supabase";

const STATUS_TEXT: Record<Campaign["status"], string> = {
  draft: "Belum dikirim",
  running: "Sedang mengirim",
  paused: "Berhenti sementara",
  done: "Selesai",
};

export function PromoTab({ outlet }: { outlet: Outlet }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState<string | null>(null);
  const [todayLimit, setTodayLimit] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [c, p, limit] = await Promise.all([
      db.from("campaigns").select("*").order("created_at", { ascending: false }),
      db.from("campaign_progress").select("*"),
      db.rpc("today_limit", { p_outlet_id: outlet.id }),
    ]);
    if (c.error || p.error || limit.error) {
      setError("Gagal memuat promo. Cek internet kamu.");
      return;
    }
    setError(null);
    setCampaigns(c.data as Campaign[]);
    setTodayLimit(limit.data as number);
    setProgress(Object.fromEntries((p.data as Progress[]).map((row) => [row.campaign_id, row])));
  }, [outlet.id]);
  usePoll(load);

  return (
    <div className="stack-lg">
      <NewPromo outlet={outlet} onCreated={load} />
      <section className="stack">
        <h2>Promo kamu</h2>
        {error && <p className="error">{error}</p>}
        {campaigns === null && !error && <p className="muted">Memuat promo...</p>}
        {campaigns?.length === 0 && <p className="empty">Belum ada promo. Buat promo pertama kamu di atas.</p>}
        {campaigns?.map((c) => (
          <PromoCard
            key={c.id}
            campaign={c}
            progress={progress[c.id]}
            outlet={outlet}
            todayLimit={todayLimit}
            onChanged={load}
          />
        ))}
      </section>
    </div>
  );
}

function NewPromo({ outlet, onCreated }: { outlet: Outlet; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let image_path: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      image_path = `${outlet.id}/${crypto.randomUUID()}.${ext}`;
      const up = await db.storage.from(IMAGE_BUCKET).upload(image_path, file, { contentType: file.type });
      if (up.error) {
        setBusy(false);
        setError("Foto gagal diupload. Coba lagi.");
        return;
      }
    }
    const { error } = await db
      .from("campaigns")
      .insert({ outlet_id: outlet.id, title: title.trim(), message: message.trim(), image_path });
    setBusy(false);
    if (error) {
      setError("Promo gagal disimpan. Coba lagi.");
      return;
    }
    setTitle("");
    setMessage("");
    setFile(null);
    setFormKey((k) => k + 1); // clears the file input
    onCreated();
  }

  return (
    <section className="card stack">
      <h2>Buat promo baru</h2>
      <form key={formKey} onSubmit={submit} className="stack">
        <label>
          Nama promo <span className="muted">(hanya untuk kamu, tidak ikut dikirim)</span>
          <input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Foto promo <span className="muted">(boleh dikosongkan)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {preview && <img src={preview} alt="Foto promo yang dipilih" className="thumb-lg" />}
        <label>
          Pesan
          <textarea required rows={5} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <p className="hint">
          Tulis <code>{"{nama}"}</code> untuk memanggil nama pelanggan. Contoh: Halo {"{nama}"}, ada promo hari ini.
        </p>
        {message.trim() && (
          <div className="hint stack-sm">
            <span>Contoh pesan yang diterima pelanggan bernama Budi:</span>
            <p className="bubble">{composeCaption(message, "Budi", outlet.optout_footer)}</p>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Menyimpan..." : "Simpan promo"}
        </button>
      </form>
    </section>
  );
}

type Failed = { id: string; error: string | null; contacts: { phone: string; name: string | null } | null };

function PromoCard({
  campaign,
  progress,
  outlet,
  todayLimit,
  onChanged,
}: {
  campaign: Campaign;
  progress?: Progress;
  outlet: Outlet;
  todayLimit: number | null;
  onChanged: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed[] | null>(null);

  useEffect(() => {
    if (!campaign.image_path) return;
    db.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(campaign.image_path, 3600)
      .then(({ data }) => setImageUrl(data?.signedUrl ?? null));
  }, [campaign.image_path]);

  async function toggle() {
    const next = campaign.status === "running" ? "paused" : "running";
    setBusy(true);
    setError(null);
    const { error } = await db.rpc("set_campaign_status", {
      p_campaign_id: campaign.id,
      p_status: next,
      p_expected_version: campaign.version,
    });
    setBusy(false);
    if (isConflict(error)) setError("Promo ini baru diubah dari HP lain. Lihat status terbaru, lalu coba lagi.");
    else if (error) setError("Gagal mengubah promo. Coba lagi.");
    onChanged();
  }

  async function showProblems() {
    if (failed) return setFailed(null);
    const { data, error } = await db
      .from("messages")
      .select("id, error, contacts(phone, name)")
      .eq("campaign_id", campaign.id)
      .in("status", ["failed", "skipped"])
      .limit(200);
    if (error) setError("Gagal memuat daftar pesan yang gagal atau dilewati.");
    else setFailed(data as unknown as Failed[]);
  }

  const p = progress;
  const running = campaign.status === "running";
  const pcOn = isPcOnline(outlet);
  const percent = p && p.total > 0 ? Math.round(((p.sent + p.failed + p.skipped) / p.total) * 100) : 0;

  return (
    <article className="card promo">
      <div className="promo-body">
        {imageUrl && <img src={imageUrl} alt="" className="thumb" />}
        <div className="stack-sm">
          <h3>{campaign.title}</h3>
          <p className={`badge ${campaign.status}`}>{STATUS_TEXT[campaign.status]}</p>
          <p className="message-preview">{campaign.message}</p>
        </div>
      </div>

      {p && (
        <div className="stack-sm">
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progres kirim"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p>
            <strong>{p.sent}</strong> terkirim dari {p.total} kontak
            {p.failed > 0 && <>, {p.failed} gagal</>}
            {p.skipped > 0 && <>, {p.skipped} dilewati</>}
          </p>
        </div>
      )}

      {running && !pcOn && <p className="warn">PC outlet mati, jadi pesan belum terkirim. Nyalakan PC outlet.</p>}
      {running && pcOn && outlet.wa_status !== "connected" && (
        <p className="warn">WhatsApp belum tersambung. Buka menu WhatsApp dan scan kode QR.</p>
      )}
      {running && (
        <p className="hint">
          Pesan dikirim pelan-pelan, satu per {outlet.delay_min_sec} sampai {outlet.delay_max_sec} detik, jam{" "}
          {outlet.send_start.slice(0, 5)} sampai {outlet.send_end.slice(0, 5)}, maksimal{" "}
          {todayLimit ?? outlet.daily_limit} pesan hari ini.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        {campaign.status !== "done" && (
          <button type="button" className={running ? "big danger" : "big primary"} onClick={toggle} disabled={busy}>
            {running ? "MATIKAN" : "NYALAKAN"}
          </button>
        )}
        {p && p.failed + p.skipped > 0 && (
          <button type="button" className="secondary" onClick={showProblems} aria-expanded={failed !== null}>
            {failed ? "Tutup daftar" : `Lihat yang gagal atau dilewati (${p.failed + p.skipped})`}
          </button>
        )}
      </div>

      {failed && (
        <ul className="list">
          {failed.map((m) => (
            <li key={m.id}>
              <span>
                {m.contacts?.name || "Tanpa nama"} ({m.contacts?.phone})
              </span>
              <span className="muted">{m.error}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
