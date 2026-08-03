// Archived 2026 schedule & results — desktop table + mobile cards. Server
// component; rows come pre-built from the file-backed archive source (never
// live Fixture rows). Completed-tournament voice: every row shows a final
// result, an AET/penalties note, or an explicit "Under review" — never
// "Scheduled", never bracket placeholders like "2A".
//
// Same Vault/neon voice as the fixture ScheduleTable it replaces on this
// page: gold date group rows, hairline chips, bold centered scores.

import { Fragment } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import CountryFlag from "@/components/media/CountryFlag";
import { atlas, eyebrowSx, tabularNums } from "@/theme/tokens";
import { nexusColors } from "@/theme/visualTokens";
import {
  formatArchivedScore,
  type Archived2026MatchStatus,
  type Archived2026ScheduleRow,
  type Archived2026Verification,
} from "@/server/worldcup2026/archiveSchedule";

export type ArchivedDayGroup = {
  dateLabel: string;
  rows: Archived2026ScheduleRow[];
};

/** Rows grouped by date label (rows are already sorted date-ascending). */
export function groupArchivedRowsByDate(
  rows: Archived2026ScheduleRow[],
): ArchivedDayGroup[] {
  const groups: ArchivedDayGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.dateLabel === row.dateLabel) {
      last.rows.push(row);
    } else {
      groups.push({ dateLabel: row.dateLabel, rows: [row] });
    }
  }
  return groups;
}

// --- chips -----------------------------------------------------------------

const STATUS_STYLES: Record<
  Archived2026MatchStatus,
  { label: string; color: string; borderColor: string }
> = {
  FULL_TIME: {
    label: "Full-time",
    color: atlas.bodyStrong,
    borderColor: atlas.borderStrong,
  },
  AFTER_EXTRA_TIME: {
    label: "AET",
    color: nexusColors.cyan,
    borderColor: "rgba(0, 217, 255, 0.45)",
  },
  PENALTIES: {
    label: "Penalties",
    color: atlas.gold,
    borderColor: atlas.goldBorder,
  },
  RESULT_UNDER_REVIEW: {
    label: "Under review",
    color: atlas.yellow,
    borderColor: "rgba(250, 204, 21, 0.45)",
  },
  INCOMPLETE: {
    label: "Incomplete",
    color: atlas.textMuted,
    borderColor: atlas.border,
  },
};

const VERIFICATION_STYLES: Record<
  Archived2026Verification,
  { label: string; color: string; borderColor: string }
> = {
  VERIFIED: {
    label: "Verified",
    color: atlas.green,
    borderColor: "rgba(39, 208, 127, 0.45)",
  },
  REPORTED: {
    label: "Reported",
    color: atlas.textSecondary,
    borderColor: atlas.borderStrong,
  },
  PARTIAL: {
    label: "Partial",
    color: atlas.yellow,
    borderColor: "rgba(250, 204, 21, 0.45)",
  },
  UNVERIFIED: {
    label: "Unverified",
    color: atlas.textMuted,
    borderColor: atlas.border,
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    color: atlas.yellow,
    borderColor: "rgba(250, 204, 21, 0.45)",
  },
};

const chipSx = {
  ...eyebrowSx,
  fontSize: "0.6rem",
  height: 22,
  borderRadius: 0,
  bgcolor: "transparent",
  border: "1px solid",
  "& .MuiChip-label": { px: 1 },
} as const;

export function ArchivedStatusChip({
  status,
}: {
  status: Archived2026MatchStatus;
}) {
  const style = STATUS_STYLES[status];
  return (
    <Chip
      label={style.label}
      size="small"
      sx={{ ...chipSx, color: style.color, borderColor: style.borderColor }}
    />
  );
}

export function VerificationChip({
  verification,
}: {
  verification: Archived2026Verification;
}) {
  const style = VERIFICATION_STYLES[verification];
  return (
    <Chip
      label={style.label}
      size="small"
      sx={{ ...chipSx, color: style.color, borderColor: style.borderColor }}
    />
  );
}

// --- shared cell content ---------------------------------------------------

/** Team display: full name where known, otherwise an honest review label. */
function teamDisplayName(
  name: string | null | undefined,
  code: string | null | undefined,
): string {
  return name ?? code ?? "TBD · under review";
}

