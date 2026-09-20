# Table Sizer

An [Obsidian](https://obsidian.md) plugin that lets you resize Markdown table columns and rows by dragging their borders.

> **English** · [中文说明](#中文说明)

Unlike Markdown table editors that rewrite the table source, Table Sizer is purely visual: the rendered table is resized and the chosen dimensions are stored per note in the plugin's own data file. **Your Markdown is never modified.**

## Features

- **Drag column borders** to set column widths.
- **Drag row borders** to set row heights.
- **Survives header edits** — dimensions are keyed by note path and table position, not by table text, so renaming or editing a header does not reset your layout.
- **Per-note persistence** — each note's tables remember their own sizes across sessions and restarts.
- **Non-destructive** — no table syntax is written back to your notes.
- **Configurable minimums** — set a floor for column width and row height.
- **Reset command** — clear the saved sizes for the current note from the command palette or the settings tab.

## Requirements

- Obsidian 1.6.0 or later.
- **Desktop only.** Resizing depends on precise pointer dragging, so the plugin is not available on Obsidian Mobile.

## Installation

### From the Community plugins directory

Once published, search for **Table Sizer** in *Settings → Community plugins → Browse*.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Beta-demo777/obsidian-table-sizer/releases).
2. Put the three files in `<your-vault>/.obsidian/plugins/table-sizer/`.
3. Reload Obsidian and enable **Table Sizer** in *Settings → Community plugins*.

## Usage

1. Open a note containing a Markdown table in **Reading view** or **Live Preview**.
2. Move the pointer to a column or row border until the resize cursor appears.
3. Drag to the size you want, then release.

Sizes are saved automatically when you release the pointer. They are scoped to the current note and table, and are **not** written into the Markdown table.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Enable column resizing | On | Show drag handles on column borders. |
| Enable row resizing | On | Show drag handles on row borders. |
| Minimum column width | 48 px | Smallest column width allowed while dragging. |
| Minimum row height | 24 px | Smallest row height allowed while dragging. |
| Reset table sizes for current note | — | Clears every saved column width and row height for the active note. |

You can also run **Table Sizer: Reset table sizes for current note** from the command palette.

## How it works

- Resizing is applied to the rendered table through a generated `<colgroup>`, with `table-layout: fixed`.
- Dimensions are persisted in the plugin's `data.json`, keyed as `<note path>::<table index>`.
- A `MutationObserver` watches the active view so that tables keep their sizes when Obsidian re-renders them.
- To avoid layout drift, tables are identified by their order in the note rather than by their header text — inserting a new table *above* an existing one will shift the saved sizes of the tables below it.

## Related plugins

This plugin is not affiliated with [Table Resize](https://community.obsidian.md/plugins/table-resize), which targets a similar problem. Table Sizer focuses on storing dimensions per note without touching the Markdown source, and also supports row heights.

## Development

```bash
npm install
npm run dev     # watch mode, rebuilds main.js on change
npm run build   # production build
npm run check   # type check only (tsc --noEmit)
```

To test locally, place the repository in `<your-vault>/.obsidian/plugins/table-sizer/` and enable the plugin. The [Hot Reload](https://github.com/pjeby/hot-reload) plugin reloads it automatically after each build.

### Releasing

1. Bump `version` in `manifest.json` (SemVer `x.y.z`) and add the matching entry to `versions.json`.
2. Commit the change.
3. Push a tag identical to the version:

   ```bash
   git tag 0.1.0 && git push origin 0.1.0
   ```

4. The [release workflow](.github/workflows/release.yml) runs the type check and build, verifies that the tag matches `manifest.json`, and attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

## License

[MIT](LICENSE) © Beta777

---

## 中文说明

一个由 Beta777 编写的 Obsidian 插件，为 Markdown 表格添加拖拽调整列宽和行高的能力。

与那些会改写表格源码的编辑器不同，本插件是纯视觉方案：调整发生在渲染后的表格上，尺寸按笔记保存在插件自己的数据文件中，**不会修改你的 Markdown 原文**。

> **仅支持桌面端。** 拖拽依赖精确的指针操作，插件不在 Obsidian 移动端提供。

### 特性

- 拖拽**列边界**调整列宽，拖拽**行边界**调整行高。
- **表头改动不会丢尺寸** —— 尺寸以「笔记路径 + 表格位置」为键，而不是依赖表格文本。
- **按笔记持久化**，重启后仍然生效。
- 可配置最小列宽与最小行高。
- 提供「重置当前笔记的表格尺寸」命令与设置面板按钮。

### 使用

1. 在阅读视图或实时预览中打开包含 Markdown 表格的笔记。
2. 将鼠标移到列边界或行边界的拖拽手柄上，指针会变为缩放样式。
3. 拖拽到目标尺寸后松开鼠标，尺寸自动保存。

### 构建

```bash
npm install
npm run build
```

将生成的 `main.js`、`manifest.json` 和 `styles.css` 放在 vault 的 `.obsidian/plugins/table-sizer/` 目录中即可加载。

### 说明

表格按其在笔记中的**出现顺序**识别，而非按表头文本。因此在一篇笔记里靠前的位置插入一张新表格，会使其后表格的已保存尺寸发生错位 —— 这是为了换取「编辑表头不丢尺寸」而做的权衡。
