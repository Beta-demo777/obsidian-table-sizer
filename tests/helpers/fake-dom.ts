/**
 * Minimal DOM plus Obsidian surface, enough to drive the real TableResizer in
 * Node. Only the members the resizer actually touches are implemented, so the
 * tests exercise production code paths rather than a reimplementation.
 */
import type { App } from "obsidian";

import type { SavedTableInfo, TableDimensions, TableIdentity, TableStore } from "../../src/types";

export interface Rect {
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

function rect(width: number, height: number): Rect {
  return { width, height, top: 0, left: 0, right: width, bottom: height };
}

function createStyle(): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  style.removeProperty = (name: string) => {
    delete style[name];
    delete style[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
  };
  style.setProperty = (name: string, value: string) => {
    style[name] = value;
  };
  return style;
}

class FakeClassList {
  private readonly classes = new Set<string>();

  constructor(initial: string[] = []) {
    initial.forEach((name) => this.classes.add(name));
  }

  add(...names: string[]): void {
    names.forEach((name) => this.classes.add(name));
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.classes.delete(name));
  }

  contains(name: string): boolean {
    return this.classes.has(name);
  }

  get value(): string {
    return [...this.classes].join(" ");
  }
}

export class FakeElement {
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  style = createStyle();
  attributes: Record<string, string> = {};
  parentNode: FakeElement | null = null;

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  remove(): void {
    const parent = this.parentNode as unknown as { children?: FakeElement[] } | null;
    if (parent && Array.isArray(parent.children)) {
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
    }
    this.parentNode = null;
  }
}

export class FakeColElement extends FakeElement {
  children: FakeElement[] = [];

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  get lastChild(): FakeElement | null {
    return this.children[this.children.length - 1] ?? null;
  }
}

class FakeCell extends FakeElement {
  constructor(
    public textContent: string,
    private readonly cellWidth: number,
    private readonly cellHeight: number
  ) {
    super();
  }

  getBoundingClientRect(): Rect {
    return rect(this.cellWidth, this.cellHeight);
  }
}

class FakeRow extends FakeElement {
  constructor(
    public cells: FakeCell[],
    private readonly rowHeight: number
  ) {
    super();
  }

  getBoundingClientRect(): Rect {
    return rect(
      this.cells.reduce((total, cell) => total + cell.getBoundingClientRect().width, 0),
      this.rowHeight
    );
  }
}

export class FakeTable extends FakeElement {
  children: FakeElement[] = [];

  constructor(
    public rows: FakeRow[],
    private readonly tableWidth = 300,
    private readonly tableHeight = 120
  ) {
    super();
  }

