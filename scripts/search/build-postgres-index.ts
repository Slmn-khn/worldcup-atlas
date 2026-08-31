// Rebuilds the Postgres-backed search index (the SearchDocument table) from
// normalized database tables. Source of truth is PostgreSQL — RawSourceRecord
// is never indexed. Replaces the former Meilisearch indexer: no external
// search service and no MEILISEARCH_* env vars are required, only
// DATABASE_URL.
//
// Idempotent: each run atomically replaces the whole table inside one
// transaction, so concurrent readers see either the old or the new index.
//
// Usage: pnpm search:index

import "dotenv/config";

import { prisma } from "@/server/db/prisma";
import { buildAllSearchDocuments } from "@/server/search/documents";
import {
  countByEntityType,
  toSearchDocumentRows,
} from "@/server/search/indexing";

const BATCH_SIZE = 1000;

async function main() {
  console.log("WORLDCUP Nexus — building Postgres search index\n");

  console.log("Building documents from normalized tables...");
  const documents = await buildAllSearchDocuments();
  const rows = toSearchDocumentRows(documents);
  for (const [type, count] of countByEntityType(rows)) {
    console.log(`  ${type.padEnd(12)} ${count}`);
  }
  console.log(`  total        ${rows.length}\n`);

  console.log('Rebuilding "SearchDocument" table...');
  await prisma.$transaction(
    async (tx) => {
      await tx.searchDocument.deleteMany();
      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE);
        await tx.searchDocument.createMany({ data: batch });
        console.log(
          `  wrote ${Math.min(start + BATCH_SIZE, rows.length)}/${rows.length}`,
        );
      }
    },
    { timeout: 300_000 },
  );

  const total = await prisma.searchDocument.count();
  console.log(`\nSearch index ready: ${total} documents.`);
  console.log("Next: pnpm search:verify");
}

main()
  .catch((error) => {
    console.error(
      "\nIndexing failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
