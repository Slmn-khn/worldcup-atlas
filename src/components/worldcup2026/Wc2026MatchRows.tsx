// Compact archived 2026 match rows — flags, teams, bold score, AET/pens tag,
// venue line, each row linking to /matches/2026/<id>. Server component; used
// by the 2026 hub (matches, bracket, overview) with the shared Vault voice.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import CountryFlag from "@/components/media/CountryFlag";
import { atlas, eyebrowSx, tabularNums } from "@/theme/tokens";
import type { Wc2026MatchDto } from "@/server/worldcup2026/queries";

export function wc2026ScoreLine(match: Wc2026MatchDto): string {
  if (match.homeScore === null || match.awayScore === null) return "–";
  const base = `${match.homeScore}–${match.awayScore}`;
  if (match.resultType === "Penalties") {
    return match.homePenaltyScore !== null && match.awayPenaltyScore !== null
      ? `${base} (${match.homePenaltyScore}–${match.awayPenaltyScore} p)`
      : `${base} (pens)`;
  }
  if (match.resultType === "AET") return `${base} AET`;
  return base;
}

function TeamSide({
  name,
  code,
  align,
  winner,
}: {
  name: string | null;
  code: string | null;
  align: "left" | "right";
  winner: boolean;
}) {
  const label = name ?? code ?? "—";
  const flag = <CountryFlag code={code} name={name} size="xs" />;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        minWidth: 0,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      {align === "left" ? flag : null}
      <Typography
        component="span"
        sx={{
          color: atlas.bodyStrong,
          fontWeight: winner ? 700 : 400,
          fontSize: "0.9rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Typography>
      {align === "right" ? flag : null}
    </Box>
  );
}

export default function Wc2026MatchRows({
  matches,
  showStage = false,
}: {
  matches: Wc2026MatchDto[];
  showStage?: boolean;
}) {
  return (
    <Box sx={{ border: `1px solid ${atlas.border}` }}>
      {matches.map((match, index) => (
        <Box
          key={match.id}
          component={Link}
          href={`/matches/2026/${match.sourceMatchId}`}
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0,1fr) auto minmax(0,1fr)",
              md: "110px minmax(0,1fr) 120px minmax(0,1fr) minmax(0,220px)",
            },
            alignItems: "center",
            gap: { xs: 1, md: 2 },
            px: { xs: 1.5, md: 2.5 },
            py: 1.5,
            textDecoration: "none",
            borderTop: index > 0 ? `1px solid ${atlas.border}` : "none",
            transition: "background-color 150ms ease",
            "&:hover": { backgroundColor: "rgba(0,217,255,0.05)" },
          }}
        >
          <Typography
            component="span"
            sx={{
              ...eyebrowSx,
              ...tabularNums,
              fontSize: "0.6rem",
              color: atlas.textMuted,
              display: { xs: "none", md: "block" },
            }}
          >
            {showStage ? (match.stageName ?? "—") : (match.date ?? "—")}
          </Typography>
          <TeamSide
            name={match.homeTeamName}
            code={match.homeTeamCode}
            align="right"
            winner={
              match.winnerTeamCode !== null &&
              match.winnerTeamCode === match.homeTeamCode
            }
          />
          <Typography
            component="span"
            sx={{
              ...tabularNums,
              fontFamily: atlas.fontDisplay,
              fontWeight: 900,
              fontSize: "0.95rem",
              color: atlas.textPrimary,
              textAlign: "center",
              whiteSpace: "nowrap",
              px: 1,
            }}
          >
            {wc2026ScoreLine(match)}
          </Typography>
          <TeamSide
            name={match.awayTeamName}
            code={match.awayTeamCode}
            align="left"
            winner={
              match.winnerTeamCode !== null &&
              match.winnerTeamCode === match.awayTeamCode
            }
          />
          <Typography
            component="span"
            sx={{
              fontSize: "0.72rem",
              color: atlas.textMuted,
              display: { xs: "none", md: "block" },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "right",
            }}
          >
            {match.groupLetter !== null ? `Group ${match.groupLetter} · ` : ""}
            {match.venueName ?? "—"}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
