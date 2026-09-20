import { MarkdownView, Plugin } from "obsidian";
import { TableDragSettingTab } from "./settings-tab";
import { TableResizer } from "./table-resizer";
import {
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  type SavedTableInfo,
  type StoredTable,
  type TableDimensions,
  type TableDragData,
  type TableDragSettings,
  type TableIdentity,
  type TableStore
} from "./types";

/**
 * Positional records written before signatures existed end in a number, so the
 * key itself tells us where the table used to be. Records without a numeric
 * suffix sort last.
 */
function legacyOrder(key: string): number {
  const separator = key.lastIndexOf("::");
  const suffix = separator < 0 ? key : key.slice(separator + 2);
  return /^\d+$/.test(suffix) ? Number(suffix) : Number.MAX_SAFE_INTEGER;
}

export default class TableDragPlugin extends Plugin {
  settings: TableDragSettings = { ...DEFAULT_SETTINGS };
  data: TableDragData = { version: DEFAULT_DATA.version, tables: {} };
  private resizer: TableResizer | null = null;
  /** Identity changes are coalesced so a re-render writes at most once. */
  private identityDirty = false;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<TableDragData & TableDragSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(saved ?? {})
    };
    const tables = this.migrateTableKeys(saved?.tables ?? {});
    this.data = {
      version: 1,
      tables
    };

    this.resizer = new TableResizer(this.app, this.settings, this.createStore());
    this.resizer.load();
    this.addSettingTab(new TableDragSettingTab(this.app, this));

    this.addCommand({
      id: "reset-current-note-table-sizes",
      name: "重置当前笔记的表格尺寸",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.resetCurrentNote();
        return true;
      }
    });
  }

  onunload(): void {
    this.resizer?.unload();
    this.resizer = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, ...this.data });
  }

  refresh(): void {
    this.resizer?.refresh();
  }

  /** Delegated: the resizer clears both the live handles and the records. */
  async resetCurrentNote(): Promise<void> {
    this.resizer?.resetCurrentNote();
  }

  private createStore(): TableStore {
    return {
      getEntries: (path) => this.getEntries(path),
      getDimensions: (key) => this.data.tables[key],
      applyIdentity: (key, meta) => this.applyIdentity(key, meta),
      saveDimensions: (key, path, dimensions, meta) =>
        this.saveDimensions(key, path, dimensions, meta),
      removeEntries: (path) => this.removeEntries(path),
      flush: () => void this.flushIdentity()
    };
  }

  private getEntries(path: string): SavedTableInfo[] {
    const prefix = `${path}::`;
    const entries: SavedTableInfo[] = [];
    for (const [key, record] of Object.entries(this.data.tables)) {
      if (!key.startsWith(prefix)) continue;
      entries.push({
        key,
        signature: record.signature,
        bodyHash: record.bodyHash,
        order: record.order ?? legacyOrder(key)
      });
    }
    return entries;
  }

  private applyIdentity(key: string, meta: TableIdentity): void {
    const record = this.data.tables[key];
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
    this.identityDirty = true;
  }

  private saveDimensions(
    key: string | null,
    path: string,
    dimensions: TableDimensions,
    meta: TableIdentity
  ): string {
    const target = key && this.data.tables[key] ? key : this.allocateKey(path);
    this.data.tables[target] = {
      columns: dimensions.columns.map((width) => Math.round(width)),
      rows: dimensions.rows.map((height) => Math.round(height)),
      signature: meta.signature,
      bodyHash: meta.bodyHash,
      order: meta.order
    };
    // The record now holds everything, so there is nothing left to coalesce.
    this.identityDirty = false;
    void this.saveSettings();
    return target;
  }

  /** Keys are opaque handles; only uniqueness within the note matters, because
   *  identity is decided by content matching rather than by the key. */
  private allocateKey(path: string): string {
    const prefix = `${path}::`;
    let slot = 0;
    while (Object.prototype.hasOwnProperty.call(this.data.tables, `${prefix}${slot}`)) slot++;
    return `${prefix}${slot}`;
  }

  private removeEntries(path: string): void {
    for (const key of Object.keys(this.data.tables)) {
      if (key.startsWith(`${path}::`)) delete this.data.tables[key];
    }
    void this.saveSettings();
  }

  private async flushIdentity(): Promise<void> {
    if (!this.identityDirty) return;
    this.identityDirty = false;
    await this.saveSettings();
  }

  private migrateTableKeys(tables: Record<string, StoredTable>): Record<string, StoredTable> {
    const migrated = { ...tables };
    for (const key of Object.keys(tables)) {
      const separator = key.lastIndexOf("::");
      if (separator < 0) continue;
      const beforeFingerprint = key.slice(0, separator);
      const tableIndexSeparator = beforeFingerprint.lastIndexOf("::");
      if (tableIndexSeparator < 0) continue;
      const tableIndex = beforeFingerprint.slice(tableIndexSeparator + 2);
      if (!/^\d+$/.test(tableIndex)) continue;
      const stableKey = beforeFingerprint;
      // If several legacy fingerprints exist, the last one reflects the most
      // recent table shape. Preserve an already migrated stable key if present.
      if (!Object.prototype.hasOwnProperty.call(tables, stableKey)) migrated[stableKey] = tables[key];
      delete migrated[key];
    }
    return migrated;
  }
}
