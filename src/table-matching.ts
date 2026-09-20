import type { SavedTableInfo } from "./types";

/**
 * Identity matching for rendered tables.
 *
 * The plugin used to key saved dimensions by document position
 * (`<note path>::<index>`), which meant inserting a table above another one
 * shifted every saved size. Keying by content instead loses sizes whenever a
 * header is edited. Both fail for the same reason: they ask "is this key
 * equal?", when identity is really a *matching* problem.
 *
 * So matching runs in rounds over the whole note, never greedily per table:
 *
 *   1a. identical signature and identical body  -> same table, content unchanged
 *   1b. identical signature                     -> same table, body edited
 *   2.  fuzzy header similarity above a threshold -> same table, header edited
 *   3.  document position                       -> last resort, never worse
 *                                                  than the previous behaviour
 *
 * Running 1a/1b/2 for every table *before* falling back to positions is what
 * makes a newly inserted table come out unmatched: the existing tables claim
 * their records first, so the newcomer has nothing left to steal.
 */

/** Below this score a fuzzy match is treated as a different table. */
export const SIMILARITY_THRESHOLD = 0.6;

/** Header text carries the weight; column count only breaks near-ties. */
const HEADER_WEIGHT = 0.75;
const COLUMN_WEIGHT = 0.25;

const FIELD_SEPARATOR = "\u001f";

export interface RenderedTableInfo {
  /** Position of the table within the note, in document order. */
  index: number;
  /** Raw text of each header cell. Its length is the column count. */
  headers: string[];
  /** Raw text of every body cell, flattened. Used only as a tie-breaker. */
  bodyTexts: string[];
}

export type MatchStrategy = "signature+body" | "signature" | "similarity" | "position";

export interface TableMatch {
  renderedIndex: number;
  key: string;
  strategy: MatchStrategy;
}

export interface MatchResult {
  matches: TableMatch[];
  /** Rendered tables that could not claim any stored record. */
  unmatchedRendered: number[];
}

export interface ParsedSignature {
  columnCount: number;
  headers: string[];
}

/** Rendered text is used rather than Markdown source, so syntax such as
 *  `**bold**` or escapes never reaches the signature. */
export function normalizeCellText(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildSignature(headers: string[]): string {
  return JSON.stringify({ c: headers.length, h: headers.map(normalizeCellText) });
}

export function parseSignature(signature: string): ParsedSignature | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signature);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { c?: unknown; h?: unknown };
  if (typeof candidate.c !== "number" || !Array.isArray(candidate.h)) return null;
  return { columnCount: candidate.c, headers: candidate.h.map((value) => String(value)) };
}

