import { expect, it } from "vitest";
import { composeCaption } from "./caption";

// Same cases as agent/tests/test_webhook.py::test_caption_adds_name_and_optout_footer
it("adds the name and the opt-out footer", () => {
  expect(composeCaption("Halo {nama}!", "Budi", "Balas STOP.")).toBe("Halo Budi!\n\nBalas STOP.");
  expect(composeCaption("Halo {nama}!", null, "")).toBe("Halo Kak!");
  expect(composeCaption("Halo {nama}, ini {outlet}.", "Sari", "", "Sunset Grill")).toBe("Halo Sari, ini Sunset Grill.");
});
