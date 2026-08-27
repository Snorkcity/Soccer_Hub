import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type BorrowingPlayer = {
  playerName: string;
  club?: string | null;
  homeGrade?: number | null;
  identityKey?: string;
  identityProven?: boolean;
  totalApps: number;
  borrowedUp: number;
  borrowedDown: number;
  borrowedUnknown: number;
};

type BorrowingSource = {
  players: BorrowingPlayer[];
};

type ClubSummary = {
  club: string;
  upPlayers: number;
  upApps: number;
  downPlayers: number;
  downApps: number;
  unknownPlayers: number;
  unknownApps: number;
};

function borrowingStory(player: BorrowingPlayer, currentGrade?: string): string {
  const stories: string[] = [];
  if (player.borrowedUp > 0) {
    const allAppearances = player.borrowedUp === player.totalApps;
    const interpretation = allAppearances && player.totalApps >= 10
      ? " — effectively a season regular in this grade"
      : allAppearances && player.totalApps > 1
        ? ` — ${player.totalApps} opportunities at this level`
        : "";
    stories.push(
      `${player.borrowedUp} of ${player.totalApps} appearance${player.totalApps === 1 ? "" : "s"} borrowed up${player.homeGrade ? ` from U${player.homeGrade}` : ""}${interpretation}`,
    );
  }
  if (player.borrowedDown > 0) {
    stories.push(
      `${player.borrowedDown} of ${player.totalApps} appearance${player.totalApps === 1 ? "" : "s"} borrowed down${player.homeGrade ? ` from U${player.homeGrade}` : ""}`,
    );
  }
  if (player.borrowedUnknown > 0) {
    const reason = player.homeGrade && String(player.homeGrade) === currentGrade
      ? `marked borrowed despite a same-grade U${player.homeGrade} registration`
      : player.identityProven
        ? "with registration grade unproven"
        : "with player identity or registration grade unproven";
    stories.push(`${player.borrowedUnknown} of ${player.totalApps} appearance${player.totalApps === 1 ? "" : "s"} ${reason}`);
  }
  return stories.join(" · ");
}

function setSheetWidths(sheet: { ["!cols"]?: Array<{ wch?: number }> }, widths: number[]) {
  sheet["!cols"] = widths.map(wch => ({ wch }));
}

