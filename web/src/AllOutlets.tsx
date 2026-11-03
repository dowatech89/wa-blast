import { useCallback, useState } from "react";
import { usePoll } from "./App";
import { initials } from "./initials";
import { db, isPcOnline, type Outlet } from "./supabase";

type Summary = { outlet_id: string; sent_today: number; today_limit: number; running_promos: number };

/** Supervisor landing page: every outlet at a glance, problems first. Tapping a card opens that outlet. */
export function AllOutlets({ outlets, onOpen }: { outlets: Outlet[]; onOpen: (id: string) => void }) {
  const [summary, setSummary] = useState<Record<string, Summary>>({});

  const load = useCallback(async () => {
    const { data, error } = await db.rpc("outlet_overview");
    if (!error) setSummary(Object.fromEntries((data as Summary[]).map((r) => [r.outlet_id, r])));
  }, []);
  usePoll(load, 15000);

  const ready = (o: Outlet) => isPcOnline(o) && o.wa_status === "connected" && !o.pause_reason;
  // Stable order: outlets that need attention on top, then by name (the list arrives sorted by name).
  const sorted = [...outlets].sort((a, b) => Number(ready(a)) - Number(ready(b)));
  const readyCount = outlets.filter(ready).length;

  return (
    <section className="stack" aria-label="Semua outlet">
      <p className="hint">
        <b>{readyCount}</b> dari {outlets.length} outlet siap kirim. Ketuk outlet untuk melihat promo dan kontaknya.
      </p>
      <ul className="outlet-grid">
        {sorted.map((o) => {
          const s = summary[o.id];
          const pcOn = isPcOnline(o);
          const waOn = o.wa_status === "connected";
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`tile outlet-card ${ready(o) ? "ready" : "blocked"}`}
                onClick={() => onOpen(o.id)}
              >
                <span className="outlet-card-head">
                  <span className="avatar" aria-hidden="true">
                    {initials(o.name)}
                  </span>
                  <span className="outlet-card-name">{o.name}</span>
                  <span className="open-arrow" aria-hidden="true">
                    →
                  </span>
                </span>
                <span className="pills">
                  <span className={`pill ${pcOn ? "on" : "off"}`}>PC {pcOn ? "menyala" : "mati"}</span>
                  <span className={`pill ${waOn ? "on" : "off"}`}>
                    WhatsApp {waOn ? "tersambung" : "belum tersambung"}
                  </span>
                </span>
                <span className="outlet-card-stats">
                  <span>
                    <span className="metric">
                      {s?.sent_today ?? "–"}
                      <small> / {s?.today_limit ?? o.daily_limit}</small>
                    </span>
                    <span className="tile-label">terkirim hari ini</span>
                  </span>
                  <span>
                    <span className="metric">{s?.running_promos ?? "–"}</span>
                    <span className="tile-label">promo berjalan</span>
                  </span>
                </span>
                {o.pause_reason && <span className="warn">{o.pause_reason}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
