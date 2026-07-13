---
name: Clubs table and colours
description: clubs table schema, seeded colours, and how they're used in charts
---

# Clubs Table

## Schema
`lib/db/src/schema/clubs.ts` — `clubs (id, name, primaryColor, logoUrl)`

## Seeded Clubs (hex colours)
- Belconnen: #87CEEB (sky blue)
- Croatia: #DC143C (crimson)
- Majura: #4169E1 (royal blue)
- Olympic: #000080 (navy)
- Tuggeranong: #008000 (green)
- Wanderers: #B22222 (firebrick)
- ANU: #FFA500 (orange)

No "Res" variants in the clubs table — those are handled by showing the base club colour.

## API
`GET /clubs` → `ClubInfo[]` (id, name, primaryColor, logoUrl?) — registered in `routes/clubs.ts`

## Frontend Usage
`useGetClubs()` → build `clubColorMap: Record<string, string>` → used as `fill` prop on Recharts `<Bar>` components for stacked opponent charts.

## Future
`logoUrl` column is reserved for match report exports once logos are uploaded.
