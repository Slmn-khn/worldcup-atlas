"use client";

// Global search — debounced queries against /api/search, grouped results in
// a black rectangular dropdown panel. Pages never depend on search
// availability: if Meilisearch is down only the dropdown shows an error.

import * as React from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListSubheader from "@mui/material/ListSubheader";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import Link from "@/components/Link";
import { atlas, eyebrowSx } from "@/theme/tokens";
import { atlasBorders, atlasColors, atlasShadows } from "@/theme/visualTokens";
import type { SearchResponseDto, SearchResultDto } from "@/server/search/types";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const SERVICE_ERROR_MESSAGE =
  "Search index is unavailable. Run pnpm search:index and make sure Meilisearch is running.";

const GROUPS: { key: keyof SearchResponseDto["groups"]; label: string }[] = [
  { key: "tournaments", label: "Tournaments" },
  { key: "countries", label: "Countries" },
  { key: "players", label: "Players" },
  { key: "matches", label: "Matches" },
  { key: "records", label: "Records" },
  { key: "events", label: "Events" },
  { key: "venues", label: "Venues" },
];

function firstResult(response: SearchResponseDto): SearchResultDto | null {
  for (const group of GROUPS) {
    const item = response.groups[group.key][0];
    if (item !== undefined) return item;
  }
  return null;
}

export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [response, setResponse] = React.useState<SearchResponseDto | null>(
    null,
  );

  function handleQueryChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setResponse(null);
      setError(null);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&limit=18`,
          {
            signal: controller.signal,
          },
        );
        if (!result.ok) {
          setResponse(null);
          setError(SERVICE_ERROR_MESSAGE);
          return;
        }
        setResponse((await result.json()) as SearchResponseDto);
        setError(null);
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") {
          setResponse(null);
          setError(SERVICE_ERROR_MESSAGE);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Enter" && response !== null) {
      const first = firstResult(response);
      if (first !== null) {
        setOpen(false);
        router.push(first.href);
      }
    }
  }

  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box sx={{ position: "relative" }}>
        <Paper
          elevation={0}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2.5,
            minHeight: 58,
            bgcolor: atlasColors.surfaceGlass,
            backdropFilter: "blur(12px)",
            border: `1px solid ${atlasBorders.cyan}`,
            borderRadius: "16px",
            boxShadow: atlasShadows.cyanGlow,
            transition: "border-color 200ms ease, box-shadow 200ms ease",
            "&:hover": { borderColor: atlasBorders.cyanStrong },
            "&:focus-within": {
              borderColor: atlasColors.cyanStrong,
              boxShadow: atlasShadows.cyanGlowStrong,
            },
            "&:focus-within .GlobalSearch-icon": {
              color: atlasColors.cyanStrong,
            },
          }}
        >
          <SearchIcon
            className="GlobalSearch-icon"
            sx={{ color: atlasColors.cyan, transition: "color 150ms ease" }}
          />
          <InputBase
            fullWidth
            placeholder="Search tournaments, countries, players, matches…"
            inputProps={{ "aria-label": "Search the archive" }}
            sx={{ color: atlas.textPrimary, fontSize: "1rem", fontWeight: 300 }}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {loading ? (
            <CircularProgress size={16} sx={{ color: atlasColors.cyan }} />
          ) : null}
        </Paper>

        {showDropdown ? (
          <Paper
            elevation={0}
            role="region"
            aria-label="Search results"
            aria-live="polite"
            sx={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              right: 0,
              zIndex: (theme) => theme.zIndex.modal,
              bgcolor: atlasColors.surface,
              border: `1px solid ${atlasBorders.softStrong}`,
              borderRadius: "14px",
              boxShadow: atlasShadows.card,
              maxHeight: 480,
              overflowY: "auto",
            }}
          >
            {error !== null ? (
              <Typography
                variant="body2"
                sx={{ color: atlas.textSecondary, px: 2.5, py: 2 }}
              >
                {error}
              </Typography>
            ) : response !== null && response.total === 0 ? (
              <Typography
                variant="body2"
                sx={{ color: atlas.textSecondary, px: 2.5, py: 2 }}
              >
                No results for “{response.query}”.
              </Typography>
            ) : response !== null ? (
              <List dense disablePadding>
                {GROUPS.flatMap((group) => {
                  const items = response.groups[group.key];
                  if (items.length === 0) return [];
                  return [
                    <ListSubheader
                      key={`${group.key}-header`}
                      sx={{
                        ...eyebrowSx,
                        bgcolor: atlas.surfaceSoft,
                        color: atlas.textMuted,
                        borderBottom: `1px solid ${atlas.border}`,
                        lineHeight: 2.8,
                      }}
                    >
                      {group.label}
                    </ListSubheader>,
                    ...items.map((item) => (
                      <ListItemButton
                        key={item.id}
                        component={Link}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        sx={{
                          alignItems: "baseline",
                          flexWrap: "wrap",
                          columnGap: 1,
                          borderBottom: `1px solid ${atlas.border}`,
                          transition: "background-color 150ms ease",
                          "&:hover, &:focus-visible": {
                            bgcolor: atlas.surface1,
                          },
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ color: atlas.textPrimary, fontWeight: 600 }}
                        >
                          {item.title}
                        </Typography>
                        {item.subtitle ? (
                          <Typography
                            variant="caption"
                            sx={{ color: atlas.textMuted }}
                          >
                            {item.subtitle}
                          </Typography>
                        ) : null}
                      </ListItemButton>
                    )),
                  ];
                })}
              </List>
            ) : (
              <Typography
                variant="body2"
                sx={{ color: atlas.textSecondary, px: 2.5, py: 2 }}
              >
                Searching…
              </Typography>
            )}
          </Paper>
        ) : null}

        <Typography
          variant="caption"
          sx={{ color: atlas.textMuted, display: "block", mt: 1 }}
        >
          Try: Brazil 1970, Maradona 1986, Argentina France final
        </Typography>
      </Box>
    </ClickAwayListener>
  );
}
