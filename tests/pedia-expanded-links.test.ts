import { describe, expect, it } from "vitest";
import { detectPediaLink } from "@/lib/pedia/link";
import { pediaMatches } from "@/lib/pedia/platforms";

describe("Expanded Pedia target contracts", () => {
  it.each([
    ["https://facebook.com/user/videos/1234567", "facebook", "video"],
    ["https://facebook.com/user/posts/1234567", "facebook", "post"],
    ["https://github.com/octocat", "github", "profile"],
    ["https://github.com/octocat/hello-world", "github", "repository"],
    ["https://t.me/channel_name/123", "telegram", "post"],
    ["https://t.me/channel_name", "telegram", "channel"],
    ["https://discord.com/invite/axvara", "discord", "invite"],
    ["https://www.linkedin.com/company/axvara/", "linkedin", "company"],
    ["https://linkedin.com/feed/update/urn:li:activity:123456789/", "linkedin", "post"],
    ["https://pinterest.com/user/my-board/", "pinterest", "board"],
    ["https://www.pinterest.com/pin/123456789/", "pinterest", "post"],
    ["https://soundcloud.com/artist/song", "soundcloud", "track"],
    ["https://twitch.tv/channel_name", "twitch", "profile"],
  ])("recognizes %s without confusing target kinds", (url, platform, targetKind) => {
    expect(detectPediaLink(url)).toMatchObject({ platform, targetKind });
  });
  it("only accepts arbitrary websites in an explicitly selected traffic product and retains its query", () => {
    expect(detectPediaLink("https://example.com/landing?campaign=one#top")).toBeNull();
    expect(detectPediaLink("https://example.com/landing?campaign=one#top", "website")).toMatchObject({ platform: "website", targetKind: "website", normalized: "https://example.com/landing?campaign=one" });
  });
  it.each(["http://localhost/x", "http://127.0.0.1/x", "http://169.254.169.254", "https://admin:pass@example.com", "https://example.com:3000", "file:///etc/passwd", "https://[::1]/"]) ("rejects unsuitable website target %s", (url) => {
    expect(detectPediaLink(url, "website")).toBeNull();
  });
  it.each(["https://open.spotify.com/album/ABC", "https://open.spotify.com/playlist/ABC", "https://evilshopee.co.id/username", "https://shope.ee/short", "https://github.com/login", "https://github.com/name/repo/issues", "https://t.me/share/url", "https://discord.com/channels/me", "https://twitch.tv/directory", "ftp://github.com/octocat"]) ("rejects a navigation page or unsupported target %s", (url) => {
    expect(detectPediaLink(url)).toBeNull();
  });
  it("searches buyer synonyms independent of query word order", () => {
    expect(pediaMatches("pengikut indo", "Followers Instagram Indonesia")).toBe(true);
    expect(pediaMatches("tayangan tiktok", "Views TikTok")).toBe(true);
    expect(pediaMatches("kunjungan", "Website Traffic")).toBe(true);
  });
});
