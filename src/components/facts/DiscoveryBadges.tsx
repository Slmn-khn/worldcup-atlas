"use client";

// Shows all five Discovery Vault badges — earned ones glow gold, unearned
// ones show as dim locked chips with a native tooltip giving progress
// (e.g. "2/3"). Purely derived from localStorage; no account, no server call.

import { useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import NeonChip from "@/components/ui/NeonChip";
import { getBadgeProgress } from "@/lib/discoveryBadges";
import {
  getProgress,
  getServerProgressSnapshot,
  subscribeToProgress,
} from "@/lib/discoveryProgress";
import { nexusBorders, nexusColors } from "@/theme/visualTokens";

export default function DiscoveryBadges() {
  const state = useSyncExternalStore(
    subscribeToProgress,
    getProgress,
    getServerProgressSnapshot,
  );
  const badges = getBadgeProgress(state);

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {badges.map((badge) => {
        const progressLabel = `${Math.min(badge.matchedCount, badge.threshold)}/${badge.threshold}`;
        return (
          <Box
            key={badge.id}
            component="span"
            title={`${badge.description} (${progressLabel})`}
          >
            {badge.isEarned ? (
              <NeonChip label={badge.label} accent="gold" dot />
            ) : (
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  px: 1.5,
                  py: 0.5,
                  borderRadius: "999px",
                  border: `1px solid ${nexusBorders.soft}`,
                  color: nexusColors.textMuted,
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {badge.label}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
