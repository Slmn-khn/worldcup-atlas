// Raw snapshot collector for the 2026 data steward agent (Phase 1).
//
// Fetches every configured endpoint of every APPROVED source and saves the
// untouched response body plus a metadata sidecar under
// data/2026/raw/<sourceId>/. Acquisition only:
//   - never writes to the database,
//   - never requires an API key,
//   - never crashes the whole run because one endpoint failed — failures are
//     recorded in the sidecar and the summary and collection continues.
//
// Raw snapshots are git-ignored; they are local working data, not curated
// output.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  APPROVED_2026_SOURCES,
  RAW_2026_DIR,
  SOURCE_REGISTRY_JSON_PATH,
  buildSourceRegistryJson,
} from "./sourceRegistry";
import type { Approved2026Source, SnapshotMeta, SourceEndpoint } from "./types";

/** Hard timeout for every collector fetch. */
export const COLLECTOR_FETCH_TIMEOUT_MS = 15_000;

export type EndpointCollectResult = SnapshotMeta & {
  /** Absolute-ish repo path the body was written to (null when failed). */
  bodyPath: string | null;
};

export type CollectSummary = {
  startedAt: string;
  finishedAt: string;
  results: EndpointCollectResult[];
  okCount: number;
  failedCount: number;
};

/** sha256 hex digest — the snapshot identity used across reports. */
export function sha256Hex(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

async function fetchWithTimeout(
  url: string,
): Promise<{ body: Buffer; httpStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    COLLECTOR_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "*/*" },
      redirect: "follow",
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const error = new Error(
        `HTTP ${response.status} ${response.statusText}`,
      ) as Error & { httpStatus?: number };
      error.httpStatus = response.status;
      throw error;
    }
    return { body, httpStatus: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function collectEndpoint(
  source: Approved2026Source,
  endpoint: SourceEndpoint,
  rawDir: string,
): Promise<EndpointCollectResult> {
  const sourceDir = path.join(rawDir, source.id);
  await mkdir(sourceDir, { recursive: true });
  const bodyPath = path.join(sourceDir, endpoint.outputFile);
  const metaPath = `${bodyPath}.meta.json`;
  const fetchedAt = new Date().toISOString();

  let meta: SnapshotMeta;
  let savedBodyPath: string | null = null;
  try {
    const { body, httpStatus } = await fetchWithTimeout(endpoint.url);
    await writeFile(bodyPath, body);
    savedBodyPath = bodyPath;
    meta = {
      sourceId: source.id,
      endpointId: endpoint.id,
      url: endpoint.url,
      format: endpoint.format,
      fetchedAt,
      contentHash: sha256Hex(body),
      status: "OK",
      httpStatus,
      errorMessage: null,
      contentLength: body.byteLength,
    };
  } catch (error) {
    const httpStatus =
      typeof (error as { httpStatus?: unknown }).httpStatus === "number"
        ? ((error as { httpStatus: number }).httpStatus ?? null)
        : null;
    meta = {
      sourceId: source.id,
      endpointId: endpoint.id,
      url: endpoint.url,
      format: endpoint.format,
      fetchedAt,
      contentHash: "",
      status: "FAILED",
      httpStatus,
      errorMessage: error instanceof Error ? error.message : String(error),
      contentLength: 0,
    };
  }

  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { ...meta, bodyPath: savedBodyPath };
}

/**
 * Collect every endpoint of every approved source. Individual failures are
 * recorded and never abort the run. Also rewrites the JSON registry mirror so
 * data/2026/source-registry.json can never drift from the TS registry.
 */
export async function collectApprovedSources(
  rawDir: string = RAW_2026_DIR,
): Promise<CollectSummary> {
  const startedAt = new Date().toISOString();
  const results: EndpointCollectResult[] = [];

  await mkdir(path.dirname(SOURCE_REGISTRY_JSON_PATH), { recursive: true });
  await writeFile(
    SOURCE_REGISTRY_JSON_PATH,
    `${JSON.stringify(buildSourceRegistryJson(), null, 2)}\n`,
    "utf8",
  );

  for (const source of APPROVED_2026_SOURCES) {
    for (const endpoint of source.endpoints ?? []) {
      // Sequential on purpose: deterministic order, no burst traffic.
      results.push(await collectEndpoint(source, endpoint, rawDir));
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    okCount: results.filter((result) => result.status === "OK").length,
    failedCount: results.filter((result) => result.status === "FAILED").length,
  };
}
