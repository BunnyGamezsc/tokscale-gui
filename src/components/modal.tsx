import { useEffect, useRef, type ReactNode } from "react";

/** The native `<dialog>`, opened modally.
 *
 *  Not a portal-and-focus-trap of our own: `showModal()` gives the backdrop,
 *  focus containment, Esc-to-close and — an acceptance criterion of #31 —
 *  focus restored to whatever opened it. That last one survives the conditional
 *  rendering both callers use: `close()` restores focus *before* it dispatches
 *  `close`, so React unmounts afterwards.
 *
 *  Shared by the Daily/Models detail and the Shortcuts sheet, which had the same
 *  fifteen lines twice.
 */
export function Modal({
  title,
  aside,
  onClose,
  className = "",
  children,
}: {
  title: string;
  /** A figure that belongs beside the title — for a detail, the figure on the
   *  row it opened from, which its footer must equal. */
  aside?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop clicks land on the dialog itself, never on its content.
        if (e.target === ref.current) ref.current?.close();
      }}
      className={`rounded-md border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/25 ${className}`}
    >
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h2 className="text-small font-semibold">{title}</h2>
        {aside && <span className="tnum font-mono text-small text-muted-foreground">{aside}</span>}
      </header>
      {children}
    </dialog>
  );
}
