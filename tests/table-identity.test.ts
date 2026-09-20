import { test } from "node:test";
import assert from "node:assert/strict";

import { TableResizer } from "../src/table-resizer";
import { DEFAULT_SETTINGS } from "../src/types";
import {
  appliedWidths,
  dispatchPointer,
  fakeBody,
  FakeElement,
  flushFrames,
  installFakeDom,
  makeApp,
  makeTable,
  makeView,
  MemoryStore,
  type FakeTable
} from "./helpers/fake-dom";

installFakeDom();

const PATH = "note.md";

const HEADERS_A = ["姓名", "年龄"];
const HEADERS_B = ["项目", "状态", "负责人"];
const HEADERS_C = ["日期", "金额"];

const BODY_A = [["张三", "30"]];
const BODY_B = [["上线", "完成", "李四"]];
const BODY_C = [["2026-01-01", "100"]];

const WIDTHS_A = [111, 222];
const WIDTHS_B = [333, 444, 555];
const WIDTHS_C = [666, 777];

/** The view's table list is mutated in place, mirroring a re-render. */
const viewTables: FakeTable[] = [];

function createResizer(store: MemoryStore): TableResizer {
  const resizer = new TableResizer(
    makeApp(makeView(PATH, viewTables)),
    { ...DEFAULT_SETTINGS },
    store
  );
  resizer.load();
  return resizer;
}

/** Re-render the note with fresh table elements, as Obsidian would. */
function render(
  resizer: TableResizer,
  specs: Array<{ headers: string[]; body: string[][] }>
): FakeTable[] {
  const tables = specs.map((spec) => makeTable(spec.headers, spec.body));
  viewTables.splice(0, viewTables.length, ...tables);
  resizer.refresh();
  flushFrames();
  return tables;
}

/** Records from a version of the plugin that only stored positions. */
function legacyStore(): MemoryStore {
  const store = new MemoryStore();
  store.seedLegacy(`${PATH}::0`, WIDTHS_A);
  store.seedLegacy(`${PATH}::1`, WIDTHS_B);
  store.seedLegacy(`${PATH}::2`, WIDTHS_C);
  return store;
}

function handlesFor(table: FakeTable, mode: "column" | "row"): FakeElement[] {
  return fakeBody.children.filter(
    (element) =>
      element.classList.contains("table-drag-handle") &&
      element.dataset.tableDragMode === mode &&
      element.dataset.tableDragRecord === table.dataset.tableDragRecord
  );
}

// ---------------------------------------------------------------------------
// Upgrading from positional records
// ---------------------------------------------------------------------------

test("legacy records are applied in place and taught their signatures", () => {
  const store = legacyStore();
  const resizer = createResizer(store);

  const [a, b, c] = render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A);
  assert.deepEqual(appliedWidths(b), WIDTHS_B);
  assert.deepEqual(appliedWidths(c), WIDTHS_C);

  for (const key of [`${PATH}::0`, `${PATH}::1`, `${PATH}::2`]) {
    assert.ok(store.tables.get(key)?.signature, `${key} should have learned a signature`);
  }
  // One coalesced write for the whole render, not one per table.
  assert.equal(store.flushCount, 1);
});

test("a plain reopen after the upgrade changes nothing", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);
  const writesAfterUpgrade = store.flushCount;

  const [a, b, c] = render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A);
  assert.deepEqual(appliedWidths(b), WIDTHS_B);
  assert.deepEqual(appliedWidths(c), WIDTHS_C);
  assert.equal(store.flushCount, writesAfterUpgrade, "no further writes once identities are known");
});

// ---------------------------------------------------------------------------
// The reported problem
// ---------------------------------------------------------------------------

test("inserting a table at the top leaves every other table untouched", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const [newcomer, a, b, c] = render(resizer, [
    { headers: ["备注"], body: [["随手记"]] },
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A, "first original table must keep its widths");
  assert.deepEqual(appliedWidths(b), WIDTHS_B, "second original table must keep its widths");
  assert.deepEqual(appliedWidths(c), WIDTHS_C, "third original table must keep its widths");
  assert.equal(appliedWidths(newcomer), null, "the new table inherits nothing");
  assert.equal(store.tables.size, 3, "no extra record was created for the new table");
});

