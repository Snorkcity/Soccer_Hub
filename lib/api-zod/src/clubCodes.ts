// Shared club → 3-letter match-ID codes, used by the API server (Dribl sync
// match IDs) and the web app (Data Entry match-ID auto-build).
//
// Codes must be unique WITHIN a league's club set: "Sydney University" and
// "Sydney Olympic" would both be SYD on first-3-letters alone, and both
// "Western City Rangers" and "Western Sydney" would be WES — which risks two
// different fixtures sharing one match ID. Clubs whose first-3 code is unique
// keep it (so every existing ACT/VIC ID is unchanged); only colliding clubs
// fall through to word-aware alternatives.

const flat = (name: string): string => name.replace(/[^A-Za-z]/g, "").toUpperCase();
const words = (name: string): string[] => name.split(/[^A-Za-z]+/).filter(Boolean);

const baseCode = (name: string): string => flat(name).slice(0, 3);

/** Ordered fallback candidates for a club whose base code collides. */
function candidates(name: string): string[] {
  const w = words(name);
  const f = flat(name);
  const list: string[] = [];
  // "Sydney University" → SYU, "Sydney Olympic" → SYO, "Western City Rangers"
  // → WEC, "Western Sydney" → WES (unique again once the other moved off it).
  if (w.length >= 2) list.push((w[0].slice(0, 2) + w[1][0]).toUpperCase());
  // Initials for 3+ word names: "Western City Rangers" → WCR.
  if (w.length >= 3) list.push(w.slice(0, 3).map((x) => x[0]).join("").toUpperCase());
  list.push(f.slice(0, 3), f.slice(0, 4));
  for (let i = 2; i <= 9; i++) list.push(f.slice(0, 2) + String(i));
  return list.filter(Boolean);
}

/**
 * Deterministic per-league code map. Clubs are processed alphabetically so the
 * same club set always yields the same codes.
 */
export function clubCodesFor(clubs: string[]): Record<string, string> {
  const sorted = [...new Set(clubs.filter((c) => c.trim()))].sort();
  const byBase = new Map<string, string[]>();
  for (const c of sorted) {
    const b = baseCode(c);
    byBase.set(b, [...(byBase.get(b) ?? []), c]);
  }
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  // Non-colliding clubs keep their base code (existing IDs stay stable).
  for (const [b, names] of byBase) {
    if (names.length === 1) {
      out[names[0]] = b;
      taken.add(b);
    }
  }
  // Colliding clubs take the first free word-aware candidate.
  for (const [, names] of byBase) {
    if (names.length === 1) continue;
    for (const name of names) {
      let pick = candidates(name).find((c) => !taken.has(c));
      if (!pick) {
        // Pathological sets (many near-identical names) — never emit a
        // duplicate: extend with a numeric suffix until free.
        const stem = baseCode(name) || "X";
        for (let i = 10; taken.has(pick ?? stem); i++) pick = `${stem}${i}`;
        pick = pick ?? stem;
      }
      out[name] = pick;
      taken.add(pick);
    }
  }
  return out;
}

/** Code for one club given its league's club set. */
export const clubCodeIn = (name: string, clubs: string[]): string =>
  clubCodesFor(clubs)[name] ?? baseCode(name);
