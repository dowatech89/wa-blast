// Account admin for supervisors: create outlets/supervisors and set passwords.
// Runs on Supabase, which injects the service-role key, so that key never reaches a browser or PC.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const DOMAIN = "wablast.local"; // same as web/src/login.ts
const USERNAME = /^[a-z0-9][a-z0-9-]{2,29}$/;
const MIN_PASSWORD = 8;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, error: string) => reply(status, { error });

const username = (email: string | undefined) => (email ?? "").replace(`@${DOMAIN}`, "");

function checkNew(body: { username?: string; password?: string }) {
  if (!USERNAME.test(body.username ?? "")) return "Nama pengguna 3-30 huruf kecil, angka, atau tanda minus.";
  return checkPassword(body.password);
}
const checkPassword = (password?: string) =>
  (password ?? "").length < MIN_PASSWORD ? `Kata sandi minimal ${MIN_PASSWORD} karakter.` : null;

async function createUser(name: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${name}@${DOMAIN}`,
    password,
    email_confirm: true,
  });
  if (error) return { error: error.code === "email_exists" ? "Nama pengguna sudah dipakai." : error.message };
  return { id: data.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data: caller, error: authError } = await admin.auth.getUser(jwt);
  if (!caller.user) {
    console.warn("admin: caller rejected", authError?.code, authError?.message); // visible in Supabase function logs
    return fail(401, "Silakan masuk lagi.");
  }
  const { data: sup } = await admin.from("supervisors").select("user_id").eq("user_id", caller.user.id).maybeSingle();
  if (!sup) return fail(403, "Hanya supervisor yang boleh mengatur akun.");

  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "list": {
      const [users, outlets, sups] = await Promise.all([
        admin.auth.admin.listUsers({ perPage: 1000 }),
        admin.from("outlets").select("id, name, owner_user_id").order("name"),
        admin.from("supervisors").select("user_id"),
      ]);
      const names = new Map(users.data.users.map((u) => [u.id, username(u.email)]));
      return reply(200, {
        outlets: (outlets.data ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          user_id: o.owner_user_id,
          username: names.get(o.owner_user_id),
        })),
        supervisors: (sups.data ?? []).map((s) => ({ user_id: s.user_id, username: names.get(s.user_id) })),
      });
    }

    case "create_outlet": {
      const name = String(body.name ?? "").trim();
      if (!name) return fail(400, "Nama outlet wajib diisi.");
      const invalid = checkNew(body);
      if (invalid) return fail(400, invalid);
      const user = await createUser(body.username, body.password);
      if (user.error) return fail(400, user.error);
      const { error } = await admin.from("outlets").insert({
        name,
        owner_user_id: user.id,
        gowa_device_id: body.username,
        daily_limit: 50,
        delay_min_sec: 30,
        delay_max_sec: 90,
        send_start: "09:00",
        send_end: "20:00",
        timezone: "Asia/Jakarta",
      });
      if (error) {
        await admin.auth.admin.deleteUser(user.id!); // no orphan account without an outlet
        return fail(400, error.message);
      }
      return reply(200, { ok: true });
    }

    case "create_supervisor": {
      const invalid = checkNew(body);
      if (invalid) return fail(400, invalid);
      const user = await createUser(body.username, body.password);
      if (user.error) return fail(400, user.error);
      const { error } = await admin.from("supervisors").insert({ user_id: user.id });
      if (error) {
        await admin.auth.admin.deleteUser(user.id!);
        return fail(400, error.message);
      }
      return reply(200, { ok: true });
    }

    case "set_password": {
      const invalid = checkPassword(body.password);
      if (invalid) return fail(400, invalid);
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password: body.password });
      return error ? fail(400, error.message) : reply(200, { ok: true });
    }
  }
  return fail(400, "Perintah tidak dikenal.");
});
