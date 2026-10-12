"use client";
import { create } from "zustand";

type PediaSearchStore = {
  q: string;
  setQ: (q: string) => void;
};

export const usePediaSearch = create<PediaSearchStore>((set) => ({
  q: "",
  setQ: (q) => set({ q }),
}));
