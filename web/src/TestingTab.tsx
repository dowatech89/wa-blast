import { useCallback, useEffect, useState } from "react";
import { composeCaption } from "./caption";
import { normalizePhone } from "./contacts";
import { Icon } from "./icons";
import { initials } from "./initials";
import { ChatPreview } from "./PromoTab";
import { type Campaign, db, IMAGE_BUCKET, isPcOnline, type Outlet, QR_BUCKET } from "./supabase";
import { toast } from "./toast";

export interface TesterContact {
  id: string;
  phone: string;
  name: string;
}

export interface TestResultItem {
  id: string;
  phone: string;
  name: string;
  status: "sent" | "failed";
  error?: string | null;
  sent_at: string;
}

interface SendProgress {
  current: number;
  total: number;
  name: string;
  phone: string;
}

export function TestingTab({ outlet }: { outlet: Outlet }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [contacts, setContacts] = useState<TesterContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Input form untuk menambah nomor baru
  const [newPhone, setNewPhone] = useState<string>("");
  const [newName, setNewName] = useState<string>("");

  const [busy, setBusy] = useState<boolean>(false);
  const [sendProgress, setSendProgress] = useState<SendProgress | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [historyResults, setHistoryResults] = useState<TestResultItem[]>([]);

  const listStorageKey = `wablast_tester_list_${outlet.id}`;
  const legacyStorageKey = `wablast_test_contact_${outlet.id}`;
  const remoteStoragePath = `${outlet.id}/tester_contacts.json`;

  // Simpan daftar tester ke localStorage & sync ke Supabase Storage di background
  const persistContacts = useCallback(
    (list: TesterContact[]) => {
      try {
        localStorage.setItem(listStorageKey, JSON.stringify(list));
      } catch {
        // Abaikan error local storage
      }
      db.storage
        .from(QR_BUCKET)
        .upload(remoteStoragePath, JSON.stringify(list), { upsert: true, contentType: "application/json" })
        .catch(() => {});
    },
    [listStorageKey, remoteStoragePath]
  );

  // 1. Muat daftar tester dari localStorage & sync dari Supabase Storage
  useEffect(() => {
    let localLoaded: TesterContact[] = [];
    try {
      const savedList = localStorage.getItem(listStorageKey);
      if (savedList) {
        localLoaded = JSON.parse(savedList) as TesterContact[];
      } else {
        // Cek migrasi dari format lama (single contact)
        const legacy = localStorage.getItem(legacyStorageKey);
        if (legacy) {
          const parsed = JSON.parse(legacy) as { phone?: string; name?: string };
          if (parsed.phone) {
            localLoaded = [
              {
                id: `tester_${Date.now()}`,
                phone: parsed.phone,
                name: parsed.name?.trim() || "Tester",
              },
            ];
            persistContacts(localLoaded);
          }
        }
      }
    } catch {
      // Abaikan error parse
    }

    if (localLoaded.length > 0) {
      setContacts(localLoaded);
      setSelectedIds(new Set(localLoaded.map((c) => c.id)));
    }

    // Ambil sinkronisasi dari Supabase Storage jika ada
    db.storage
      .from(QR_BUCKET)
      .download(remoteStoragePath)
      .then(async ({ data, error }) => {
        if (!error && data) {
          try {
            const text = await data.text();
            const remoteList = JSON.parse(text) as TesterContact[];
            if (Array.isArray(remoteList) && remoteList.length > 0) {
              setContacts((prev) => {
                if (prev.length === 0) {
                  setSelectedIds(new Set(remoteList.map((c) => c.id)));
                  try {
                    localStorage.setItem(listStorageKey, JSON.stringify(remoteList));
                  } catch {
                    // Ignore
                  }
                  return remoteList;
                }
                return prev;
              });
            }
          } catch {
            // Ignore
          }
        }
      });
  }, [listStorageKey, legacyStorageKey, remoteStoragePath, persistContacts]);

  // 2. Muat daftar promo outlet
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

  // 3. Muat signed URL media promo terpilih
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

  // Tambah nomor tester baru
  function addContact() {
    const cleaned = normalizePhone(newPhone);
    if (!cleaned) {
      toast("Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.");
      return;
    }
    const cleanName = newName.trim() || "Tester";
    if (contacts.some((c) => c.phone === cleaned)) {
      toast("Nomor ini sudah ada di daftar tester.");
      return;
    }
    const newEntry: TesterContact = {
      id: `tester_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      phone: cleaned,
      name: cleanName,
    };
    const updated = [...contacts, newEntry];
    setContacts(updated);
    setSelectedIds((prev) => new Set([...prev, newEntry.id]));
    setNewPhone("");
    setNewName("");
    persistContacts(updated);
    toast(`Nomor ${cleanName} (+${cleaned}) berhasil disimpan!`);
  }

  // Hapus nomor tester
  function removeContact(id: string) {
    const target = contacts.find((c) => c.id === id);
    if (!target) return;
    if (!confirm(`Hapus nomor ${target.name} (+${target.phone}) dari daftar tester?`)) return;
    const updated = contacts.filter((c) => c.id !== id);
    setContacts(updated);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    persistContacts(updated);
    toast("Nomor tester dihapus.");
  }

  // Toggle checklist pilihan tester
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(contacts.map((c) => c.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  // Jalankan pengiriman ke daftar tester yang ditentukan
  async function sendToContacts(targetContacts: TesterContact[]) {
    setStatusMsg(null);
    if (!selectedCampaign) {
      setStatusMsg({ ok: false, text: "Pilih promo yang ingin diuji coba terlebih dahulu." });
      return;
    }

    if (targetContacts.length === 0) {
      setStatusMsg({ ok: false, text: "Pilih minimal 1 nomor tujuan uji coba." });
      return;
    }

    if (!isPcOnline(outlet)) {
      setStatusMsg({
        ok: false,
        text: `Komputer outlet ${outlet.name} sedang mati/offline. Nyalakan WABlast.exe di komputer outlet agar pesan dapat dikirim.`,
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
    const results: TestResultItem[] = [];

    for (let i = 0; i < targetContacts.length; i++) {
      const target = targetContacts[i];
      setSendProgress({
        current: i + 1,
        total: targetContacts.length,
        name: target.name,
        phone: target.phone,
      });

      const testId = `test_${Date.now()}_${target.phone}`;
      const payload = {
        id: testId,
        phone: target.phone,
        name: target.name,
        campaign_id: selectedCampaign.id,
        campaign_title: selectedCampaign.title,
        message: selectedCampaign.message,
        image_path: selectedCampaign.image_path,
        created_at: new Date().toISOString(),
      };

      const requestPath = `${outlet.id}/test_request.json`;
      const up = await db.storage.from(QR_BUCKET).upload(requestPath, JSON.stringify(payload), {
        upsert: true,
        contentType: "application/json",
      });

      if (up.error) {
        results.push({
          id: testId,
          phone: target.phone,
          name: target.name,
          status: "failed",
          error: `Gagal mengirim instruksi ke PC outlet: ${up.error.message}`,
          sent_at: new Date().toISOString(),
        });
        setHistoryResults([...results]);
        continue;
      }

      // Polling hasil dari test_result.json selama maksimal 25 detik
      const resultPath = `${outlet.id}/test_result.json`;
      let pollAttempts = 0;
      const maxAttempts = 18;
      let resolved = false;

      while (pollAttempts < maxAttempts) {
        pollAttempts++;
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const { data, error } = await db.storage.from(QR_BUCKET).download(resultPath);
          if (!error && data) {
            const text = await data.text();
            const res = JSON.parse(text);
            if (res.id === testId) {
              results.push({
                id: testId,
                phone: target.phone,
                name: target.name,
                status: res.status === "sent" ? "sent" : "failed",
                error: res.error || null,
                sent_at: res.sent_at || new Date().toISOString(),
              });
              setHistoryResults([...results]);
              resolved = true;
              break;
            }
          }
        } catch {
          // Retry
        }
      }

      if (!resolved) {
        results.push({
          id: testId,
          phone: target.phone,
          name: target.name,
          status: "failed",
          error: "Waktu tunggu habis (25 detik). Pastikan WABlast.exe menyala di PC outlet dan WhatsApp terhubung.",
          sent_at: new Date().toISOString(),
        });
        setHistoryResults([...results]);
      }

      // Jeda 1.5 detik antar nomor untuk kelancaran pengiriman
      if (i < targetContacts.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    setBusy(false);
    setSendProgress(null);

    const successCount = results.filter((r) => r.status === "sent").length;
    const failCount = results.length - successCount;

    if (failCount === 0) {
      setStatusMsg({
        ok: true,
        text: `Berhasil! Semua ${successCount} pesan uji coba telah dikirim ke nomor WhatsApp tester.`,
      });
      toast(`Semua ${successCount} pesan uji coba terkirim!`);
    } else if (successCount > 0) {
      setStatusMsg({
        ok: false,
        text: `${successCount} pesan uji coba berhasil terkirim, ${failCount} gagal. Periksa riwayat di bawah.`,
      });
      toast(`${successCount} terkirim, ${failCount} gagal.`);
    } else {
      const firstErr = results[0]?.error || "Terjadi kesalahan di WhatsApp PC outlet.";
      setStatusMsg({
        ok: false,
        text: `Pengiriman gagal: ${firstErr}`,
      });
      toast("Pengiriman uji coba gagal.");
    }
  }

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));
  const previewName = selectedContacts[0]?.name || "Budi";

  const captionText = selectedCampaign
    ? composeCaption(selectedCampaign.message, previewName, outlet.optout_footer || "", outlet.name)
    : "";

  return (
    <div className="stack-lg">
      <div className="section-title">
        <div>
          <h2>Uji Coba Kirim Promo (Testing)</h2>
          <p className="hint">
            Kirim promo ke nomor-nomor WhatsApp tester tersimpan untuk melihat tampilan aslinya di HP sebelum
            disebarkan ke semua pelanggan.
          </p>
        </div>
      </div>

      <div className="promo-editor">
        <div className="stack">
          {/* Card 1: Kelola & Pilih Nomor Tester */}
          <article className="card stack">
            <div className="card-head">
              <h3>1. Nomor Tujuan Uji Coba (Tester)</h3>
              <p>Simpan nomor HP tester Anda. Centang nomor yang ingin dikirimkan promo uji coba.</p>
            </div>

            {/* Form Tambah Nomor Baru */}
            <div
              style={{
                background: "var(--surface-2)",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid var(--border)",
              }}
              className="stack-sm"
            >
              <strong style={{ fontSize: "0.95rem" }}>+ Tambah Nomor Tester Baru:</strong>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr auto",
                  gap: "10px",
                  alignItems: "flex-end",
                }}
              >
                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                    Nomor WhatsApp:
                  </span>
                  <input
                    type="tel"
                    placeholder="08123456789 atau 628..."
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    disabled={busy}
                    style={{ margin: 0, width: "100%" }}
                  />
                </label>

                <label style={{ margin: 0 }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                    Nama Tester:
                  </span>
                  <input
                    type="text"
                    placeholder="Contoh: Aulia, Pak Boss"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={busy}
                    style={{ margin: 0, width: "100%" }}
                  />
                </label>

                <button
                  type="button"
                  className="secondary"
                  onClick={addContact}
                  disabled={busy || !newPhone.trim()}
                  style={{ height: "42px", whiteSpace: "nowrap" }}
                >
                  💾 Simpan
                </button>
              </div>
              {newPhone && (
                <span className="hint" style={{ marginTop: "2px" }}>
                  Nomor tersanitasi: <strong>+{normalizePhone(newPhone) || "nomor belum valid"}</strong>
                </span>
              )}
            </div>

            {/* Daftar Nomor Tersimpan */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  paddingBottom: "6px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                  Daftar Nomor Tester ({selectedContacts.length} dari {contacts.length} dipilih):
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="tertiary"
                    style={{ padding: "4px 8px", fontSize: "0.8rem", height: "auto" }}
                    onClick={selectAll}
                    disabled={busy || contacts.length === 0}
                  >
                    Pilih Semua
                  </button>
                  <button
                    type="button"
                    className="tertiary"
                    style={{ padding: "4px 8px", fontSize: "0.8rem", height: "auto" }}
                    onClick={deselectAll}
                    disabled={busy || selectedIds.size === 0}
                  >
                    Batal Pilih
                  </button>
                </div>
              </div>

              {contacts.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "var(--muted)",
                    background: "var(--surface-2)",
                    borderRadius: "10px",
                    fontSize: "0.9rem",
                  }}
                >
                  Belum ada nomor tester tersimpan. Tambahkan nomor WhatsApp tester Anda di formulir atas.
                </div>
              ) : (
                <ul className="list" style={{ margin: 0, padding: 0 }}>
                  {contacts.map((c) => {
                    const isChecked = selectedIds.has(c.id);
                    return (
                      <li
                        key={c.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          borderRadius: "10px",
                          background: isChecked ? "var(--brand-soft)" : "transparent",
                          border: `1px solid ${isChecked ? "var(--brand-ink)" : "var(--border)"}`,
                          marginBottom: "6px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            margin: 0,
                            cursor: "pointer",
                            flex: 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(c.id)}
                            disabled={busy}
                            style={{ margin: 0, width: "18px", height: "18px", cursor: "pointer" }}
                          />
                          <span
                            className="avatar"
                            aria-hidden="true"
                            style={{ width: "32px", height: "32px", fontSize: "0.8rem" }}
                          >
                            {initials(c.name)}
                          </span>
                          <span style={{ display: "flex", flexDirection: "column" }}>
                            <strong style={{ fontSize: "0.95rem" }}>{c.name}</strong>
                            <span className="muted" style={{ fontSize: "0.85rem" }}>
                              +{c.phone}
                            </span>
                          </span>
                        </label>

                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <button
                            type="button"
                            className="tertiary"
                            style={{
                              fontSize: "0.8rem",
                              padding: "4px 8px",
                              height: "auto",
                              whiteSpace: "nowrap",
                            }}
                            onClick={() => sendToContacts([c])}
                            disabled={busy || !selectedCampaign}
                            title="Kirim uji coba hanya ke nomor ini"
                          >
                            Kirim ke nomor ini
                          </button>
                          <button
                            type="button"
                            className="tertiary"
                            style={{
                              fontSize: "0.8rem",
                              padding: "4px 6px",
                              height: "auto",
                              color: "var(--danger)",
                            }}
                            onClick={() => removeContact(c.id)}
                            disabled={busy}
                            title="Hapus dari daftar tester"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </article>

          {/* Card 2: Pilih Promo & Eksekusi Uji Coba */}
          <article className="card stack">
            <div className="card-head">
              <h3>2. Pilih Promo yang Mau Diuji</h3>
              <p>Pilih draf promo atau promo yang ingin diuji coba ke nomor tester.</p>
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
              onClick={() => sendToContacts(selectedContacts)}
              disabled={busy || !selectedCampaign || selectedContacts.length === 0}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            >
              {busy && sendProgress ? (
                <>
                  <span className="dot-pulse" />
                  Mengirim {sendProgress.current} dari {sendProgress.total}: {sendProgress.name} (+{sendProgress.phone})
                  ...
                </>
              ) : selectedContacts.length > 1 ? (
                <>🚀 Kirim Pesan Uji Coba ke {selectedContacts.length} Nomor Sekaligus</>
              ) : (
                <>🚀 Kirim Pesan Uji Coba Sekarang ({selectedContacts.length} Nomor)</>
              )}
            </button>
          </article>

          {/* Riwayat Pengiriman Tes */}
          {historyResults.length > 0 && (
            <article className="card stack-sm" style={{ borderLeft: "4px solid var(--brand)" }}>
              <strong style={{ fontSize: "0.95rem" }}>Riwayat Pengiriman Uji Coba:</strong>
              <div className="stack-sm" style={{ marginTop: "6px" }}>
                {historyResults.map((item, idx) => (
                  <div
                    key={`${item.id}_${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      fontSize: "0.88rem",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: "bold",
                            background: item.status === "sent" ? "var(--brand-soft)" : "var(--danger-soft)",
                            color: item.status === "sent" ? "var(--brand-ink)" : "var(--danger)",
                          }}
                        >
                          {item.status === "sent" ? "✓ Terkirim" : "✕ Gagal"}
                        </span>
                        <strong>{item.name}</strong>
                        <span className="muted">(+{item.phone})</span>
                      </div>
                      {item.error && (
                        <p style={{ margin: "4px 0 0", color: "var(--danger)", fontSize: "0.82rem" }}>
                          Penyebab: {item.error}
                        </p>
                      )}
                    </div>
                    <span className="muted" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {new Date(item.sent_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                    </span>
                  </div>
                ))}
              </div>
            </article>
          )}
        </div>

        {/* Pratinjau Chat Sesuai Tampilan Asli */}
        <div>
          <h3 style={{ marginBottom: "12px" }}>Pratinjau di HP Penerima</h3>
          <p className="hint" style={{ marginBottom: "10px" }}>
            Variabel <code>{"{nama}"}</code> menampilkan nama tester yang dipilih (contoh:{" "}
            <strong>{previewName}</strong>).
          </p>
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
