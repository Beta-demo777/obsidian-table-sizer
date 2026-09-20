import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SIMILARITY_THRESHOLD,
  buildBodyHash,
  buildSignature,
  canLearnIdentity,
  cellSimilarity,
  matchRenderedTables,
  normalizeCellText,
  parseSignature,
  similarityScore,
  type RenderedTableInfo
} from "../src/table-matching";
import type { SavedTableInfo } from "../src/types";

/** Build a rendered-table description the way the resizer does. */
function rendered(index: number, headers: string[], body: string[][] = []): RenderedTableInfo {
  return { index, headers, bodyTexts: body.flat() };
}

/** Build a stored record that already knows its own content. */
function saved(key: string, headers: string[], order: number, body: string[][] = []): SavedTableInfo {
  return {
    key,
    signature: buildSignature(headers),
    bodyHash: buildBodyHash(body.flat()),
    order
  };
}

function keysByIndex(result: ReturnType<typeof matchRenderedTables>): Map<number, string> {
  return new Map(result.matches.map((match) => [match.renderedIndex, match.key]));
}

function strategyFor(result: ReturnType<typeof matchRenderedTables>, index: number): string {
  return result.matches.find((match) => match.renderedIndex === index)?.strategy ?? "none";
}

/**
 * The previous implementation, reproduced for contrast: the key *is* the
 * document position, so any shift moves every saved size.
 */
function matchByDocumentIndex(
  tables: RenderedTableInfo[],
  entries: SavedTableInfo[],
  path = "note.md"
): Map<number, string> {
  const paired = new Map<number, string>();
  for (const table of tables) {
    const key = `${path}::${table.index}`;
    if (entries.some((entry) => entry.key === key)) paired.set(table.index, key);
  }
  return paired;
}

// ---------------------------------------------------------------------------
// The reported problem: inserting a table near the top of a note
// ---------------------------------------------------------------------------

const headersA = ["姓名", "年龄"];
const headersB = ["项目", "状态", "负责人"];
const headersC = ["日期", "金额"];

/** Three tables already resized, stored under the legacy positional keys. */
const storedABC = [
  saved("note.md::0", headersA, 0, [["张三", "30"]]),
  saved("note.md::1", headersB, 1, [["上线", "完成", "李四"]]),
  saved("note.md::2", headersC, 2, [["2026-01-01", "100"]])
];

test("inserting a table above others does not shift their saved sizes", () => {
  const newTable = rendered(0, ["备注"]);
  const after = [newTable, rendered(1, headersA), rendered(2, headersB), rendered(3, headersC)];

  const result = matchRenderedTables(after, storedABC);
  const paired = keysByIndex(result);

  assert.equal(paired.get(1), "note.md::0", "first original table must keep its record");
  assert.equal(paired.get(2), "note.md::1", "second original table must keep its record");
  assert.equal(paired.get(3), "note.md::2", "third original table must keep its record");
  assert.equal(paired.has(0), false, "the new table must not claim anyone's record");
  assert.deepEqual(result.unmatchedRendered, [0]);
});

test("contrast: the previous positional keying mis-assigns every table", () => {
  const after = [rendered(0, ["备注"]), rendered(1, headersA), rendered(2, headersB), rendered(3, headersC)];
  const legacy = matchByDocumentIndex(after, storedABC);

  assert.equal(legacy.get(0), "note.md::0", "the new table steals the first table's record");
  assert.equal(legacy.get(1), "note.md::1", "the first table now reads the second's dimensions");
  assert.equal(legacy.get(2), "note.md::2");
  assert.equal(legacy.has(3), false, "the last table loses its record entirely");
});

// ---------------------------------------------------------------------------
// Other layout changes
// ---------------------------------------------------------------------------

test("deleting a middle table leaves the others intact", () => {
  const after = [rendered(0, headersA), rendered(1, headersC)];
  const paired = keysByIndex(matchRenderedTables(after, storedABC));

  assert.equal(paired.get(0), "note.md::0");
  assert.equal(paired.get(1), "note.md::2");
});

test("reordering tables follows content, not position", () => {
  const after = [rendered(0, headersC), rendered(1, headersB), rendered(2, headersA)];
  const paired = keysByIndex(matchRenderedTables(after, storedABC));

  assert.equal(paired.get(0), "note.md::2", "C keeps its record at its new position");
  assert.equal(paired.get(1), "note.md::1");
  assert.equal(paired.get(2), "note.md::0");
});

test("editing one header still recognises the table", () => {
  const edited = rendered(0, ["用户姓名", "年龄"]);
  const result = matchRenderedTables([edited], [storedABC[0]]);

  assert.equal(keysByIndex(result).get(0), "note.md::0");
  assert.equal(strategyFor(result, 0), "similarity");
});

