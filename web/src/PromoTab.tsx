import { type FormEvent, useCallback, useEffect, useState } from "react";
import { usePoll } from "./App";
import { composeCaption } from "./caption";
import { initials } from "./initials";
import { type Campaign, db, IMAGE_BUCKET, isConflict, isPcOnline, type Outlet, type Progress } from "./supabase";
import { toast } from "./toast";

const STATUS_TEXT: Record<Campaign["status"], string> = {
  draft: "Belum dikirim",
  running: "Sedang mengirim",
  paused: "Berhenti sementara",
  done: "Selesai",
};

export function isVideo(pathOrUrl: string | null | undefined): boolean {
  if (!pathOrUrl) return false;
  const clean = pathOrUrl.split("?")[0].toLowerCase();
  return (
    clean.endsWith(".mp4") ||
    clean.endsWith(".webm") ||
    clean.endsWith(".mov") ||
    clean.endsWith(".avi") ||
    clean.endsWith(".3gp")
  );
}

export function isPdf(pathOrUrl: string | null | undefined): boolean {
  if (!pathOrUrl) return false;
  const clean = pathOrUrl.split("?")[0].toLowerCase();
  return clean.endsWith(".pdf");
}

export function PromoTab({ outlet }: { outlet: Outlet }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState<string | null>(null);
  const [todayLimit, setTodayLimit] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [c, p, limit] = await Promise.all([
      db.from("campaigns").select("*").eq("outlet_id", outlet.id).order("created_at", { ascending: false }),
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
      <PromoForm outlet={outlet} onDone={load} />
      <section className="stack">
        <div className="section-title">
          <h2>Promo kamu</h2>
          {campaigns && campaigns.length > 0 && <span className="hint">{campaigns.length} promo</span>}
        </div>
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

/** New promo, or edits `campaign` (only while draft or paused; the database refuses otherwise). */
function PromoForm({
  outlet,
  campaign,
  currentImage,
  onDone,
  onCancel,
}: {
  outlet: Outlet;
  campaign?: Campaign;
  currentImage?: string | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(campaign?.title ?? "");
  const [message, setMessage] = useState(campaign?.message ?? "");
  const [openedVersion] = useState(campaign?.version); // polling refreshes `campaign`; compare with what was opened
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
    // ponytail: a replaced photo stays in storage; add cleanup if the bucket ever gets large.
    let image_path = campaign?.image_path ?? null;
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      image_path = `${outlet.id}/${crypto.randomUUID()}.${ext}`;
      const up = await db.storage.from(IMAGE_BUCKET).upload(image_path, file, { contentType: file.type });
      if (up.error) {
        setBusy(false);
        setError("Media promo (foto/video/PDF) gagal diupload. Coba lagi.");
        return;
      }
    }
    const fields = { title: title.trim(), message: message.trim(), image_path };
    if (campaign) {
      // Version check: refuses when the promo was started or edited elsewhere since this form opened.
      const { data, error } = await db
        .from("campaigns")
        .update(fields)
        .eq("id", campaign.id)
        .eq("version", openedVersion)
        .select("id");
      setBusy(false);
      if (error || !data?.length) {
        setError(
          error?.message.includes("draft or paused")
            ? "Promo yang sedang mengirim tidak bisa diubah. Tekan MATIKAN dulu."
            : "Promo ini baru diubah dari HP lain. Tutup, lalu coba lagi.",
        );
        return;
      }
      toast("Perubahan promo tersimpan");
      onDone();
      return;
    }
    const { error } = await db.from("campaigns").insert({ outlet_id: outlet.id, ...fields });
    setBusy(false);
    if (error) {
      setError("Promo gagal disimpan. Coba lagi.");
      return;
    }
    setTitle("");
    setMessage("");
    setFile(null);
    setFormKey((k) => k + 1); // clears the file input
    toast("Promo tersimpan. Tekan NYALAKAN untuk mulai kirim.");
    onDone();
  }

  const form = (
    <form key={formKey} onSubmit={submit} className="promo-editor">
      <div className="stack">
        <label>
          Nama promo <span className="muted">(hanya untuk kamu, tidak ikut dikirim)</span>
          <input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {campaign ? "Ganti media (foto, video, atau PDF)" : "Media promo (foto, video, atau PDF)"}{" "}
          <span className="muted">{campaign ? "(kosongkan kalau media tetap)" : "(boleh dikosongkan)"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Pesan
          <div style={{ display: "flex", gap: "6px", margin: "6px 0", flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary"
              style={{ padding: "3px 10px", fontSize: "0.8rem", borderRadius: "14px" }}
              onClick={() => setMessage((m) => (m ? `${m} {salam}` : "{salam}"))}
              title="Sisipkan ucapan salam waktu otomatis (Selamat Pagi/Siang/Sore/Malam)"
            >
              + {"{salam}"}
            </button>
            <button
              type="button"
              className="secondary"
              style={{ padding: "3px 10px", fontSize: "0.8rem", borderRadius: "14px" }}
              onClick={() => setMessage((m) => (m ? `${m} {nama}` : "{nama}"))}
              title="Sisipkan nama pelanggan"
            >
              + {"{nama}"}
            </button>
            <button
              type="button"
              className="secondary"
              style={{ padding: "3px 10px", fontSize: "0.8rem", borderRadius: "14px" }}
              onClick={() => setMessage((m) => (m ? `${m} {outlet}` : "{outlet}"))}
              title="Sisipkan nama outlet"
            >
              + {"{outlet}"}
            </button>
          </div>
          <textarea required rows={5} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <p className="hint">
          Tulis <code>{"{salam}"}</code> untuk salam otomatis (Selamat Pagi/Siang/Sore), <code>{"{nama}"}</code> untuk nama pelanggan, dan <code>{"{outlet}"}</code> untuk nama outlet. Contoh:
          {"{salam}"} {"{nama}"}, ada promo spesial dari {"{outlet}"} hari ini!
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Menyimpan..." : campaign ? "Simpan perubahan" : "Simpan promo"}
          </button>
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
              Batal
            </button>
          )}
        </div>
      </div>
      <ChatPreview
        sender={outlet.sender_name || outlet.name}
        image={preview ?? currentImage ?? null}
        text={message.trim() ? composeCaption(message, "Budi", outlet.optout_footer, outlet.name) : ""}
        fileType={file?.type}
        filePath={campaign?.image_path}
      />
    </form>
  );

  if (campaign) return form;
  return (
    <section className="card stack">
      <div className="card-head">
        <h2>Buat promo baru</h2>
        <p>Foto dan pesan yang akan dikirim ke semua kontak aktif.</p>
      </div>
      {form}
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
  const [editing, setEditing] = useState(false);

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

  // A sent promo cannot change (customers already have it), so offer a copy that starts as an editable draft.
  async function reuse() {
    setBusy(true);
    const { error } = await db.from("campaigns").insert({
      outlet_id: outlet.id,
      title: `${campaign.title} (salinan)`.slice(0, 80),
      message: campaign.message,
      image_path: campaign.image_path,
    });
    setBusy(false);
    if (error) setError("Gagal menyalin promo. Coba lagi.");
    else {
      toast("Salinan dibuat di atas. Tekan Ubah promo untuk mengganti isinya.");
      onChanged();
    }
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
  const editable = campaign.status === "draft" || campaign.status === "paused";

  if (editing && editable)
    return (
      <article className="card stack">
        <div className="card-head">
          <h3>Ubah promo</h3>
          {campaign.status === "paused" && (
            <p>Perubahan berlaku untuk pelanggan yang belum dikirimi. Yang sudah menerima tidak berubah.</p>
          )}
        </div>
        <PromoForm
          outlet={outlet}
          campaign={campaign}
          currentImage={imageUrl}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
        />
      </article>
    );
  const pcOn = isPcOnline(outlet);
  const percent = p && p.total > 0 ? Math.round(((p.sent + p.failed + p.skipped) / p.total) * 100) : 0;

  return (
    <article className="card promo">
      <div className="promo-body">
        {imageUrl && (
          isVideo(campaign.image_path) ? (
            <span
              className="thumb"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#1b2120",
                color: "#ffffff",
                fontSize: "1.5rem",
              }}
              title="Media Video Promo"
            >
              ▶
            </span>
          ) : isPdf(campaign.image_path) ? (
            <span
              className="thumb"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--brand-soft)",
                color: "var(--brand-ink)",
                fontSize: "1.8rem",
              }}
              title="Media PDF Promo"
            >
              📄
            </span>
          ) : (
            <img src={imageUrl} alt="" className="thumb" />
          )
        )}
        <div className="stack-sm">
          <h3>{campaign.title}</h3>
          <span className={`pill ${campaign.status}`}>{STATUS_TEXT[campaign.status]}</span>
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
          <p className="promo-stats">
            <span>
              <b>{p.sent}</b> terkirim
            </span>
            <span>
              <b>{p.waiting}</b> menunggu
            </span>
            {p.failed > 0 && (
              <span>
                <b>{p.failed}</b> gagal
              </span>
            )}
            {p.skipped > 0 && (
              <span>
                <b>{p.skipped}</b> dilewati
              </span>
            )}
            <span>dari {p.total} kontak</span>
          </p>
        </div>
      )}

      {running && !pcOn && <p className="warn">PC outlet mati, jadi pesan belum terkirim. Nyalakan PC outlet.</p>}
      {running && pcOn && outlet.wa_status !== "connected" && (
        <p className="warn">WhatsApp belum tersambung. Buka menu WhatsApp dan scan kode QR.</p>
      )}
      {running && (
        <p className="hint">
          Pesan dikirim pelan-pelan dengan jeda acak 30 sampai 90 detik, jam {outlet.send_start.slice(0, 5)} sampai{" "}
          {outlet.send_end.slice(0, 5)}, maksimal {todayLimit ?? outlet.daily_limit} pesan hari ini.
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
        {editable && (
          <button type="button" className="secondary" onClick={() => setEditing(true)} disabled={busy}>
            Ubah promo
          </button>
        )}
        {campaign.status === "done" && (
          <button type="button" className="secondary" onClick={reuse} disabled={busy}>
            Pakai lagi (salin & ubah)
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

/** What a customer named Budi sees, in a phone frame: the outlet's profile name on top, then the photo and caption
 *  in an outgoing bubble. Always shown, so the captain sees the result while typing. */
export function ChatPreview({
  sender,
  image,
  text,
  fileType,
  filePath,
}: {
  sender: string;
  image: string | null;
  text: string;
  fileType?: string;
  filePath?: string | null;
}) {
  const isVideoMedia = fileType?.startsWith("video/") || isVideo(filePath) || isVideo(image);
  const isPdfMedia = fileType === "application/pdf" || isPdf(filePath) || isPdf(image);

  return (
    <figure className="chat phone">
      <figcaption className="chat-head">
        <span className="avatar" aria-hidden="true">
          {initials(sender)}
        </span>
        <span>
          <b>~{sender}</b>
          <small>Contoh yang diterima pelanggan bernama Budi</small>
        </span>
      </figcaption>
      <div className="chat-body">
        <div className="chat-bubble">
          {image && (
            isVideoMedia ? (
              <video
                src={image}
                controls
                playsInline
                style={{ width: "100%", maxHeight: "240px", borderRadius: "12px", background: "#000", display: "block" }}
              />
            ) : isPdfMedia ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 14px",
                  background: "var(--surface-2)",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  marginBottom: "8px",
                }}
              >
                <span style={{ fontSize: "1.8rem" }}>📄</span>
                <div>
                  <strong>Dokumen PDF Menu</strong>
                  <p className="hint" style={{ margin: 0, fontSize: "0.8rem" }}>PDF siap terkirim</p>
                </div>
              </div>
            ) : (
              <img src={image} alt="Foto promo yang dipilih" />
            )
          )}
          {text ? (
            <p>{text}</p>
          ) : (
            <p className="chat-placeholder">Tulis pesan di form, contohnya langsung muncul di sini.</p>
          )}
          <span className="chat-time" aria-hidden="true">
            10.30 ✓✓
          </span>
        </div>
      </div>
    </figure>
  );
}
