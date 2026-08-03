// Sitemap generated from the live database (Checkpoint 7A). Historical data
// is stable, so detail pages use low-frequency entries. A query failure
// throws — failing the build loudly beats shipping a bad sitemap.
// Revalidated daily (Checkpoint 8B, P1.3) instead of force-dynamic — the
// content only changes on data import, and the four findMany queries were a
// free database-load amplifier when run per request.

import type { MetadataRoute } from "next";
import { prisma } from "@/server/db/prisma";
import { siteConfig } from "@/lib/site";

export const revalidate = 86400;

/**
 * 2026 archive entries from the imported WorldCup2026* tables (Mominul-only
 * import). Guarded: an empty/unavailable 2026 archive contributes nothing,
 * and /tournaments/2026 is only added here when the canonical Tournament
 * table does not already list 2026 (post-promotion the canonical loop below
 * covers it).
 */
async function wc2026Entries(
  base: string,
  canonicalYears: Set<number>,
): Promise<MetadataRoute.Sitemap> {
  try {
    const matches = await prisma.worldCup2026Match.findMany({
      select: { sourceMatchId: true },
    });
    if (matches.length === 0) return [];
    const players = await prisma.worldCup2026Player.findMany({
      select: { sourcePlayerId: true },
    });
    return [
      ...(canonicalYears.has(2026)
        ? []
        : [
            {
              url: `${base}/tournaments/2026`,
              changeFrequency: "yearly" as const,
              priority: 0.8,
            },
          ]),
      {
        url: `${base}/schedule/2026`,
        changeFrequency: "yearly" as const,
        priority: 0.7,
      },
      ...matches.map((match) => ({
        url: `${base}/matches/2026/${match.sourceMatchId}`,
        changeFrequency: "yearly" as const,
        priority: 0.4,
      })),
      ...players.map((player) => ({
        url: `${base}/tournaments/2026/players/${player.sourcePlayerId}`,
        changeFrequency: "yearly" as const,
        priority: 0.3,
      })),
    ];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.siteUrl.replace(/\/$/, "");

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/tournaments`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/matches`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/countries`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/players`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/records`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/explorer`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/sources`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.5 },
  ];

  const [tournaments, matches, countries, players] = await Promise.all([
    prisma.tournament.findMany({ select: { year: true } }),
    prisma.match.findMany({ select: { slug: true } }),
    prisma.country.findMany({ select: { slug: true } }),
    prisma.player.findMany({ select: { slug: true } }),
  ]);
  const wc2026 = await wc2026Entries(
    base,
    new Set(tournaments.map((tournament) => tournament.year)),
  );

  return [
    ...staticEntries,
    ...wc2026,
    ...tournaments.map((tournament) => ({
      url: `${base}/tournaments/${tournament.year}`,
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
    ...countries.map((country) => ({
      url: `${base}/countries/${country.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
    ...matches.map((match) => ({
      url: `${base}/matches/${match.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.4,
    })),
    ...players.map((player) => ({
      url: `${base}/players/${player.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
