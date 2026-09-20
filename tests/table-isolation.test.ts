import { test } from "node:test";
import assert from "node:assert/strict";

import { TableResizer } from "../src/table-resizer";
import { DEFAULT_SETTINGS } from "../src/types";
import {
  appliedWidths,
  fakeBody,
  flushFrames,
  installFakeDom,
  makeApp,
  makeTable,
  makeView,
  type FakeTable
} from "./helpers/fake-dom";
import { TestTableStore } from "./helpers/test-store";

installFakeDom();

const PATH = "note.md";
const NOTE_HEADERS = ["姓名", "年龄"];
const NOTE_BODY = [["张三", "30"]];

class CountingStore extends TestTableStore {
  reads = 0;

  override getEntries(path: string) {
    this.reads++;
    return super.getEntries(path);
  }
}

function handlesFor(table: FakeTable) {
  const record = table.dataset.tableDragRecord;
  if (record === undefined) return [];
  return fakeBody.children.filter(
    (element) =>
      element.classList.contains("table-drag-handle") &&
      element.dataset.tableDragRecord === record
  );
}

/**
 * Reproduces what happens with Editing Toolbar enabled: it mounts its bar
 * inside the view, as a sibling of the note content, and that bar contains real
 * `<table>` elements for its colour pickers.
 */
function makeToolbarView(noteTables: FakeTable[]) {
  const view = makeView(PATH, noteTables);
  const toolbar = view.addForeignHost(["markdown-source-view", "editingToolbarModalBar"]);
  const picker = makeTable(["", "", ""], [["", "", ""], ["", "", ""]]);
  picker.classList.add("x-color-picker-table");
  toolbar.appendChild(picker);
  return { view, toolbar, picker };
}

test("tables another plugin mounts inside the view are left alone", () => {
  const noteTables: FakeTable[] = [];
  const { view, picker } = makeToolbarView(noteTables);

  const store = new CountingStore();
  store.seedLegacy(`${PATH}::0`, [111, 222]);

  const resizer = new TableResizer(makeApp(view), { ...DEFAULT_SETTINGS }, store);
  resizer.load();

  const noteTable = makeTable(NOTE_HEADERS, NOTE_BODY);
  noteTables.splice(0, noteTables.length, noteTable);
  resizer.refresh();
  flushFrames();

  // The note's own table is still recognised and sized.
  assert.deepEqual(appliedWidths(noteTable), [111, 222], "the note table must still be resized");
  assert.equal(
    handlesFor(noteTable).length,
    NOTE_HEADERS.length + (1 + NOTE_BODY.length),
    "the note table gets one handle per column and per row"
  );

  // The colour picker is not touched at all.
  assert.equal(appliedWidths(picker), null, "the picker must not get a colgroup");
  assert.equal(picker.style.tableLayout, undefined, "the picker's layout must be left alone");
  assert.equal(picker.dataset.tableDragRecord, undefined, "the picker must not be registered");
  assert.equal(handlesFor(picker).length, 0, "the picker must not get drag handles");

  resizer.unload();
});

test("a table outside the note content is not counted as a note table", () => {
  const noteTables: FakeTable[] = [];
  const { view, picker } = makeToolbarView(noteTables);

  const store = new CountingStore();
  store.seedLegacy(`${PATH}::0`, [111, 222]);
  store.seedLegacy(`${PATH}::1`, [333, 444]);

  const resizer = new TableResizer(makeApp(view), { ...DEFAULT_SETTINGS }, store);
  resizer.load();

  // Only one note table exists, and the picker must not consume the second
  // record just because it happens to be in the DOM.
  const noteTable = makeTable(NOTE_HEADERS, NOTE_BODY);
  noteTables.splice(0, noteTables.length, noteTable);
  resizer.refresh();
  flushFrames();

  assert.deepEqual(appliedWidths(noteTable), [111, 222]);
  assert.equal(appliedWidths(picker), null);
  assert.equal(
    store.tables[`${PATH}::1`]?.signature,
    undefined,
    "the picker must not have claimed the second record"
  );
  assert.deepEqual(store.tables[`${PATH}::1`]?.columns, [333, 444]);

  resizer.unload();
});

test("UI changes outside the note content do not trigger a re-scan", () => {
  const noteTables: FakeTable[] = [];
  const { view, toolbar } = makeToolbarView(noteTables);

  const store = new CountingStore();
  const resizer = new TableResizer(makeApp(view), { ...DEFAULT_SETTINGS }, store);
  resizer.load();

  noteTables.splice(0, noteTables.length, makeTable(NOTE_HEADERS, NOTE_BODY));
  resizer.refresh();
  flushFrames();

  const readsAfterRender = store.reads;
  assert.ok(readsAfterRender > 0, "the render must have consulted the store");

  const hasRelevant = (
    resizer as unknown as { hasRelevantMutation(mutations: unknown[]): boolean }
  ).hasRelevantMutation.bind(resizer);
  const mutationIn = (target: unknown) => [
    {
      type: "childList",
      target,
      addedNodes: [document.createElement("div")],
      removedNodes: []
    }
  ];

  // A toolbar that repositions itself on every mouse move is not a note change.
  assert.equal(hasRelevant(mutationIn(toolbar)), false, "toolbar updates are not note changes");
  // A change to the note's rendered content is.
  assert.equal(hasRelevant(mutationIn(view.noteContent)), true, "note changes must be seen");
  assert.equal(store.reads, readsAfterRender, "no re-scan was triggered by the assertions");

  resizer.unload();
});
