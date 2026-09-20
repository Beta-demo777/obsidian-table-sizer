import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { TableResizer } from "../src/table-resizer";
import { TestTableStore } from "./helpers/test-store";
import { DEFAULT_SETTINGS } from "../src/types";
import {
  dispatchWindowEvent,
  fakeBody,
  fakeWindow,
  flushFrames,
  installFakeDom,
  makeApp,
  makeTable,
  makeView,
  pendingFrameCount,
  type FakeElement,
  type FakeTable
} from "./helpers/fake-dom";

installFakeDom();

const PATH = "note.md";
const VIEWPORT_HEIGHT = 900;
const VIEWPORT_MARGIN = 200;

/** Shaped like the real 36-table note that froze the window. */
const NOTE_TABLES = 36;
const BODY_ROWS = 12;
const TABLE_SPACING = 500;

/** Resizers register window listeners, so each test must release its own. */
const activeResizers: TableResizer[] = [];

afterEach(() => {
  for (const resizer of activeResizers.splice(0)) resizer.unload();
  fakeBody.children.length = 0;
  flushFrames();
  fakeWindow.innerHeight = VIEWPORT_HEIGHT;
});

interface Note {
  resizer: TableResizer;
  tables: FakeTable[];
  handleStyleWrites: () => number;
  forcedLayouts: () => number;
  resetMetrics: () => void;
  readsFor: (table: FakeTable) => { table: number; inner: number };
  tableReads: () => number;
}

function buildNote(): Note {
  const viewTables: FakeTable[] = [];
  const resizer = new TableResizer(
    makeApp(makeView(PATH, viewTables)),
    { ...DEFAULT_SETTINGS },
    new TestTableStore()
  );

  let forced = 0;
  let layoutDirty = false;
  let tableReads = 0;
  const reads = new Map<FakeTable, { table: number; inner: number }>();

  const wrapRect = (holder: { getBoundingClientRect: () => unknown }, onRead: () => void): void => {
    const original = holder.getBoundingClientRect.bind(holder);
    holder.getBoundingClientRect = () => {
      // A read while layout is dirty is exactly what forces a synchronous
      // reflow in a browser.
      if (layoutDirty) {
        forced++;
        layoutDirty = false;
      }
      onRead();
      return original();
    };
  };

  const tables: FakeTable[] = [];
  for (let index = 0; index < NOTE_TABLES; index++) {
    const headers = ["A", "B", "C", "D"].slice(0, 3 + (index % 2));
    const body = Array.from({ length: BODY_ROWS }, (_, row) =>
      headers.map((_, column) => `r${row}c${column}`)
    );
    const table = makeTable(headers, body, { top: index * TABLE_SPACING });
    const counts = { table: 0, inner: 0 };
    reads.set(table, counts);
    wrapRect(table, () => {
      counts.table++;
      tableReads++;
    });
    for (const row of table.rows) {
      wrapRect(row, () => counts.inner++);
      for (const cell of row.cells) wrapRect(cell, () => counts.inner++);
    }
    tables.push(table);
  }

  viewTables.splice(0, viewTables.length, ...tables);
  resizer.load();
  resizer.refresh();
  flushFrames();
  activeResizers.push(resizer);

  // Handles only exist once a render has run, so their styles are wrapped now,
  // and only for the handles this note created.
  let handleStyleWrites = 0;
  for (const element of fakeBody.children) {
    if (!element.classList.contains("table-drag-handle")) continue;
    const target = (element as FakeElement).style as Record<string, unknown>;
    (element as FakeElement).style = new Proxy(target, {
      set(object, property, value) {
        layoutDirty = true;
        handleStyleWrites++;
        (object as Record<string | symbol, unknown>)[property] = value;
        return true;
      }
    });
  }

  return {
    resizer,
    tables,
    handleStyleWrites: () => handleStyleWrites,
    forcedLayouts: () => forced,
    resetMetrics: () => {
      forced = 0;
      tableReads = 0;
      handleStyleWrites = 0;
      layoutDirty = false;
      // Per-table counters must be cleared too: the initial render legitimately
      // measures every table, and that is not what these tests are about.
      for (const counts of reads.values()) {
        counts.table = 0;
        counts.inner = 0;
      }
    },
    readsFor: (table) => reads.get(table) ?? { table: 0, inner: 0 },
    tableReads: () => tableReads
  };
}

function scrollAndSettle(): void {
  dispatchWindowEvent("scroll");
  flushFrames();
}

test("positioning measures layout before it writes, so it forces no reflow", () => {
  const note = buildNote();
  note.resetMetrics();

  scrollAndSettle();

  assert.ok(
    note.handleStyleWrites() > 0,
    "the pass must actually have written handle styles"
  );
  assert.equal(
    note.forcedLayouts(),
    0,
    "a read happened after a write: that is a forced synchronous reflow"
  );
});

test("off-screen tables are not measured at all while positioning", () => {
  const note = buildNote();
  note.resetMetrics();

  scrollAndSettle();

  const viewportBottom = VIEWPORT_HEIGHT + VIEWPORT_MARGIN;
  for (const table of note.tables) {
    const rect = table.getBoundingClientRect();
    const counts = note.readsFor(table);
    if (rect.top > viewportBottom) {
      assert.equal(
        counts.inner,
        0,
        `table at top=${rect.top} is off-screen yet its cells or rows were measured`
      );
    }
  }

  // The note holds 36 tables; only the few near the viewport may be measured.
  const measured = note.tables.filter((table) => note.readsFor(table).inner > 0);
  assert.ok(
    measured.length > 0 && measured.length < NOTE_TABLES,
    `expected only the visible tables to be measured, got ${measured.length}`
  );
});

test("many scroll events collapse into a single positioning pass", () => {
  const note = buildNote();
  note.resetMetrics();

  for (let i = 0; i < 25; i++) dispatchWindowEvent("scroll");
  assert.equal(pendingFrameCount(), 1, "scroll events must coalesce into one frame");

  flushFrames();

  // One pass reads each table's own rect once to decide whether it is in view.
  assert.equal(
    note.tableReads(),
    NOTE_TABLES,
    "more than one pass ran, or the pass skipped its viewport check"
  );
});

test("scroll and resize are both wired and released with the plugin", () => {
  const note = buildNote();
  assert.equal(dispatchWindowEvent("resize"), 1, "resize must have exactly one listener");
  assert.equal(dispatchWindowEvent("scroll"), 1, "scroll must have exactly one listener");
  flushFrames();

  note.resizer.unload();
  assert.equal(dispatchWindowEvent("scroll"), 0, "unload must release the scroll listener");
  assert.equal(dispatchWindowEvent("resize"), 0, "unload must release the resize listener");
});

test("handle count for this note shape stays what the design implies", () => {
  const before = fakeBody.children.length;
  const note = buildNote();

  const handles = fakeBody.children
    .slice(before)
    .filter((element) => element.classList.contains("table-drag-handle"));

  const expectedColumns = note.tables.reduce(
    (total, table) => total + (table.rows[0]?.cells.length ?? 0),
    0
  );
  const expectedRows = note.tables.reduce((total, table) => total + table.rows.length, 0);

  // One fixed-position element per column and per row, for every table in the
  // note — including the ones scrolled out of sight. That is the cost this
  // design carries; it is why the positioning pass must not thrash layout.
  assert.equal(handles.length, expectedColumns + expectedRows);
  assert.equal(expectedColumns, 126);
  assert.equal(expectedRows, 468);
});
