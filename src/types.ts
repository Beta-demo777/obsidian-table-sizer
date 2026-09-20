export interface TableDimensions {
  columns: number[];
  rows: number[];
}

/**
 * Identity hints stored alongside a table's dimensions.
 *
 * `signature` and `bodyHash` describe the table's content so it can be
 * recognised again after other tables are inserted, removed or reordered.
 * `order` is the last known document position, used only as a last-resort
 * fallback and as the ordering for legacy, signature-less records.
 */
export interface TableIdentity {
  signature: string;
  bodyHash: string;
  order: number;
}

/** On-disk record. Identity fields are optional because records saved by
 *  earlier plugin versions only contain dimensions. */
export interface StoredTable extends TableDimensions {
  signature?: string;
  bodyHash?: string;
  order?: number;
}

/** A stored record as the resizer sees it. */
export interface SavedTableInfo {
  key: string;
  signature?: string;
  bodyHash?: string;
  order: number;
}

/**
 * Storage boundary between the plugin and the resizer. Kept as an interface so
 * the resizer can be driven by a fake store in tests.
 */
export interface TableStore {
  getEntries(path: string): SavedTableInfo[];
  /** Dimensions for a matched record, fetched only once identity is settled. */
  getDimensions(key: string): TableDimensions | undefined;
  /** Record a confident match so the next render can recognise the table directly. */
  applyIdentity(key: string, meta: TableIdentity): void;
  /** Persist dimensions, allocating a key when the table has none yet. */
  saveDimensions(
    key: string | null,
    path: string,
    dimensions: TableDimensions,
    meta: TableIdentity
  ): string;
  removeEntries(path: string): void;
  /** Write pending metadata-only changes, coalescing them into one save. */
  flush(): void;
}

export interface TableDragData {
  version: 1;
  tables: Record<string, StoredTable>;
}

export interface TableDragSettings {
  minColumnWidth: number;
  minRowHeight: number;
  enableColumnResize: boolean;
  enableRowResize: boolean;
}

export const DEFAULT_SETTINGS: TableDragSettings = {
  minColumnWidth: 48,
  minRowHeight: 24,
  enableColumnResize: true,
  enableRowResize: true
};

export const DEFAULT_DATA: TableDragData = {
  version: 1,
  tables: {}
};
