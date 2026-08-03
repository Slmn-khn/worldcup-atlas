// Small "Last synced X ago" line, with a quiet stale warning when the data is
// older than the freshness threshold. Honest about data age — never hidden.
// In archive mode (tournament finished) the stale warning is dropped — the
// data is final, not stale — and the source note reads as archived data.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { atlas, eyebrowSx } from "@/theme/tokens";
import type { FixtureFreshness } from "@/server/fixtures/types";

export default function FixtureFreshnessNote({
  freshness,
  sourceNote,
  archiveMode = false,
}: {
  freshness: FixtureFreshness;
  sourceNote?: string;
  /** Post-tournament presentation: final data, no staleness warning. */
  archiveMode?: boolean;
}) {
  const note =
    sourceNote ??
    (archiveMode
      ? "Archived 2026 fixture data"
      : "OpenFootball baseline · worldcup26 live (when available)");
  const showStale =
    !archiveMode && freshness.isStale && freshness.lastSyncedAt !== null;

  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1.5,
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{
          width: 7,
          height: 7,
          bgcolor:
            !archiveMode && freshness.isStale ? atlas.textMuted : atlas.gold,
        }}
      />
      <Typography
        component="span"
        sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.textSecondary }}
      >
        {freshness.label}
        {showStale ? " · data may be stale" : ""}
      </Typography>
      <Typography
        component="span"
        sx={{ fontSize: "0.72rem", color: atlas.textMuted }}
      >
        {note}
      </Typography>
    </Box>
  );
}