test("editing one header of a three column table matches by similarity", () => {
  const edited = rendered(0, ["项目", "状态", "负责人员"]);
  const result = matchRenderedTables([edited], [storedABC[1]]);

  assert.equal(strategyFor(result, 0), "similarity");
  assert.equal(keysByIndex(result).get(0), "note.md::1");
});

test("editing the body only keeps an exact signature match", () => {
  const edited = rendered(0, headersA, [["李四", "41"]]);
  const result = matchRenderedTables([edited], [storedABC[0]]);

  assert.equal(strategyFor(result, 0), "signature");
  assert.equal(keysByIndex(result).get(0), "note.md::0");
});

// ---------------------------------------------------------------------------
// Tables that share a header row
// ---------------------------------------------------------------------------

test("two tables with identical headers are told apart by their body", () => {
  const entries = [
    saved("note.md::0", headersA, 0, [["张三", "30"]]),
    saved("note.md::1", headersA, 1, [["李四", "41"]])
  ];

  // Swap them in the document: only the body can reveal the swap.
  const after = [rendered(0, headersA, [["李四", "41"]]), rendered(1, headersA, [["张三", "30"]])];
  const result = matchRenderedTables(after, entries);
  const paired = keysByIndex(result);

  assert.equal(paired.get(0), "note.md::1");
  assert.equal(paired.get(1), "note.md::0");
  assert.equal(strategyFor(result, 0), "signature+body");
});

test("inserting a same-header table above does not steal from the others", () => {
  const entries = [
    saved("note.md::0", headersA, 0, [["张三", "30"]]),
    saved("note.md::1", headersA, 1, [["李四", "41"]])
  ];

  const after = [
    rendered(0, headersA, [["王五", "52"]]),
    rendered(1, headersA, [["张三", "30"]]),
    rendered(2, headersA, [["李四", "41"]])
  ];
  const paired = keysByIndex(matchRenderedTables(after, entries));

  assert.equal(paired.has(0), false, "new table is unmatched");
  assert.equal(paired.get(1), "note.md::0");
  assert.equal(paired.get(2), "note.md::1");
});

test("documented limit: two fully identical tables cannot be told apart", () => {
  const body = [["张三", "30"]];
  const entries = [saved("note.md::0", headersA, 0, body), saved("note.md::1", headersA, 1, body)];

  // Same headers and same body, so inserting an identical third table above
  // still shifts the pairing. This is an information limit, not a bug.
  const after = [rendered(0, headersA, body), rendered(1, headersA, body), rendered(2, headersA, body)];
  const paired = keysByIndex(matchRenderedTables(after, entries));

  assert.equal(paired.has(0), true);
  assert.equal(paired.has(1), true);
  assert.equal(paired.has(2), false);
});

// ---------------------------------------------------------------------------
// Upgrading records written by earlier plugin versions
// ---------------------------------------------------------------------------

test("records without a signature fall back to position when counts match", () => {
  const legacy: SavedTableInfo[] = [
    { key: "note.md::0", order: 0 },
    { key: "note.md::1", order: 1 },
    { key: "note.md::2", order: 2 }
  ];
  const view = [rendered(0, headersA), rendered(1, headersB), rendered(2, headersC)];
  const result = matchRenderedTables(view, legacy);
  const paired = keysByIndex(result);

  assert.equal(paired.get(0), "note.md::0");
  assert.equal(paired.get(1), "note.md::1");
  assert.equal(paired.get(2), "note.md::2");
  for (const match of result.matches) {
    assert.equal(match.strategy, "position");
    assert.equal(canLearnIdentity(match, 3, 3), true, "safe to learn while the shape is unchanged");
  }
});

test("a positional match is not trusted once the table count differs", () => {
  const legacy: SavedTableInfo[] = [{ key: "note.md::0", order: 0 }];
  const view = [rendered(0, ["备注"]), rendered(1, headersA)];
  const result = matchRenderedTables(view, legacy);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].strategy, "position");
  assert.equal(
    canLearnIdentity(result.matches[0], 2, 1),
    false,
    "learning here would cement a guess"
  );
});

test("migration is lossless: a plain reopen keeps every record in place", () => {
  const legacy: SavedTableInfo[] = [
    { key: "note.md::0", order: 0 },
    { key: "note.md::1", order: 1 }
  ];
  const view = [rendered(0, headersA), rendered(1, headersB)];
  const paired = keysByIndex(matchRenderedTables(view, legacy));

  assert.equal(paired.get(0), "note.md::0");
  assert.equal(paired.get(1), "note.md::1");
});

// ---------------------------------------------------------------------------
// Scoring behaviour
// ---------------------------------------------------------------------------

