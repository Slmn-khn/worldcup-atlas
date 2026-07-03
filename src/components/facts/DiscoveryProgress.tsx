"use client";

// Reads the visitor's local discovery progress — no account required.
// `useSyncExternalStore` is the correct primitive for an external, browser-only
// store like localStorage: it renders the server snapshot (empty) during
// SSR/first paint, then reconciles with the real state after hydration with
// no manual "mounted" state and no risk of a hydration mismatch.

import { useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  getProgress,
  getServerProgressSnapshot,
  subscribeToProgress,
} from "@/lib/discoveryProgress";
import { nexusColors } from "@/theme/visualTokens";

export default function DiscoveryProgress() {
  const state = useSyncExternalStore(
    subscribeToProgress,
    getProgress,
    getServerProgressSnapshot,
  );
  const count = state.discovered.length;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Typography variant="body2" sx={{ color: nexusColors.textSecondary }}>
        {count > 0
          ? `You've discovered ${count} World Cup ${count === 1 ? "story" : "stories"}.`
          : "Start your discovery streak."}
      </Typography>
      {state.streak.current > 0 ? (
        <Typography variant="caption" sx={{ color: nexusColors.textMuted }}>
          Current streak: {state.streak.current}{" "}
          {state.streak.current === 1 ? "day" : "days"}
          {state.streak.longest > state.streak.current
            ? ` · best ${state.streak.longest}`
            : ""}
        </Typography>
      ) : null}
      {state.quiz.attempts > 0 ? (
        <Typography variant="caption" sx={{ color: nexusColors.textMuted }}>
          Quiz score: {state.quiz.correct}/{state.quiz.attempts} correct
        </Typography>
      ) : null}
    </Box>
  );
}