  getBoundingClientRect(): Rect {
    return rect(this.tableWidth, this.tableHeight);
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): FakeElement {
    const index = reference ? this.children.indexOf(reference) : 0;
    this.children.splice(index < 0 ? 0 : index, 0, node);
    node.parentNode = this;
    return node;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

/** Build a table the way Obsidian renders one: a header row plus body rows. */
export function makeTable(headers: string[], body: string[][] = [], width = 300): FakeTable {
  const headerRow = new FakeRow(
    headers.map((header) => new FakeCell(header, 100, 30)),
    30
  );
  const bodyRows = body.map(
    (cells) => new FakeRow(cells.map((cell) => new FakeCell(cell, 100, 30)), 30)
  );
  return new FakeTable([headerRow, ...bodyRows], width, (1 + body.length) * 30);
}

/** The column widths the resizer applied, or null when it applied none. */
export function appliedWidths(table: FakeTable): number[] | null {
  const colgroup = table.children[0] as FakeColElement | undefined;
  if (!colgroup || !Array.isArray(colgroup.children)) return null;
  return colgroup.children.map((col) => Number.parseFloat(String(col.style.width)));
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

let frameQueue: Array<(() => void) | null> = [];
const documentListeners = new Map<string, Set<(event: unknown) => void>>();

export class FakeBody extends FakeElement {
  children: FakeElement[] = [];

  createDiv(options?: { cls?: string[] }): FakeElement {
    const element = new FakeElement();
    options?.cls?.forEach((name) => element.classList.add(name));
    element.parentNode = this;
    this.children.push(element);
    return element;
  }
}

export const fakeBody = new FakeBody();

export const fakeDocument = {
  body: fakeBody,
  createElement(tag: string): FakeElement {
    return tag === "colgroup" || tag === "col" ? new FakeColElement() : new FakeElement();
  },
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = documentListeners.get(type) ?? new Set();
    set.add(listener);
    documentListeners.set(type, set);
  },
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    documentListeners.get(type)?.delete(listener);
  }
};

export function installFakeDom(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.HTMLElement = FakeElement;
  globals.HTMLTableColElement = FakeColElement;
  globals.document = fakeDocument;
  globals.window = {
    requestAnimationFrame(callback: () => void): number {
      frameQueue.push(callback);
      return frameQueue.length;
    },
    cancelAnimationFrame(id: number): void {
      if (id > 0) frameQueue[id - 1] = null;
    },
    addEventListener(): void {},
    removeEventListener(): void {}
  };
  globals.MutationObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
}

/** Run the callbacks refresh() scheduled, to settle one animation frame. */
export function flushFrames(): void {
  const queue = frameQueue;
  frameQueue = [];
  for (const callback of queue) callback?.();
}

/** Send a pointer event to the listeners the resizer registered. */
export function dispatchPointer(
  type: string,
  event: { target?: unknown; clientX?: number; clientY?: number }
): void {
  const full = {
    clientX: 0,
    clientY: 0,
    preventDefault(): void {},
    stopPropagation(): void {},
    ...event
  };
  for (const listener of documentListeners.get(type) ?? []) listener(full);
}

// ---------------------------------------------------------------------------
// Obsidian surface
// ---------------------------------------------------------------------------

export interface FakeView {
  file: { path: string };
  contentEl: { querySelectorAll(selector: string): FakeTable[] };
}

export function makeView(path: string, tables: FakeTable[]): FakeView {
  return {
    file: { path },
    contentEl: {
      querySelectorAll: (selector: string) => (selector === "table" ? tables : [])
    }
  };
}

export function makeApp(view: FakeView | null): App {
  return {
    workspace: {
      onLayoutReady(): void {},
      on(): unknown {
        return {};
      },
      offref(): void {},
      getActiveViewOfType: () => view
    }
  } as unknown as App;
}

interface MemoryRecord {
  dimensions: TableDimensions;
  signature?: string;
  bodyHash?: string;
  order?: number;
}

/** In-memory stand-in for the plugin's data store. */
export class MemoryStore implements TableStore {
  readonly tables = new Map<string, MemoryRecord>();
  flushCount = 0;
  private dirty = false;

  /** Seed a record the way a previous plugin version would have written it. */
  seedLegacy(key: string, dimensions: number[]): void {
    this.tables.set(key, { dimensions: { columns: dimensions, rows: [30] } });
  }

  seed(key: string, columns: number[], identity: Omit<TableIdentity, "order">): void {
    this.tables.set(key, { dimensions: { columns, rows: [30] }, ...identity });
  }

  getEntries(path: string): SavedTableInfo[] {
    const prefix = `${path}::`;
    const entries: SavedTableInfo[] = [];
    for (const [key, record] of this.tables) {
      if (!key.startsWith(prefix)) continue;
      entries.push({
        key,
        signature: record.signature,
        bodyHash: record.bodyHash,
        order: record.order ?? Number.MAX_SAFE_INTEGER
      });
    }
    return entries;
  }

  getDimensions(key: string): TableDimensions | undefined {
    return this.tables.get(key)?.dimensions;
  }

  applyIdentity(key: string, meta: TableIdentity): void {
    const record = this.tables.get(key);
    if (!record) return;
    if (
      record.signature === meta.signature &&
      record.bodyHash === meta.bodyHash &&
      record.order === meta.order
    ) {
      return;
    }
    record.signature = meta.signature;
    record.bodyHash = meta.bodyHash;
    record.order = meta.order;
    this.dirty = true;
  }

  saveDimensions(
    key: string | null,
    path: string,
    dimensions: TableDimensions,
    meta: TableIdentity
  ): string {
    const target = key && this.tables.has(key) ? key : this.allocateKey(path);
    this.tables.set(target, {
      dimensions: { columns: [...dimensions.columns], rows: [...dimensions.rows] },
      ...meta
    });
    this.dirty = false;
    return target;
  }

  removeEntries(path: string): void {
    for (const key of [...this.tables.keys()]) {
      if (key.startsWith(`${path}::`)) this.tables.delete(key);
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.flushCount++;
  }

  private allocateKey(path: string): string {
    let slot = 0;
    while (this.tables.has(`${path}::${slot}`)) slot++;
    return `${path}::${slot}`;
  }
}
