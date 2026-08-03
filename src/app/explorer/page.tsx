// Data Explorer shell (Checkpoint 5G) — database-backed via the query layer.
// Server component fetches normalized rows; the Data Grid and filters are
// client components driven by URL query params. No RawSourceRecord exposure.

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ExplorerFilters from "@/components/explorer/ExplorerFilters";
import ExplorerTable from "@/components/explorer/ExplorerTable";
import ExplorerSummary from "@/components/explorer/ExplorerSummary";
import { getExplorerData } from "@/server/queries/explorer";
import {
  parseExplorerOptions,
  searchParamsGetter,
} from "@/server/queries/parseExplorerParams";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Data Explorer",
  description:
    "Browse imported World Cup records and events across tournaments, matches, players, and teams.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExplorerPage({ searchParams }: Props) {
  const params = await searchParams;
  const data = await getExplorerData(
    parseExplorerOptions(searchParamsGetter(params)),
  );

  return (
    <Box>
      <VaultPageHeader
        title="Data Explorer"
        lede="Browse imported World Cup records and events across tournaments, matches, players, and teams."
        meta="This explorer covers the normalized historical archive (1930–2022). The separately imported 2026 archive is browsable via the 2026 hub, schedule, and search. Raw source rows are not exposed."
      />

      <PageContainer sx={{ py: { xs: 5, md: 7 } }}>
        <Stack spacing={2.5}>
          <ExplorerFilters
            filters={data.filters}
            active={data.activeFilters}
            currentPageSize={data.pageSize}
            total={data.total}
          />
          <ExplorerSummary
            total={data.total}
            page={data.page}
            pageSize={data.pageSize}
            active={data.activeFilters}
          />
          {data.rows.length > 0 ? (
            <ExplorerTable
              rows={data.rows}
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
            />
          ) : (
            <EmptyState
              title="No rows match these filters"
              description="Try a different event type or tournament, or clear the filters."
            />
          )}
        </Stack>
      </PageContainer>
    </Box>
  );
}
