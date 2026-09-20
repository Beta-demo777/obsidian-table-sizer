import { MarkdownView, Plugin } from "obsidian";
import { TableDragSettingTab } from "./settings-tab";
import { TableResizer } from "./table-resizer";
import { DEFAULT_DATA, DEFAULT_SETTINGS, type TableDimensions, type TableDragData, type TableDragSettings } from "./types";

export default class TableDragPlugin extends Plugin {
  settings: TableDragSettings = { ...DEFAULT_SETTINGS };
  data: TableDragData = { version: DEFAULT_DATA.version, tables: {} };
  private resizer: TableResizer | null = null;

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

    this.resizer = new TableResizer(
      this.app,
      this.settings,
      (key) => this.getDimensions(key),
      (key, dimensions) => this.setDimensions(key, dimensions),
      (prefix) => this.removeDimensions(prefix)
    );
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

  async resetCurrentNote(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path;
    if (!path) return;
    for (const key of Object.keys(this.data.tables)) {
      if (key.startsWith(`${path}::`)) delete this.data.tables[key];
    }
    await this.saveSettings();
    this.resizer?.resetCurrentNote();
  }

  private getDimensions(key: string): TableDimensions | undefined {
    return this.data.tables[key];
  }

  private migrateTableKeys(tables: Record<string, TableDimensions>): Record<string, TableDimensions> {
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

  private setDimensions(key: string, dimensions: TableDimensions): void {
    this.data.tables[key] = {
      columns: dimensions.columns.map((width) => Math.round(width)),
      rows: dimensions.rows.map((height) => Math.round(height))
    };
    void this.saveSettings();
  }

  private removeDimensions(prefix: string): void {
    for (const key of Object.keys(this.data.tables)) {
      if (key.startsWith(prefix)) delete this.data.tables[key];
    }
    void this.saveSettings();
  }
}
