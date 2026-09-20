import type {
  SavedTableInfo,
  StoredTable,
  TableDimensions,
  TableIdentity,
  TableStore
} from "./types";

/**
 * Positional records written before signatures existed end in a number, so the
 * key itself tells us where the table used to be. Records without a numeric
 * suffix sort last.
 */
export function legacyOrder(key: string): number {
  const separator = key.lastIndexOf("::");
  const suffix = separator < 0 ? key : key.slice(separator + 2);
  return /^\d+$/.test(suffix) ? Number(suffix) : Number.MAX_SAFE_INTEGER;
}

/**
 * Work out what an observed identity actually changes.
 *
 * Document position is only read back for records that still have no signature:
 * those are the ones positional fallback pairs up, and keeping their position
 * current is what makes upgrading from an older version lossless. Tracking it
 * for a record that already knows its table would mark the file dirty on every
 * re-render, because the set of rendered tables changes constantly while
 * scrolling in Live Preview and every index shifts with it.
 *
 * Returns the fields to write, or null when nothing meaningful changed.
 */
export function identityPatch(
  stored: StoredTable,
  observed: TableIdentity
): Partial<TableIdentity> | null {
  const hadSignature = !!stored.signature;
  const contentChanged =
    stored.signature !== observed.signature || stored.bodyHash !== observed.bodyHash;
  const orderChanged = !hadSignature && stored.order !== observed.order;
  if (!contentChanged && !orderChanged) return null;

  const patch: Partial<TableIdentity> = {
    signature: observed.signature,
    bodyHash: observed.bodyHash
  };
  if (orderChanged) patch.order = observed.order;
  return patch;
}

/**
 * The plugin's table records.
 *
 * Deliberately free of any Obsidian dependency, so the exact same code runs in
 * the app and in the tests — a test double that reimplements this logic drifts
 * from the real thing and hides bugs. Persistence is delegated to `persist`,
 * which the plugin points at `saveData`.
 */
export class TableRecordStore implements TableStore {
  private identityDirty = false;

  constructor(
    readonly tables: Record<string, StoredTable>,
    private readonly persist: () => void
  ) {}

  getEntries(path: string): SavedTableInfo[] {
    const prefix = `${path}::`;
    const entries: SavedTableInfo[] = [];
    for (const [key, record] of Object.entries(this.tables)) {
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

  getDimensions(key: string): TableDimensions | undefined {
    return this.tables[key];
  }

  applyIdentity(key: string, meta: TableIdentity): void {
    const record = this.tables[key];
    if (!record) return;
    const patch = identityPatch(record, meta);
    if (!patch) return;
    Object.assign(record, patch);
    this.identityDirty = true;
  }

  saveDimensions(
    key: string | null,
    path: string,
    dimensions: TableDimensions,
    meta: TableIdentity
  ): string {
    const target = key && this.tables[key] ? key : this.allocateKey(path);
    this.tables[target] = {
      columns: dimensions.columns.map((width) => Math.round(width)),
      rows: dimensions.rows.map((height) => Math.round(height)),
      signature: meta.signature,
      bodyHash: meta.bodyHash,
      order: meta.order
    };
    // The record now holds everything, so there is nothing left to coalesce.
    this.identityDirty = false;
    this.persist();
    return target;
  }

  removeEntries(path: string): void {
    for (const key of Object.keys(this.tables)) {
      if (key.startsWith(`${path}::`)) delete this.tables[key];
    }
    this.persist();
  }

  /** Write pending identity-only changes, coalescing them into one save. */
  flush(): void {
    if (!this.identityDirty) return;
    this.identityDirty = false;
    this.persist();
  }

  /** Keys are opaque handles; identity comes from content matching, not the key. */
  private allocateKey(path: string): string {
    const prefix = `${path}::`;
    let slot = 0;
    while (Object.prototype.hasOwnProperty.call(this.tables, `${prefix}${slot}`)) slot++;
    return `${prefix}${slot}`;
  }
}
