// The drag edge of the sidebar and of the side pane, used by Sidebar.tsx and
// SidePane.tsx. Mouse, pen and touch drag it (pointer events, with the
// browser's own touch scrolling turned off on the handle in styles.css), and
// it is a focusable separator the arrow keys move: 16px a press, 64px with
// Shift. The caller keeps the width and clamps it; this only reports moves.
import type { KeyboardEvent, PointerEvent } from "react";

export function ResizeHandle({
  className,
  label,
  width,
  min,
  max,
  grow,
  fromPointer,
  onChange,
  onCommit,
}: {
  className: string;
  label: string;
  width: number;
  min: number;
  max: number;
  /** Which arrow widens it: 1 for a handle on the right edge, -1 on the left. */
  grow: 1 | -1;
  /** The width a pointer at this x would give. */
  fromPointer: (clientX: number) => number;
  onChange: (width: number) => void;
  /** A drag or key press has finished: keep the width. */
  onCommit: () => void;
}) {
  // Pointer capture keeps the drag alive when the pointer outruns the handle.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: globalThis.PointerEvent) => onChange(fromPointer(ev.clientX));
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      onCommit();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (direction === 0) return;
    e.preventDefault();
    onChange(width + direction * grow * (e.shiftKey ? 64 : 16));
    onCommit();
  };

  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag, or use the arrow keys, to resize"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
