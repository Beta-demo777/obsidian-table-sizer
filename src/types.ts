export interface TableDimensions {
  columns: number[];
  rows: number[];
}

export interface TableDragData {
  version: 1;
  tables: Record<string, TableDimensions>;
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
