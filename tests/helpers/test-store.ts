/**
 * The real store, plus a write counter and seeding helpers.
 *
 * This deliberately *extends* the production class rather than reimplementing
 * it: a test double that mirrors the logic drifts from the real thing and hides
 * bugs, which is exactly how a data.json write storm once slipped past a green
 * suite.
 */
import { TableRecordStore } from "../../src/table-store";
import type { StoredTable } from "../../src/types";

export class TestTableStore extends TableRecordStore {
  /** How many times the plugin would have written data.json. */
  writes = 0;

  constructor(tables: Record<string, StoredTable> = {}) {
    super(tables, () => {
      this.writes++;
    });
  }

  /** A record as a version before signatures would have written it. */
  seedLegacy(key: string, columns: number[]): void {
    this.tables[key] = { columns, rows: [30] };
  }

  /** A record that already knows its table's content. */
  seed(key: string, columns: number[], identity: { signature: string; bodyHash: string }): void {
    this.tables[key] = { columns, rows: [30], ...identity };
  }

  recordCount(): number {
    return Object.keys(this.tables).length;
  }
}
