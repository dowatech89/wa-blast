import { useCallback, useState } from "react";
import { usePoll } from "./App";
import { type ParseResult, parseContactRows } from "./contacts";
import { db, type Outlet } from "./supabase";

const PAGE = 50;
const SAVE_BATCH = 500;

type Row = { id: string; phone: string; name: string | null; opted_out: boolean; not_on_whatsapp: boolean };

export function ContactsTab({ outlet, isSupervisor }: { outlet: Outlet; isSupervisor: boolean }) {
  const [counts, setCounts] = useState<{ total: number; stopped: number; noWa: number } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const term = search.trim();
    let list = db
      .from("contacts")
      .select("id, phone, name, opted_out, not_on_whatsapp")
      .eq("outlet_id", outlet.id) // a supervisor sees every outlet's rows through RLS
      .order("created_at")
      .limit(PAGE);
    if (term) {
      // Strip characters that would break the PostgREST or() syntax; only search phone when digits were typed.
      const name = term.replaceAll(/[%,()*.]/g, "");
      const digits = term.replace(/\D/g, "").replace(/^0/, "");
      list = list.or(digits ? `name.ilike.%${name}%,phone.ilike.%${digits}%` : `name.ilike.%${name}%`);
    }
    const [all, stopped, noWa, page] = await Promise.all([
      db.from("contacts").select("id", { count: "exact", head: true }).eq("outlet_id", outlet.id),
      db.from("contacts").select("id", { count: "exact", head: true }).eq("outlet_id", outlet.id).eq("opted_out", true),
      db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("outlet_id", outlet.id)
        .eq("not_on_whatsapp", true),
      list,
    ]);
    if (all.error || stopped.error || noWa.error || page.error) {
      setError("Gagal memuat kontak. Cek internet kamu.");
      return;
    }
    setError(null);
    setCounts({ total: all.count ?? 0, stopped: stopped.count ?? 0, noWa: noWa.count ?? 0 });
    setRows(page.data as Row[]);
  }, [search, outlet.id]);
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
        <label>
          Cari nama atau nomor
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            {rows.map((r) => (
              <li key={r.id}>
                <span>
                  {r.name || "Tanpa nama"} <span className="muted">{r.phone}</span>
                  {r.opted_out && <span className="badge done">Minta berhenti</span>}
                  {r.not_on_whatsapp && <span className="badge done">Tidak punya WhatsApp</span>}
                </span>
                <span className="row-actions">
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
          <p className="muted">
            Menampilkan {rows.length} kontak pertama. Pakai kolom cari untuk menemukan kontak lain.
          </p>
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
