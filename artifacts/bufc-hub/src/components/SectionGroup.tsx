import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SectionDef {
  id: string;
  title: string;
  summary?: ReactNode;
  content: ReactNode;
}

export interface SectionGroupProps {
  id: string;
  sections: SectionDef[];
  defaultExpandedMobile: string[];
  defaultExpandedDesktop: string[];
  className?: string;
}

export function SectionGroup({
  id,
  sections,
  defaultExpandedMobile,
  defaultExpandedDesktop,
  className,
}: SectionGroupProps) {
  const storageKey = `bufc-hub.section-group.${id}`;

  const [expanded, setExpanded] = useState<string[]>(() => {
    let saved: string[] | null = null;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          saved = parsed;
        }
      }
    } catch {
      // A malformed preference should not prevent the page from loading.
    }

    if (saved) {
      return saved.filter((savedId) => sections.some((section) => section.id === savedId));
    }

    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return defaultExpandedMobile;
    }
    return defaultExpandedDesktop;
  });

  const sectionIdKey = sections.map((section) => section.id).join("\u0000");

  useEffect(() => {
    const validIds = new Set(sectionIdKey ? sectionIdKey.split("\u0000") : []);
    setExpanded((previous) => {
      const valid = previous.filter((sectionId) => validIds.has(sectionId));
      return valid.length === previous.length ? previous : valid;
    });
  }, [sectionIdKey]);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(expanded));
    } catch {
      // Section persistence is an enhancement; collapsing still works without it.
    }
  }, [expanded, storageKey]);

  const toggleSection = useCallback((sectionId: string, open: boolean) => {
    setExpanded((prev) => {
      if (open) return Array.from(new Set([...prev, sectionId]));
      return prev.filter((x) => x !== sectionId);
    });
  }, []);

  const expandAll = () => setExpanded(sections.map((s) => s.id));
  const collapseAll = () => setExpanded([]);

  const validExpanded = expanded.filter((expandedId) =>
    sections.some((section) => section.id === expandedId),
  );
  const allExpanded = validExpanded.length === sections.length && sections.length > 0;
  const noneExpanded = validExpanded.length === 0;

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    setExpanded((prev) => Array.from(new Set([...prev, sectionId])));

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      const el = sectionRefs.current[sectionId];
      if (el) {
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
        triggerRefs.current[sectionId]?.focus({ preventScroll: true });
      }
    }, 100);
  }, []);

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4 sticky top-14 z-20 bg-background/95 backdrop-blur py-2 -mx-2 px-2 border-b border-border/50">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-2 font-medium">Jump to:</span>
          {sections.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className="px-2.5 py-1 text-xs font-medium bg-card border border-border rounded-md hover:bg-accent/10 hover:border-accent/40 transition-colors"
              data-testid={`jump-to-${id}-${s.id}`}
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={expandAll}
            disabled={allExpanded}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            data-testid={`expand-all-${id}`}
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            disabled={noneExpanded}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            data-testid={`collapse-all-${id}`}
          >
            <ChevronsDownUp className="w-3.5 h-3.5" />
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {sections.map((section) => {
          const isOpen = expanded.includes(section.id);
          return (
            <div
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className="scroll-mt-28"
            >
              <Collapsible
                open={isOpen}
                onOpenChange={(open) => toggleSection(section.id, open)}
              >
                <h3>
                  <CollapsibleTrigger
                    ref={(element) => {
                      triggerRefs.current[section.id] = element;
                    }}
                    className="group flex w-full items-center justify-between rounded-lg border border-primary/20 bg-primary/[0.06] px-4 py-3 text-left transition-colors hover:bg-primary/[0.10] data-[state=open]:border-primary/30 data-[state=open]:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid={`trigger-${id}-${section.id}`}
                  >
                    <span className="flex items-center gap-4">
                      <span className="text-lg font-semibold tracking-tight">{section.title}</span>
                      {section.summary && (
                        <span className="hidden text-sm font-normal text-muted-foreground sm:inline-block">
                          {section.summary}
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                </h3>
                <CollapsibleContent className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
                  <div className="pt-4">{section.content}</div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </div>
    </div>
  );
}