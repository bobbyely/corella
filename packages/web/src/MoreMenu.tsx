// The "···" menu in the chat header: the actions that used to sit in the
// header as a row of buttons (Files, Export, the games) now live here, so the
// header holds only what you look at often. Rendered by Chat.tsx; holds only
// whether it is open. Keyboard: Enter or Space opens it, arrows move, Escape
// closes and gives focus back to the button. The new chat's folder picker is
// the same menu with its own button and a heading (Composer.tsx).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons.js";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  /** A link instead of an action: Export is a download the server names. */
  href?: string;
  download?: boolean;
  onSelect?: () => void;
  /** Ticked: the value in use, for a menu that picks one. */
  checked?: boolean;
  /** A path or other literal, set in the mono face. */
  mono?: boolean;
  /** A rule above it, setting it apart from the list. */
  separated?: boolean;
  /** The whole of a label that was shortened, such as a folder's path. */
  title?: string;
  className?: string;
}

export function MoreMenu({
  items,
  trigger,
  heading,
}: {
  items: MenuItem[];
  /** The button, when it is not the plain "···". */
  trigger?: { content: ReactNode; className: string; label: string };
  heading?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const entries = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]") ?? []);

  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    // Any press outside closes it, like a native menu.
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      // Stops the app-wide Escape from also leaving the chat.
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      all[(at + step + all.length) % all.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="more">
      <button
        ref={button}
        className={trigger?.className ?? "plain icon"}
        aria-label={trigger?.label ?? "More"}
        title={trigger?.label ?? "More"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger?.content ?? <Icon name="more" />}
      </button>
      {open && (
        <div className="more-menu" role="menu" ref={menu} onKeyDown={onKeyDown} aria-label={heading}>
          {heading && <h2 className="rule-label">{heading}</h2>}
          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                role="menuitem"
                tabIndex={-1}
                href={item.href}
                download={item.download}
                onClick={() => setOpen(false)}
              >
                {item.icon}
                {item.label}
              </a>
            ) : (
              <button
                key={item.title ?? item.label}
                title={item.title}
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                tabIndex={-1}
                className={`${item.mono ? "mono" : ""} ${item.separated ? "separated" : ""} ${item.className ?? ""}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.checked !== undefined && <span className="menu-check">{item.checked && <Icon name="check" size={14} />}</span>}
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
