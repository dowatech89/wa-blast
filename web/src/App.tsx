import type { Session } from "@supabase/supabase-js";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { AdminTab, MyPassword } from "./Accounts";
import { AllOutlets } from "./AllOutlets";
import { ConnectTab } from "./ConnectTab";
import { ContactsTab } from "./ContactsTab";
import { Icon, type IconName, Logo } from "./icons";
import { LOGIN_OUTLETS, toEmail } from "./login";
import { Overview } from "./Overview";
import { PromoTab } from "./PromoTab";
import { SettingsTab } from "./SettingsTab";
import { db, isPcOnline, type Outlet } from "./supabase";
import { Toaster } from "./toast";

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
  return (
    <>
      {session ? <Dashboard /> : <Login />}
      <Toaster />
    </>
  );
}

const OTHER = "__other";
const LAST_OUTLET_KEY = "wablast-login-outlet"; // per-device convenience: a captain's phone remembers their outlet

function lastOutlet(): string {
  try {
    const saved = localStorage.getItem(LAST_OUTLET_KEY);
    return LOGIN_OUTLETS.some((o) => o.username === saved) ? (saved as string) : "";
  } catch {
    return "";
  }
}

function Login() {
  const [choice, setChoice] = useState(lastOutlet);
  const [typed, setTyped] = useState("");
  const username = choice === OTHER ? typed : choice;
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
    if (error) setError(choice === OTHER ? "Nama pengguna atau kata sandi salah." : "Kata sandi salah.");
    else if (choice !== OTHER) {
      try {
        localStorage.setItem(LAST_OUTLET_KEY, choice);
      } catch {
        // private mode: the dropdown just starts empty next time
      }
    }
  }

  return (
    <main className="login">
      <section className="login-hero" aria-label="Tentang WA Blast">
        <p className="brand">
          <Logo size={40} />
          WA Blast
        </p>
        <h2>Promo WhatsApp outlet, terkirim pelan-pelan dan aman.</h2>
        <ul>
          <li>
            <Icon name="siap" />
            Foto dan pesan dengan nama tiap pelanggan
          </li>
          <li>
            <Icon name="siap" />
            Jeda acak, batas harian, dan tombol STOP otomatis
          </li>
          <li>
            <Icon name="siap" />
            Pantau semua outlet dari satu layar
          </li>
        </ul>
      </section>
      <div className="login-card">
        <div className="card-head">
          <h1>Masuk</h1>
          <p>Pilih outlet kamu, lalu isi kata sandi dari admin.</p>
        </div>
        <form onSubmit={submit} className="stack">
          <label>
            Outlet
            <select required value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="" disabled>
                Pilih outlet
              </option>
              {LOGIN_OUTLETS.map((o) => (
                <option key={o.username} value={o.username}>
                  {o.name}
                </option>
              ))}
              <option value={OTHER}>Lainnya (ketik nama pengguna)</option>
            </select>
          </label>
          {choice === OTHER ? (
            <label>
              Nama pengguna
              <input
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
          ) : (
            // Lets password managers file the saved password under the chosen outlet's username.
            <input type="text" autoComplete="username" value={username} readOnly hidden />
          )}
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
      </div>
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
type TabId = (typeof TABS)[number]["id"] | "semua"; // "semua": the supervisor's all-outlets page

function currentTab(): TabId {
  const hash = location.hash.slice(1);
  return hash === "semua" || TABS.some((t) => t.id === hash) ? (hash as TabId) : "promo";
}

function Dashboard() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(currentTab);
  const [isSupervisor, setIsSupervisor] = useState<boolean | null>(null); // null until known: avoids a flash of the wrong page

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
  // Supervisors start on "Semua outlet"; picking a card sets outletId.
  const overview = isSupervisor === true && outlets.length > 1 && (outletId === null || tab === "semua");
  const openOutlet = (id: string | null) => {
    setOutletId(id);
    location.hash = id ? "promo" : "semua";
  };
  // A supervisor with no outlet yet still needs the Admin menu to create the first one.
  if (isSupervisor === null) return <p className="page-message">Memuat...</p>;
  if (!outlet && isSupervisor)
    return (
      <Frame title="Admin" nav={[{ id: "admin", label: "Admin", current: true }]}>
        <main>
          <AdminTab onChanged={load} />
        </main>
      </Frame>
    );
  if (error && !outlet) return <p className="page-message error">{error}</p>;
  if (!outlet) return <p className="page-message">Memuat...</p>;

  if (overview)
    return (
      <Frame
        title="Semua outlet"
        nav={[
          { id: "semua", label: "Semua outlet", current: tab !== "admin" },
          { id: "admin", label: "Admin", current: tab === "admin" },
        ]}
      >
        <main>
          {tab === "admin" ? <AdminTab onChanged={load} /> : <AllOutlets outlets={outlets} onOpen={openOutlet} />}
        </main>
      </Frame>
    );

  const shown = (tab === "admin" && !isSupervisor) || tab === "semua" ? "promo" : tab;

  return (
    <Frame
      title={outlet.name}
      nav={TABS.filter((t) => t.id !== "admin" || isSupervisor).map((t) => ({
        ...t,
        current: shown === t.id,
        status: t.id === "wa" ? waStatus(outlet) : undefined,
      }))}
    >
      {outlets.length > 1 && (
        <div className="outlet-pick">
          <button type="button" className="link" onClick={() => openOutlet(null)}>
            ← Semua outlet
          </button>
          <label>
            Pindah outlet
            <select value={outlet.id} onChange={(e) => setOutletId(e.target.value)}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <p className="error notice">{error}</p>}
      {outlet.pause_reason && (
        <div className="alert notice" role="alert">
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

      <Overview key={`overview-${outlet.id}`} outlet={outlet} />

      {/* key resets each tab's form state when a supervisor switches outlet */}
      <main key={outlet.id}>
        {shown === "promo" && <PromoTab outlet={outlet} />}
        {shown === "kontak" && <ContactsTab outlet={outlet} isSupervisor={isSupervisor === true} />}
        {shown === "wa" && <ConnectTab outlet={outlet} />}
        {shown === "atur" && (
          <div className="stack-lg">
            <SettingsTab outlet={outlet} onSaved={load} />
            <MyPassword />
          </div>
        )}
        {shown === "admin" && <AdminTab onChanged={load} />}
      </main>
    </Frame>
  );
}

// `status` puts a green or red dot on the item (the WhatsApp link), so the state shows from any page.
type NavItem = { id: IconName; label: string; current: boolean; status?: { ok: boolean; text: string } };

/** Phone: header, then the page, with the menu as icon tiles above the working area (CSS reorders).
 *  Desktop (900px+): a teal sidebar holds the header and the menu; the page fills the right column. */
function Frame({ title, nav, children }: { title: string; nav: NavItem[]; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="side">
        <header className="top">
          <div>
            <p className="brand small">
              <Logo size={22} />
              WA Blast
            </p>
            <h1>{title}</h1>
          </div>
          <SignOut place="top" />
        </header>
        <nav className="tabs" aria-label="Menu">
          {nav.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={t.current ? "page" : undefined}>
              <span className="tab-icon">
                <Icon name={t.id} />
                {t.status && <span className={`nav-dot ${t.status.ok ? "on" : "off"}`} />}
              </span>
              {t.label}
              {t.status && <span className="sr-only">({t.status.text})</span>}
            </a>
          ))}
        </nav>
        <SignOut place="bottom" />
      </aside>
      <div className="content">{children}</div>
    </div>
  );
}

/** Phone: in the header, next to the outlet name. Desktop: at the bottom of the sidebar. CSS shows one of them. */
function SignOut({ place }: { place: "top" | "bottom" }) {
  return (
    <button type="button" className={`link sign-out sign-out-${place}`} onClick={() => db.auth.signOut()}>
      <Icon name="keluar" />
      Keluar
    </button>
  );
}

function waStatus(outlet: Outlet) {
  if (outlet.wa_status !== "connected") return { ok: false, text: "WhatsApp belum tersambung" };
  return isPcOnline(outlet)
    ? { ok: true, text: "WhatsApp tersambung" }
    : { ok: false, text: "WhatsApp tersambung, PC outlet mati" };
}
