import { type FormEvent, useState } from "react";
import { db, type Outlet } from "./supabase";

type NumberKey =
  | "daily_limit"
  | "delay_min_sec"
  | "delay_max_sec"
  | "pause_after_failures"
  | "min_days_between_promos"
  | "warmup_start_limit"
  | "warmup_daily_increase";

export function SettingsTab({ outlet, onSaved }: { outlet: Outlet; onSaved: () => void }) {
  // Form starts from the outlet row as it was when the tab opened; `version` guards against overwriting newer edits.
  const [form, setForm] = useState({
    daily_limit: outlet.daily_limit,
    delay_min_sec: outlet.delay_min_sec,
    delay_max_sec: outlet.delay_max_sec,
    send_start: outlet.send_start.slice(0, 5),
    send_end: outlet.send_end.slice(0, 5),
    check_number_first: outlet.check_number_first,
    pause_after_failures: outlet.pause_after_failures,
    min_days_between_promos: outlet.min_days_between_promos,
    optout_footer: outlet.optout_footer,
    stop_keywords: outlet.stop_keywords.join(", "),
    warmup_enabled: outlet.warmup_enabled,
    warmup_start_limit: outlet.warmup_start_limit,
    warmup_daily_increase: outlet.warmup_daily_increase,
  });
  const [version, setVersion] = useState(outlet.version);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const keywords = form.stop_keywords
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean);

  const footer = form.optout_footer.trim().toUpperCase();
  const footerMissesKeyword = footer !== "" && !keywords.some((k) => footer.includes(k));

  const invalid =
    form.daily_limit < 1
      ? "Batas harian minimal 1."
      : form.delay_min_sec < 1
        ? "Jeda paling cepat minimal 1 detik."
        : form.delay_max_sec < form.delay_min_sec
          ? "Jeda paling lama tidak boleh lebih kecil dari jeda paling cepat."
          : form.send_end <= form.send_start
            ? "Jam selesai harus setelah jam mulai."
            : form.pause_after_failures < 0 || form.min_days_between_promos < 0 || form.warmup_daily_increase < 0
              ? "Angka tidak boleh minus."
              : form.warmup_start_limit < 1
                ? "Pemanasan harus mulai dari minimal 1 pesan."
                : keywords.length === 0
                  ? "Isi minimal satu kata untuk berhenti langganan, misalnya STOP."
                  : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    const { data, error } = await db
      .from("outlets")
      .update({ ...form, optout_footer: form.optout_footer.trim(), stop_keywords: keywords })
      .eq("id", outlet.id)
      .eq("version", version)
      .select("version");
    setBusy(false);
    if (error) setMessage({ ok: false, text: "Gagal menyimpan. Coba lagi." });
    else if (!data.length)
      setMessage({
        ok: false,
        text: "Pengaturan baru saja diubah dari HP lain. Buka ulang menu ini untuk melihat yang terbaru.",
      });
    else {
      setVersion(data[0].version);
      setMessage({ ok: true, text: "Pengaturan tersimpan." });
      onSaved();
    }
  }

  const num = (key: NumberKey, min = 1) => ({
    type: "number",
    min,
    required: true,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(e.target.value) }),
  });

  return (
    <form onSubmit={submit} className="stack-lg">
      <section className="card stack">
        <h2>Jadwal kirim</h2>
        <label>
          Maksimal pesan per hari
          <input {...num("daily_limit")} />
        </label>
        <div className="row">
          <label>
            Jeda paling cepat (detik)
            <input {...num("delay_min_sec")} />
          </label>
          <label>
            Jeda paling lama (detik)
            <input {...num("delay_max_sec")} />
          </label>
        </div>
        <div className="row">
          <label>
            Mulai kirim jam
            <input
              type="time"
              required
              value={form.send_start}
              onChange={(e) => setForm({ ...form, send_start: e.target.value })}
            />
          </label>
          <label>
            Berhenti kirim jam
            <input
              type="time"
              required
              value={form.send_end}
              onChange={(e) => setForm({ ...form, send_end: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="card stack">
        <h2>Pengaman nomor</h2>
        <p className="hint">
          Pengaturan ini menjaga nomor captain supaya tidak diblokir WhatsApp. Kalau ragu, biarkan seperti semula.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={form.warmup_enabled}
            onChange={(e) => setForm({ ...form, warmup_enabled: e.target.checked })}
          />
          Pemanasan nomor baru
        </label>
        {form.warmup_enabled && (
          <div className="row">
            <label>
              Hari pertama kirim maksimal
              <input {...num("warmup_start_limit")} />
            </label>
            <label>
              Lalu naik per hari sebanyak
              <input {...num("warmup_daily_increase", 0)} />
            </label>
          </div>
        )}
        <p className="hint">
          Nomor yang baru disambungkan mulai dari sedikit pesan, lalu naik tiap hari sampai batas harian di atas.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={form.check_number_first}
            onChange={(e) => setForm({ ...form, check_number_first: e.target.checked })}
          />
          Cek dulu apakah nomor punya WhatsApp
        </label>
        <p className="hint">Nomor tanpa WhatsApp dilewati dan tidak akan dikirimi lagi.</p>

        <label>
          Berhenti otomatis setelah gagal berturut-turut (kali)
          <input {...num("pause_after_failures", 0)} />
        </label>
        <p className="hint">
          Semua promo dihentikan dan muncul peringatan di atas. Isi 0 kalau tidak mau berhenti otomatis.
        </p>

        <label>
          Jeda antar promo ke pelanggan yang sama (hari)
          <input {...num("min_days_between_promos", 0)} />
        </label>
        <p className="hint">
          Isi 1: pelanggan dapat paling banyak 1 promo per hari. Kalau ada beberapa promo berjalan, promo berikutnya
          menunggu dan terkirim di hari berikutnya. Isi 0 kalau pelanggan boleh menerima promo kapan saja.
        </p>

        <label>
          Kalimat di akhir setiap promo
          <textarea
            rows={2}
            maxLength={200}
            value={form.optout_footer}
            onChange={(e) => setForm({ ...form, optout_footer: e.target.value })}
          />
        </label>
        <label>
          Kata untuk berhenti langganan (pisahkan dengan koma)
          <input
            required
            value={form.stop_keywords}
            onChange={(e) => setForm({ ...form, stop_keywords: e.target.value })}
          />
        </label>
        <p className="hint">
          Pelanggan yang membalas salah satu kata ini tidak akan dikirimi promo lagi. Pastikan katanya sama dengan yang
          ditulis di kalimat penutup.
        </p>
        {footerMissesKeyword && (
          <p className="warn">
            Kalimat penutup belum menyebut kata berhenti ({keywords.join(", ")}). Pelanggan bisa bingung harus membalas
            apa.
          </p>
        )}
      </section>

      {invalid && <p className="warn">{invalid}</p>}
      {message && (
        <p className={message.ok ? "ok" : "error"} role="status">
          {message.text}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy || invalid !== null}>
        {busy ? "Menyimpan..." : "Simpan pengaturan"}
      </button>
    </form>
  );
}
