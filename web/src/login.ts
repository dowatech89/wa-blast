const LOGIN_DOMAIN = "wablast.local"; // same as agent/wablast/session.py

/** Accounts are created as <username>@wablast.local so captains only type the username. */
export function toEmail(username: string) {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${LOGIN_DOMAIN}`;
}

/** Outlets offered in the login dropdown. Personal (dowa) and supervisor accounts are left out on purpose and sign
 *  in through "Lainnya". ponytail: hardcoded; add a row here when the Admin menu creates a new outlet. */
export const LOGIN_OUTLETS = [
  { username: "sunset", name: "Sunset Grill" },
  { username: "dspa", name: "D'Spa" },
  { username: "dbistro", name: "D'Bistro" },
  { username: "dbc", name: "Dragon Beach Club" },
  { username: "rooms", name: "Rooms" },
  { username: "dbar", name: "D'Bar" },
] as const;
