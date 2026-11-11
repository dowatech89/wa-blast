import { useCallback, useState } from "react";
import { usePoll } from "./App";
import { type ParseResult, parseContactRows } from "./contacts";
import { Icon } from "./icons";
import { initials } from "./initials";
import { db, type Outlet } from "./supabase";
import { toast } from "./toast";

const SAVE_BATCH = 500;

type MessageRecord = { id: string; status: string; sent_at: string | null };
type Row = {
  id: string;
  phone: string;
  name: string | null;
  opted_out: boolean;
  not_on_whatsapp: boolean;
  last_replied_at?: string | null;
  last_reply_text?: string | null;
  messages?: MessageRecord[];
};
type ContactFilter = "all" | "chatted" | "replied" | "not_chatted" | "stopped";

export function ContactsTab({ outlet, isSupervisor }: { outlet: Outlet; isSupervisor: boolean }) {
  const [counts, setCounts] = useState<{ total: number; stopped: number; noWa: number; chatted: number; replied: number } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [limitCount, setLimitCount] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const term = search.trim();
    const isChatted = filter === "chatted";
    let list = db
      .from("contacts")
      .select(
        isChatted
          ? "id, phone, name, opted_out, not_on_whatsapp, last_replied_at, last_reply_text, messages!inner(id, status, sent_at)"
          : "id, phone, name, opted_out, not_on_whatsapp, last_replied_at, last_reply_text, messages(id, status, sent_at)"
      )
      .eq("outlet_id", outlet.id)
      .order("created_at")
      .limit(limitCount);

    if (isChatted) {
      list = list.eq("messages.status", "sent");
    } else if (filter === "replied") {
      list = list.not("last_replied_at", "is", null);
    } else if (filter === "stopped") {
      list = list.eq("opted_out", true);
    }

    if (term) {
      // Strip characters that would break the PostgREST or() syntax; only search phone when digits were typed.
      const name = term.replaceAll(/[%,()*.]/g, "");
      const digits = term.replace(/\D/g, "").replace(/^0/, "");
      list = list.or(digits ? `name.ilike.%${name}%,phone.ilike.%${digits}%` : `name.ilike.%${name}%`);
    }

    const [all, stopped, noWa, chatted, replied, page] = await Promise.all([
      db.from("contacts").select("id", { count: "exact", head: true }).eq("outlet_id", outlet.id),
      db.from("contacts").select("id", { count: "exact", head: true }).eq("outlet_id", outlet.id).eq("opted_out", true),
      db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("outlet_id", outlet.id)
        .eq("not_on_whatsapp", true),
      db
        .from("contacts")
        .select("id, messages!inner(status)", { count: "exact", head: true })
        .eq("outlet_id", outlet.id)
        .eq("messages.status", "sent"),
      db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("outlet_id", outlet.id)
        .not("last_replied_at", "is", null),
      list,
    ]);

    if (all.error || stopped.error || noWa.error || page.error) {
      setError("Gagal memuat kontak. Cek internet kamu.");
      return;
    }
    setError(null);
    setCounts({
      total: all.count ?? 0,
      stopped: stopped.count ?? 0,
      noWa: noWa.count ?? 0,
      chatted: chatted.count ?? 0,
      replied: replied.count ?? 0,
    });
    setRows(page.data as Row[]);
  }, [search, outlet.id, filter, limitCount]);
  usePoll(load, 15000);

  async function remove(row: Row) {
    if (!confirm(`Hapus ${row.name || row.phone} dari daftar kontak?`)) return;
    const { error } = await db.from("contacts").delete().eq("id", row.id);
    if (error) setError("Kontak gagal dihapus. Coba lagi.");
    load();
  }

  async function allowAgain(row: Row) {
    if (
      !confirm(
        `${row.name || row.phone} pernah membalas STOP. Kirim promo ke nomor ini lagi?

` +
          "Lakukan hanya kalau pelanggan sudah setuju. Pelanggan yang dikirimi tanpa setuju bisa melaporkan nomor outlet sebagai spam.",
      )
    )
      return;
    const { error } = await db.rpc("allow_contact_again", { p_contact_id: row.id });
    if (error) setError("Gagal mengizinkan kirim lagi. Coba lagi.");
    load();
  }

  async function exportChattedExcel() {
    const { data, error } = await db
      .from("contacts")
      .select("phone, name, messages!inner(status, sent_at)")
      .eq("outlet_id", outlet.id)
      .eq("messages.status", "sent");
    if (error || !data || data.length === 0) {
      toast("Belum ada nomor yang sudah di-chat.");
      return;
    }
    const { utils, writeFile } = await import("xlsx");
    const dataRows = [
      ["Nama", "Nomor WhatsApp", "Tanggal Kirim Terakhir", "Status"],
      ...data.map((c) => {
        const msgs = (c.messages as MessageRecord[]) || [];
        const latest = msgs
          .filter((m) => m.status === "sent")
          .sort((a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime())[0];
        return [
          c.name || "-",
          "+" + c.phone,
          latest?.sent_at ? new Date(latest.sent_at).toLocaleString("id-ID") : "-",
          "Sudah Di-chat",
        ];
      }),
    ];
    const sheet = utils.aoa_to_sheet(dataRows);
    sheet["!cols"] = [{ wch: 25 }, { wch: 20 }, { wch: 24 }, { wch: 15 }];
    const book = utils.book_new();
    utils.book_append_sheet(book, sheet, "Sudah Di-chat");
    writeFile(book, `nomor-sudah-dichat-${outlet.name.toLowerCase().replace(/\s+/g, "-")}.xlsx`);
    toast("File Excel berhasil diunduh.");
  }

  async function copyChattedNumbers() {
    const { data, error } = await db
      .from("contacts")
      .select("phone, name, messages!inner(status)")
      .eq("outlet_id", outlet.id)
      .eq("messages.status", "sent");
    if (error || !data || data.length === 0) {
      toast("Belum ada nomor yang sudah di-chat.");
      return;
    }
    const text = data.map((c) => `+${c.phone}${c.name ? ` (${c.name})` : ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast(`${data.length} nomor berhasil disalin ke clipboard!`);
  }

  return (
    <div className="stack-lg">
      <Upload outlet={outlet} onSaved={load} />
      <section className="stack">
        <div className="section-title">
          <h2>Daftar kontak</h2>
          {counts && <span className="hint">{counts.total} kontak</span>}
        </div>
        {counts && counts.stopped + counts.noWa > 0 && (
          <p className="hint">
            {counts.stopped > 0 && <>{counts.stopped} sudah minta berhenti. </>}
            {counts.noWa > 0 && <>{counts.noWa} tidak punya WhatsApp. </>}
            Mereka tidak akan dikirimi promo.
          </p>
        )}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
          <button
            type="button"
            className={filter === "all" ? "primary" : "secondary"}
            style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
            onClick={() => setFilter("all")}
          >
            Semua ({counts?.total ?? rows?.length ?? 0})
          </button>
          <button
            type="button"
            className={filter === "chatted" ? "primary" : "secondary"}
            style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
            onClick={() => setFilter("chatted")}
          >
            ✓ Sudah Di-chat ({counts?.chatted ?? (rows || []).filter((r) => r.messages?.some((m) => m.status === "sent")).length})
          </button>
          <button
            type="button"
            className={filter === "replied" ? "primary" : "secondary"}
            style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
            onClick={() => setFilter("replied")}
          >
            💬 Sudah Membalas ({counts?.replied ?? (rows || []).filter((r) => r.last_replied_at).length})
          </button>
          <button
            type="button"
            className={filter === "not_chatted" ? "primary" : "secondary"}
            style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
            onClick={() => setFilter("not_chatted")}
          >
            Belum Di-chat ({counts ? Math.max(0, counts.total - counts.chatted - counts.stopped - counts.noWa) : (rows || []).filter((r) => !r.messages?.some((m) => m.status === "sent") && !r.opted_out).length})
          </button>
          {counts && counts.stopped > 0 && (
            <button
              type="button"
              className={filter === "stopped" ? "primary" : "secondary"}
              style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
              onClick={() => setFilter("stopped")}
            >
              Minta Berhenti ({counts.stopped})
            </button>
          )}

          {counts && counts.chatted > 0 && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary"
                style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
                onClick={exportChattedExcel}
                title="Unduh daftar nomor yang sudah di-chat ke Excel"
              >
                Unduh Excel ({counts.chatted})
              </button>
              <button
                type="button"
                className="secondary"
                style={{ minHeight: "36px", padding: "4px 12px", fontSize: "0.85rem" }}
                onClick={copyChattedNumbers}
                title="Salin semua nomor yang sudah di-chat ke clipboard"
              >
                Salin Nomor
              </button>
            </div>
          )}
        </div>
        <label>
          Cari nama atau nomor
          <span className="search">
            <Icon name="cari" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        {rows === null && !error && <p className="muted">Memuat kontak...</p>}
        {rows?.length === 0 && (
          <p className="empty">
            {search ? "Tidak ada kontak yang cocok." : "Belum ada kontak. Upload file Excel di atas."}
          </p>
        )}
        {rows && rows.length > 0 && (
          <ul className="list">
            {rows
            .filter((r) => {
              const isChatted = r.messages && r.messages.some((m) => m.status === "sent");
              if (filter === "chatted") return isChatted;
              if (filter === "replied") return !!r.last_replied_at;
              if (filter === "not_chatted") return !isChatted && !r.opted_out && !r.not_on_whatsapp;
              if (filter === "stopped") return r.opted_out;
              return true;
            })
            .map((r) => (
              <li key={r.id}>
                <span className="person">
                  <span className="avatar" aria-hidden="true">
                    {initials(r.name)}
                  </span>
                  <span>
                    {r.name || "Tanpa nama"} <span className="muted">{r.phone}</span>
                    {r.opted_out && <span className="badge done">Minta berhenti</span>}
                    {r.not_on_whatsapp && <span className="badge done">Tidak punya WhatsApp</span>}
                    {r.last_replied_at && (
                      <span
                        className="badge ok"
                        style={{
                          background: "rgba(18, 140, 126, 0.15)",
                          color: "var(--brand-ink)",
                          fontWeight: 600,
                          borderColor: "transparent",
                        }}
                        title={r.last_reply_text ? `Isi: ${r.last_reply_text}` : undefined}
                      >
                        💬 Membalas{r.last_reply_text ? `: "${r.last_reply_text.slice(0, 24)}${r.last_reply_text.length > 24 ? "..." : ""}"` : ""}
                      </span>
                    )}
                    {(() => {
                      const sentMsg = r.messages
                        ?.filter((m) => m.status === "sent")
                        .sort((a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime())[0];
                      if (sentMsg) {
                        const dateStr = sentMsg.sent_at
                          ? new Date(sentMsg.sent_at).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "";
                        return (
                          <span
                            className="badge ok"
                            style={{
                              background: "var(--brand-soft)",
                              color: "var(--brand-ink)",
                              borderColor: "transparent",
                            }}
                          >
                            ✓ Sudah di-chat {dateStr ? `(${dateStr})` : ""}
                          </span>
                        );
                      }
                      if (!r.opted_out && !r.not_on_whatsapp) {
                        return <span className="badge muted">Belum di-chat</span>;
                      }
                      return null;
                    })()}
                  </span>
                </span>
                <span className="row-actions">
                  <a
                    href={`https://wa.me/${r.phone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link"
                    style={{ textDecoration: "none" }}
                    title={`Buka chat WhatsApp dengan ${r.name || r.phone}`}
                  >
                    Chat WA
                  </a>
                  {r.opted_out && isSupervisor && (
                    <button type="button" className="link" onClick={() => allowAgain(r)}>
                      Izinkan kirim lagi
                    </button>
                  )}
                  <button type="button" className="link danger-text" onClick={() => remove(r)}>
                    Hapus
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {counts && rows && counts.total > rows.length && !search && (
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setLimitCount((prev) => prev + 100)}
            >
              Muat 100 kontak lagi (menampilkan {rows.length} dari {counts.total})
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

const FAILED_SHOWN = 50;
const TEMPLATE_ROWS = 2000;

async function downloadTemplate() {
  const { utils, writeFile } = await import("xlsx");
  // Examples live in the header, not in a data row a captain could forget to delete and then message.
  const sheet = utils.aoa_to_sheet([["Nama (contoh: Budi)", "Nomor (contoh: 081234567890)"]]);
  // Text-format the number column, or Excel drops the leading 0 and shows 6,28129E+12.
  for (let r = 1; r <= TEMPLATE_ROWS; r++) sheet[utils.encode_cell({ r, c: 1 })] = { t: "s", v: "", z: "@" };
  sheet["!ref"] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: TEMPLATE_ROWS, c: 1 } });
  sheet["!cols"] = [{ wch: 28 }, { wch: 30 }];
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, "Kontak");
  writeFile(book, "template-kontak.xlsx");
}

