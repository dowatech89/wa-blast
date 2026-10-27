import { expect, it } from "vitest";
import { toEmail } from "./login";

// Same cases as agent/tests/test_webhook.py::test_username_maps_to_account_email
it("maps a username to the account email", () => {
  expect(toEmail(" Sunset ")).toBe("sunset@wablast.local");
  expect(toEmail("captain@test.local")).toBe("captain@test.local");
});
