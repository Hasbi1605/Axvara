"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";

type Credential = { id: number; secret: string };
type Props = {
  inventory: Credential[];
  disabled: boolean;
  onMove: (id: number, index: number) => void;
  onRemove: (id: number) => void;
};
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function CredentialRow({ row, index, total, disabled, onMove, onRemove, reducedMotion }: {
  row: Credential; index: number; total: number; reducedMotion: boolean;
} & Omit<Props, "inventory">) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, activeIndex, overIndex } = useSortable({
    id: row.id, disabled,
    transition: { duration: reducedMotion ? 0 : 220, easing: EASING },
  });
  // This ghost moves to the predicted slot while its neighbors make room.
  // The floating card is rendered separately, outside the scroll clipping.
  const destination = isDragging && overIndex >= 0 ? overIndex : index;
  return (
    <li ref={setNodeRef} data-inventory-id={row.id} data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition, willChange: activeIndex >= 0 ? "transform" : undefined }}
      className={`relative flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${isDragging ? "border-dashed border-[#00E5FF]/70 bg-[#00E5FF]/[0.08]" : "border-transparent bg-white/[0.04]"}`}>
      {isDragging && <span data-drop-indicator="true" aria-hidden="true" className="pointer-events-none absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-[#00E5FF] shadow-[0_0_10px_#00E5FF80]" />}
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
        aria-label={`Geser kredensial ${index + 1}`} title="Tarik untuk mengatur urutan; Spasi untuk memakai keyboard"
        className={`shrink-0 touch-none select-none rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] disabled:opacity-30 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}>
        <GripVertical size={15} />
      </button>
      <span className="w-5 shrink-0 text-center text-[11px] text-[#5cefff]">{destination + 1}</span>
      <span className={`min-w-0 flex-1 truncate font-mono text-xs ${isDragging ? "text-[#5cefff]/60" : "text-white"}`}>{isDragging ? `Lepas di urutan ${destination + 1}` : row.secret}</span>
      <button type="button" aria-label={`Naikkan kredensial ${index + 1}`} title="Naikkan" onClick={() => onMove(row.id, index - 1)} disabled={disabled || activeIndex >= 0 || index === 0} className="shrink-0 rounded p-1 text-white/60 hover:bg-white/10 hover:text-[#00E5FF] disabled:opacity-20"><ArrowUp size={14} /></button>
      <button type="button" aria-label={`Turunkan kredensial ${index + 1}`} title="Turunkan" onClick={() => onMove(row.id, index + 1)} disabled={disabled || activeIndex >= 0 || index === total - 1} className="shrink-0 rounded p-1 text-white/60 hover:bg-white/10 hover:text-[#00E5FF] disabled:opacity-20"><ArrowDown size={14} /></button>
      <button type="button" onClick={() => onRemove(row.id)} disabled={disabled || activeIndex >= 0} className="shrink-0 text-[11px] font-semibold text-red-300 hover:text-red-200 hover:underline disabled:opacity-40">Hapus</button>
    </li>
  );
}

export function CredentialQueue({ inventory, disabled, onMove, onRemove }: Props) {
  const container = useRef<HTMLUListElement>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const itemIds = useMemo(() => inventory.map(row => row.id), [inventory]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const active = inventory.find(row => row.id === activeId);
  const reset = () => { setActiveId(null); setTargetIndex(null); };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
      autoScroll={{ threshold: { x: 0, y: 0.25 }, acceleration: 8, interval: 10, canScroll: element => element === container.current }}
      accessibility={{ screenReaderInstructions: { draggable: "Tekan Spasi untuk mengangkat kredensial, panah atas atau bawah untuk memindahkan, Spasi untuk menyimpan, atau Escape untuk membatalkan." } }}
      onDragStart={({ active }) => { setActiveId(Number(active.id)); setTargetIndex(inventory.findIndex(row => row.id === active.id)); }}
      onDragOver={({ over }) => { setTargetIndex(over ? inventory.findIndex(row => row.id === over.id) : null); }}
      onDragCancel={reset}
      onDragEnd={({ active, over }) => {
        reset();
        if (over && active.id !== over.id) onMove(Number(active.id), inventory.findIndex(row => row.id === over.id));
      }}>
      <p aria-live="polite" className="mb-1.5 min-h-4 text-[11px] text-[#5cefff]">{active && targetIndex !== null ? `Lepas di urutan ${targetIndex + 1} · Dekati tepi daftar untuk menggulir` : ""}</p>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul ref={container} aria-label="Urutan pengiriman kredensial"
          className={`max-h-48 space-y-1.5 overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#080C1E]/65 p-2.5 ${active ? "select-none" : ""}`}>
          {inventory.map((row, index) => <CredentialRow key={row.id} row={row} index={index} total={inventory.length} disabled={disabled} reducedMotion={reducedMotion} onMove={onMove} onRemove={onRemove} />)}
        </ul>
      </SortableContext>
      {typeof document !== "undefined" && createPortal(
        <DragOverlay zIndex={10000} dropAnimation={reducedMotion ? null : { duration: 220, easing: EASING }}>
          {active ? <div aria-hidden="true" data-credential-drag-overlay="true"
            className="pointer-events-none flex cursor-grabbing items-center gap-2 rounded-lg border border-[#00E5FF]/70 bg-[#172238] px-2.5 py-3 text-xs shadow-[0_16px_40px_#0009,0_0_0_1px_#00E5FF33]">
            <GripVertical size={15} className="shrink-0 text-[#5cefff]" />
            <span className="shrink-0 text-[#5cefff]">{(targetIndex ?? 0) + 1}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-white">{active.secret}</span>
          </div> : null}
        </DragOverlay>, document.body,
      )}
    </DndContext>
  );
}
