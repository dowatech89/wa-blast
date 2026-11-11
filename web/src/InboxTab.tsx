import { useCallback, useState } from "react";
import { usePoll } from "./App";
import { Icon } from "./icons";
import { initials } from "./initials";
import { db, type InboundMessage, type Outlet } from "./supabase";
import { toast } from "./toast";

export function InboxTab({ outlet }: { outlet: Outlet }) {
  const [messages, setMessages] = useState<InboundMessage[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    let query = db
      .from("inbound_messages")
      .select("id, outlet_id, phone, sender_name, message, received_at")
      .eq("outlet_id", outlet.id)
      .order("received_at", { ascending: false })
      .limit(80);

    const term = search.trim();
    if (term) {
      const clean = term.replaceAll(/[%,()*.]/g, "");
      const digits = term.replace(/\D/g, "").replace(/^0/, "");
      query = query.or(
        digits
          ? `sender_name.ilike.%${clean}%,phone.ilike.%${digits}%,message.ilike.%${clean}%`
          : `sender_name.ilike.%${clean}%,message.ilike.%${clean}%`
      );
    }

    const { data, error: err } = await query;
    if (err) {
      setError("Gagal memuat pesan balasan. Periksa koneksi internet.");
      return;
    }
    setError(null);
    setMessages(data as InboundMessage[]);
  }, [outlet.id, search]);

  usePoll(load, 3500);

  async function deleteMessage(id: string) {
    if (!confirm("Hapus catatan pesan balasan ini?")) return;
    setDeletingId(id);
    const { error: err } = await db.from("inbound_messages").delete().eq("id", id);
    setDeletingId(null);
    if (err) {
      toast("Gagal menghapus pesan balasan.");
    } else {
      toast("Pesan balasan dihapus.");
      setMessages((prev) => (prev ? prev.filter((m) => m.id !== id) : null));
    }
  }

  function formatTime(iso: string) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const isToday =
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();

      const timeStr = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      if (isToday) {
        return `Hari ini, ${timeStr} WIB`;
      }
      return `${d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}, ${timeStr} WIB`;
    } catch {
      return iso;
    }
  }

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="card-head">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2>Kotak Masuk (Respon Chat)</h2>
              <p>Pesan dan balasan dari pelanggan atau teman yang masuk ke nomor WhatsApp outlet.</p>
            </div>
            {messages && (
              <span className="pill" style={{ background: "rgba(18, 140, 126, 0.1)", color: "var(--brand-ink)" }}>
                {messages.length} pesan
              </span>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: "8px", alignItems: "center" }}>
          <div className="search-wrap" style={{ flex: 1, position: "relative" }}>
            <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}>
              <Icon name="cari" />
            </span>
            <input
              type="search"
              placeholder="Cari nama, nomor WhatsApp, atau kata dalam pesan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", paddingLeft: "36px" }}
            />
          </div>
          {search && (
            <button type="button" className="secondary" onClick={() => setSearch("")}>
              Reset
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {messages === null && !error && (
          <p className="muted" style={{ padding: "20px 0", textAlign: "center" }}>
            Memuat pesan balasan...
          </p>
        )}

        {messages?.length === 0 && (
          <div className="empty" style={{ textAlign: "center", padding: "40px 20px" }}>
            <p style={{ fontSize: "2rem", marginBottom: "8px" }}>💬</p>
            <h3>Belum ada pesan balasan masuk</h3>
            <p className="muted" style={{ maxWidth: "460px", margin: "8px auto" }}>
              Setiap kali ada penerima promo atau teman yang membalas WhatsApp ke nomor ini, pesan mereka akan otomatis
              terdeteksi dan muncul di sini secara real-time.
            </p>
          </div>
        )}

        {messages && messages.length > 0 && (
          <div className="stack-sm" style={{ marginTop: "12px" }}>
            {messages.map((m) => {
              const displayName = m.sender_name || "Tanpa Nama";
              const cleanDigits = m.phone.replace(/\D/g, "");
              const waLink = `https://wa.me/${cleanDigits}`;

              return (
                <article
                  key={m.id}
                  className="card"
                  style={{
                    padding: "16px",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    background: "var(--card-bg, #ffffff)",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="row" style={{ gap: "10px", alignItems: "center" }}>
                      <span className="avatar" aria-hidden="true" style={{ width: "36px", height: "36px", fontSize: "0.85rem" }}>
                        {initials(displayName)}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{displayName}</div>
                        <div className="muted" style={{ fontSize: "0.85rem" }}>
                          +{m.phone}
                        </div>
                      </div>
                    </div>
                    <span className="hint" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {formatTime(m.received_at)}
                    </span>
                  </div>

                  <div
                    style={{
                      background: "rgba(18, 140, 126, 0.06)",
                      borderLeft: "3px solid var(--brand)",
                      padding: "10px 14px",
                      borderRadius: "0 8px 8px 0",
                      fontSize: "0.95rem",
                      lineHeight: "1.5",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.message}
                  </div>

                  <div className="row" style={{ justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="primary"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.85rem",
                        padding: "6px 14px",
                        borderRadius: "6px",
                        textDecoration: "none",
                        color: "#ffffff",
                      }}
                    >
                      <Icon name="wa" /> Balas di WhatsApp
                    </a>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => deleteMessage(m.id)}
                      disabled={deletingId === m.id}
                      style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                      title="Hapus riwayat balasan ini"
                    >
                      {deletingId === m.id ? "Menghapus..." : "Hapus"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
