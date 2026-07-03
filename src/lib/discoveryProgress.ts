// Discovery Vault gamification store. localStorage only — no accounts, no
// network calls, no personal data ever leaves the browser. Tracks which
// facts a visitor has discovered (with just enough metadata — category and
// tags — to compute badge progress client-side without a server round
// trip), a daily discovery streak, and mini-quiz score.
//
// See src/lib/discoveryBadges.ts for badge definitions and
// src/components/facts/{DiscoveryProgress,DiscoveryBadges,MarkFactDiscovered}.tsx
// for the UI that reads and writes this store.

import type { FactCategory } from "@/generated/prisma/enums";

const STORAGE_KEY = "worldcup-nexus:discovery-progress";
// Native "storage" events only fire in OTHER tabs, never the tab that made
// the write — this custom event bridges that gap so same-tab UI (e.g. the
// quiz score right after answering) updates immediately.
const PROGRESS_EVENT = "worldcup-nexus:discovery-progress-changed";

export type MinimalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type DiscoveredFactRecord = {
  slug: string;
  category: FactCategory;
  tags: string[];
  discoveredAt: string;
};

export type DiscoveryStreak = {
  current: number;
  longest: number;
  /** "YYYY-MM-DD" in the visitor's local time zone, or null before any visit. */
  lastVisitDate: string | null;
};

export type DiscoveryQuizStats = {
  attempts: number;
  correct: number;
};

export type DiscoveryProgressState = {
  version: 1;
  discovered: DiscoveredFactRecord[];
  streak: DiscoveryStreak;
  quiz: DiscoveryQuizStats;
};

const EMPTY_STATE: DiscoveryProgressState = {
  version: 1,
  discovered: [],
  streak: { current: 0, longest: 0, lastVisitDate: null },
  quiz: { attempts: 0, correct: 0 },
};

function getBrowserStorage(): MinimalStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage can throw in private-browsing / locked-down environments.
    return null;
  }
}

function sanitizeDiscovered(raw: unknown): DiscoveredFactRecord[] {
  if (!Array.isArray(raw)) return [];
  const bySlug = new Map<string, DiscoveredFactRecord>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.slug !== "string" ||
      typeof record.category !== "string" ||
      typeof record.discoveredAt !== "string"
    ) {
      continue;
    }
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    bySlug.set(record.slug, {
      slug: record.slug,
      category: record.category as FactCategory,
      tags,
      discoveredAt: record.discoveredAt,
    });
  }
  return [...bySlug.values()];
}

function sanitizeStreak(raw: unknown): DiscoveryStreak {
  if (typeof raw !== "object" || raw === null) return EMPTY_STATE.streak;
  const streak = raw as Record<string, unknown>;
  return {
    current:
      typeof streak.current === "number" && Number.isFinite(streak.current)
        ? streak.current
        : 0,
    longest:
      typeof streak.longest === "number" && Number.isFinite(streak.longest)
        ? streak.longest
        : 0,
    lastVisitDate:
      typeof streak.lastVisitDate === "string" ? streak.lastVisitDate : null,
  };
}

function sanitizeQuiz(raw: unknown): DiscoveryQuizStats {
  if (typeof raw !== "object" || raw === null) return EMPTY_STATE.quiz;
  const quiz = raw as Record<string, unknown>;
  return {
    attempts:
      typeof quiz.attempts === "number" && Number.isFinite(quiz.attempts)
        ? quiz.attempts
        : 0,
    correct:
      typeof quiz.correct === "number" && Number.isFinite(quiz.correct)
        ? quiz.correct
        : 0,
  };
}

function parseState(raw: string | null): DiscoveryProgressState {
  if (raw === null) return EMPTY_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_STATE;
    const obj = parsed as Record<string, unknown>;
    return {
      version: 1,
      discovered: sanitizeDiscovered(obj.discovered),
      streak: sanitizeStreak(obj.streak),
      quiz: sanitizeQuiz(obj.quiz),
    };
  } catch {
    return EMPTY_STATE;
  }
}

