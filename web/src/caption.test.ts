import { expect, it } from "vitest";
import { composeCaption, getGreeting } from "./caption";

// Same cases as agent/tests/test_webhook.py::test_caption_adds_name_and_optout_footer
it("adds the name and the opt-out footer", () => {
  expect(composeCaption("Halo {nama}!", "Budi", "Balas STOP.")).toBe("Halo Budi!\n\nBalas STOP.");
  expect(composeCaption("Halo {nama}!", null, "")).toBe("Halo Kak!");
  expect(composeCaption("Halo {nama}, ini {outlet}.", "Sari", "", "Sunset Grill")).toBe("Halo Sari, ini Sunset Grill.");
});

it("supports dynamic {salam} time greeting", () => {
  const morning = new Date("2026-11-09T08:00:00");
  const afternoon = new Date("2026-11-09T13:00:00");
  const evening = new Date("2026-11-09T16:30:00");
  const night = new Date("2026-11-09T20:00:00");

  expect(getGreeting(morning)).toBe("Selamat pagi");
  expect(getGreeting(afternoon)).toBe("Selamat siang");
  expect(getGreeting(evening)).toBe("Selamat sore");
  expect(getGreeting(night)).toBe("Selamat malam");

  expect(composeCaption("{salam} {nama}!", "Budi", "", "", morning)).toBe("Selamat pagi Budi!");
  expect(composeCaption("{salam} {nama}!", "Budi", "", "", evening)).toBe("Selamat sore Budi!");
});
