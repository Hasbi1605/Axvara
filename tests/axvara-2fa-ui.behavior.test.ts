// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("2fa/public/index.html", "utf8");
const bodyHtml = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, "");

const SEED_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC 6238 test key

const flush = async () => {
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));
};

async function mountApp(serverNowOffsetMs = 0) {
  vi.resetModules();
  document.documentElement.innerHTML = `<head></head><body>${bodyHtml}</body>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/time")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ now: Date.now() + serverNowOffsetMs }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
  await import("../2fa/public/app.js");
  await flush();
}

describe("AXVARA 2FA UI behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
  });

  it("generates live 6-digit TOTP immediately on paste, copies clean digits without disabling button", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mountApp();

    expect(document.getElementById("state-empty")!.hidden).toBe(false);
    expect(document.getElementById("state-single")!.hidden).toBe(true);
    expect(document.getElementById("saved-section")!.hidden).toBe(true);
    expect(document.getElementById("skew-bar")!.hidden).toBe(true);

    const input = document.getElementById("secret-input") as HTMLTextAreaElement;
    input.value = SEED_SHA1;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(document.getElementById("state-single")!.hidden).toBe(false);
    expect(document.getElementById("state-empty")!.hidden).toBe(true);
    const codeText = document.getElementById("single-code-value")!.textContent!;
    expect(codeText).toMatch(/^\d{3} \d{3}$/);

    const copyBtn = document.getElementById("single-copy") as HTMLButtonElement;
    copyBtn.click();
    await flush();

    expect(writeText).toHaveBeenCalledWith(codeText.replace(/\s+/g, ""));
    expect(copyBtn.disabled).toBe(false); // Never disable copy button during feedback
    expect(copyBtn.hasAttribute("data-copied")).toBe(true);
    expect(copyBtn.textContent).toContain("Tersalin");
  });

  it("flags 6-digit OTP input cleanly and clears error once valid secret is entered", async () => {
    await mountApp();
    const input = document.getElementById("secret-input") as HTMLTextAreaElement;
    input.value = "482910";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const err = document.getElementById("input-error")!;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain("6 digit");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("input-error");

    input.value = "JBSW Y3DP EHPK 3PXP";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(err.hidden).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("switches to bulk mode for multi-line input, hides passwords, resists XSS, and supports copy all", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mountApp();

    const input = document.getElementById("secret-input") as HTMLTextAreaElement;
    input.value = [
      "user1@axvara.tech|TopSecretPassword99|JBSWY3DPEHPK3PXP",
      "otpauth://totp/<script>alert(1)</script>:acct@test.io?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      "bad-line-123",
    ].join("\n");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(document.getElementById("state-bulk")!.hidden).toBe(false);
    const bulkList = document.getElementById("bulk-list")!;
    expect(bulkList.querySelectorAll("li")).toHaveLength(3);
    expect(bulkList.querySelector("script")).toBeNull();
    expect(bulkList.textContent).toContain("user1@axvara.tech");
    expect(bulkList.textContent).not.toContain("TopSecretPassword99");
    expect(document.getElementById("bulk-count")!.textContent).toContain("2 valid");

    (document.getElementById("bulk-copy-all") as HTMLButtonElement).click();
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedLines = (writeText.mock.calls[0] as unknown as [string])[0].split("\n");
    expect(copiedLines).toHaveLength(2);
    expect(copiedLines[0]).toMatch(/^user1@axvara\.tech\t\d{6}$/);
  });

  it("toggles advanced options (8-digit/SHA-256) and closes options bar with Escape", async () => {
    await mountApp();
    const toggle = document.getElementById("options-toggle") as HTMLButtonElement;
    const bar = document.getElementById("options-bar")!;
    expect(bar.hidden).toBe(true);

    toggle.click();
    expect(bar.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const digits = document.getElementById("opt-digits") as HTMLSelectElement;
    digits.value = "8";
    digits.dispatchEvent(new Event("change", { bubbles: true }));

    const input = document.getElementById("secret-input") as HTMLTextAreaElement;
    input.value = SEED_SHA1;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(document.getElementById("single-code-value")!.textContent).toMatch(/^\d{4} \d{4}$/);
    expect(document.getElementById("single-spec")!.textContent).toContain("8 digit");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bar.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("saves keys locally in browser storage, persists on remount, and clears cleanly", async () => {
    await mountApp();
    const input = document.getElementById("secret-input") as HTMLTextAreaElement;
    input.value = "ChatGPT Plus: JBSWY3DPEHPK3PXP";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const saveBtn = document.getElementById("single-save") as HTMLButtonElement;
    saveBtn.click();
    await flush();

    expect(saveBtn.textContent).toBe("Tersimpan");
    expect(document.getElementById("saved-section")!.hidden).toBe(false);
    expect(document.getElementById("saved-list")!.textContent).toContain("ChatGPT Plus");

    // Simulate reload: saved key persists and generates live code
    window.dispatchEvent(new Event("pagehide"));
    await mountApp();
    expect(document.getElementById("saved-section")!.hidden).toBe(false);
    expect(document.getElementById("saved-count")!.textContent).toBe("1");
    const savedCodeBtn = document.querySelector<HTMLButtonElement>("#saved-list button.row-code-btn")!;
    expect(savedCodeBtn.textContent).toMatch(/^\d{3} \d{3}$/);

    // Clear all removes saved section again
    (document.getElementById("saved-clear-all") as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById("saved-section")!.hidden).toBe(true);
  });

  it("shows clock-sync notice only when device clock skew exceeds 2 seconds", async () => {
    await mountApp(15_000);
    const bar = document.getElementById("skew-bar")!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain("+15 detik");
  });
});
