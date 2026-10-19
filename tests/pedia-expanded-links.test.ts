import { describe, expect, it } from "vitest";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
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
    ["https://open.spotify.com/artist/ABC123", "spotify", "artist"],
    ["https://open.spotify.com/playlist/ABC123", "spotify", "playlist"],
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
  it.each(["https://open.spotify.com/album/ABC", "https://evilshopee.co.id/username", "https://shope.ee/short", "https://github.com/login", "https://github.com/name/repo/issues", "https://t.me/share/url", "https://discord.com/channels/me", "https://twitch.tv/directory", "ftp://github.com/octocat"]) ("rejects a navigation page or unsupported target %s", (url) => {
    expect(detectPediaLink(url)).toBeNull();
  });
  it("searches buyer synonyms independent of query word order", () => {
    expect(pediaMatches("pengikut indo", "Followers Instagram Indonesia")).toBe(true);
    expect(pediaMatches("tayangan tiktok", "Views TikTok")).toBe(true);
    expect(pediaMatches("kunjungan", "Website Traffic")).toBe(true);
  });
});

it("requires an actual Shorts link for the Shorts product while preserving legacy video compatibility",()=>{
  const short=detectPediaLink("https://www.youtube.com/shorts/ABC123xyz");
  const video=detectPediaLink("https://www.youtube.com/watch?v=ABC123xyz");
  expect(short?.normalized).toBe("https://www.youtube.com/shorts/ABC123xyz");
  expect(short&&pediaTargetMatches("short",short.targetKind)).toBe(true);
  expect(video&&pediaTargetMatches("short",video.targetKind)).toBe(false);
  expect(short&&pediaTargetMatches("video",short.targetKind)).toBe(true);
  expect(detectPediaLink("https://www.youtube.com/shorts/ABC123xyz/extra")).toBeNull();
});

it.each(["artist", "playlist", "track"])("normalizes Spotify locale-prefixed %s links without loosening target kinds", kind => {
  expect(detectPediaLink(`https://open.spotify.com/intl-id/${kind}/ABC123?si=public`)).toMatchObject({platform:"spotify",targetKind:kind,normalized:`https://open.spotify.com/${kind}/ABC123`});
  expect(detectPediaLink(`https://open.spotify.com/intl-en-US/${kind}/ABC123`)).toMatchObject({targetKind:kind});
  expect(detectPediaLink(`https://open.spotify.com/browse/${kind}/ABC123`)).toBeNull();
  expect(detectPediaLink(`https://open.spotify.com/intl-id/${kind}/ABC123/extra`)).toBeNull();
});
