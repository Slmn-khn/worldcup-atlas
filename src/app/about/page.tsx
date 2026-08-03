// About page (Checkpoint 7A).

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import SectionHeading from "@/components/ui/SectionHeading";
import { siteConfig } from "@/lib/site";
import { ARCHIVE_COVERAGE } from "@/lib/archiveCoverage";

export const metadata: Metadata = {
  title: "About",
  description:
    "What WORLDCUP Nexus is: an independent, data-driven archive of the FIFA World Cup from 1930 to 2026.",
};

export default function AboutPage() {
  return (
    <Box>
      <VaultPageHeader
        eyebrow={siteConfig.tagline}
        title="About WORLDCUP Nexus"
        lede={siteConfig.description}
      />

      <PageContainer component="section" sx={{ py: { xs: 4, md: 5 } }}>
        <SectionHeading title="What This Is" />
        <Typography
          variant="body1"
          sx={{ color: "text.secondary", maxWidth: 760 }}
        >
          WORLDCUP Nexus is a digital football museum spanning{" "}
          {ARCHIVE_COVERAGE.label}: every imported tournament, nation, player,
          match, goal, card, substitution, and penalty in one place — from the
          first World Cup through the completed 2026 edition. Browse tournament
          histories, relive matches through event timelines, follow a nation
          through every campaign, trace a player&apos;s World Cup record,
          explore the Book of Records, or dig through the raw numbers in the
          Data Explorer.
        </Typography>
      </PageContainer>

      <PageContainer component="section" sx={{ py: { xs: 4, md: 5 } }}>
        <SectionHeading title="Data-Driven and Honest" />
        <Typography
          variant="body1"
          sx={{ color: "text.secondary", maxWidth: 760 }}
        >
          Everything on this site is computed from imported, source-backed data
          — nothing is invented or estimated. Where the source data has limits
          (squad lists are not match appearances; assists are not recorded), the
          site says so instead of guessing. Full attribution, license details,
          and known limitations are on the{" "}
          <Typography
            component={Link}
            href="/sources"
            sx={{ color: "primary.main" }}
          >
            Sources
          </Typography>{" "}
          page.
        </Typography>
      </PageContainer>

      <PageContainer component="section" sx={{ py: { xs: 4, md: 5 } }}>
        <SectionHeading title="What's Next" />
        <Stack component="ul" spacing={1} sx={{ pl: 3, m: 0 }}>
          {[
            "Search improvements and richer result pages",
            "Explorer improvements (more filters, column controls)",
            "Group standings and knockout bracket views",
            "Source reconciliation against secondary references",
            "Deployment polish and performance work",
          ].map((item) => (
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
      </PageContainer>

      <PageContainer
        component="section"
        sx={{ py: { xs: 4, md: 5 }, pb: { xs: 7, md: 9 } }}
      >
        <SectionHeading title="Independent Project" />
        <Typography
          variant="body1"
          sx={{ color: "text.secondary", maxWidth: 760, mb: 3 }}
        >
          {siteConfig.disclaimer}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button component={Link} href="/tournaments" variant="contained">
            Explore Tournaments
          </Button>
          <Button
            component={Link}
            href="/sources"
            variant="outlined"
            sx={{
              color: "text.primary",
              borderColor: "divider",
              "&:hover": { borderColor: "primary.main" },
            }}
          >
            Data Sources
          </Button>
        </Stack>
      </PageContainer>
    </Box>
  );
}
