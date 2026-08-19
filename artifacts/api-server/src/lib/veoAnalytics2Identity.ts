import { and, eq } from "drizzle-orm";
import {
  db,
  leaguePlayerStatsTable,
  matchesTable,
  playerStatsTable,
  veoMatchesTable,
} from "@workspace/db";
import { canonicalShirtNumber } from "./veoAnalytics2Store";
import type {
  Analytics2TeamContext,
  ParsedPlayer,
  PlayerIdentityInfo,
  PlayerTeamSide,
} from "./veoAnalytics2Parser";

interface SquadPlayer {
  side: "own" | "opponent";
  club: string;
  playerName: string;
  shirtNumber: string | null;
}

export interface Analytics2MatchIdentityContext {
  parserContext: Analytics2TeamContext;
  squadPlayers: SquadPlayer[];
  ownPlayerIdsByName: Map<string, Set<number>>;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function unresolvedIdentity(identity: PlayerIdentityInfo): PlayerIdentityInfo {
  return {
    ...identity,
    hubPlayerId: null,
    hubPlayerName: null,
    identityStatus: "unresolved",
  };
}

export async function loadAnalytics2MatchIdentityContext(input: {
  leagueId: number;
  veoMatchId: string;
  focusClub: string;
  focusTeamId: string | null;
  fallbackOpponent: string | null;
}): Promise<Analytics2MatchIdentityContext> {
  const fallback: Analytics2MatchIdentityContext = {
    parserContext: {
      focusTeamId: input.focusTeamId,
      focusTeamName: input.focusClub,
      opponentTeamName: input.fallbackOpponent,
    },
    squadPlayers: [],
    ownPlayerIdsByName: new Map(),
  };

  const veoRows = await db
    .select({ matchId: veoMatchesTable.matchId })
    .from(veoMatchesTable)
    .where(
      and(
        eq(veoMatchesTable.leagueId, input.leagueId),
        eq(veoMatchesTable.veoMatchId, input.veoMatchId),
      ),
    )
    .limit(1);
  const hubMatchId = veoRows[0]?.matchId;
  if (hubMatchId == null) return fallback;

  const matchRows = await db
    .select({
      matchId: matchesTable.matchId,
      seasonId: matchesTable.seasonId,
      opponent: matchesTable.opponent,
    })
    .from(matchesTable)
    .where(eq(matchesTable.id, hubMatchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) return fallback;

  const rawSquadPlayers = await db
    .select({
      club: leaguePlayerStatsTable.club,
      playerName: leaguePlayerStatsTable.playerName,
      shirtNumber: leaguePlayerStatsTable.shirtNumber,
    })
    .from(leaguePlayerStatsTable)
    .where(
      and(
        eq(leaguePlayerStatsTable.seasonId, match.seasonId),
        eq(leaguePlayerStatsTable.matchId, match.matchId),
      ),
    );

  const squadPlayers: SquadPlayer[] = rawSquadPlayers.flatMap((row) => {
    const club = row.club?.trim();
    const playerName = row.playerName.trim();
    if (!club || !playerName) return [];
    return [{
      side: club === input.focusClub ? "own" as const : "opponent" as const,
      club,
      playerName,
      shirtNumber: row.shirtNumber,
    }];
  });

  const officialShirtSides: Record<string, "own" | "opponent"> = {};
  const sidesByShirt = new Map<string, Set<"own" | "opponent">>();
  for (const player of squadPlayers) {
    const shirt = canonicalShirtNumber(player.shirtNumber);
    if (!shirt) continue;
    const sides = sidesByShirt.get(shirt) ?? new Set();
    sides.add(player.side);
    sidesByShirt.set(shirt, sides);
  }
  for (const [shirt, sides] of sidesByShirt) {
    if (sides.size === 1) officialShirtSides[shirt] = [...sides][0];
  }

  const ownPlayerRows = await db
    .select({
      playerId: playerStatsTable.playerId,
      playerName: playerStatsTable.playerName,
    })
    .from(playerStatsTable)
    .where(
      and(
        eq(playerStatsTable.matchId, hubMatchId),
        eq(playerStatsTable.club, input.focusClub),
      ),
    );
  const ownPlayerIdsByName = new Map<string, Set<number>>();
  for (const row of ownPlayerRows) {
    const name = normaliseName(row.playerName);
    const ids = ownPlayerIdsByName.get(name) ?? new Set();
    ids.add(row.playerId);
    ownPlayerIdsByName.set(name, ids);
  }

  const officialOpponentClub =
    squadPlayers.find((player) => player.side === "opponent")?.club ??
    match.opponent ??
    input.fallbackOpponent;

  return {
    parserContext: {
      focusTeamId: input.focusTeamId,
      focusTeamName: input.focusClub,
      opponentTeamName: officialOpponentClub,
      officialShirtSides,
    },
    squadPlayers,
    ownPlayerIdsByName,
  };
}

function resolveIdentityForSide(
  player: ParsedPlayer,
  context: Analytics2MatchIdentityContext,
): PlayerIdentityInfo {
  const { identity, team } = player;
  const shirt = canonicalShirtNumber(identity.jerseyNumber);
  if (!shirt || team.side === "unassigned") return unresolvedIdentity(identity);

  const candidates = new Map<string, string>();
  for (const squadPlayer of context.squadPlayers) {
    if (squadPlayer.side !== team.side) continue;
    if (canonicalShirtNumber(squadPlayer.shirtNumber) !== shirt) continue;
    candidates.set(normaliseName(squadPlayer.playerName), squadPlayer.playerName);
  }

  if (candidates.size > 1) {
    return {
      ...identity,
      hubPlayerId: null,
      hubPlayerName: null,
      identityStatus: "ambiguous",
    };
  }
  if (candidates.size === 0) return unresolvedIdentity(identity);

  const hubPlayerName = [...candidates.values()][0];
  let hubPlayerId: number | null = null;
  if (team.side === "own") {
    const ids = context.ownPlayerIdsByName.get(normaliseName(hubPlayerName));
    if (ids?.size === 1) hubPlayerId = [...ids][0];
  }

  return {
    ...identity,
    hubPlayerId,
    hubPlayerName,
    identityStatus: "resolved",
  };
}

export function enrichAnalytics2PlayerIdentities(
  players: ParsedPlayer[],
  context: Analytics2MatchIdentityContext,
): ParsedPlayer[] {
  return players.map((player) => ({
    ...player,
    identity: resolveIdentityForSide(player, context),
  }));
}

export function countPlayersByTeam(
  players: ParsedPlayer[],
): Record<PlayerTeamSide, number> {
  return players.reduce<Record<PlayerTeamSide, number>>(
    (counts, player) => {
      counts[player.team.side]++;
      return counts;
    },
    { own: 0, opponent: 0, unassigned: 0 },
  );
}