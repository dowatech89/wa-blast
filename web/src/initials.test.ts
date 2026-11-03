import { expect, it } from "vitest";
import { initials } from "./initials";

it.each([
  ["Sunset Grill", "SG"],
  ["budi", "B"],
  ["D'Spa", "DS"],
  ["Dragon Beach Club", "DB"],
  ["", "?"],
  [null, "?"],
])("%s -> %s", (name, expected) => {
  expect(initials(name)).toBe(expected);
});
