import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum diisi di file env.");
}

export const db = createClient(url, anonKey);

export const IMAGE_BUCKET = "campaign-images";
export const QR_BUCKET = "qr-codes";

export type Outlet = {
  id: string;
  name: string;
  wa_status: "disconnected" | "waiting_qr" | "connected";
  wa_number: string | null;
  qr_image_path: string | null;
  daily_limit: number;
  delay_min_sec: number;
  delay_max_sec: number;
  send_start: string;
  send_end: string;
  timezone: string;
  last_seen_at: string | null;
  version: number;
  // Block-risk controls (see migration 20261027010000_risk_controls.sql)
  check_number_first: boolean;
  pause_after_failures: number;
  min_days_between_promos: number;
  optout_footer: string;
  stop_keywords: string[];
  warmup_enabled: boolean;
  warmup_start_limit: number;
  warmup_daily_increase: number;
  wa_connected_since: string | null;
  pause_reason: string | null;
};

export type Campaign = {
  id: string;
  title: string;
  message: string;
  image_path: string | null;
  status: "draft" | "running" | "paused" | "done";
  version: number;
  created_at: string;
};

export type Progress = {
  campaign_id: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  waiting: number;
};

/** set_campaign_status raises PT409 (PostgREST maps it to HTTP 409) when the version is stale. */
export const isConflict = (error: { code?: string } | null) => error?.code === "PT409";

// WABlast.exe writes last_seen_at every few seconds; silence longer than this means the PC is off.
const PC_OFFLINE_AFTER_MS = 30_000;
export const isPcOnline = (outlet: Outlet) =>
  outlet.last_seen_at !== null && Date.now() - new Date(outlet.last_seen_at).getTime() < PC_OFFLINE_AFTER_MS;
