"use client";

import { useEffect, useState } from "react";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/site";

let cachedSettings = DEFAULT_STORE_SETTINGS;
let settingsRequest: Promise<StoreSettings> | null = null;
let loadedAt = 0;
let revision = 0;
const invalidatedStorageEvents = new WeakSet<StorageEvent>();

function loadSettings() {
  if (loadedAt && Date.now() - loadedAt < 30_000) return Promise.resolve(cachedSettings);
  if (!settingsRequest) {
    const started = revision;
    const request: Promise<StoreSettings> = fetch("/api/store-settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Pengaturan toko gagal dimuat");
        const body = await response.json();
        if (started !== revision) return cachedSettings;
        cachedSettings = { ...DEFAULT_STORE_SETTINGS, ...(body.settings ?? {}) };
        loadedAt = Date.now();
        return cachedSettings;
      })
      .catch(() => cachedSettings).finally(() => { if (settingsRequest === request) settingsRequest = null; });
    settingsRequest = request;
  }
  return settingsRequest;
}

export function useStoreSettings() {
  const [settings, setSettings] = useState<StoreSettings>(cachedSettings);
  useEffect(() => {
    const onChange = (event: Event) => setSettings((event as CustomEvent<StoreSettings>).detail);
    window.addEventListener("axvara:store-settings", onChange);
    const refresh = () => { if (!document.hidden) void loadSettings().then(setSettings); };
    const storage = (event: StorageEvent) => {
      if (event.key === "axvara:settings-updated") {
        if (!invalidatedStorageEvents.has(event)) {
          invalidatedStorageEvents.add(event);
          revision++; loadedAt = 0; settingsRequest = null;
        }
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", refresh);
    void loadSettings().then(setSettings);
    return () => {
      window.removeEventListener("axvara:store-settings", onChange);
      window.removeEventListener("focus", refresh); window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return settings;
}

export function publishStoreSettings(settings: StoreSettings) {
  cachedSettings = settings;
  revision++;
  loadedAt = Date.now();
  try { localStorage.setItem("axvara:settings-updated", String(loadedAt)); } catch { /* optional cross-tab refresh */ }
  window.dispatchEvent(new CustomEvent<StoreSettings>("axvara:store-settings", { detail: settings }));
}
