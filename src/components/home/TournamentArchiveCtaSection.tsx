// Post-tournament archive CTA — the homepage band shown in place of the live
// "Latest Matches & Scores" section while FEATURE_LATEST_MATCHES_SECTION is
// off. Static links only: no fixture queries, no provider calls.

import Box from "@mui/material/Box";
import HomeSection from "@/components/home/HomeSection";
import SectionHeader from "@/components/ui/SectionHeader";
import Link from "@/components/Link";
import VaultButton from "@/components/vault/VaultButton";

export default function TournamentArchiveCtaSection() {
  return (
    <HomeSection>
      <SectionHeader
        eyebrow="2026 World Cup"
        title="2026 Tournament Archive"
        accent="gold"
        subtitle="Spain are world champions. Explore the full tournament bracket, venues, teams, and verified results."
        action={{ label: "Full schedule", href: "/schedule/2026" }}
      />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        <VaultButton
          component={Link}
          href="/tournaments/2026"
          variant="primary"
        >
          View 2026 Archive
        </VaultButton>
        <VaultButton component={Link} href="/schedule/2026" variant="outline">
          Full 2026 Schedule.
        </VaultButton>
      </Box>
    </HomeSection>
  );
}
