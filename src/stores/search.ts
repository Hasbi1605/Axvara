"use client";
import { create } from "zustand";

type SearchStore = {
  q: string;
  setQ: (q: string) => void;
};

export const useSearch = create<SearchStore>((set) => ({
  q: "",
  setQ: (q) => set({ q }),
}));