test("an unrelated table does not inherit a record that knows its own content", () => {
  // Same column count as the stored table, nothing else in common.
  const unrelated = rendered(0, ["名称", "备注"]);
  const result = matchRenderedTables([unrelated], [storedABC[2]]);

  assert.equal(result.matches.length, 0);
  assert.deepEqual(result.unmatchedRendered, [0]);
  assert.ok(
    similarityScore(["名称", "备注"], parseSignature(storedABC[2].signature!)!) <
      SIMILARITY_THRESHOLD
  );
});

test("cost of the rule above: a wholesale header rewrite resets that table", () => {
  // The record knows it was ["日期", "金额"], so positional guessing is refused
  // and the table starts from its natural size. Re-dragging stores a new
  // signature. This is the deliberate trade for never applying the wrong
  // table's dimensions.
  const rewritten = rendered(0, ["名称", "备注"]);
  const result = matchRenderedTables([rewritten], [storedABC[2]]);

  assert.deepEqual(result.unmatchedRendered, [0]);
});

test("only records without a signature are matched by position", () => {
  const legacy: SavedTableInfo = { key: "note.md::0", order: 0 };
  const signed = saved("note.md::1", headersB, 1);
  const view = [rendered(0, headersA)];

  const result = matchRenderedTables(view, [legacy, signed]);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].key, "note.md::0", "the signature-less record is the one reused");
  assert.equal(result.matches[0].strategy, "position");
});

test("adding a column still matches the original record", () => {
  const widened = rendered(0, ["项目", "状态", "负责人", "截止日期"]);
  const result = matchRenderedTables([widened], [storedABC[1]]);

  assert.equal(keysByIndex(result).get(0), "note.md::1");
  assert.equal(strategyFor(result, 0), "similarity");
});

test("the highest scoring candidate wins regardless of record order", () => {
  // Neither candidate shares an exact signature, so this can only be decided by
  // the fuzzy round. The weaker candidate is listed first on purpose.
  const weaker = saved("note.md::weaker", ["项目", "负责人"], 0);
  const stronger = saved("note.md::stronger", ["项目状态说明", "负责人"], 1);
  const view = [rendered(0, ["项目状态", "负责人"])];

  const forward = matchRenderedTables(view, [weaker, stronger]);
  const backward = matchRenderedTables(view, [stronger, weaker]);

  assert.equal(keysByIndex(forward).get(0), "note.md::stronger");
  assert.equal(keysByIndex(backward).get(0), "note.md::stronger");
  assert.equal(strategyFor(forward, 0), "similarity");
});

test("similarity is symmetric and null-safe", () => {
  assert.equal(cellSimilarity("", ""), 1);
  assert.equal(cellSimilarity("a", ""), 0);
  assert.equal(cellSimilarity("姓名", "姓名"), 1);
  assert.equal(cellSimilarity("姓名", "用户姓名"), cellSimilarity("用户姓名", "姓名"));
  assert.ok(cellSimilarity("姓名", "用户姓名") > 0.4);
  assert.equal(cellSimilarity("abc", "xyz"), 0);
});

test("normalisation ignores case, whitespace and zero-width characters", () => {
  assert.equal(normalizeCellText("  Full   Name "), "full name");
  assert.equal(normalizeCellText("姓\u200b名"), "姓名");
  assert.equal(buildSignature(["Name"]), buildSignature(["  name  "]));
});

test("parseSignature rejects anything it did not write", () => {
  assert.equal(parseSignature("not json"), null);
  assert.equal(parseSignature('{"c":"3","h":[]}'), null);
  assert.equal(parseSignature('{"c":2}'), null);
  assert.equal(parseSignature("null"), null);
  assert.deepEqual(parseSignature(buildSignature(["a", "b"])), {
    columnCount: 2,
    headers: ["a", "b"]
  });
});

test("bodyHash is stable and content sensitive", () => {
  assert.equal(buildBodyHash(["a", "b"]), buildBodyHash(["a", "b"]));
  assert.notEqual(buildBodyHash(["a", "b"]), buildBodyHash(["a", "c"]));
  assert.equal(buildBodyHash([]), buildBodyHash([]));
});

test("empty inputs are handled without throwing", () => {
  assert.deepEqual(matchRenderedTables([], []), { matches: [], unmatchedRendered: [] });
  assert.deepEqual(matchRenderedTables([rendered(0, [])], []), {
    matches: [],
    unmatchedRendered: [0]
  });
  assert.equal(similarityScore([], { columnCount: 0, headers: [] }), 0);
});

test("every rendered table is paired at most once", () => {
  const view = [rendered(0, headersA), rendered(1, headersA), rendered(2, headersA)];
  const entries = [saved("note.md::0", headersA, 0)];
  const result = matchRenderedTables(view, entries);

  const renderedIndexes = result.matches.map((match) => match.renderedIndex);
  const keys = result.matches.map((match) => match.key);
  assert.equal(new Set(renderedIndexes).size, renderedIndexes.length);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(result.matches.length, 1);
});
