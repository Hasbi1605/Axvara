"use client";

import { useEffect, useState } from "react";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/site";

let cachedSettings = DEFAULT_STORE_SETTINGS;
let settingsRequest: Promise<StoreSettings> | null = null;

function loadSettings() {
  if (!settingsRequest) {
    settingsRequest = fetch("/api/store-settings")
      .then(async (response) => {
        if (!response.ok) throw new Error("Pengaturan toko gagal dimuat");
        const body = await response.json();
        cachedSettings = { ...DEFAULT_STORE_SETTINGS, ...(body.settings ?? {}) };
        return cachedSettings;
      })
      .catch(() => cachedSettings);
  }
  return settingsRequest;
}

export function useStoreSettings() {
  const [settings, setSettings] = useState<StoreSettings>(cachedSettings);
  useEffect(() => {
    const onChange = (event: Event) => setSettings((event as CustomEvent<StoreSettings>).detail);
    window.addEventListener("axvara:store-settings", onChange);
    void loadSettings().then(setSettings);
    return () => window.removeEventListener("axvara:store-settings", onChange);
  }, []);
  return settings;
}

export function publishStoreSettings(settings: StoreSettings) {
  cachedSettings = settings;
  settingsRequest = Promise.resolve(settings);
  window.dispatchEvent(new CustomEvent<StoreSettings>("axvara:store-settings", { detail: settings }));
}
