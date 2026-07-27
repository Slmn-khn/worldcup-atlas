// Tolerant CSV parsing for the 2026 candidate providers (Phase 1).
//
// Candidate-provider files are community data whose exact shape is not
// guaranteed, so parsing is deliberately forgiving:
//   - extra columns are allowed (kept, with a row warning),
//   - short rows pad missing cells with null,
//   - empty strings become null,
//   - numeric strings become numbers only when the conversion is lossless,
//   - a malformed row becomes a WARN/ERROR record — it is NEVER silently
//     dropped, and it never fails the whole file.
//
// Pure functions over string bodies — no filesystem, no network, no database.

import { parse as parseCsvSync } from "csv-parse/sync";

import type {
  ProviderCandidateRecord,
  ProviderParseStatus,
} from "../types";

/** Parsed provider file: header + candidate rows (+ file-level error). */
export type TolerantCsvResult = {
  columns: string[];
  records: ProviderCandidateRecord[];
  /** Non-null when the document itself could not be tokenized at all. */
  fileError: string | null;
};

/**
 * Empty string → null; losslessly-numeric string → number; everything else →
 * trimmed string. "Lossless" means the numeric text round-trips (so id-like
 * values such as "007" or "1e3" stay strings).
 */
export function coerceCell(value: string | null | undefined): string | number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    // Round-trip check: "007", "1.50" and other id-like/zero-padded values
    // would lose information, so they stay strings.
    if (Number.isFinite(num) && String(num) === trimmed) return num;
  }
  return trimmed;
}

/**
 * Tokenizes a CSV body into raw string cells. Relaxed about ragged rows and
 * stray quotes; a hard tokenizer failure is reported as fileError (the caller
 * still gets an empty, well-formed result — never a throw).
 */
function tokenize(body: string): { rows: string[][]; fileError: string | null } {
  try {
    const rows = parseCsvSync(body, {
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    }) as string[][];
    return { rows, fileError: null };
  } catch (error) {
    return {
      rows: [],
      fileError: `CSV parse failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parses one provider CSV into candidate records. `requiredColumns` marks the
 * fields a row needs to be usable at all: a row missing every required value
 * is an ERROR record (kept, with warnings); a row with lesser problems (extra
 * cells, some missing required values) is WARN.
 */
export function parseProviderCsv(input: {
  sourceId: string;
  sourceFile: string;
  body: string;
  /** Column names (as in the header) that identify a usable row. */
  requiredColumns?: string[];
}): TolerantCsvResult {
  const { sourceId, sourceFile, body } = input;
  const required = input.requiredColumns ?? [];
  const { rows, fileError } = tokenize(body);
  if (fileError !== null || rows.length === 0) {
    return {
      columns: [],
      records: [],
      fileError: fileError ?? "File is empty (no header row).",
    };
  }

  const columns = rows[0].map((name, index) => {
    const trimmed = name.trim();
    return trimmed === "" ? `column_${index + 1}` : trimmed;
  });

  const records: ProviderCandidateRecord[] = rows.slice(1).map((cells, index) => {
    const warnings: string[] = [];
    const raw: Record<string, unknown> = {};
    const parsed: Record<string, unknown> = {};

    columns.forEach((column, columnIndex) => {
      const cell = columnIndex < cells.length ? cells[columnIndex] : null;
      raw[column] = cell;
      parsed[column] = coerceCell(cell);
    });
    if (cells.length > columns.length) {
      warnings.push(
        `Row has ${cells.length} cells for ${columns.length} header columns; extra cells kept under _extra.`,
      );
      raw._extra = cells.slice(columns.length);
    }
    if (cells.length < columns.length) {
      warnings.push(
        `Row has ${cells.length} cells for ${columns.length} header columns; missing cells set to null.`,
      );
    }

    const missingRequired = required.filter(
      (column) => parsed[column] == null,
    );
    if (missingRequired.length > 0 && missingRequired.length < required.length) {
      warnings.push(`Missing required value(s): ${missingRequired.join(", ")}.`);
    }
    let parseStatus: ProviderParseStatus = warnings.length > 0 ? "WARN" : "OK";
    if (required.length > 0 && missingRequired.length === required.length) {
      warnings.push(
        `Row is unusable: every required column (${required.join(", ")}) is empty.`,
      );
      parseStatus = "ERROR";
    }

    return {
      sourceId,
      sourceFile,
      sourceRowNumber: index + 1,
      raw,
      parsed,
      parseStatus,
      warnings,
    };
  });

  return { columns, records, fileError: null };
}

/**
 * Parses a provider JSON document (array of objects, or an object wrapping
 * one) into the same candidate-record shape, so JSON endpoints flow through
 * the identical candidate pipeline. Non-object entries become ERROR records.
 */
export function parseProviderJson(input: {
  sourceId: string;
  sourceFile: string;
  body: string;
}): TolerantCsvResult {
  const { sourceId, sourceFile, body } = input;
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (error) {
    return {
      columns: [],
      records: [],
      fileError: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let entries: unknown[] = [];
  if (Array.isArray(doc)) entries = doc;
  else if (doc !== null && typeof doc === "object") {
    const root = doc as Record<string, unknown>;
    const arrayValues = Object.values(root).filter((value) => Array.isArray(value));
    entries = arrayValues.length === 1 ? (arrayValues[0] as unknown[]) : [doc];
  } else {
    return { columns: [], records: [], fileError: "JSON document is not an object or array." };
  }

  const columnSet = new Set<string>();
  const records: ProviderCandidateRecord[] = entries.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        sourceId,
        sourceFile,
        sourceRowNumber: index + 1,
        raw: { value: entry },
        parsed: {},
        parseStatus: "ERROR" as const,
        warnings: ["Entry is not a JSON object."],
      };
    }
    const raw = entry as Record<string, unknown>;
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      columnSet.add(key);
      parsed[key] = typeof value === "string" ? coerceCell(value) : value;
    }
    return {
      sourceId,
      sourceFile,
      sourceRowNumber: index + 1,
      raw,
      parsed,
      parseStatus: "OK" as const,
      warnings: [],
    };
  });

  return { columns: [...columnSet], records, fileError: null };
}

// ---------------------------------------------------------------------------
// Safe readers over parsed provider rows
// ---------------------------------------------------------------------------

/** First non-null string value among the given keys (numbers stringified). */
export function pickString(
  parsed: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** First finite number among the given keys (numeric strings accepted). */
export function pickNumber(
  parsed: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }
  return null;
}

/** pickNumber restricted to integers. */
export function pickInt(
  parsed: Record<string, unknown>,
  keys: string[],
): number | null {
  const num = pickNumber(parsed, keys);
  return num !== null && Number.isInteger(num) ? num : null;
}
