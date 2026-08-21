import { eq } from "drizzle-orm";
import { clubsTable, db, leaguesTable, pool } from "@workspace/db";
import {
  ensureNplb2026Structure,
  NPLB_2026_LEAGUES,
  NPLB_2026_YEAR,
} from "./lib/nplb2026";
import {
  driblFixtureFeedFor,
  suggestClubName,
} from "./routes/dribl";
import { logger } from "./lib/logger";

const EXPECTED_FIXTURES_PER_GRADE = 132;
const EXPECTED_CLUBS_PER_GRADE = 12;

const BRAND_ALIASES: Record<string, string[]> = {
  Belconnen: ["Belconnen"],
  "Brindabella Blues": ["Brindabella Blues", "Brindabella"],
  "Canberra Croatia": ["Canberra Croatia", "Croatia"],
  "Canberra Olympic": ["Canberra Olympic", "Olympic"],
  Majura: ["Majura"],
  "Monaro Panthers": ["Monaro Panthers", "Monaro"],
  "O'Connor Knights": ["O'Connor Knights", "O'Connor"],
  Tigers: ["Tigers"],
  "Tuggeranong United": ["Tuggeranong United", "Tuggeranong"],
};

const BRAND_SOURCE_PRIORITY = [
  "ACT NPLM U23",
  "ACT NPLM",
  "ACT NPLW",
  "ACT NPLW Reserves",
];

type BrandRow = {
  leagueName: string;
  clubName: string;
  primaryColor: string;
  logoUrl: string | null;
};

function findReliableBrand(clubName: string, rows: BrandRow[]): BrandRow | null {
  const aliases = BRAND_ALIASES[clubName] ?? [clubName];
  for (const sourceLeague of BRAND_SOURCE_PRIORITY) {
    for (const alias of aliases) {
      const match = rows.find((row) =>
        row.leagueName === sourceLeague
        && row.clubName.localeCompare(alias, "en", { sensitivity: "base" }) === 0
      );
      if (match) return match;
    }
  }
  return null;
}

async function assertSetupPrerequisites(): Promise<void> {
  const result = await pool.query<{ ready: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_index index_row
      INNER JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
      INNER JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_class.relname = 'seasons_league_year_unique'
        AND index_row.indisunique = true
        AND index_row.indisvalid = true
    ) AS ready
  `);
  if (!result.rows[0]?.ready) {
    throw new Error(
      "Database startup migrations are not current: deploy or restart the API before running NPLB setup",
    );
  }
}

async function main(): Promise<void> {
  const target = process.env.NPLB_SETUP_TARGET;
  if (target !== "development" && target !== "production") {
    throw new Error("NPLB_SETUP_TARGET must be development or production");
  }

  // The conflict-safe season upsert depends on this database invariant. Refuse
  // to make even the first league write if the newly deployed API has not run.
  await assertSetupPrerequisites();

  // Validate every live feed before making any database changes. This prevents
  // a typo or changed Dribl competition from leaving a half-created setup.
  const feeds = await Promise.all(NPLB_2026_LEAGUES.map(async (spec) => {
    const feed = await driblFixtureFeedFor(spec.localName, NPLB_2026_YEAR);
    const clubNames = [...new Set(feed.clubNames.map(suggestClubName))].sort();
    if (feed.fixtureCount !== EXPECTED_FIXTURES_PER_GRADE) {
      throw new Error(
        `${spec.driblLeague}: expected ${EXPECTED_FIXTURES_PER_GRADE} non-bye fixtures, received ${feed.fixtureCount}`,
      );
    }
    if (clubNames.length !== EXPECTED_CLUBS_PER_GRADE) {
      throw new Error(
        `${spec.driblLeague}: expected ${EXPECTED_CLUBS_PER_GRADE} clubs, received ${clubNames.length}`,
      );
    }
    if (!clubNames.includes("Belconnen")) {
      throw new Error(
        `${spec.driblLeague}: cleaned club list has no Belconnen focus club (${clubNames.join(", ")})`,
      );
    }
    return { spec, fixtureCount: feed.fixtureCount, clubNames };
  }));

  await ensureNplb2026Structure();

  const brandRows = await db
    .select({
      leagueName: leaguesTable.name,
      clubName: clubsTable.name,
      primaryColor: clubsTable.primaryColor,
      logoUrl: clubsTable.logoUrl,
    })
    .from(clubsTable)
    .innerJoin(leaguesTable, eq(leaguesTable.id, clubsTable.leagueId));

  for (const feed of feeds) {
    const [league] = await db
      .select({ id: leaguesTable.id })
      .from(leaguesTable)
      .where(eq(leaguesTable.name, feed.spec.localName))
      .limit(1);
    if (!league) throw new Error(`Setup did not create ${feed.spec.localName}`);

    for (const clubName of feed.clubNames) {
      const brand = findReliableBrand(clubName, brandRows);
      if (!brand) {
        await db
          .insert(clubsTable)
          .values({ leagueId: league.id, name: clubName })
          .onConflictDoNothing();
        continue;
      }

      await db
        .insert(clubsTable)
        .values({
          leagueId: league.id,
          name: clubName,
          primaryColor: brand.primaryColor,
          logoUrl: brand.logoUrl,
        })
        // Branding is seeded only once. A coach's later colour or crest edit
        // must never be reverted by a routine setup rerun.
        .onConflictDoNothing();
    }
  }

  logger.info({
    target,
    grades: feeds.map((feed) => ({
      league: feed.spec.localName,
      driblLeague: feed.spec.driblLeague,
      fixtures: feed.fixtureCount,
      clubs: feed.clubNames.length,
    })),
  }, "2026 NPLB league and club setup complete");
}

void main()
  .catch((error) => {
    logger.error({ err: String(error) }, "2026 NPLB setup failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });