import { MarkdownView, Plugin } from "obsidian";
import { TableDragSettingTab } from "./settings-tab";
import { TableResizer } from "./table-resizer";
import { TableRecordStore } from "./table-store";
import {
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  type StoredTable,
  type TableDragData,
  type TableDragSettings
} from "./types";

export default class TableDragPlugin extends Plugin {
  settings: TableDragSettings = { ...DEFAULT_SETTINGS };
  data: TableDragData = { version: DEFAULT_DATA.version, tables: {} };
  private resizer: TableResizer | null = null;
  /**
   * Holds and mutates `data.tables`; `saveSettings` serialises the same object,
   * so the store never needs to know how persistence works.
   */
  private store: TableRecordStore | null = null;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<TableDragData & TableDragSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(saved ?? {})
    };
    this.data = {
      version: 1,
      tables: this.migrateTableKeys(saved?.tables ?? {})
    };

    this.store = new TableRecordStore(this.data.tables, () => void this.saveSettings());
    this.resizer = new TableResizer(this.app, this.settings, this.store);
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
    this.store = null;
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