function Upload({ outlet, onSaved }: { outlet: Outlet; onSaved: () => void }) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [failed, setFailed] = useState<ParseResult["invalid"]>([]); // stays after saving so the captain can fix them
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  async function pick(file: File | undefined) {
    setParsed(null);
    setFailed([]);
    setError(null);
    setDone(null);
    if (!file) return;
    try {
      const { read, utils } = await import("xlsx"); // ~200 KB gzip: only fetched when a file is picked
      const book = read(await file.arrayBuffer());
      const sheet = book.Sheets[book.SheetNames[0]];
      const result = parseContactRows(utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true }));
      setParsed(result);
      setFailed(result.invalid);
    } catch (e) {
      setError(
        e instanceof Error && e.message.startsWith("Kolom")
          ? e.message
          : "File tidak bisa dibaca. Pakai file Excel (.xlsx, .xls) atau .csv.",
      );
    }
  }

  async function save() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    const rows = parsed.contacts.map((c) => ({ ...c, outlet_id: outlet.id }));
    for (let i = 0; i < rows.length; i += SAVE_BATCH) {
      const { error } = await db
        .from("contacts")
        .upsert(rows.slice(i, i + SAVE_BATCH), { onConflict: "outlet_id,phone", ignoreDuplicates: true });
      if (error) {
        setBusy(false);
        setError(`Gagal menyimpan setelah ${i} kontak. Coba upload lagi, kontak yang sudah masuk tidak akan dobel.`);
        onSaved();
        return;
      }
    }
    setBusy(false);
    setDone(`${rows.length} kontak sudah diproses. Nomor yang sudah ada sebelumnya tidak dibuat dobel.`);
    setParsed(null);
    setInputKey((k) => k + 1);
    onSaved();
  }

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>Tambah kontak dari Excel</h2>
      </div>
      <p className="hint">
        Paling gampang: unduh template, isi nama dan nomor, lalu upload di bawah. Nomor boleh ditulis <q>0812...</q>,{" "}
        <q>812...</q>, atau <q>+62 812...</q>, semuanya otomatis jadi +62.
      </p>
      <button type="button" className="secondary" onClick={downloadTemplate}>
        Unduh template Excel
      </button>
      <label>
        Pilih file
        <input key={inputKey} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {parsed && (
        <div className="stack-sm">
          <p>
            <strong>{parsed.contacts.length}</strong> nomor siap disimpan.
          </p>
          {parsed.duplicates > 0 && <p className="muted">{parsed.duplicates} nomor dobel di file dilewati.</p>}
          {parsed.contacts.length > 0 && (
            <button type="button" className="primary" onClick={save} disabled={busy}>
              {busy ? "Menyimpan..." : `Simpan ${parsed.contacts.length} kontak`}
            </button>
          )}
        </div>
      )}
      {done && <p className="ok">{done}</p>}
      {failed.length > 0 && (
        <div className="stack-sm">
          <p className="warn">
            {failed.length} nomor salah dan tidak disimpan. Perbaiki di file, lalu upload lagi (kontak yang sudah masuk
            tidak akan dobel).
          </p>
          <ul className="list">
            {failed.slice(0, FAILED_SHOWN).map((x) => (
              <li key={x.row}>
                <span>
                  Baris {x.row}: {x.name || "Tanpa nama"} <span className="muted">{x.value}</span>
                </span>
              </li>
            ))}
          </ul>
          {failed.length > FAILED_SHOWN && <p className="muted">Dan {failed.length - FAILED_SHOWN} baris lainnya.</p>}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
