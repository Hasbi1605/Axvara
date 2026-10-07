// tests/pedia-link.test.ts — PEDIA M1: parser link §9.6 (tabel pola, shared client+server).
import { describe, expect, it } from "vitest";
import { detectPediaLink } from "@/lib/pedia/link";

describe("detectPediaLink §9.6", () => {
  it("Instagram: profil, @user, post (buang query & igsh)", () => {
    expect(detectPediaLink("https://www.instagram.com/namakamu")).toMatchObject({
      platform: "instagram", targetKind: "profile",
      normalized: "https://www.instagram.com/namakamu/",
    });
    expect(detectPediaLink("@NamaKamu")).toMatchObject({
      platform: "instagram", targetKind: "profile",
      normalized: "https://www.instagram.com/namakamu/",
    });
    // AC-02: query igsh dibuang.
    expect(detectPediaLink("https://www.instagram.com/p/XYZ/?igsh=abc")).toMatchObject({
      platform: "instagram", targetKind: "post",
      normalized: "https://www.instagram.com/p/XYZ/",
    });
    expect(detectPediaLink("https://instagram.com/reel/ABC123/?utm=x")).toMatchObject({
      platform: "instagram", targetKind: "reel",
      normalized: "https://www.instagram.com/reel/ABC123/",
    });
  });

  it("TikTok: profil, video, short link apa adanya", () => {
    expect(detectPediaLink("https://www.tiktok.com/@user")).toMatchObject({
      platform: "tiktok", targetKind: "profile",
      normalized: "https://www.tiktok.com/@user",
    });
    expect(detectPediaLink("https://www.tiktok.com/@user/video/12345")).toMatchObject({
      platform: "tiktok", targetKind: "video",
      normalized: "https://www.tiktok.com/@user/video/12345",
    });
    const short = detectPediaLink("https://vt.tiktok.com/AbC12/?x=1");
    expect(short).toMatchObject({ platform: "tiktok", targetKind: "video" });
    expect(short?.normalized).toBe("https://vt.tiktok.com/AbC12");
  });

  it("YouTube: channel, watch, youtu.be, shorts", () => {
    expect(detectPediaLink("https://youtube.com/@kanal")).toMatchObject({
      platform: "youtube", targetKind: "channel",
    });
    expect(detectPediaLink("https://www.youtube.com/watch?v=ABC123xyz&si=qq")).toMatchObject({
      platform: "youtube", targetKind: "video",
      normalized: "https://www.youtube.com/watch?v=ABC123xyz",
    });
    expect(detectPediaLink("https://youtu.be/ABC123xyz")).toMatchObject({
      platform: "youtube", targetKind: "video",
      normalized: "https://www.youtube.com/watch?v=ABC123xyz",
    });
    expect(detectPediaLink("https://www.youtube.com/shorts/ABC123xyz")).toMatchObject({
      platform: "youtube", targetKind: "video",
    });
  });

  it("Facebook, Threads, Shopee, Spotify", () => {
    expect(detectPediaLink("https://facebook.com/namapage")).toMatchObject({
      platform: "facebook", targetKind: "profile",
    });
    expect(detectPediaLink("https://www.facebook.com/reel/123")).toMatchObject({
      platform: "facebook", targetKind: "video",
    });
    expect(detectPediaLink("https://www.threads.net/@user")).toMatchObject({
      platform: "threads", targetKind: "profile",
    });
    expect(detectPediaLink("https://shopee.co.id/tokomu")).toMatchObject({
      platform: "shopee", targetKind: "shop",
    });
    expect(detectPediaLink("https://open.spotify.com/track/ABC?si=xx")).toMatchObject({
      platform: "spotify", targetKind: "track",
      normalized: "https://open.spotify.com/track/ABC",
    });
  });

  it("tak dikenal → null (pesan netral, bukan merah)", () => {
    expect(detectPediaLink("https://example.com/foo")).toBeNull();
    expect(detectPediaLink("halo dunia")).toBeNull();
    expect(detectPediaLink("")).toBeNull();
  });

  it("username disamarkan (@ma***a)", () => {
    expect(detectPediaLink("https://instagram.com/maria")?.displayUser).toBe("@ma***a");
  });
});