function TeamCellContent({
  name,
  code,
  align,
}: {
  name: string | null | undefined;
  code: string | null | undefined;
  align: "left" | "right";
}) {
  const label = teamDisplayName(name, code);
  const known = name != null || code != null;
  const flag = (
    <CountryFlag code={code ?? null} name={name ?? null} size="xs" />
  );
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        maxWidth: "100%",
      }}
    >
      {align === "right" ? (
        <>
          <Typography
            component="span"
            sx={{
              color: known ? atlas.bodyStrong : atlas.textMuted,
              fontStyle: known ? "normal" : "italic",
              fontSize: "0.9rem",
            }}
          >
            {label}
          </Typography>
          {flag}
        </>
      ) : (
        <>
          {flag}
          <Typography
            component="span"
            sx={{
              color: known ? atlas.bodyStrong : atlas.textMuted,
              fontStyle: known ? "normal" : "italic",
              fontSize: "0.9rem",
            }}
          >
            {label}
          </Typography>
        </>
      )}
    </Box>
  );
}

function ScoreText({ row }: { row: Archived2026ScheduleRow }) {
  const score = formatArchivedScore(row);
  return (
    <Typography
      component="span"
      sx={{
        ...tabularNums,
        whiteSpace: "nowrap",
        fontFamily: atlas.fontDisplay,
        fontWeight: 900,
        fontSize: "0.95rem",
        color: score !== null ? nexusColors.textPrimary : atlas.yellow,
        ...(score === null
          ? {
              fontFamily: undefined,
              fontWeight: 600,
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }
          : null),
      }}
    >
      {score ?? "Under review"}
    </Typography>
  );
}

function stageContext(row: Archived2026ScheduleRow): string {
  return row.groupName ?? row.stage;
}

function venueLabel(row: Archived2026ScheduleRow): string | null {
  if (row.venueName !== null && row.venueName !== undefined) {
    return row.cityName != null
      ? `${row.venueName} · ${row.cityName}`
      : row.venueName;
  }
  return row.cityName ?? null;
}

// --- desktop table ---------------------------------------------------------

const HEADER_BG =
  "linear-gradient(180deg, rgba(16,32,51,0.98), rgba(8,20,34,0.98))";

const headerCellSx = {
  color: nexusColors.gold,
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  whiteSpace: "nowrap",
  py: 1.75,
  borderBottom: "1px solid rgba(0,217,255,0.28)",
} as const;

const cellSx = {
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  color: nexusColors.textSecondary,
  py: 1.75,
} as const;

export default function ArchivedScheduleTable({
  groups,
}: {
  groups: ArchivedDayGroup[];
}) {
  return (
    <Box
      sx={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "16px",
        bgcolor: atlas.canvasSoft,
      }}
    >
      <Table
        sx={{
          minWidth: 980,
          "& td, & th": { borderColor: "rgba(255,255,255,0.08)" },
          "& tbody tr": {
            transition: "background-color 160ms ease",
          },
          "& tbody tr:hover": {
            backgroundColor: "rgba(0,217,255,0.045)",
          },
        }}
      >
        <TableHead sx={{ background: HEADER_BG }}>
          <TableRow>
            <TableCell sx={{ ...headerCellSx, minWidth: 130 }}>Stage</TableCell>
            <TableCell sx={{ ...headerCellSx, textAlign: "right" }}>
              Home
            </TableCell>
            <TableCell sx={{ ...headerCellSx, textAlign: "center", width: 150 }}>
              Score
            </TableCell>
            <TableCell sx={headerCellSx}>Away</TableCell>
            <TableCell sx={headerCellSx}>Venue</TableCell>
            <TableCell sx={{ ...headerCellSx, width: 120 }}>Result</TableCell>
            <TableCell sx={{ ...headerCellSx, width: 130 }}>
              Verification
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.dateLabel}>
              {/* Highlighted date group row. */}
              <TableRow sx={{ backgroundColor: "rgba(244,201,93,0.06)" }}>
                <TableCell
                  colSpan={7}
                  sx={{
                    py: 1.25,
                    borderBottom: "1px solid rgba(244,201,93,0.16)",
                    borderLeft: "3px solid rgba(244,201,93,0.5)",
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      ...tabularNums,
                      fontSize: "0.72rem",
                      fontWeight: 900,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: nexusColors.gold,
                    }}
                  >
                    {group.dateLabel}
                  </Typography>
                </TableCell>
              </TableRow>
              {group.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell
                    sx={{ ...cellSx, whiteSpace: "nowrap", color: atlas.textMuted }}
                  >
                    {stageContext(row)}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, textAlign: "right" }}>
                    <TeamCellContent
                      name={row.homeTeamName}
                      code={row.homeTeamCode}
                      align="right"
                    />
                  </TableCell>
                  <TableCell sx={{ ...cellSx, textAlign: "center" }}>
                    <ScoreText row={row} />
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <TeamCellContent
                      name={row.awayTeamName}
                      code={row.awayTeamCode}
                      align="left"
                    />
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: atlas.textMuted }}>
                    {venueLabel(row) ?? "—"}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, whiteSpace: "nowrap" }}>
                    <ArchivedStatusChip status={row.status} />
                  </TableCell>
                  <TableCell sx={{ ...cellSx, whiteSpace: "nowrap" }}>
                    <VerificationChip verification={row.verification} />
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

