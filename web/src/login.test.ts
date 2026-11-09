import { expect, it } from "vitest";
import { LOGIN_OUTLETS, toEmail } from "./login";

// Same cases as agent/tests/test_webhook.py::test_username_maps_to_account_email
it("maps a username to the account email", () => {
  expect(toEmail(" Sunset ")).toBe("sunset@wablast.local");
  expect(toEmail("captain@test.local")).toBe("captain@test.local");
});

it("offers only outlet accounts in the login dropdown", () => {
  const usernames = LOGIN_OUTLETS.map((o) => o.username);
  expect(usernames).toContain("dowa");
  expect(usernames).toContain("dowa-test");
  expect(usernames).not.toContain("supervisor");
  for (const u of usernames) expect(u).toMatch(/^[a-z0-9][a-z0-9-]{2,29}$/); // same rule as the admin function
});
