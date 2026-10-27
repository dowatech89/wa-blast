const LOGIN_DOMAIN = "wablast.local"; // same as agent/wablast/session.py

/** Accounts are created as <username>@wablast.local so captains only type the username. */
export function toEmail(username: string) {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${LOGIN_DOMAIN}`;
}
