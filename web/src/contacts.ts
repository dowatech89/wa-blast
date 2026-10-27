// Indonesian mobile numbers: 08xx with 10-13 digits in total, i.e. 628 + 7..11 digits.
const MOBILE = /^628[1-9]\d{6,10}$/;
const PHONE_HEADER = /(^|\W)(no|nomor|hp|telp|telepon|phone|wa|whatsapp)(\W|$)/i;
const NAME_HEADER = /(nama|name)/i;

/** Returns the number as 628xxxxxxxxx, or null when it is not an Indonesian mobile number. */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined || typeof raw === "boolean") return null;
  let text = typeof raw === "number" ? Math.trunc(raw).toString() : String(raw).trim();
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(text)) text = BigInt(Math.round(Number(text))).toString();

  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return MOBILE.test(digits) ? digits : null;
}

type Contact = { phone: string; name: string | null };
export type ParseResult = {
  contacts: Contact[];
  invalid: { row: number; value: string }[];
  duplicates: number;
};

/** Rows as returned by SheetJS `sheet_to_json(sheet, { header: 1 })`; the first row is the header. */
export function parseContactRows(rows: unknown[][]): ParseResult {
  const header = (rows[0] ?? []).map((h) => String(h ?? ""));
  // "No" alone is usually a row counter, so prefer a more specific phone header when there is one.
  const candidates = header.flatMap((h, i) => (PHONE_HEADER.test(h) ? [i] : []));
  const phoneCol = candidates.find((i) => header[i].trim().toLowerCase() !== "no") ?? candidates[0];
  if (phoneCol === undefined) {
    throw new Error("Kolom nomor tidak ditemukan. Beri judul kolom seperti 'Nomor' atau 'No HP'.");
  }
  const nameCol = header.findIndex((h) => NAME_HEADER.test(h));

  const seen = new Set<string>();
  const result: ParseResult = { contacts: [], invalid: [], duplicates: 0 };
  rows.slice(1).forEach((row, i) => {
    const value = row[phoneCol];
    if (value === undefined || value === null || String(value).trim() === "") return;
    const phone = normalizePhone(value);
    if (!phone) {
      result.invalid.push({ row: i + 2, value: String(value) });
      return;
    }
    if (seen.has(phone)) {
      result.duplicates++;
      return;
    }
    seen.add(phone);
    const name = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    result.contacts.push({ phone, name: name || null });
  });
  return result;
}
