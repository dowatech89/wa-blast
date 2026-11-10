import { describe, expect, it } from "vitest";
import { isPcOnline, PC_OFFLINE_AFTER_MS, type Outlet } from "./supabase";

const mockOutlet = (last_seen_at: string | null): Outlet => ({
  id: "outlet-1",
  name: "Test Outlet",
  wa_status: "connected",
  wa_number: "628123456789",
  qr_image_path: null,
  daily_limit: 10,
  delay_min_sec: 30,
  delay_max_sec: 90,
  send_start: "09:00:00",
  send_end: "20:00:00",
  timezone: "Asia/Jakarta",
  last_seen_at,
  version: 1,
  check_number_first: true,
  pause_after_failures: 5,
  min_days_between_promos: 7,
  optout_footer: "Balas STOP untuk berhenti.",
  stop_keywords: ["STOP"],
  warmup_enabled: false,
  warmup_start_limit: 10,
  warmup_daily_increase: 5,
  wa_connected_since: null,
  pause_reason: null,
});

describe("isPcOnline", () => {
  it("returns false when last_seen_at is null", () => {
    expect(isPcOnline(mockOutlet(null))).toBe(false);
  });

  it("returns true when heartbeat is recent within 75 seconds", () => {
    const now = 1_000_000_000_000;
    const recent = new Date(now - 30_000).toISOString(); // 30s ago
    expect(isPcOnline(mockOutlet(recent), now)).toBe(true);

    const atLimit = new Date(now - (PC_OFFLINE_AFTER_MS - 1000)).toISOString(); // 74s ago
    expect(isPcOnline(mockOutlet(atLimit), now)).toBe(true);
  });

  it("returns false when heartbeat exceeds 75 seconds", () => {
    const now = 1_000_000_000_000;
    const expired = new Date(now - 76_000).toISOString(); // 76s ago
    expect(isPcOnline(mockOutlet(expired), now)).toBe(false);
  });

  it("tolerates negative diff caused by slight clock skew", () => {
    const now = 1_000_000_000_000;
    const futureFromClockSkew = new Date(now + 5_000).toISOString(); // 5s in future
    expect(isPcOnline(mockOutlet(futureFromClockSkew), now)).toBe(true);
  });
});