// --- mobile cards ----------------------------------------------------------

function MobileTeamLine({
  name,
  code,
  score,
  emphasized,
}: {
  name: string | null | undefined;
  code: string | null | undefined;
  score: number | null | undefined;
  emphasized: boolean;
}) {
  const known = name != null || code != null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1.5,
        py: 0.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <CountryFlag code={code ?? null} name={name ?? null} size="xs" />
        <Typography
          component="span"
          sx={{
            color: known ? atlas.bodyStrong : atlas.textMuted,
            fontStyle: known ? "normal" : "italic",
            fontWeight: emphasized ? 700 : 400,
            fontSize: "0.92rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {teamDisplayName(name, code)}
        </Typography>
      </Box>
      <Typography
        component="span"
        sx={{
          ...tabularNums,
          fontFamily: atlas.fontDisplay,
          fontWeight: 900,
          fontSize: "1rem",
          color:
            score != null ? nexusColors.textPrimary : atlas.textMuted,
          flexShrink: 0,
        }}
      >
        {score ?? "–"}
      </Typography>
    </Box>
  );
}

export function ArchivedScheduleCards({
  groups,
}: {
  groups: ArchivedDayGroup[];
}) {
  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      {groups.map((group) => (
        <Box key={group.dateLabel}>
          <Typography
            component="p"
            sx={{
              ...tabularNums,
              fontSize: "0.7rem",
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: nexusColors.gold,
              borderLeft: "3px solid rgba(244,201,93,0.5)",
              pl: 1.25,
              mb: 1.5,
            }}
          >
            {group.dateLabel}
          </Typography>
          <Box sx={{ display: "grid", gap: 1.5 }}>
            {group.rows.map((row) => {
              const score = formatArchivedScore(row);
              return (
                <Box
                  key={row.id}
                  sx={{
                    border: `1px solid ${atlas.border}`,
                    bgcolor: atlas.surfaceSoft,
                    p: 2,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                      mb: 1,
                    }}
                  >
                    <Typography
                      component="span"
                      sx={{
                        ...eyebrowSx,
                        fontSize: "0.6rem",
                        color: atlas.textMuted,
                      }}
                    >
                      {stageContext(row)}
                    </Typography>
                    <ArchivedStatusChip status={row.status} />
                  </Box>
                  <MobileTeamLine
                    name={row.homeTeamName}
                    code={row.homeTeamCode}
                    score={row.homeScore}
                    emphasized={
                      row.winnerTeamCode != null &&
                      row.winnerTeamCode === row.homeTeamCode
                    }
                  />
                  <MobileTeamLine
                    name={row.awayTeamName}
                    code={row.awayTeamCode}
                    score={row.awayScore}
                    emphasized={
                      row.winnerTeamCode != null &&
                      row.winnerTeamCode === row.awayTeamCode
                    }
                  />
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                      mt: 1.25,
                      flexWrap: "wrap",
                    }}
                  >
                    <Typography
                      component="span"
                      sx={{ fontSize: "0.75rem", color: atlas.textMuted }}
                    >
                      {score !== null
                        ? score
                        : "Result under review"}
                      {venueLabel(row) !== null ? ` · ${venueLabel(row)}` : ""}
                    </Typography>
                    <VerificationChip verification={row.verification} />
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
