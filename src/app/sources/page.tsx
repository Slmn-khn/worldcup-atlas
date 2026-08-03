// Data sources and attribution page (Checkpoint 7A). The attribution block
// follows the exact requirements of the source's CC-BY-SA 4.0 license:
// author name, copyright notice, license link, repository link, and a
// modification notice. Wording aligned with docs/DATA_SOURCES.md.

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import SectionHeading from "@/components/ui/SectionHeading";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Data Sources",
  description:
    "Data sources, attribution, license details, transformations, and known limitations of the WORLDCUP Nexus archive.",
};

const SECTION_SX = { py: { xs: 3.5, md: 4.5 } };

function Bullets({ items }: { items: string[] }) {
  return (
    <Stack component="ul" spacing={1} sx={{ pl: 3, m: 0 }}>
      {items.map((item) => (
        <Typography
          key={item}
          component="li"
          variant="body1"
          sx={{ color: "text.secondary" }}
        >
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

export default function SourcesPage() {
  const attribution = siteConfig.sourceAttribution;

  return (
    <Box>
      <VaultPageHeader
        title="Data Sources"
        lede="Where the archive's data comes from, how it is transformed, and how it is licensed."
      />

      <PageContainer component="section" sx={SECTION_SX}>
        <SectionHeading title="Primary Source" />
        <Typography
          variant="body1"
          sx={{ color: "text.secondary", maxWidth: 760, mb: 2 }}
        >
          All historical data in WORLDCUP Nexus comes from the{" "}
          <MuiLink
            href={attribution.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: "primary.main" }}
          >
            {attribution.name}
          </MuiLink>{" "}
          by {attribution.author} — a comprehensive, source-documented dataset
          covering FIFA World Cup tournaments, teams, players, matches, goals,
          cards, substitutions, penalty kicks, squads, and awards.
        </Typography>
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 0,
            bgcolor: "rgba(244, 201, 93, 0.05)",
            px: 3,
            py: 2.5,
            maxWidth: 760,
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: "text.primary", fontWeight: 700, mb: 1 }}
          >
            Attribution
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {attribution.name} by {attribution.author}. {attribution.copyright}.
            Published under the{" "}
            <MuiLink
              href={attribution.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: "primary.main" }}
            >
              {attribution.license} license
            </MuiLink>
            . Source repository:{" "}
            <MuiLink
              href={attribution.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: "primary.main" }}
            >
              github.com/jfjelstul/worldcup
            </MuiLink>
            .
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
            Modification notice: WORLDCUP Nexus normalizes the original CSV
            files into a relational database, derives display fields and
            aggregate statistics (described below), and serves the result
            through this site. The underlying data presented here remains
            subject to the {attribution.license} license.
          </Typography>
        </Box>
      </PageContainer>

      <PageContainer component="section" sx={SECTION_SX}>
        <SectionHeading
          title="Secondary and Reference Sources"
          subtitle="Additional sources beyond the primary historical database."
        />
        <Bullets
          items={[
            "Mominul FIFA World Cup 2026 Dataset (github.com/mominullptr/FIFA-World-Cup-2026-Dataset) — the approved, user-verified source of the imported 2026 tournament archive: teams, venues, matches, squads, events, lineups, and statistics. The only source imported for 2026; its ML prediction features are excluded.",
            "OpenFootball World Cup data (public domain) — reserved for cross-referencing results and filling confirmed gaps; not currently used in production data.",
            "Wikipedia match articles and RSSSF records — manual verification reference only.",
          ]}
        />
      </PageContainer>

      <PageContainer component="section" sx={SECTION_SX}>
        <SectionHeading
          title="How the Data Is Transformed"
          subtitle="Every transformation is documented in the repository (docs/DATA_SOURCES.md and docs/DATA_ISSUES.md)."
        />
        <Bullets
          items={[
            "Source CSV files are downloaded and cached byte-for-byte, then normalized into PostgreSQL tables with stable slugs and cross-references.",
            "Player nationality is derived from squad membership (the most frequent squad team's country) — the source has no nationality column.",
            "Tournament winners come from the source's winner field; runners-up are derived from the losing finalist of the decided final.",
            "Records and leaderboards are computed from imported events only, and labeled with exactly what the data supports.",
            "The search index is generated from the normalized database tables — never from raw source rows.",
          ]}
        />
      </PageContainer>

      <PageContainer component="section" sx={SECTION_SX}>
        <SectionHeading title="Known Limitations" />
        <Bullets
          items={[
            "The imported dataset covers both men's (1930–2022) and women's (1991–2019) World Cups; combined views are labeled \"all imported tournaments\".",
            "Squad membership means a player was selected for a tournament squad — it is not match appearance data. No appearances, caps, or minutes are claimed.",
            "Assist, lineup, referee-to-match, and attendance data are not part of the imported subset.",
            "Penalty shootout kicks are listed in source order; the source does not record the true kick sequence or distinguish missed from saved.",
            "Some source fields may be incomplete; missing values are shown as missing rather than estimated.",
          ]}
        />
      </PageContainer>

      <PageContainer
        component="section"
        sx={{ ...SECTION_SX, pb: { xs: 7, md: 9 } }}
      >
        <SectionHeading title="Independent Project" />
        <Typography
          variant="body1"
          sx={{ color: "text.secondary", maxWidth: 760 }}
        >
          {siteConfig.disclaimer} FIFA and the FIFA World Cup are trademarks of
          their respective owners; no official endorsement is implied. This site
          exists for historical reference and research.
        </Typography>
      </PageContainer>
    </Box>
  );
}
