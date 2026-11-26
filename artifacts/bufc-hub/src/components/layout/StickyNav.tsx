import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Publish the actual wrapped height so chart jump bars remain below the navigation. */
export function StickyNav({ summary, children, testId }: { summary: ReactNode[]; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const update = () => {
      const height = el.getBoundingClientRect().height + 8;
      parent.style.setProperty("--analysis-nav-height", `${height}px`);
      parent.style.setProperty("--analysis-nav-top", `calc(${height}px - var(--analysis-scroll-padding, 0px))`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      parent.style.removeProperty("--analysis-nav-height");
      parent.style.removeProperty("--analysis-nav-top");
    };
  }, []);
  const parts = summary.filter(Boolean);
  return (
    <div
      ref={ref}
      style={{ top: "calc(0px - var(--analysis-scroll-padding, 0px))" }}
      className="sticky z-30 -mx-4 md:-mx-8 min-w-0 border-b border-border bg-background px-4 md:px-8 py-3"
      data-testid={testId}
    >
      <div className="min-w-0 space-y-2">{children}</div>
      {parts.length > 0 && (
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs" aria-live="polite" data-testid={testId ? `${testId}-summary` : undefined}>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Now showing</span>
          {parts.map((p, i) => (
            <span key={i} className={`min-w-0 break-words ${i === parts.length - 1 ? "font-semibold text-primary" : "text-foreground"}`}>
              {i > 0 && <span className="mr-1.5 text-muted-foreground/60">/</span>}{p}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