test("inserting a table with the same shape as an existing one is still safe", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  // Same two headers as the first table, different content.
  const [newcomer, a, , c] = render(resizer, [
    { headers: HEADERS_A, body: [["王五", "52"]] },
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A);
  assert.deepEqual(appliedWidths(c), WIDTHS_C);
  assert.equal(appliedWidths(newcomer), null);
});

test("deleting a middle table leaves the others intact", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const [a, c] = render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A);
  assert.deepEqual(appliedWidths(c), WIDTHS_C);
});

test("reordering tables carries the sizes with the content", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const [c, b, a] = render(resizer, [
    { headers: HEADERS_C, body: BODY_C },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_A, body: BODY_A }
  ]);

  assert.deepEqual(appliedWidths(c), WIDTHS_C);
  assert.deepEqual(appliedWidths(b), WIDTHS_B);
  assert.deepEqual(appliedWidths(a), WIDTHS_A);
});

test("editing a header keeps that table's sizes", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const [a, b, c] = render(resizer, [
    { headers: ["用户姓名", "年龄"], body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A, "a renamed header must not lose its widths");
  assert.deepEqual(appliedWidths(b), WIDTHS_B);
  assert.deepEqual(appliedWidths(c), WIDTHS_C);
});

test("a wholesale rewrite does not inherit another table's sizes", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const [a, b, replaced] = render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: ["名称", "备注"], body: [["甲", "乙"]] }
  ]);

  assert.deepEqual(appliedWidths(a), WIDTHS_A);
  assert.deepEqual(appliedWidths(b), WIDTHS_B);
  assert.equal(appliedWidths(replaced), null, "unrelated content must not be handed WIDTHS_C");
});

// ---------------------------------------------------------------------------
// Boundaries of the upgrade
// ---------------------------------------------------------------------------

test("documented limit: inserting before the upgrade resolves is ambiguous", () => {
  const store = new MemoryStore();
  store.seedLegacy(`${PATH}::0`, WIDTHS_A);

  const resizer = createResizer(store);
  // A positional record has no content to compare, so the newcomer takes it.
  const [newcomer, old] = render(resizer, [
    { headers: ["备注"], body: [["随手记"]] },
    { headers: HEADERS_A, body: BODY_A }
  ]);

  // The newcomer has a single column, so it picks up only the first width.
  assert.deepEqual(appliedWidths(newcomer), [111]);
  assert.equal(appliedWidths(old), null);
  assert.equal(
    store.tables.get(`${PATH}::0`)?.signature,
    undefined,
    "a positional guess must not be recorded as identity"
  );
});

test("records for other notes are never matched", () => {
  const store = new MemoryStore();
  store.seedLegacy("other.md::0", WIDTHS_A);

  const resizer = createResizer(store);
  const [a] = render(resizer, [{ headers: HEADERS_A, body: BODY_A }]);

  assert.equal(appliedWidths(a), null, "another note's record must not leak in");
});

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

test("dragging a new table stores a fresh record with its identity", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const [newcomer] = render(resizer, [
    { headers: ["备注"], body: [["随手记"]] },
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  const handle = handlesFor(newcomer, "column")[0];
  assert.ok(handle, "the new table must expose a column handle");

  dispatchPointer("pointerdown", { target: handle, clientX: 0, clientY: 0 });
  dispatchPointer("pointermove", { clientX: 40, clientY: 0 });
  dispatchPointer("pointerup", {});

  assert.deepEqual(appliedWidths(newcomer), [140], "100px measured + 40px dragged");

  const created = [...store.tables.entries()].filter(([key]) => key.startsWith(`${PATH}::`));
  assert.equal(created.length, 4, "a record was created for the new table");
  const added = created.find(([key]) => !["0", "1", "2"].includes(key.split("::")[1]));
  assert.ok(added, "the new record uses a fresh key");
  assert.ok(added[1].signature, "the new record stores its identity");
  assert.deepEqual(added[1].dimensions.columns, [140]);
});

test("resetting the note clears its records and its sizes", () => {
  const store = legacyStore();
  const resizer = createResizer(store);
  render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  resizer.resetCurrentNote();
  flushFrames();

  const [a, b, c] = render(resizer, [
    { headers: HEADERS_A, body: BODY_A },
    { headers: HEADERS_B, body: BODY_B },
    { headers: HEADERS_C, body: BODY_C }
  ]);

  assert.equal(store.tables.size, 0);
  assert.equal(appliedWidths(a), null);
  assert.equal(appliedWidths(b), null);
  assert.equal(appliedWidths(c), null);
});
