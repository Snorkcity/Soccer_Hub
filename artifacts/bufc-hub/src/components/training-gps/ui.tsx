import type { ReactNode } from "react";
import type { TrainingInsight } from "@workspace/api-zod";
import { AlertTriangle, Info } from "lucide-react";

export function Panel({ title, kicker, context, aside, children, testId }: { title: string; kicker?: string; context?: string; aside?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rounded-xl border border-card-border bg-card/80 p-4 sm:p-5">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {kicker && <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">{kicker}</p>}
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          {context && <p className="mt-1 text-xs text-muted-foreground">{context}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-base font-bold leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "watch" }) {
  const Icon = tone === "watch" ? AlertTriangle : Info;
  return (
    <p className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${tone === "watch" ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-border bg-muted/30 text-muted-foreground"}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function InsightList({ insights, testId }: { insights: TrainingInsight[]; testId: string }) {
  return (
    <Panel title="What the evidence shows" kicker="Insights" testId={testId}>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not enough recorded evidence for a finding yet.</p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2">
          {insights.map((i, idx) => (
            <li key={idx} data-testid={`${testId}-item-${idx}`}
              className={`rounded-lg border-l-2 bg-muted/30 px-4 py-3 ${i.tone === "watch" ? "border-amber-400" : "border-primary"}`}>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="font-mono text-[10px] text-muted-foreground">{String(idx + 1).padStart(2, "0")}</span>
                {i.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{i.evidence}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">Findings describe recorded output only — they are not effort grades. The untrimmed full recording is never included.</p>
    </Panel>
  );
}

export const tooltipStyle = {
  contentStyle: { background: "hsl(209 61% 14%)", border: "1px solid hsl(206 59% 28%)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "hsl(210 40% 98%)", fontWeight: 600 },
};
export const axisProps = { stroke: "hsl(215 20% 65%)", fontSize: 11, tickLine: false } as const;
