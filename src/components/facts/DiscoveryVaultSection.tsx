// Discovery Vault homepage section — an hourly rotating World Cup fact. The
// hourly fact is loaded once in getHomeViewModel (try/catch'd there, see
// src/server/home/queries.ts) so this component never touches the database
// directly and never crashes the homepage if no facts exist yet.

import HomeSection from "@/components/home/HomeSection";
import SectionHeader from "@/components/ui/SectionHeader";
import EmptyState from "@/components/ui/EmptyState";
import HourlyFactCard from "./HourlyFactCard";
import type { HomeHourlyFact } from "@/server/home/queries";

export default function DiscoveryVaultSection({
  hourlyFact,
}: {
  hourlyFact: HomeHourlyFact;
}) {
  return (
    <HomeSection divider>
      <SectionHeader
        eyebrow="Discovery Vault"
        title="The Discovery Vault"
        accent="cyan"
        subtitle="A new World Cup story every hour."
        action={{ label: "All discoveries", href: "/facts" }}
      />
      {hourlyFact !== null ? (
        <HourlyFactCard
          fact={hourlyFact.fact}
          nextRotationAt={hourlyFact.nextRotationAt}
        />
      ) : (
        <EmptyState title="Discovery Vault facts are being prepared." />
      )}
    </HomeSection>
  );
}
