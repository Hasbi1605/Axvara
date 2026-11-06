"use client";
import { createContext, type ReactNode } from "react";

export const PaymentTestScope = createContext(false);

export function PaymentTestProvider({ children }: { children: ReactNode }) {
  return <PaymentTestScope.Provider value={true}>{children}</PaymentTestScope.Provider>;
}
