import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A trigger + floating menu pair rendered through a portal into document.body.
 *
 * Why: menus that live inside tables/cards use `position: absolute`, which
 * gets clipped or visually duplicated whenever an ancestor has
 * `overflow-hidden`/`overflow-x-auto` (rounded table wrappers, scroll
 * containers, etc). Rendering into a portal with `position: fixed` and a
 * measured rect sidesteps all of that — the menu always floats above
 * everything, never gets clipped, and never overlaps neighbouring rows.
 */
export function StatusMenu({
  trigger,
  children,
  open,
  onClose,
  align = 'left',
  width = 176,
}: {
  trigger: (opts: { ref: React.RefObject<HTMLButtonElement> }) => React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  width?: number;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const menuH = menuRef.current?.offsetHeight ?? 200;
      const openUp = r.bottom + menuH + 8 > vh;
      const top = openUp ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.min(Math.max(8, left), vw - width - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onClose();
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  return (
    <>
      {trigger({ ref: btnRef })}
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
            className="z-100 bg-surface rounded-lg ring-1 ring-ink/10 shadow-card py-1 animate-scale-in origin-top"
            onClick={e => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