function writeState(
  store: MinimalStorage | null,
  state: DiscoveryProgressState,
): void {
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/disabled — gamification is a nice-to-have, never block on it.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROGRESS_EVENT));
  }
}

// Snapshot cache keyed by the raw string, so repeated `getProgress()` calls
// with no underlying change return the SAME object reference. Required for
// `useSyncExternalStore`, which treats every new reference as a change and
// would otherwise re-render in a loop. Only applies to the real browser
// storage path (no explicit `storage` override) so tests never share state.
let cachedRaw: string | null | undefined;
let cachedState: DiscoveryProgressState = EMPTY_STATE;

/** Full progress state. Safe defaults if nothing (or something invalid) is stored. */
export function getProgress(storage?: MinimalStorage): DiscoveryProgressState {
  const store = storage ?? getBrowserStorage();
  const raw = store ? store.getItem(STORAGE_KEY) : null;
  if (storage === undefined) {
    if (raw === cachedRaw) return cachedState;
    cachedState = parseState(raw);
    cachedRaw = raw;
    return cachedState;
  }
  return parseState(raw);
}

/** Server/SSR snapshot for `useSyncExternalStore` — always the empty state. */
export function getServerProgressSnapshot(): DiscoveryProgressState {
  return EMPTY_STATE;
}

/** Subscribes to both cross-tab (`storage`) and same-tab progress changes. */
export function subscribeToProgress(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(PROGRESS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(PROGRESS_EVENT, onStoreChange);
  };
}

function todayLocalDateString(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterdayLocalDateString(now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return todayLocalDateString(yesterday);
}

/** Advances the streak for a visit "today", never double-counting the same day. */
function nextStreak(streak: DiscoveryStreak, now: Date): DiscoveryStreak {
  const today = todayLocalDateString(now);
  if (streak.lastVisitDate === today) return streak;
  const current =
    streak.lastVisitDate === yesterdayLocalDateString(now)
      ? streak.current + 1
      : 1;
  return { current, longest: Math.max(streak.longest, current), lastVisitDate: today };
}

/**
 * Records a fact discovery (idempotent per slug) and advances the daily
 * streak. Revisiting an already-discovered fact still counts as "engaging
 * today" for streak purposes, but never adds a duplicate discovered entry.
 */
export function recordFactDiscovered(
  fact: { slug: string; category: FactCategory; tags: string[] },
  now: Date = new Date(),
  storage?: MinimalStorage,
): DiscoveryProgressState {
  const store = storage ?? getBrowserStorage();
  const current = getProgress(storage);
  const alreadyDiscovered = current.discovered.some(
    (entry) => entry.slug === fact.slug,
  );
  const discovered = alreadyDiscovered
    ? current.discovered
    : [
        ...current.discovered,
        {
          slug: fact.slug,
          category: fact.category,
          tags: fact.tags,
          discoveredAt: now.toISOString(),
        },
      ];
  const next: DiscoveryProgressState = {
    ...current,
    discovered,
    streak: nextStreak(current.streak, now),
  };
  writeState(store, next);
  return next;
}

/** Records one mini-quiz attempt (see QuizBlock). */
export function recordQuizAttempt(
  correct: boolean,
  storage?: MinimalStorage,
): DiscoveryProgressState {
  const store = storage ?? getBrowserStorage();
  const current = getProgress(storage);
  const next: DiscoveryProgressState = {
    ...current,
    quiz: {
      attempts: current.quiz.attempts + 1,
      correct: current.quiz.correct + (correct ? 1 : 0),
    },
  };
  writeState(store, next);
  return next;
}

export function getDiscoveredCount(storage?: MinimalStorage): number {
  return getProgress(storage).discovered.length;
}

/** Distinct categories among the visitor's discovered facts. */
export function getViewedCategories(storage?: MinimalStorage): FactCategory[] {
  return [...new Set(getProgress(storage).discovered.map((entry) => entry.category))];
}
