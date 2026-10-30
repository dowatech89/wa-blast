import { describe, expect, it } from "vitest";
import { normalizePhone, parseContactRows } from "./contacts";

describe("normalizePhone", () => {
  it.each([
    ["081234567890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["81234567890", "6281234567890"],
    ["0812.3456.7890", "6281234567890"],
    [81234567890, "6281234567890"], // Excel stores numbers without the leading 0
    ["8.1234567890E10", "6281234567890"], // scientific notation as text
  ])("%s -> %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(["", "abc", "0812", "021-555", "+1 415 555 0100", null, undefined])("rejects %s", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe("parseContactRows", () => {
  it("finds the phone and name columns by header and normalizes rows", () => {
    const res = parseContactRows([
      ["No", "Nama Pelanggan", "No. HP"],
      [1, "Budi", "0812-3456-7890"],
      [2, "Sari", 81298765432],
      [3, "Salah", "12345"],
      [4, "Budi lagi", "+6281234567890"],
      [],
    ]);
    expect(res.contacts).toEqual([
      { phone: "6281234567890", name: "Budi" },
      { phone: "6281298765432", name: "Sari" },
    ]);
    expect(res.invalid).toEqual([{ row: 4, value: "12345", name: "Salah" }]);
    expect(res.duplicates).toBe(1);
  });

  it("reads the downloadable template's headers", () => {
    const res = parseContactRows([
      ["Nama (contoh: Budi)", "Nomor (contoh: 081234567890)"],
      ["Sari", "0812 9876 5432"],
    ]);
    expect(res.contacts).toEqual([{ phone: "6281298765432", name: "Sari" }]);
  });

  it("accepts a sheet with only a phone column", () => {
    const res = parseContactRows([["WhatsApp"], ["081234567890"]]);
    expect(res.contacts).toEqual([{ phone: "6281234567890", name: null }]);
  });

  it("reports a missing phone column instead of guessing", () => {
    expect(() =>
      parseContactRows([
        ["Nama", "Alamat"],
        ["Budi", "Jl. Mawar"],
      ]),
    ).toThrow(/kolom nomor/i);
  });
});
