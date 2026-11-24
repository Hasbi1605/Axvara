// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/ui/Toast";

function Trigger() {
  const toast = useToast();
  return <button onClick={() => toast.success("Produk disimpan")}>Simpan</button>;
}

it("cancels pending dismissal timers when ToastProvider unmounts", () => {
  vi.useFakeTimers();
  try {
    const { unmount } = render(<ToastProvider><Trigger /></ToastProvider>);
    const timersBefore = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(screen.getByText("Produk disimpan")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(timersBefore + 1);
    unmount();
    expect(vi.getTimerCount()).toBe(timersBefore);
  } finally {
    vi.useRealTimers();
  }
});
