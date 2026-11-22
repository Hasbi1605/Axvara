import { expect, it } from "vitest";
import { parseItems } from "@/lib/orders/items-json";

it("falls back to [] for absent, falsy, invalid and non-array stored items", () => {
  for (const raw of [undefined, null, "", false, 0, "[", "{}", "null", '"text"']) {
    expect(parseItems(raw)).toEqual([]);
  }
});

it("preserves every array member and its position without validation", () => {
  expect(parseItems('[null,false,0,"x",[],{}, {"qty":"2"}]')).toEqual([null, false, 0, "x", [], {}, { qty: "2" }]);
});
