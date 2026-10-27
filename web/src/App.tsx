import type { Session } from "@supabase/supabase-js";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AdminTab, MyPassword } from "./Accounts";
import { ConnectTab } from "./ConnectTab";
import { ContactsTab } from "./ContactsTab";
import { toEmail } from "./login";
import { PromoTab } from "./PromoTab";
import { SettingsTab } from "./SettingsTab";
import { db, isPcOnline, type Outlet } from "./supabase";

const POLL_MS = 4000;

export function usePoll(load: () => Promise<void>, ms = POLL_MS) {
  useEffect(() => {
    load();
    const id = setInterval(load, ms);
    return () => clearInterval(id);
  }, [load, ms]);
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="page-message">Memuat...</p>;
  return session ? <Dashboard /> : <Login />;
}

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await db.auth.signInWithPassword({ email: toEmail(username), password });
    setBusy(false);
    if (error) setError("Nama pengguna atau kata sandi salah.");
  }

  return (
    <main className="login">
      <h1 className="brand">WA Blast</h1>
      <p className="muted">Masuk pakai akun outlet kamu.</p>
      <form onSubmit={submit} className="stack">
        <label>
          Nama pengguna
          <input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Kata sandi
          <input
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Tampilkan kata sandi
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Masuk..." : "Masuk"}
        </button>
      </form>
    </main>
  );
}

const TABS = [
  { id: "promo", label: "Promo" },
  { id: "kontak", label: "Kontak" },
  { id: "wa", label: "WhatsApp" },
  { id: "atur", label: "Pengaturan" },
  { id: "admin", label: "Admin" }, // supervisors only
] as const;
type TabId = (typeof TABS)[number]["id"];

function currentTab(): TabId {
  const hash = location.hash.slice(1);
  return TABS.some((t) => t.id === hash) ? (hash as TabId) : "promo";
}

function Dashboard() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(currentTab);
  const [isSupervisor, setIsSupervisor] = useState(false);

  useEffect(() => {
    db.rpc("is_supervisor").then(({ data }) => setIsSupervisor(data === true));
  }, []);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const load = useCallback(async () => {
    // A captain sees one outlet; a supervisor sees all of them (RLS decides).
    const { data, error } = await db.from("outlets").select("*").order("name");
    if (error) setError("Gagal memuat data outlet. Cek internet, lalu muat ulang halaman.");
    else if (!data.length) setError("Akun ini belum terhubung ke outlet mana pun. Hubungi admin.");
    else {
      setError(null);
      setOutlets(data as Outlet[]);
    }
  }, []);
  usePoll(load);

  const outlet = outlets.find((o) => o.id === outletId) ?? outlets[0];
  const signOut = (
    <button type="button" className="link" onClick={() => db.auth.signOut()}>
      Keluar
    </button>
  );
  // A supervisor with no outlet yet still needs the Admin menu to create the first one.
  if (!outlet && isSupervisor)
    return (
      <div className="shell">
        <header className="top">
          <h1>Admin</h1>
          {signOut}
        </header>
        <AdminTab onChanged={load} />
      </div>
    );
  if (error && !outlet) return <p className="page-message error">{error}</p>;
  if (!outlet) return <p className="page-message">Memuat...</p>;

  const pcOn = isPcOnline(outlet);
  const waOn = outlet.wa_status === "connected";
  const shown = tab === "admin" && !isSupervisor ? "promo" : tab;

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="brand small">WA Blast</p>
          <h1>{outlet.name}</h1>
        </div>
        {signOut}
      </header>

      {outlets.length > 1 && (
        <label className="outlet-pick">
          Pilih outlet
          <select value={outlet.id} onChange={(e) => setOutletId(e.target.value)}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <ul className="status" aria-label="Status">
        <li className={pcOn ? "on" : "off"}>{pcOn ? "PC outlet menyala" : "PC outlet mati"}</li>
        <li className={waOn ? "on" : "off"}>{waOn ? "WhatsApp tersambung" : "WhatsApp belum tersambung"}</li>
      </ul>
      {error && <p className="error">{error}</p>}
      {outlet.pause_reason && (
        <div className="alert" role="alert">
          <p>{outlet.pause_reason}</p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await db.from("outlets").update({ pause_reason: null }).eq("id", outlet.id);
              load();
            }}
          >
            Mengerti
          </button>
        </div>
      )}

      <nav className="tabs" aria-label="Menu">
        {TABS.filter((t) => t.id !== "admin" || isSupervisor).map((t) => (
          <a key={t.id} href={`#${t.id}`} aria-current={shown === t.id ? "page" : undefined}>
            {t.label}
          </a>
        ))}
      </nav>

      {/* key resets each tab's form state when a supervisor switches outlet */}
      <main key={outlet.id}>
        {shown === "promo" && <PromoTab outlet={outlet} />}
        {shown === "kontak" && <ContactsTab outlet={outlet} />}
        {shown === "wa" && <ConnectTab outlet={outlet} />}
        {shown === "atur" && (
          <div className="stack-lg">
            <SettingsTab outlet={outlet} onSaved={load} />
            <MyPassword />
          </div>
        )}
        {shown === "admin" && <AdminTab onChanged={load} />}
      </main>
    </div>
  );
}
