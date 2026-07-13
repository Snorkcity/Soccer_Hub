---
name: Drizzle numeric coercion
description: Drizzle ORM numeric columns are typed as string — must stringify before insert/update when Zod parses them as number
---

## Rule

Drizzle's `numeric(...)` column type is TypeScript `string | null` for insert/update. When the OpenAPI Zod schema defines a field as `zod.number().nullish()`, TypeScript will error if you pass it directly to `.values()` or `.set()`.

**Fix:** Use a `n2s` helper in every route file that has numeric columns:

```ts
const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));
```

Then spread and override:
```ts
db.insert(table).values({ ...parsed.data, possession: n2s(parsed.data.possession) })
```

**Why:** Drizzle reflects Postgres `numeric` as a JS string to avoid float precision loss. This mismatch is not caught at runtime (Postgres accepts either) but TypeScript errors at compile time.

**How to apply:** Any route that inserts/updates a table with `numeric(...)` columns (matches, goals, gps_sessions, athletic_tests). The read path is fine — use `parseFloat()` before passing to Zod response schemas.
