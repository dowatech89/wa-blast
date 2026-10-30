import { useCallback, useState } from "react";
import { usePoll } from "./App";
import { type Campaign, db, isPcOnline, type Outlet, type Progress } from "./supabase";

type Counts = {
  sentToday: number;
  todayLimit: number;
  contacts: number;
  running: Campaign | null;
  runningCount: number;
  progress: Progress | null;
};

/** "HH:MM" now in the outlet's timezone; the browser ships IANA data, unlike the exe on Windows. */
function outletClock(timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

/** Bento summary above the tabs: everything here is a real value from Supabase (see DESIGN.md, Layout). */
export function Overview({ outlet }: { outlet: Outlet }) {
  const [counts, setCounts] = useState<Counts | null>(null);

  const load = useCallback(async () => {
    // Midnight on this phone: captains use the dashboard in the outlet's own timezone.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [sent, limit, contacts, running] = await Promise.all([
      db
        .from("messages")
        .select("id, campaigns!inner(outlet_id)", { count: "exact", head: true })
        .eq("campaigns.outlet_id", outlet.id)
        .eq("status", "sent")
        .gte("sent_at", today.toISOString()),
      db.rpc("today_limit", { p_outlet_id: outlet.id }),
      db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("outlet_id", outlet.id)
        .eq("opted_out", false)
        .eq("not_on_whatsapp", false),
      db
        .from("campaigns")
        .select("*", { count: "exact" })
        .eq("outlet_id", outlet.id)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (sent.error || limit.error || contacts.error || running.error) return; // keep the last good values
    const first = (running.data?.[0] as Campaign | undefined) ?? null;
    const progress = first
      ? (await db.from("campaign_progress").select("*").eq("campaign_id", first.id).maybeSingle()).data
      : null;
    setCounts({
      sentToday: sent.count ?? 0,
      todayLimit: (limit.data as number | null) ?? outlet.daily_limit,
      contacts: contacts.count ?? 0,
      running: first,
      runningCount: running.count ?? 0,
      progress: progress as Progress | null,
    });
  }, [outlet.id, outlet.daily_limit]);
  usePoll(load);

  const pcOn = isPcOnline(outlet);
  const waOn = outlet.wa_status === "connected";
  const start = outlet.send_start.slice(0, 5);
  const end = outlet.send_end.slice(0, 5);
  const now = outletClock(outlet.timezone);
  const inHours = now >= start && now < end;
  const ready = pcOn && waOn;

  let verdict: string;
  let fix: { text: string; href?: string } | null = null;
  if (!pcOn) {
    verdict = "Belum bisa kirim: PC outlet mati";
    fix = { text: "Nyalakan PC outlet. WA Blast jalan sendiri dalam 1 menit." };
  } else if (!waOn) {
    verdict = "Belum bisa kirim: WhatsApp belum tersambung";
    fix = { text: "Sambungkan WhatsApp", href: "#wa" };
  } else if (!inHours) {
    verdict = `Siap. Menunggu jam kirim ${start}`;
  } else {
    verdict = "Siap mengirim";
  }

  const p = counts?.progress;
  const done = p ? p.sent + p.failed + p.skipped : 0;
  const percent = p && p.total > 0 ? Math.round((done / p.total) * 100) : 0;

  return (
    <section className="bento" aria-label="Ringkasan">
      <article className={`tile tile-verdict ${ready ? "ready" : "blocked"}`} aria-live="polite">
        <p className="tile-label">Siap kirim?</p>
        <p className="verdict">{verdict}</p>
        <ul className="checks">
          <li>
            PC outlet <b className={pcOn ? "yes" : "no"}>{pcOn ? "Menyala" : "Mati"}</b>
          </li>
          <li>
            WhatsApp{" "}
            <b className={waOn ? "yes" : "no"}>
              {waOn ? (outlet.wa_number ? `+${outlet.wa_number}` : "Tersambung") : "Belum tersambung"}
            </b>
          </li>
          <li>
            Jam kirim{" "}
            <b className={inHours ? "yes" : undefined}>
              {start} - {end}
            </b>
          </li>
        </ul>
        {ready && counts && (
          <p className="hint">
            {counts.running
              ? "Pesan sedang dikirim pelan-pelan, satu per satu. Tidak perlu ditunggu."
              : "Tinggal tekan NYALAKAN di promo yang mau dikirim."}
          </p>
        )}
        {fix &&
          (fix.href ? (
            <a className="tile-link" href={fix.href}>
              {fix.text}
            </a>
          ) : (
            <p className="hint">{fix.text}</p>
          ))}
      </article>

      <article className="tile tile-promo">
        <p className="tile-label">Promo berjalan</p>
        {counts?.running ? (
          <>
            <div className="section-title">
              <h3>{counts.running.title}</h3>
              {counts.runningCount > 1 && <span className="hint">+{counts.runningCount - 1} lainnya</span>}
            </div>
            <div
              className="bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progres promo berjalan"
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="hint">
              {p ? (
                <>
                  <b>{p.sent}</b> terkirim dari {p.total} kontak, {p.waiting} menunggu
                </>
              ) : (
                "Menyiapkan antrean..."
              )}
            </p>
          </>
        ) : (
          <>
            <p>{counts ? "Belum ada promo yang dinyalakan." : "Memuat..."}</p>
            <a className="tile-link" href="#promo">
              Buka menu Promo
            </a>
          </>
        )}
      </article>

      <article className="tile">
        <p className="tile-label">Terkirim hari ini</p>
        <p className="metric">
          {counts?.sentToday ?? "–"}
          <small> / {counts?.todayLimit ?? outlet.daily_limit}</small>
        </p>
        <p className="hint">batas hari ini</p>
      </article>

      <article className="tile">
        <p className="tile-label">Kontak aktif</p>
        <p className="metric">{counts?.contacts ?? "–"}</p>
        <a className="tile-link" href="#kontak">
          Lihat kontak
        </a>
      </article>
    </section>
  );
}