export function NplbBorrowingReport({ leagueName, src }: {
  leagueName: string;
  src?: BorrowingSource;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const currentGrade = leagueName.match(/\bU(\d+)\b/i)?.[1] ?? "";

  const { clubs, players } = useMemo(() => {
    const allPlayers = src?.players ?? [];
    const summaries = new Map<string, ClubSummary & {
      upIdentities: Set<string>;
      downIdentities: Set<string>;
      unknownIdentities: Set<string>;
    }>();
    for (const player of allPlayers) {
      if (!player.club) continue;
      summaries.set(player.club, summaries.get(player.club) ?? {
        club: player.club,
        upPlayers: 0,
        upApps: 0,
        downPlayers: 0,
        downApps: 0,
        unknownPlayers: 0,
        unknownApps: 0,
        upIdentities: new Set(),
        downIdentities: new Set(),
        unknownIdentities: new Set(),
      });
      const summary = summaries.get(player.club)!;
      const identity = player.identityKey ?? `${player.club}\u0000${player.playerName.toLowerCase()}`;
      if (player.borrowedUp > 0) {
        summary.upIdentities.add(identity);
        summary.upApps += player.borrowedUp;
      }
      if (player.borrowedDown > 0) {
        summary.downIdentities.add(identity);
        summary.downApps += player.borrowedDown;
      }
      if (player.borrowedUnknown > 0) {
        summary.unknownIdentities.add(identity);
        summary.unknownApps += player.borrowedUnknown;
      }
    }
    for (const summary of summaries.values()) {
      summary.upPlayers = summary.upIdentities.size;
      summary.downPlayers = summary.downIdentities.size;
      summary.unknownPlayers = summary.unknownIdentities.size;
    }
    return {
      clubs: Array.from(summaries.values()).sort((a, b) =>
        (b.upApps + b.downApps) - (a.upApps + a.downApps) || a.club.localeCompare(b.club)),
      players: allPlayers
        .filter(player => player.borrowedUp + player.borrowedDown + player.borrowedUnknown > 0)
        .sort((a, b) =>
          (b.borrowedUp + b.borrowedDown + b.borrowedUnknown) - (a.borrowedUp + a.borrowedDown + a.borrowedUnknown)
          || (a.club ?? "").localeCompare(b.club ?? "")
          || a.playerName.localeCompare(b.playerName)),
    };
  }, [src]);

  const downloadExcel = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();

      const clubSheet = XLSX.utils.json_to_sheet(clubs.map(club => ({
        Club: club.club,
        "Players borrowed up": club.upPlayers,
        "Borrowed-up appearances": club.upApps,
        "Players borrowed down": club.downPlayers,
        "Borrowed-down appearances": club.downApps,
        "Players with unknown direction": club.unknownPlayers,
        "Unknown-direction appearances": club.unknownApps,
      })));
      setSheetWidths(clubSheet, [24, 20, 24, 22, 26, 29, 31]);
      XLSX.utils.book_append_sheet(workbook, clubSheet, "Club Summary");

      const playerSheet = XLSX.utils.json_to_sheet(players.map(player => ({
        Player: player.playerName,
        Club: player.club ?? "Unknown",
        "Team grade": currentGrade ? `U${currentGrade}` : leagueName,
        "Registered grade": player.homeGrade ? `U${player.homeGrade}` : "Unproven",
        "Total appearances": player.totalApps,
        "Borrowed-up appearances": player.borrowedUp,
        "Borrowed-down appearances": player.borrowedDown,
        "Unknown-direction appearances": player.borrowedUnknown,
        Story: borrowingStory(player, currentGrade),
      })));
      setSheetWidths(playerSheet, [22, 24, 14, 18, 19, 24, 26, 31, 58]);
      XLSX.utils.book_append_sheet(workbook, playerSheet, "Player Detail");

      const metadataSheet = XLSX.utils.aoa_to_sheet([
        ["Boys league borrowing report"],
        ["League", leagueName],
        ["Generated", new Date().toLocaleString("en-AU")],
        [],
        ["Definition", "Meaning"],
        ["Players borrowed up", "Unique stable Dribl identities registered in a younger grade and appearing for this team."],
        ["Borrowed-up appearances", "Deduplicated match-card appearances made by those players in this team."],
        ["Players borrowed down", "Unique stable Dribl identities registered in an older grade and appearing for this team."],
        ["Borrowed-down appearances", "Deduplicated match-card appearances made by those players in this team."],
        ["Unknown direction", "Borrowed match-card evidence where identity or exactly one registered home grade cannot be proven, or the borrowed flag conflicts with a same-grade registration. It is not included in up or down totals."],
        ["Unknown player count", "Distinct evidence identities: stable Dribl identity when available, otherwise a normalised-name fallback. Unknown rows are never included in up or down player totals."],
        ["Rolling substitutions", "Starts, bench appearances and minutes are intentionally excluded because NPLB uses rolling substitutions."],
      ]);
      setSheetWidths(metadataSheet, [28, 105]);
      XLSX.utils.book_append_sheet(workbook, metadataSheet, "Definitions");

      const safeLeague = (leagueName || "NPLB").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      XLSX.writeFile(workbook, `${safeLeague}-borrowing-report.xlsx`, { compression: true });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The Excel report could not be created.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{leagueName || "NPLB"} — League Borrowing Report</CardTitle>
          <CardDescription className="mt-1 max-w-3xl">
            Players is the number of unique players. Appearances is how often they appeared on a match card.
            Borrowed up means registered in a younger grade; borrowed down means registered in an older grade.
          </CardDescription>
        </div>
        <button
          type="button"
          onClick={downloadExcel}
          disabled={exporting || clubs.length === 0}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? "Building Excel…" : "Download Excel"}
        </button>
      </CardHeader>
      <CardContent className="space-y-6">
        {exportError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            Excel export failed: {exportError}
          </div>
        )}
        {clubs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No player borrowing evidence is available for this league.</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Club</TableHead>
                    <TableHead className="text-right text-emerald-600 dark:text-emerald-400">Players up</TableHead>
                    <TableHead className="text-right text-emerald-600 dark:text-emerald-400">Apps up</TableHead>
                    <TableHead className="text-right text-red-600 dark:text-red-400">Players down</TableHead>
                    <TableHead className="text-right text-red-600 dark:text-red-400">Apps down</TableHead>
                    <TableHead className="text-right text-muted-foreground">Players ?</TableHead>
                    <TableHead className="text-right text-muted-foreground">Apps ?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clubs.map(club => (
                    <TableRow key={club.club}>
                      <TableCell className="font-medium">{club.club}</TableCell>
                      <TableCell className="text-right tabular-nums">{club.upPlayers}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{club.upApps}</TableCell>
                      <TableCell className="text-right tabular-nums">{club.downPlayers}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-red-600 dark:text-red-400">{club.downApps}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{club.unknownPlayers}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{club.unknownApps}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Player stories</h3>
              {players.length === 0 ? (
                <div className="text-sm text-muted-foreground">No borrowed appearances are recorded.</div>
              ) : (
                <div className="max-h-[30rem] overflow-auto rounded-md border">
                  <Table className="min-w-[760px]">
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>Player</TableHead>
                        <TableHead>Club</TableHead>
                        <TableHead>Registered</TableHead>
                        <TableHead className="text-right">Team apps</TableHead>
                        <TableHead>Borrowing story</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {players.map((player, index) => (
                        <TableRow key={`${player.club ?? "unknown"}-${player.playerName}-${index}`}>
                          <TableCell className="font-medium">{player.playerName}</TableCell>
                          <TableCell className="text-muted-foreground">{player.club ?? "—"}</TableCell>
                          <TableCell>{player.homeGrade ? `U${player.homeGrade}` : "Unproven"}</TableCell>
                          <TableCell className="text-right tabular-nums">{player.totalApps}</TableCell>
                          <TableCell className="min-w-[300px]">{borrowingStory(player, currentGrade)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}