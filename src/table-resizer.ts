import { MarkdownView, type App } from "obsidian";
import type { TableDimensions, TableDragSettings } from "./types";

type ResizeMode = "column" | "row";

interface ResizeSession {
  mode: ResizeMode;
  table: HTMLTableElement;
  tableKey: string;
  index: number;
  startX: number;
  startY: number;
  startDimensions: TableDimensions;
}

interface TableRecord {
  table: HTMLTableElement;
  tableKey: string;
  dimensions: TableDimensions;
  columnHandles: HTMLElement[];
  rowHandles: HTMLElement[];
}

export class TableResizer {
  private readonly records = new Map<HTMLTableElement, TableRecord>();
  private readonly handles = new Set<HTMLElement>();
  private activeView: MarkdownView | null = null;
  private resizeSession: ResizeSession | null = null;
  private refreshFrame: number | null = null;
  private observer: MutationObserver | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: TableDragSettings,
    private readonly getDimensions: (key: string) => TableDimensions | undefined,
    private readonly setDimensions: (key: string, dimensions: TableDimensions) => void,
    private readonly removeDimensions: (key: string) => void
  ) {}

  load(): void {
    this.app.workspace.onLayoutReady(() => this.refresh());
    this.app.workspace.on("active-leaf-change", () => this.refresh());
    this.app.workspace.on("layout-change", () => this.refresh());

    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("pointermove", this.onPointerMove, true);
    document.addEventListener("pointerup", this.onPointerUp, true);
    document.addEventListener("pointercancel", this.onPointerUp, true);
    window.addEventListener("resize", this.onViewportChange, true);
    window.addEventListener("scroll", this.onViewportChange, true);
  }

  unload(): void {
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("pointermove", this.onPointerMove, true);
    document.removeEventListener("pointerup", this.onPointerUp, true);
    document.removeEventListener("pointercancel", this.onPointerUp, true);
    window.removeEventListener("resize", this.onViewportChange, true);
    window.removeEventListener("scroll", this.onViewportChange, true);
    if (this.refreshFrame !== null) window.cancelAnimationFrame(this.refreshFrame);
    this.observer?.disconnect();
    this.observer = null;
    this.clearRecords();
  }

  refresh(): void {
    if (this.refreshFrame !== null) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      this.refreshNow();
    });
  }

  resetCurrentNote(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path;
    if (!path) return;

    for (const [table, record] of this.records) {
      if (record.tableKey.startsWith(`${path}::`)) this.removeRecord(table, record);
    }
    this.removeDimensions(`${path}::`);
    this.refresh();
  }

  private refreshNow(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      this.activeView = null;
      this.clearRecords();
      this.observer?.disconnect();
      this.observer = null;
      return;
    }

    if (view !== this.activeView) {
      this.activeView = view;
      this.observer?.disconnect();
      this.observer = new MutationObserver((mutations) => {
        if (!this.resizeSession && this.hasRelevantMutation(mutations)) this.refresh();
      });
      this.observer.observe(view.contentEl, { childList: true, subtree: true });
    }

    this.clearRecords();
    const tables = (Array.from(view.contentEl.querySelectorAll("table")) as HTMLTableElement[])
      .filter((table) => {
        const rect = table.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    tables.forEach((table, index) => this.setupTable(table, view.file?.path ?? "", index));
    this.updateHandlePositions();
  }

  private hasRelevantMutation(mutations: MutationRecord[]): boolean {
    return mutations.some((mutation) => {
      if (mutation.type !== "childList") return false;
      if (mutation.target instanceof HTMLTableColElement) return false;

      const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
      return changedNodes.some((node) => !(node instanceof HTMLTableColElement));
    });
  }

  private setupTable(table: HTMLTableElement, path: string, index: number): void {
    const columnCount = table.rows[0]?.cells.length ?? 0;
    if (columnCount === 0 || table.rows.length === 0) return;

    // Keep this key independent from table text. Headers can be added or edited
    // while the rendered table is being rebuilt; dimensions should survive that.
    const tableKey = `${path}::${index}`;
    const dimensions = this.normalizeDimensions(table, this.getDimensions(tableKey));
    const record: TableRecord = {
      table,
      tableKey,
      dimensions,
      columnHandles: [],
      rowHandles: []
    };
    this.records.set(table, record);
    table.classList.add("table-drag-resizable");
    table.dataset.tableDragKey = tableKey;

    if (this.getDimensions(tableKey)) this.applyDimensions(record);

    if (this.settings.enableColumnResize) {
      for (let column = 0; column < columnCount; column++) {
        const handle = this.createHandle("column", column, tableKey);
        record.columnHandles.push(handle);
      }
    }
    if (this.settings.enableRowResize) {
      for (let row = 0; row < table.rows.length; row++) {
        const handle = this.createHandle("row", row, tableKey);
        record.rowHandles.push(handle);
      }
    }
  }

  private createHandle(mode: ResizeMode, index: number, tableKey: string): HTMLElement {
    const handle = document.body.createDiv({ cls: ["table-drag-handle", `table-drag-handle--${mode}`] });
    handle.dataset.tableDragMode = mode;
    handle.dataset.tableDragIndex = String(index);
    handle.dataset.tableDragKey = tableKey;
    handle.setAttribute("aria-label", mode === "column" ? "调整表格列宽" : "调整表格行高");
    this.handles.add(handle);
    return handle;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("table-drag-handle")) return;

    const mode = target.dataset.tableDragMode;
    const index = Number(target.dataset.tableDragIndex);
    const key = target.dataset.tableDragKey;
    if ((mode !== "column" && mode !== "row") || !Number.isInteger(index) || !key) return;

    const record = Array.from(this.records.values()).find((item) => item.tableKey === key);
    if (!record) return;

    event.preventDefault();
    event.stopPropagation();
    this.resizeSession = {
      mode,
      table: record.table,
      tableKey: key,
      index,
      startX: event.clientX,
      startY: event.clientY,
      startDimensions: {
        columns: [...record.dimensions.columns],
        rows: [...record.dimensions.rows]
      }
    };
    target.classList.add("is-dragging");
    document.body.classList.add("table-drag-is-resizing", `table-drag-${mode}`);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const session = this.resizeSession;
    if (!session) return;

    event.preventDefault();
    const record = this.records.get(session.table);
    if (!record) return;

    const next: TableDimensions = {
      columns: [...session.startDimensions.columns],
      rows: [...session.startDimensions.rows]
    };
    if (session.mode === "column") {
      next.columns[session.index] = Math.max(
        this.settings.minColumnWidth,
        session.startDimensions.columns[session.index] + event.clientX - session.startX
      );
    } else {
      next.rows[session.index] = Math.max(
        this.settings.minRowHeight,
        session.startDimensions.rows[session.index] + event.clientY - session.startY
      );
    }

    record.dimensions = next;
    this.applyDimensions(record);
    this.updateHandlePositions();
  };

  private onPointerUp = (): void => {
    const session = this.resizeSession;
    if (!session) return;

    const record = this.records.get(session.table);
    if (record) this.setDimensions(session.tableKey, record.dimensions);
    for (const handle of this.handles) handle.classList.remove("is-dragging");
    document.body.classList.remove("table-drag-is-resizing", "table-drag-column", "table-drag-row");
    this.resizeSession = null;
  };

  private onViewportChange = (): void => {
    this.updateHandlePositions();
  };

  private updateHandlePositions(): void {
    for (const record of this.records.values()) {
      const tableRect = record.table.getBoundingClientRect();
      const visible = tableRect.width > 0 && tableRect.height > 0;
      [...record.columnHandles, ...record.rowHandles].forEach((handle) => {
        handle.style.display = visible ? "block" : "none";
      });
      if (!visible) continue;

      record.columnHandles.forEach((handle, index) => {
        const cell = record.table.rows[0]?.cells[index];
        if (!cell) return;
        const rect = cell.getBoundingClientRect();
        handle.style.left = `${rect.right}px`;
        handle.style.top = `${tableRect.top}px`;
        handle.style.height = `${tableRect.height}px`;
      });

      record.rowHandles.forEach((handle, index) => {
        const row = record.table.rows[index];
        if (!row) return;
        const rect = row.getBoundingClientRect();
        handle.style.left = `${tableRect.left}px`;
        handle.style.top = `${rect.bottom}px`;
        handle.style.width = `${tableRect.width}px`;
      });
    }
  }

  private applyDimensions(record: TableRecord): void {
    const { table, dimensions } = record;
    table.classList.add("table-drag-managed");
    table.style.tableLayout = "fixed";
    table.style.width = `${Math.max(1, dimensions.columns.reduce((sum, width) => sum + width, 0))}px`;

    let colgroup = Array.from(table.children).find((child) =>
      child instanceof HTMLTableColElement && child.dataset.tableDragColgroup === "true"
    ) as HTMLTableColElement | undefined;
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      colgroup.dataset.tableDragColgroup = "true";
      table.insertBefore(colgroup, table.firstChild);
    }
    while (colgroup.children.length < dimensions.columns.length) colgroup.appendChild(document.createElement("col"));
    while (colgroup.children.length > dimensions.columns.length) colgroup.lastChild?.remove();
    dimensions.columns.forEach((width, index) => {
      const column = colgroup?.children[index];
      if (column instanceof HTMLTableColElement) column.style.width = `${width}px`;
    });

    Array.from(table.rows).forEach((row, index) => {
      const height = dimensions.rows[index];
      if (height === undefined) return;
      row.style.height = `${height}px`;
      Array.from(row.cells).forEach((cell) => { cell.style.height = `${height}px`; });
    });
  }

  private normalizeDimensions(table: HTMLTableElement, saved?: TableDimensions): TableDimensions {
    const columnCount = table.rows[0]?.cells.length ?? 0;
    const columns = Array.from({ length: columnCount }, (_, index) => {
      const savedWidth = saved?.columns[index];
      if (typeof savedWidth === "number" && Number.isFinite(savedWidth) && savedWidth > 0) return savedWidth;
      return Math.max(this.settings.minColumnWidth, table.rows[0]?.cells[index]?.getBoundingClientRect().width || 120);
    });
    const rows = Array.from(table.rows, (row, index) => {
      const savedHeight = saved?.rows[index];
      if (typeof savedHeight === "number" && Number.isFinite(savedHeight) && savedHeight > 0) return savedHeight;
      return Math.max(this.settings.minRowHeight, row.getBoundingClientRect().height || 28);
    });
    return { columns, rows };
  }

  private clearRecords(): void {
    for (const [table, record] of this.records) this.removeRecord(table, record);
    this.records.clear();
  }

  private removeRecord(table: HTMLTableElement, record: TableRecord): void {
    record.columnHandles.forEach((handle) => { this.handles.delete(handle); handle.remove(); });
    record.rowHandles.forEach((handle) => { this.handles.delete(handle); handle.remove(); });
    table.classList.remove("table-drag-resizable", "table-drag-managed");
    delete table.dataset.tableDragKey;
    const colgroup = Array.from(table.children).find((child) =>
      child instanceof HTMLTableColElement && child.dataset.tableDragColgroup === "true"
    );
    colgroup?.remove();
    table.style.removeProperty("table-layout");
    table.style.removeProperty("width");
    Array.from(table.rows).forEach((row) => {
      row.style.removeProperty("height");
      Array.from(row.cells).forEach((cell) => cell.style.removeProperty("height"));
    });
    this.records.delete(table);
  }
}