/** FNV-1a, so identical bodies hash identically without a dependency. */
export function buildBodyHash(bodyTexts: string[]): string {
  const joined = bodyTexts.map(normalizeCellText).join(FIELD_SEPARATOR);
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function bigrams(value: string): Set<string> {
  const grams = new Set<string>();
  if (value.length < 2) {
    if (value) grams.add(value);
    return grams;
  }
  for (let i = 0; i < value.length - 1; i++) grams.add(value.slice(i, i + 2));
  return grams;
}

function diceCoefficient(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** How alike two header cells are. Contains and shares n-grams with a
 *  character-level Dice coefficient, which tolerates CJK text where word
 *  segmentation is unavailable. */
export function cellSimilarity(left: string, right: string): number {
  const a = normalizeCellText(left);
  const b = normalizeCellText(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const containment =
    a.includes(b) || b.includes(a)
      ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
      : 0;
  return Math.max(containment, diceCoefficient(a, b));
}

export function similarityScore(headers: string[], saved: ParsedSignature): number {
  const count = Math.max(headers.length, saved.headers.length);
  if (count === 0) return 0;
  let headerTotal = 0;
  for (let i = 0; i < count; i++) {
    headerTotal += cellSimilarity(headers[i] ?? "", saved.headers[i] ?? "");
  }
  const headerScore = headerTotal / count;
  const columnDelta = Math.abs(headers.length - saved.columnCount);
  const columnScore = columnDelta === 0 ? 1 : columnDelta === 1 ? 0.5 : 0;
  return HEADER_WEIGHT * headerScore + COLUMN_WEIGHT * columnScore;
}

export function matchRenderedTables(
  rendered: RenderedTableInfo[],
  saved: SavedTableInfo[]
): MatchResult {
  const matches: TableMatch[] = [];
  const takenRendered = new Set<number>();
  const takenSaved = new Set<string>();

  const assign = (table: RenderedTableInfo, entry: SavedTableInfo, strategy: MatchStrategy): void => {
    takenRendered.add(table.index);
    takenSaved.add(entry.key);
    matches.push({ renderedIndex: table.index, key: entry.key, strategy });
  };

  // Round 1a: same signature and same body.
  for (const table of rendered) {
    if (takenRendered.has(table.index)) continue;
    const signature = buildSignature(table.headers);
    const bodyHash = buildBodyHash(table.bodyTexts);
    const entry = saved.find(
      (candidate) =>
        !takenSaved.has(candidate.key) &&
        candidate.signature === signature &&
        !!candidate.bodyHash &&
        candidate.bodyHash === bodyHash
    );
    if (entry) assign(table, entry, "signature+body");
  }

  // Round 1b: same signature, duplicates paired in order.
  for (const table of rendered) {
    if (takenRendered.has(table.index)) continue;
    const signature = buildSignature(table.headers);
    const entry = saved.find(
      (candidate) => !takenSaved.has(candidate.key) && candidate.signature === signature
    );
    if (entry) assign(table, entry, "signature");
  }

  // Round 2: fuzzy. Highest scoring pair wins, so a strong match is never
  // consumed by a weaker one considered earlier.
  const candidates: Array<{ table: RenderedTableInfo; entry: SavedTableInfo; score: number }> = [];
  for (const table of rendered) {
    if (takenRendered.has(table.index)) continue;
    for (const entry of saved) {
      if (takenSaved.has(entry.key) || !entry.signature) continue;
      const parsed = parseSignature(entry.signature);
      if (!parsed) continue;
      const score = similarityScore(table.headers, parsed);
      if (score >= SIMILARITY_THRESHOLD) candidates.push({ table, entry, score });
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score || a.table.index - b.table.index || a.entry.order - b.entry.order
  );
  for (const candidate of candidates) {
    if (takenRendered.has(candidate.table.index) || takenSaved.has(candidate.entry.key)) continue;
    assign(candidate.table, candidate.entry, "similarity");
  }

  // Round 3: positional fallback. Only records that carry no signature take
  // part — those come from older plugin versions, so position is the only
  // signal available and pairing them this way is what makes the upgrade
  // lossless. A record that already knows what its table looks like is never
  // handed to a table that failed every content round, because that would
  // silently apply one table's dimensions to an unrelated one.
  const remainingTables = rendered
    .filter((table) => !takenRendered.has(table.index))
    .sort((a, b) => a.index - b.index);
  const remainingEntries = saved
    .filter((entry) => !takenSaved.has(entry.key) && !entry.signature)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const pairs = Math.min(remainingTables.length, remainingEntries.length);
  for (let i = 0; i < pairs; i++) assign(remainingTables[i], remainingEntries[i], "position");

  return {
    matches,
    unmatchedRendered: rendered
      .filter((table) => !takenRendered.has(table.index))
      .map((table) => table.index)
  };
}

/**
 * A positional match proves nothing about identity, so learning a signature
 * from one could cement a wrong association. It is only trusted when the note
 * still has exactly as many tables as it has records — then positions line up
 * unambiguously and this is how records from older plugin versions are
 * upgraded in place.
 */
export function canLearnIdentity(
  match: TableMatch,
  renderedCount: number,
  savedCount: number
): boolean {
  if (match.strategy !== "position") return true;
  return renderedCount === savedCount;
}
