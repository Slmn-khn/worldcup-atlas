"use client";

// Live countdown to the next hourly rotation. Recomputes once per minute;
// renders nothing if no rotation time was provided (e.g. no facts published
// yet) so the card never shows a broken or stale countdown.

import { useEffect, useState } from "react";
import Typography from "@mui/material/Typography";
import { nexusColors } from "@/theme/visualTokens";

function formatCountdown(nextRotationAt: string): string | null {
  const target = new Date(nextRotationAt).getTime();
  if (!Number.isFinite(target)) return null;
  const minutes = Math.max(0, Math.ceil((target - Date.now()) / 60_000));
  return minutes <= 0
    ? "Next discovery any moment"
    : `Next discovery in ${minutes}m`;
}

export default function FactCountdown({
  nextRotationAt,
}: {
  nextRotationAt?: string | null;
}) {
  // Starts null (matches SSR) — the effect below fills it in asynchronously
  // right after mount, so the countdown never causes a hydration mismatch.
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (nextRotationAt === undefined || nextRotationAt === null) return;
    const update = () => setLabel(formatCountdown(nextRotationAt));
    const timeoutId = setTimeout(update, 0);
    const intervalId = setInterval(update, 60_000);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [nextRotationAt]);

  if (label === null) return null;

  return (
    <Typography
      variant="caption"
      sx={{ color: nexusColors.textMuted, fontVariantNumeric: "tabular-nums" }}
    >
      {label}
    </Typography>
  );
}
