import { useCallback, useEffect, useState } from "react";
import { composeCaption } from "./caption";
import { normalizePhone } from "./contacts";
import { Icon } from "./icons";
import { ChatPreview } from "./PromoTab";
import { type Campaign, db, IMAGE_BUCKET, isPcOnline, type Outlet, QR_BUCKET } from "./supabase";
import { toast } from "./toast";

interface TestResult {
  id: string;
  status: "sent" | "failed";
  phone: string;
  error?: string | null;
  sent_at: string;
}

interface SavedTestContact {
  phone: string;
  name: string;
}

export function TestingTab({ outlet }: { outlet: Outlet }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [name, setName] = useState<string>("Budi");
  const [busy, setBusy] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<TestResult | null>(null);

  const storageKey = `wablast_test_contact_${outlet.id}`;

  // Muat nomor tes tersimpan dari localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedTestContact;
        if (parsed.phone) setPhone(parsed.phone);
        if (parsed.name) setName(parsed.name);
      }
    } catch {
      // Ignore private mode storage errors
    }
  }, [storageKey]);

  // Muat daftar promo outlet
  const loadCampaigns = useCallback(async () => {
    const { data } = await db
      .from("campaigns")
      .select("*")
      .eq("outlet_id", outlet.id)
      .order("created_at", { ascending: false });
    if (data && data.length > 0) {
      setCampaigns(data as Campaign[]);
      setSelectedId((prev) => (prev && data.some((c) => c.id === prev) ? prev : data[0].id));
    } else {
      setCampaigns([]);
    }
  }, [outlet.id]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedId) || null;

  // Muat signed URL media promo terpilih
  useEffect(() => {
    if (!selectedCampaign?.image_path) {
      setImageUrl(null);
      return;
    }
    db.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(selectedCampaign.image_path, 3600)
      .then(({ data }) => setImageUrl(data?.signedUrl ?? null));
  }, [selectedCampaign?.image_path]);

  // Simpan nomor & nama tester ke penyimpanan lokal
  function saveContact() {
    const cleaned = normalizePhone(phone);
    if (!cleaned) {
      toast("Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.");
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ phone: cleaned, name: name.trim() || "Tester" }));
      setPhone(cleaned);
      toast("Nomor uji coba tersimpan!");
    } catch {
      toast("Gagal menyimpan ke memori browser.");
    }
  }

  async function sendTest() {
    setStatusMsg(null);
    if (!selectedCampaign) {
      setStatusMsg({ ok: false, text: "Pilih promo yang ingin diuji coba terlebih dahulu." });
      return;
    }

    const clean = normalizePhone(phone);
    if (!clean) {
      setStatusMsg({ ok: false, text: "Nomor WhatsApp belum valid. Contoh format: 08123456789 atau 628123456789." });
      return;
    }

    if (!isPcOnline(outlet)) {
      setStatusMsg({
        ok: false,
        text: "Komputer outlet Sunset Grill sedang mati/offline. Nyalakan WABlast.exe di komputer outlet agar pesan dapat dikirim.",
      });
      return;
    }

    if (outlet.wa_status !== "connected") {
      setStatusMsg({
        ok: false,
        text: "WhatsApp outlet belum tersambung. Silakan scan QR di menu WhatsApp terlebih dahulu.",
      });
      return;
    }

    setBusy(true);
    const testId = `test_${Date.now()}`;
    const testPayload = {
      id: testId,
      phone: clean,
      name: name.trim() || "Tester",
      campaign_id: selectedCampaign.id,
      campaign_title: selectedCampaign.title,
      message: selectedCampaign.message,
      image_path: selectedCampaign.image_path,
      created_at: new Date().toISOString(),
    };

    // 1. Upload permintaan tes ke storage bucket qr-codes (folder outlet_id)
    const requestPath = `${outlet.id}/test_request.json`;
    const up = await db.storage.from(QR_BUCKET).upload(requestPath, JSON.stringify(testPayload), {
      upsert: true,
      contentType: "application/json",
    });

    if (up.error) {
      setBusy(false);
      setStatusMsg({ ok: false, text: `Gagal mengirim instruksi ke PC outlet: ${up.error.message}` });
      return;
    }

    // Auto-save contact if not saved yet
    try {
      localStorage.setItem(storageKey, JSON.stringify({ phone: clean, name: name.trim() || "Tester" }));
    } catch {
      // Ignore
    }

    // 2. Poll hasil dari test_result.json selama maksimal 25 detik
    const resultPath = `${outlet.id}/test_result.json`;
    let attempts = 0;
    const maxAttempts = 18; // ~27 detik (polling tiap 1.5 detik)

    const pollTimer = setInterval(async () => {
      attempts++;
      try {
        const { data, error } = await db.storage.from(QR_BUCKET).download(resultPath);
        if (!error && data) {
          const text = await data.text();
          const res = JSON.parse(text) as TestResult;
          if (res.id === testId) {
            clearInterval(pollTimer);
            setBusy(false);
            if (res.status === "sent") {
              setLastSent(res);
              setStatusMsg({
                ok: true,
                text: `Berhasil! Pesan uji coba telah dikirim ke WhatsApp +${clean}. Silakan cek HP penerima.`,
              });
              toast("Pesan uji coba terkirim!");
            } else {
              setStatusMsg({
                ok: false,
                text: `Pengiriman gagal: ${res.error || "Terjadi kesalahan di WhatsApp PC outlet."}`,
              });
            }
            return;
          }
        }
      } catch {
        // Belum siap, tunggu polling berikutnya
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
        setBusy(false);
        setStatusMsg({
          ok: false,
          text: "Waktu tunggu habis (25 detik). Pastikan WABlast.exe menyala di PC outlet dan WhatsApp terhubung.",
        });
      }
    }, 1500);
  }

  const captionText = selectedCampaign
    ? composeCaption(selectedCampaign.message, name.trim() || "Budi", outlet.optout_footer || "", outlet.name)
    : "";

  return (
    <div className="stack-lg">
      <div className="section-title">
        <div>
          <h2>Uji Coba Kirim Promo (Testing)</h2>
          <p className="hint">
            Kirim promo ke 1 nomor WhatsApp yang Anda tentukan sendiri (misal HP pribadi/tester) untuk melihat tampilan
            aslinya sebelum disebarkan ke semua pelanggan.
          </p>
        </div>
      </div>

      <div className="promo-editor">
        <div className="stack">
          {/* Card Pengaturan Nomor Tes */}
          <article className="card stack">
            <div className="card-head">
              <h3>1. Nomor Tujuan Uji Coba</h3>
              <p>Nomor ini akan otomatis tersimpan di browser ini agar tidak perlu diketik ulang.</p>
            </div>

            <label>
              Nomor WhatsApp Tujuan
              <input
                type="tel"
                required
                placeholder="08123456789 atau 628123456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
              />
              <span className="hint">
                Nomor tersanitasi: <strong>+{normalizePhone(phone) || "..."}</strong>
              </span>
            </label>

            <label>
              Nama Penerima (untuk variabel <code>{"{nama}"}</code>)
              <input
                type="text"
                placeholder="Contoh: Budi atau Nama Anda"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>

            <div className="row">
              <button type="button" className="secondary" onClick={saveContact} disabled={busy || !phone.trim()}>
                💾 Simpan Nomor Ini
              </button>
            </div>
          </article>

          {/* Card Pilih Promo */}
          <article className="card stack">
            <div className="card-head">
              <h3>2. Pilih Promo yang Mau Diuji</h3>
              <p>Pilih salah satu draf promo atau promo yang sudah pernah dibuat.</p>
            </div>

            {campaigns.length === 0 ? (
              <p className="notice">
                Belum ada promo yang dibuat. Silakan buat promo terlebih dahulu di menu <strong>Promo</strong>.
              </p>
            ) : (
              <label>
                Promo
                <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={busy}>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.status.toUpperCase()})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selectedCampaign && (
              <div
                style={{
                  background: "var(--surface-2)",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span className={`pill ${selectedCampaign.status}`}>{selectedCampaign.status}</span>
                  <strong>{selectedCampaign.title}</strong>
                </div>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                  {selectedCampaign.message.slice(0, 150)}
                  {selectedCampaign.message.length > 150 ? "..." : ""}
                </p>
              </div>
            )}

            {statusMsg && (
              <div className={`alert notice ${statusMsg.ok ? "siap" : "error"}`} role="alert">
                <Icon name={statusMsg.ok ? "siap" : "awas"} />
                <p>{statusMsg.text}</p>
              </div>
            )}

            <button
              type="button"
              className="primary"
              onClick={sendTest}
              disabled={busy || !selectedCampaign || !phone.trim()}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            >
              {busy ? (
                <>
                  <span className="dot-pulse" />
                  Mengirim ke PC outlet...
                </>
              ) : (
                <>🚀 Kirim Pesan Uji Coba Sekarang</>
              )}
            </button>
          </article>

          {lastSent && (
            <article className="card stack-sm" style={{ borderLeft: "4px solid var(--brand)" }}>
              <strong>Riwayat Pengiriman Tes Terakhir:</strong>
              <p style={{ margin: 0, fontSize: "0.88rem" }}>
                Terkirim ke <strong>+{lastSent.phone}</strong> pada{" "}
                {new Date(lastSent.sent_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB.
              </p>
            </article>
          )}
        </div>

        {/* Pratinjau Chat Sesuai Tampilan Asli */}
        <div>
          <h3 style={{ marginBottom: "12px" }}>Pratinjau di HP Penerima</h3>
          <ChatPreview
            sender={outlet.sender_name || outlet.name}
            image={imageUrl}
            text={captionText}
            filePath={selectedCampaign?.image_path}
          />
        </div>
      </div>
    </div>
  );
}
