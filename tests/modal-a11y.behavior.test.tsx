// @vitest-environment jsdom
//
// tests/modal-a11y.behavior.test.tsx — Bukti perilaku, bukan grep source.
//
// Sebelum ini seluruh 538 test berjalan di environment `node` dan pola
// include-nya hanya `.test.ts`, sehingga tidak ada satu pun test yang
// benar-benar merender komponen. Akibatnya QuickVariantModal bisa dikirim
// tanpa role dialog, tanpa Escape, dan tanpa focus trap tanpa ada yang
// memerah. Test ini menegakkan kontrak useModalA11y secara langsung.

import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef, useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useModalA11y } from "@/hooks/useModalA11y";

afterEach(() => cleanup());

/** Harness minimal yang meniru struktur modal storefront. */
function Modal({ onClose, withButtons = true }: { onClose: () => void; withButtons?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalA11y({ active: true, containerRef: panelRef, onClose, initialFocusRef: closeRef });
  return (
    <div role="dialog" aria-modal="true" aria-label="Uji modal">
      <div ref={panelRef} tabIndex={-1}>
        {withButtons && (
          <>
            <button ref={closeRef}>Tutup</button>
            <button>Tengah</button>
            <button>Terakhir</button>
          </>
        )}
      </div>
    </div>
  );
}

function Host({ withButtons = true }: { withButtons?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Pemicu</button>
      {open && <Modal onClose={() => setOpen(false)} withButtons={withButtons} />}
    </>
  );
}

describe("useModalA11y — kontrak aksesibilitas modal", () => {
  it("mengunci scroll body saat aktif dan memulihkan nilai sebelumnya saat ditutup", () => {
    document.body.style.overflow = "auto"; // nilai awal yang harus dipulihkan
    const onClose = vi.fn();
    const { unmount } = render(<Modal onClose={onClose} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("Escape memanggil onClose", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("memindahkan fokus awal ke initialFocusRef", async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      render(<Modal onClose={onClose} />);
      vi.runAllTimers(); // hook memakai setTimeout 0 agar node sudah terpasang
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tutup" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("Tab dari elemen terakhir kembali ke elemen pertama (trap maju)", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    const last = screen.getByRole("button", { name: "Terakhir" });
    const first = screen.getByRole("button", { name: "Tutup" });
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab dari elemen pertama melompat ke elemen terakhir (trap mundur)", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} />);
    const first = screen.getByRole("button", { name: "Tutup" });
    const last = screen.getByRole("button", { name: "Terakhir" });
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Tab saat fokus masih di luar panel ditarik masuk, tidak lolos ke latar", () => {
    const onClose = vi.fn();
    render(
      <>
        <button>Latar</button>
        <Modal onClose={onClose} />
      </>,
    );
    const background = screen.getByRole("button", { name: "Latar" });
    background.focus();
    expect(document.activeElement).toBe(background);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tutup" }));
  });

  it("panel tanpa elemen fokus tetap menahan Tab di dalam container", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} withButtons={false} />);
    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(panel);
  });

  it("mengembalikan fokus ke elemen pemicu setelah modal ditutup", () => {
    vi.useFakeTimers();
    try {
      render(<Host />);
      const trigger = screen.getByRole("button", { name: "Pemicu" });
      trigger.focus();
      fireEvent.click(trigger);
      vi.runAllTimers();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tutup" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.activeElement).toBe(trigger);
    } finally {
      vi.useRealTimers();
    }
  });

  it("melepas listener keydown setelah unmount (tidak ada onClose hantu)", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Modal onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tidak memasang apa pun saat active=false", () => {
    document.body.style.overflow = "visible";
    function Inactive() {
      const panelRef = useRef<HTMLDivElement>(null);
      useModalA11y({ active: false, containerRef: panelRef, onClose: () => {} });
      return <div ref={panelRef} />;
    }
    render(<Inactive />);
    expect(document.body.style.overflow).toBe("visible");
  });
});
