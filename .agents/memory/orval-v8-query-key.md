---
name: Orval v8 queryKey pattern
description: TanStack Query v5 UseQueryOptions requires queryKey — must pass it explicitly when using { query: { enabled } } pattern
---

## Rule

Orval v8 generates hooks typed with `UseQueryOptions<...>` from TanStack Query v5, which requires `queryKey` as a non-optional field. Passing just `{ query: { enabled: bool } }` causes a TypeScript error: "Property 'queryKey' is missing".

**Fix:** Always import the matching `getXxxQueryKey` helper and pass it:

```ts
import { useGetSeasonSummary, getGetSeasonSummaryQueryKey } from "@workspace/api-client-react";

const params = { teamId: tId, seasonId: sId };
const { data } = useGetSeasonSummary(
  params,
  { query: { enabled: isReady, queryKey: getGetSeasonSummaryQueryKey(params) } }
);
```

**Why:** TanStack Query v5 made queryKey required in UseQueryOptions to enforce deterministic cache keys. Orval v8 uses the full UseQueryOptions type instead of a partial.

**How to apply:** Every page that uses `{ query: { enabled: ... } }` must also pass `queryKey` using the corresponding `getXxxQueryKey(params)` getter exported from `@workspace/api-client-react`.
