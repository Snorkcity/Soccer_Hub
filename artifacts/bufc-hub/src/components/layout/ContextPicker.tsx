import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveLeague, type LeagueOption } from "@/contexts/LeagueContext";

// Region is inferred from the competition name only — no extra data needed.
const REGIONS: { code: string; label: string; match: RegExp }[] = [
  { code: "ACT", label: "ACT", match: /\b(ACT|Capital Football|Canberra)\b/i },
  { code: "NSW", label: "NSW", match: /\b(NSW|New South Wales|Sydney)\b/i },
  { code: "VIC", label: "VIC", match: /\b(VIC|Victoria|Melbourne)\b/i },
  { code: "QLD", label: "QLD", match: /\b(QLD|Queensland|Brisbane)\b/i },
  { code: "SA", label: "SA", match: /\b(SA|South Australia|Adelaide)\b/i },
  { code: "WA", label: "WA", match: /\b(WA|Western Australia|Perth)\b/i },
  { code: "TAS", label: "TAS", match: /\b(TAS|Tasmania|Hobart)\b/i },
  { code: "NT", label: "NT", match: /\b(NT|Northern Territory|Darwin)\b/i },
];

export function leagueRegion(name: string): string {
  return REGIONS.find(r => r.match.test(name))?.label ?? "Other";
}

function groupLeagues(options: LeagueOption[]) {
  const groups = new Map<string, LeagueOption[]>();
  for (const o of options) {
    const region = leagueRegion(o.name);
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region)!.push(o);
  }
  const order = [...REGIONS.map(r => r.label), "Other"];
  return [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([region, items]) => ({ region, items: [...items].sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Searchable, grouped competition picker. Hidden choice when only one league. */
export function CompetitionPicker({ className = "" }: { className?: string }) {
  const { activeLeagueId, setActiveLeagueId, competitionOptions: leagueOptions, activeSeason } = useActiveLeague();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupLeagues(leagueOptions), [leagueOptions]);
  const current = leagueOptions.find(l => l.id === activeLeagueId);

  if (leagueOptions.length <= 1) {
    return current ? (
      <span className={`font-medium text-foreground ${className}`} data-testid="text-active-competition">{current.name}</span>
    ) : null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Competition: ${current?.name ?? "none selected"}. Change competition`}
          data-testid="button-competition-picker"
          className={`inline-flex h-7 max-w-[60vw] sm:max-w-[280px] items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 text-xs font-medium text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        >
          <span className="truncate">{current?.name ?? "Select competition"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(320px,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={`Search ${activeSeason?.year ?? ""} competitions...`} data-testid="input-competition-search" />
          <CommandList className="max-h-[min(320px,50vh)]">
            <CommandEmpty>
              <span className="text-xs text-muted-foreground">No competition matches that search.</span>
            </CommandEmpty>
            {groups.map(g => (
              <CommandGroup key={g.region} heading={g.region}>
                {g.items.map(l => {
                  const selected = l.id === activeLeagueId;
                  return (
                    <CommandItem
                      key={l.id}
                      value={`${l.name} ${g.region} ${l.id}`}
                      onSelect={() => { setActiveLeagueId(l.id); setOpen(false); }}
                      aria-selected={selected}
                      data-testid={`option-competition-${l.id}`}
                      className="text-xs"
                    >
                      <Check className={`mr-2 h-3.5 w-3.5 ${selected ? "opacity-100 text-primary" : "opacity-0"}`} />
                      <span className="truncate">{l.name}</span>
                      {selected && <span className="ml-auto pl-2 text-[10px] uppercase tracking-wide text-primary">Current</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Primary campaign picker: years from every accessible competition. */
export function SeasonPicker({ className = "" }: { className?: string }) {
  const { yearOptions, activeYear, setActiveYear } = useActiveLeague();
  if (!yearOptions.length) return null;
  if (yearOptions.length === 1) {
    return (
      <span className={`font-medium text-foreground ${className}`} data-testid="text-active-season">
        {activeYear ?? yearOptions[0]} season
      </span>
    );
  }
  return (
    <Select value={activeYear ?? ""} onValueChange={setActiveYear}>
      <SelectTrigger
        aria-label="Season year"
        data-testid="select-season"
        className={`h-7 w-auto min-w-[110px] gap-1.5 px-2 text-xs font-medium ${className}`}
      >
        <SelectValue placeholder="Season" />
      </SelectTrigger>
      <SelectContent>
        {yearOptions.map(year => (
          <SelectItem key={year} value={year} className="text-xs">
            {year} season
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
