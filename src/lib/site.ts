// Central site configuration used by metadata, layout, footer, sitemap,
// and robots. Single source of truth for naming and the independence
// disclaimer — WORLDCUP Nexus never claims FIFA affiliation.

import { ARCHIVE_COVERAGE } from "@/lib/archiveCoverage";

export const siteConfig = {
  siteName: "WORLDCUP Nexus",
  tagline: "Every World Cup. Every Era. Every Legend.",
  description: `An independent historical archive of the FIFA World Cup, spanning ${ARCHIVE_COVERAGE.label}. Explore tournaments, matches, players, countries, records, and 2026 results.`,
  disclaimer:
    "WORLDCUP Nexus is an independent historical archive and is not affiliated with FIFA.",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  // Brand assets live in public/brand. The icon variants under /brand and the
  // root /favicon.ico, /icon.png, /apple-icon.png are generated from the
  // source icon by `pnpm assets:icons`. No official FIFA branding is used.
  brand: {
    ogImage: "/brand/worldcup-nexus-banner.png",
    icon: "/brand/worldcup-nexus-icon.png",
    banner: "/brand/worldcup-nexus-banner.png",
  },
  sourceAttribution: {
    name: "Fjelstul World Cup Database",
    author: "Joshua C. Fjelstul, Ph.D.",
    copyright: "© 2023 Joshua C. Fjelstul, Ph.D.",
    license: "CC-BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/legalcode",
    repositoryUrl: "https://www.github.com/jfjelstul/worldcup",
  },
  // 2026 archive source (user-approved import; see docs/DATA_SOURCES.md).
  sourceAttribution2026: {
    name: "Mominul FIFA World Cup 2026 Dataset",
    repositoryUrl: "https://github.com/mominullptr/FIFA-World-Cup-2026-Dataset",
  },
  navLinks: [
    { label: "Tournaments", href: "/tournaments" },
    { label: "Matches", href: "/matches" },
    { label: "Countries", href: "/countries" },
    { label: "Players", href: "/players" },
    { label: "Records", href: "/records" },
    { label: "Explorer", href: "/explorer" },
    { label: "Sources", href: "/sources" },
    { label: "About", href: "/about" },
  ],
} as const;
