/**
 * Minimal DOM plus Obsidian surface, enough to drive the real TableResizer in
 * Node. Only the members the resizer actually touches are implemented, so the
 * tests exercise production code paths rather than a reimplementation.
 */
import type { App } from "obsidian";

export interface Rect {
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** A rect placed in document coordinates, so viewport culling can be tested. */
function rectAt(left: number, top: number, width: number, height: number): Rect {
  return { width, height, top, left, right: left + width, bottom: top + height };
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

  /** Supports the selectors used by production code, e.g. ".a, .b" or "table". */
  closest(selector: string): FakeElement | null {
    const parts = parseSelector(selector);
    let node: FakeElement | null = this;
    while (node) {
      if (parts.some((part) => matchesSelector(node as FakeElement, part))) return node;
      node = node.parentNode;
    }
    return null;
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

interface ParsedSelector {
  classes: string[];
  tag: string | null;
}

function parseSelector(selector: string): ParsedSelector[] {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.startsWith(".")
        ? { classes: [part.slice(1)], tag: null }
        : { classes: [], tag: part.toLowerCase() }
    );
}

function matchesSelector(element: FakeElement, part: ParsedSelector): boolean {
  if (part.tag && (element as unknown as { tagName?: string }).tagName !== part.tag) return false;
  return part.classes.every((name) => element.classList.contains(name));
}

/** A plain container, used to model Obsidian's nesting inside a view. */
export class FakeContainer extends FakeElement {
  children: FakeElement[] = [];

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): FakeElement {
    const index = reference ? this.children.indexOf(reference) : 0;
    this.children.splice(index < 0 ? 0 : index, 0, node);
    node.parentNode = this;
    return node;
  }

  /** Depth-first search, enough for the selectors the tests use. */
  querySelectorAll(selector: string): FakeElement[] {
    const parts = parseSelector(selector);
    const found: FakeElement[] = [];
    const walk = (parent: FakeElement): void => {
      const children = (parent as unknown as { children?: FakeElement[] }).children;
      if (!Array.isArray(children)) return;
      for (const child of children) {
        // Keep parentNode honest even for children injected directly into the
        // array, so `closest()` behaves like it does in a browser.
        if (!child.parentNode) child.parentNode = parent;
        if (parts.some((part) => matchesSelector(child, part))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
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
    private readonly cellHeight: number,
    private readonly cellLeft: number,
    private readonly cellTop: number
  ) {
    super();
  }

  getBoundingClientRect(): Rect {
    return rectAt(this.cellLeft, this.cellTop, this.cellWidth, this.cellHeight);
  }
}

class FakeRow extends FakeElement {
  constructor(
    public cells: FakeCell[],
    private readonly rowHeight: number,
    private readonly rowTop: number
  ) {
    super();
  }

  getBoundingClientRect(): Rect {
    const width = this.cells.reduce((total, cell) => total + cell.getBoundingClientRect().width, 0);
    const left = this.cells[0]?.getBoundingClientRect().left ?? 0;
    return rectAt(left, this.rowTop, width, this.rowHeight);
  }
}

export class FakeTable extends FakeElement {
  readonly tagName = "table";
  children: FakeElement[] = [];

  constructor(
    public rows: FakeRow[],
    private readonly tableWidth = 300,
    private readonly tableHeight = 120,
    private readonly tableLeft = 0,
    private readonly tableTop = 0
  ) {
    super();
  }

  getBoundingClientRect(): Rect {
    return rectAt(this.tableLeft, this.tableTop, this.tableWidth, this.tableHeight);
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

export interface TableOptions {
  /** Document offset of the table, used to exercise viewport culling. */
  top?: number;
  left?: number;
  cellWidth?: number;
  rowHeight?: number;
}

/**
 * Build a table the way Obsidian renders one: a header row plus body rows.
 * Cells keep their own document coordinates so the resizer's viewport logic
 * sees a realistic layout instead of everything stacked at the origin.
 */
export function makeTable(
  headers: string[],
  body: string[][] = [],
  options: TableOptions = {}
): FakeTable {
  const cellWidth = options.cellWidth ?? 100;
  const rowHeight = options.rowHeight ?? 30;
  const left = options.left ?? 0;
  const top = options.top ?? 0;

  const buildRow = (texts: string[], rowIndex: number): FakeRow => {
    const rowTop = top + rowIndex * rowHeight;
    const cells = texts.map(
      (text, cellIndex) =>
        new FakeCell(text, cellWidth, rowHeight, left + cellIndex * cellWidth, rowTop)
    );
    return new FakeRow(cells, rowHeight, rowTop);
  };

  const rows = [buildRow(headers, 0), ...body.map((cells, i) => buildRow(cells, i + 1))];
  const width = cellWidth * Math.max(headers.length, 1);
  return new FakeTable(rows, width, rows.length * rowHeight, left, top);
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

const windowListeners = new Map<string, Set<(event: unknown) => void>>();

/** Viewport is a realistic size so culling behaves as it does in the app. */
export const fakeWindow = {
  innerHeight: 900,
  innerWidth: 1200,
  requestAnimationFrame(callback: () => void): number {
    frameQueue.push(callback);
    return frameQueue.length;
  },
  cancelAnimationFrame(id: number): void {
    if (id > 0) frameQueue[id - 1] = null;
  },
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = windowListeners.get(type) ?? new Set();
    set.add(listener);
    windowListeners.set(type, set);
  },
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    windowListeners.get(type)?.delete(listener);
  }
};

/** Fire a window event (e.g. `scroll`) and report how many listeners ran. */
export function dispatchWindowEvent(type: string): number {
  const listeners = [...(windowListeners.get(type) ?? [])];
  for (const listener of listeners) listener({ type });
  return listeners.length;
}

export function installFakeDom(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.Element = FakeElement;
  globals.HTMLElement = FakeElement;
  globals.HTMLTableColElement = FakeColElement;
  globals.document = fakeDocument;
  globals.window = fakeWindow;
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

/** How many animation frames are currently queued but not yet run. */
export function pendingFrameCount(): number {
  return frameQueue.filter(Boolean).length;
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
  contentEl: FakeContainer;
  /** Where Obsidian renders the note; tables under it are note tables. */
  noteContent: FakeContainer;
  /** Mount another plugin's UI inside the view, the way Editing Toolbar does. */
  addForeignHost(classes: string[]): FakeContainer;
}

export function makeView(path: string, tables: FakeTable[]): FakeView {
  const noteContent = new FakeContainer();
  noteContent.classList.add("cm-content");

  const contentEl = new FakeContainer();
  contentEl.classList.add("view-content");

  // The note host shares the caller's array, which tests mutate in place to
  // simulate a re-render.
  noteContent.children = tables as unknown as FakeElement[];
  contentEl.appendChild(noteContent);

  return {
    file: { path },
    contentEl,
    noteContent,
    addForeignHost(classes: string[]): FakeContainer {
      const host = new FakeContainer();
      classes.forEach((name) => host.classList.add(name));
      contentEl.appendChild(host);
      return host;
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
