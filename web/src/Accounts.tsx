import { FunctionsHttpError } from "@supabase/supabase-js";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { db } from "./supabase";

const MIN_PASSWORD = 8; // same as supabase/functions/admin/index.ts

type Account = { user_id: string; username: string };
type Accounts = { outlets: (Account & { id: string; name: string })[]; supervisors: Account[] };
type Message = { ok: boolean; text: string } | null;

// The `admin` Edge Function holds the service-role key; it answers in plain Indonesian on errors.
async function callAdmin(body: Record<string, string>) {
  const { data, error } = await db.functions.invoke("admin", { body });
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.json().catch(() => null);
    return { error: detail?.error ?? "Gagal. Coba lagi." };
  }
  if (error) return { error: "Gagal tersambung. Cek internet, lalu coba lagi." };
  return { data };
}

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p className={message.ok ? "ok" : "error"} role="status">
      {message.text}
    </p>
  );
}

export function MyPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await db.auth.updateUser({ password });
    setBusy(false);
    setMessage(
      error ? { ok: false, text: "Gagal mengganti kata sandi. Coba lagi." } : { ok: true, text: "Kata sandi diganti." },
    );
    if (!error) setPassword("");
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h2>Kata sandi saya</h2>
      <label>
        Kata sandi baru
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="hint">Minimal {MIN_PASSWORD} karakter. Jangan pakai nama outlet atau angka berurutan.</p>
      <Feedback message={message} />
      <button type="submit" className="secondary" disabled={busy}>
        {busy ? "Menyimpan..." : "Ganti kata sandi"}
      </button>
    </form>
  );
}

function SetPassword({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await callAdmin({ action: "set_password", user_id: account.user_id, password });
    setBusy(false);
    setMessage(error ? { ok: false, text: error } : { ok: true, text: `Kata sandi ${account.username} diganti.` });
    if (!error) {
      setPassword("");
      setOpen(false);
    }
  }

  if (!open)
    return (
      <>
        <button type="button" className="link" onClick={() => setOpen(true)}>
          Ganti kata sandi
        </button>
        <Feedback message={message} />
      </>
    );
  return (
    <form onSubmit={submit} className="stack-sm">
      <label>
        Kata sandi baru untuk {account.username}
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <Feedback message={message} />
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Menyimpan..." : "Simpan"}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Batal
        </button>
      </div>
    </form>
  );
}

function NewAccount({ kind, onCreated }: { kind: "outlet" | "supervisor"; onCreated: () => void }) {
  const empty = { name: "", username: "", password: "" };
  const [form, setForm] = useState(empty);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const username = form.username.trim().toLowerCase();
    const { error } = await callAdmin(
      kind === "outlet"
        ? { action: "create_outlet", name: form.name.trim(), username, password: form.password }
        : { action: "create_supervisor", username, password: form.password },
    );
    setBusy(false);
    if (error) return setMessage({ ok: false, text: error });
    setMessage({ ok: true, text: `Akun ${username} dibuat. Login pakai nama pengguna ${username}.` });
    setForm(empty);
    onCreated();
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h2>{kind === "outlet" ? "Tambah outlet" : "Tambah supervisor"}</h2>
      {kind === "outlet" && (
        <label>
          Nama outlet
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
      )}
      <label>
        Nama pengguna
        <input
          required
          autoCapitalize="none"
          spellCheck={false}
          pattern="[a-zA-Z0-9][a-zA-Z0-9\-]{2,29}"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
      </label>
      <p className="hint">3-30 huruf, angka, atau tanda minus. Contoh: sunset, kemang-2.</p>
      <label>
        Kata sandi
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </label>
      {kind === "outlet" && (
        <p className="hint">
          Batas awal: 50 pesan per hari, jeda 30-90 detik, jam 09.00-20.00. Bisa diubah di menu Pengaturan outlet itu.
        </p>
      )}
      <Feedback message={message} />
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Membuat..." : kind === "outlet" ? "Tambah outlet" : "Tambah supervisor"}
      </button>
    </form>
  );
}

export function AdminTab({ onChanged }: { onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await callAdmin({ action: "list" });
    if (error) setError(error);
    else {
      setError(null);
      setAccounts(data as Accounts);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const created = () => {
    load();
    onChanged();
  };

  if (error) return <p className="error">{error}</p>;
  if (!accounts) return <p className="muted">Memuat akun...</p>;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <h2>Outlet</h2>
        {accounts.outlets.map((o) => (
          <div key={o.id} className="stack-sm">
            <p>
              <strong>{o.name}</strong> <span className="muted">login: {o.username}</span>
            </p>
            <SetPassword account={o} />
          </div>
        ))}
      </section>
      <NewAccount kind="outlet" onCreated={created} />

      <section className="card stack">
        <h2>Supervisor</h2>
        <p className="hint">Supervisor bisa melihat dan mengatur semua outlet, dan membuka menu Admin ini.</p>
        {accounts.supervisors.map((s) => (
          <div key={s.user_id} className="stack-sm">
            <p>
              <strong>{s.username}</strong>
            </p>
            <SetPassword account={s} />
          </div>
        ))}
      </section>
      <NewAccount kind="supervisor" onCreated={created} />
    </div>
  );
}
