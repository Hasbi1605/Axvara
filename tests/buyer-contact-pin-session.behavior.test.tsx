// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { readPediaContact, rememberPediaContact } from "@/lib/pedia/buyer-session";

const CODE = "AXP-20261028-FIXTURE1";
beforeEach(() => sessionStorage.clear());
it("the Pedia contact cache rejects PINs and removes prior PIN-shaped values", () => {
  rememberPediaContact(CODE, "0A2B4C");
  expect(sessionStorage.length).toBe(0);
  sessionStorage.setItem(`axp-contact:${CODE}`, JSON.stringify({ contact: "0A2B4C", until: Date.now() + 60000 }));
  expect(readPediaContact(CODE)).toBe(""); expect(sessionStorage.length).toBe(0);
});
it("full checkout contacts remain available for status and refill", () => {
  rememberPediaContact(CODE, "buyer@example.test"); expect(readPediaContact(CODE)).toBe("buyer@example.test");
  rememberPediaContact(CODE, "081234567890"); expect(readPediaContact(CODE)).toBe("081234567890");
});
