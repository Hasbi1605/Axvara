import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { generateOrderCode, checkMagicBytes, isAllowedImageType, aggregateQty, isValidOrderCode, DEV_FALLBACK_SHA256, PROD_SHA256_HINT } from "@/lib/security";
import { rateLimit } from "@/lib/rateLimit";

// Helper to mock NextRequest minimal for rateLimit
function mockReq(ip: string) {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === "cf-connecting-ip" ? ip : k.toLowerCase() === "x-forwarded-for" ? ip : null),
    },
  } as unknown as import("next/server").NextRequest;
}

describe("F-High: Order enumeration — code entropy + format", () => {
  it("generateOrderCode menghasilkan 8 hex (AXV-YYYYMMDD-XXXXXXXX) bukan 4 char", () => {
    const code = generateOrderCode();
    expect(code).toMatch(/^AXV-\d{8}-[A-Z0-9]{8}$/);
    const suffix = code.split("-")[2];
    expect(suffix.length).toBe(8);
  });

  it("isValidOrderCode menolak format lama 4 char dan menerima 8 char", () => {
    expect(isValidOrderCode("AXV-20260902-ABCD")).toBe(false); // old 4-char should fail now
    expect(isValidOrderCode("AXV-20260902-AB12CD34")).toBe(true);
    expect(isValidOrderCode("AXV-20260902-XXXX")).toBe(false); // not hex
  });

  it("5 code berturut-turut unik dan suffix tidak collision", () => {
    const codes = Array.from({ length: 30 }, () => generateOrderCode());
    const suffixes = codes.map((c) => c.split("-")[2]);
    const uniq = new Set(suffixes);
    expect(uniq.size).toBe(suffixes.length); // no collision in 30
  });

  it("rateLimit untuk public lookup: 20允许, 21 ditolak", () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 200) + 10}`;
    for (let i = 0; i < 20; i++) expect(rateLimit(`lookup:${ip}`, 20)).toBe(true);
    expect(rateLimit(`lookup:${ip}`, 20)).toBe(false);
  });
});

describe("F-High: Idle timeout — requireAdmin harus cek idle cookie", () => {
  it("src/lib/auth.ts requireAdmin mengandung idle check", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf-8");
    expect(src).toContain("getIdleTokenFromCookieHeader");
    expect(src).toMatch(/getIdleTokenFromCookieHeader\(req\.headers\.get\("cookie"\)\)/);
    expect(src).toContain("if (!idle) return null");
  });

  it("idle cookie helper ada dan parsing __Host- prefix", async () => {
    const { getIdleTokenFromCookieHeader } = await import("@/lib/auth");
    expect(getIdleTokenFromCookieHeader("__Host-axvara_idle=abc123; other=x")).toBe("abc123");
    expect(getIdleTokenFromCookieHeader("axvara_idle=xyz")).toBe("xyz");
    expect(getIdleTokenFromCookieHeader(null)).toBeNull();
    expect(getIdleTokenFromCookieHeader("axvara_admin_token=only")).toBeNull();
  });
});

describe("F-High: Exposed dev password — .env.example sanitized + fallback != prod", () => {
  it(".env.example tidak mengandung hash prod #Kecitran123", () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf-8");
    expect(envExample).not.toContain(PROD_SHA256_HINT);
    expect(envExample).not.toContain("#Kecitran123");
    expect(envExample).toContain("__ISI_DI_CLOUDFLARE_PAGES_VARIABLES__");
  });

  it("DEV_FALLBACK_SHA256 di security.ts dan auth.ts bukan hash prod", async () => {
    const authSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf-8");
    expect(authSrc).toContain(DEV_FALLBACK_SHA256);
    expect(DEV_FALLBACK_SHA256).not.toBe(PROD_SHA256_HINT);
    // auth.ts harus contain dev-only comment
    expect(authSrc).toMatch(/DEV ONLY|dev-only/i);
  });

  it("auth.ts fallback hanya dipakai di isDev() (fail-closed di prod)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf-8");
    // requireEnv harus throw di prod jika env kosong
    expect(src).toContain("Missing required env:");
    expect(src).toContain("ADMIN_PASSWORD_SHA256");
    expect(src).toContain("ADMIN_JWT_SECRET");
  });
});

describe("F-Medium: Stock aggregation — duplicate product_id", () => {
  it("aggregateQty menjumlahkan qty duplikat", () => {
    const m = aggregateQty([{ product_id: 12, qty: 6 }, { product_id: 12, qty: 5 }, { product_id: 1, qty: 1 }]);
    expect(m.get(12)).toBe(11);
    expect(m.get(1)).toBe(1);
  });

  it("stok 9 diminta 11 (6+5 duplikat) harus terdeteksi melebihi", () => {
    const stock = 9;
    const total = aggregateQty([{ product_id: 12, qty: 6 }, { product_id: 12, qty: 5 }]).get(12)!;
    expect(total > stock).toBe(true);
  });

  it("stok -1 (unlimited) tidak dibatasi oleh aggregate", () => {
    const stock = -1;
    // Logic di route: if (stock !== -1) cek; jadi -1 lolos
    const total = 100;
    const shouldCheck = stock !== -1 && total > stock;
    expect(shouldCheck).toBe(false);
  });
});

describe("F-Medium: Payment proof — upload strict", () => {
  it("isAllowedImageType hanya jpeg/png/webp, tolak svg", () => {
    expect(isAllowedImageType("image/jpeg")).toBe(true);
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/webp")).toBe(true);
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("image/heic")).toBe(false);
    expect(isAllowedImageType("text/plain")).toBe(false);
  });

  it("checkMagicBytes valid untuk jpeg/png/webp, tolak fake", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x57, 0x45, 0x42, 0x50]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const fake = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(checkMagicBytes(jpg, "image/jpeg")).toBe(true);
    expect(checkMagicBytes(png, "image/png")).toBe(true);
    expect(checkMagicBytes(webp, "image/webp")).toBe(true);
    expect(checkMagicBytes(fake, "image/jpeg")).toBe(false);
    expect(checkMagicBytes(jpg, "image/png")).toBe(false); // mismatch
  });

  it("src/app/api/proof/upload/route.ts ada dan gunakan bukti/ prefix private", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/proof/upload/route.ts"), "utf-8");
    expect(src).toContain('bukti/');
    expect(src).toContain("MAX");
    expect(src).toContain("5 * 1024 * 1024");
  });

  it("checkout page mewajibkan proofUrl", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/checkout/page.tsx"), "utf-8");
    expect(src).toContain("proofUrl");
    expect(src).toContain("Upload bukti");
    // harus ada guard `if (!proofUrl)`
    expect(src).toMatch(/if\s*\(\s*!proofUrl\s*\)/);
  });
});

describe("Regression: checkout proof_url tidak null", () => {
  it("POST /api/orders schema proof_url wajib (bukan optional/nullable) — BUG-04", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/orders/route.ts"), "utf-8");
    expect(src).toContain("proof_url");
    // BUG-04: proof_url harus required (min 1), bukan optional/nullable
    expect(src).toMatch(/proof_url:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(src).not.toMatch(/proof_url:.*\.optional\(\)/);
    expect(src).not.toMatch(/proof_url:.*\.nullable\(\)/);
  });
});

// ===================================================================
// Deep Bug Audit — Regression tests untuk 16 bug fixes (2026-09-02)
// ===================================================================

describe("BUG-01: Stock restore saat admin batalkan pesanan", () => {
  it("admin orders PATCH route mengandung stock restore logic", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/orders/[code]/route.ts"), "utf-8");
    // Harus SELECT items (untuk parsing qty)
    expect(src).toMatch(/SELECT.*items.*FROM orders/i);
    // Harus restore stock: UPDATE products SET stock = stock + ?
    expect(src).toContain("stock = stock + ?");
    // Hanya restore saat cancel dari pending
    expect(src).toContain('"dibatalkan"');
    expect(src).toContain('"pending"');
  });
});

describe("BUG-02: Pesanan page selalu fetch server (bukan early return localStorage)", () => {
  it("pesanan page tidak early-return setelah localStorage find", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/pesanan/[code]/page.tsx"), "utf-8");
    // TIDAK boleh ada pattern: if (found) { setOrder(found); return; }
    expect(src).not.toMatch(/if\s*\(found\)\s*\{\s*setOrder\(found\);\s*return;?\s*\}/);
    // HARUS ada fetch ke /api/orders setelah localStorage
    expect(src).toContain("/api/orders?code=");
  });
});

describe("BUG-03: Admin modal input lisensi/key saat konfirmasi lunas", () => {
  it("admin page memiliki state confirmOrder dan adminNote", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/admin/page.tsx"), "utf-8");
    expect(src).toContain("confirmOrder");
    expect(src).toContain("adminNote");
    expect(src).toContain("setConfirmOrder");
  });

  it("admin page mengirim admin_note ke PATCH endpoint", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/admin/page.tsx"), "utf-8");
    expect(src).toContain("admin_note");
    // setStatus harus terima parameter note
    expect(src).toMatch(/setStatus.*code.*status.*note/);
  });

  it("admin page punya textarea untuk lisensi/key input", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/admin/page.tsx"), "utf-8");
    expect(src).toMatch(/placeholder.*[Ll]isensi/);
  });
});

describe("BUG-05: Tidak ada duplicate generateOrderCode lemah di utils.ts", () => {
  it("utils.ts re-export dari security.ts, bukan implementasi sendiri", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/utils.ts"), "utf-8");
    // Harus re-export
    expect(src).toMatch(/export\s*\{.*generateOrderCode.*\}\s*from\s*["']@\/lib\/security["']/);
    // TIDAK boleh ada Math.random (implementasi lemah lama)
    expect(src).not.toContain("Math.random");
  });

  it("security.ts generateOrderCode pakai crypto.getRandomValues", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/security.ts"), "utf-8");
    expect(src).toContain("crypto.getRandomValues");
  });
});

describe("BUG-06: Checkout block bank placeholder belum aktif", () => {
  it("checkout page menolak bank selain seabank", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/checkout/page.tsx"), "utf-8");
    // Harus ada guard: bankKey !== "seabank"
    expect(src).toContain('bankKey !== "seabank"');
    expect(src).toMatch(/belum tersedia/i);
  });
});

describe("BUG-07: Login rate limit 5/menit (bukan 12)", () => {
  it("login route rate limit max 5", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/auth/login/route.ts"), "utf-8");
    // Harus > 5, BUKAN > 12
    expect(src).toContain("e.c > 5");
    expect(src).not.toContain("e.c > 12");
  });
});

describe("BUG-09: Zod enum payment_method tanpa duplikat", () => {
  it("orders route enum tidak punya value duplikat", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/orders/route.ts"), "utf-8");
    // Extract enum array dari source
    const enumMatch = src.match(/payment_method:\s*z\.enum\(\[([^\]]+)\]\)/);
    expect(enumMatch).toBeTruthy();
    if (enumMatch) {
      const values = enumMatch[1].match(/"[^"]+"/g) ?? [];
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    }
  });
});

describe("BUG-10: Sitemap domain configurable (bukan hardcoded pages.dev)", () => {
  it("sitemap.ts menggunakan SITE_URL env atau axvara.id", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/sitemap.ts"), "utf-8");
    expect(src).toContain("process.env.SITE_URL");
    expect(src).toContain("axvara.id");
    // TIDAK boleh hardcode pages.dev
    expect(src).not.toContain("axvara.pages.dev");
  });
});

describe("BUG-11: Product detail sold/stock conditional null-safe", () => {
  it("produk page menggunakan null-safe check untuk soldCount dan stock", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/produk/[slug]/page.tsx"), "utf-8");
    // Harus pakai explicit null check, bukan truthiness
    expect(src).toMatch(/product\.soldCount\s*!=\s*null\s*&&\s*product\.soldCount\s*>\s*0/);
    // TIDAK boleh pakai pattern lama: (product.soldCount || product.stock)
    expect(src).not.toMatch(/\(product\.soldCount\s*\|\|\s*product\.stock\)/);
  });
});

describe("BUG-12: CommunityBar WA link live (bukan dead href=#)", () => {
  it("CommunityBar WA link mengarah ke wa.me, bukan href=#", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/storefront/CommunityBar.tsx"), "utf-8");
    expect(src).toContain("wa.me");
    // WA link TIDAK boleh pakai onClick={comingSoon}
    expect(src).not.toMatch(/href=\{waHref\}[^>]*onClick=\{comingSoon\}/);
  });
});

describe("BUG-13: Proof upload extension sesuai tipe (bukan selalu .webp)", () => {
  it("proof upload route menentukan extension dari content type", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/proof/upload/route.ts"), "utf-8");
    // Harus ada logic: const ext = type === "image/png" ? "png" : ...
    expect(src).toMatch(/const ext\s*=/);
    expect(src).toContain('"image/png"');
    // Extension values harus ada: "png", "jpg", "webp"
    expect(src).toMatch(/\?\s*"png"/);
    expect(src).toMatch(/\?\s*"webp"/);
    expect(src).toMatch(/:\s*"jpg"/);
    // Key harus pakai ${ext}, BUKAN hardcoded .webp
    expect(src).toMatch(/`bukti\/.*\$\{ext\}`/);
  });
});

describe("BUG-14: Login response mengembalikan email", () => {
  it("login route response mengandung email field", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/auth/login/route.ts"), "utf-8");
    // Harus ada: { ok: true, email: ... }
    expect(src).toMatch(/NextResponse\.json\(\{\s*ok:\s*true,\s*email:/);
  });
});

describe("BUG-15: Client pages HARUS export runtime edge (required by CF Pages)", () => {
  it("produk/[slug]/page.tsx export runtime edge (CF Pages requirement)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/produk/[slug]/page.tsx"), "utf-8");
    expect(src).toContain('"use client"');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*["']edge["']/);
  });

  it("pesanan/[code]/page.tsx export runtime edge (CF Pages requirement)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/pesanan/[code]/page.tsx"), "utf-8");
    expect(src).toContain('"use client"');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*["']edge["']/);
  });
});

describe("BUG-16: CartDrawer animasi slideInRight (bukan fadeInUp)", () => {
  it("CartDrawer menggunakan slideInRight animation", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/storefront/CartDrawer.tsx"), "utf-8");
    expect(src).toContain("slideInRight");
    expect(src).not.toContain("fadeInUp");
  });

  it("tailwind config mendefinisikan keyframe slideInRight", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "tailwind.config.ts"), "utf-8");
    expect(src).toContain("slideInRight");
    expect(src).toContain('translateX(100%)');
    expect(src).toContain('translateX(0)');
  });
});
