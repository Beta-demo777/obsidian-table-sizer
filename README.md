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
- Dimensions are persisted in the plugin's `data.json`, under a key scoped to the note.
- A `MutationObserver` watches the active view so that tables keep their sizes when Obsidian re-renders them.

### How a table is recognised again

Tables are matched by **content**, not by position, so inserting, deleting or reordering tables in a note no longer disturbs the sizes of the others. Each rendered table gets a signature built from its header row, plus a hash of its body, and the whole note is matched in rounds:

1. identical signature and body — the same table, unchanged;
2. identical signature — the same table with an edited body;
3. similar headers above a threshold — the same table with a renamed header;
4. document position — last resort.

Rounds 1–3 are applied to every table *before* any positional fallback, which is what makes a newly inserted table come out unmatched: the existing tables claim their records first, so the newcomer has nothing left to inherit. A table that has never been resized simply has no record.

Two honest limits:

- Two tables that are identical in both header and body cannot be told apart, so inserting a third identical table above them still shifts their pairing. Nothing short of writing an identifier into the Markdown can fix that, and this plugin deliberately never touches your Markdown.
- Positional fallback is only used for records written by versions before 0.2, which carry no signature. Such records are upgraded in place the first time the note is opened with the same number of tables, so existing sizes are preserved. A record that already knows what its table looks like is never handed to a table that failed every content round — otherwise one table's dimensions could silently be applied to another.

## Related plugins

This plugin is not affiliated with [Table Resize](https://community.obsidian.md/plugins/table-resize), which targets a similar problem. Table Sizer focuses on storing dimensions per note without touching the Markdown source, and also supports row heights.

## Development

```bash
npm install
npm run dev     # watch mode, rebuilds main.js on change
npm run build   # production build
npm run check   # type check only (tsc --noEmit)
npm test        # scenario tests (Node's test runner, no extra framework)
```

The tests drive the real `TableResizer` through a stubbed DOM, so they cover the matching rules and the table lifecycle without needing Obsidian running.

To test locally, place the repository in `<your-vault>/.obsidian/plugins/table-sizer/` and enable the plugin. The [Hot Reload](https://github.com/pjeby/hot-reload) plugin reloads it automatically after each build.

### Releasing

1. Bump `version` in `manifest.json` and `package.json` (SemVer `x.y.z`) and add the matching entry to `versions.json`.
2. Commit the change.
3. Push a tag identical to the version:

   ```bash
   git tag 0.2.0 && git push origin 0.2.0
   ```

4. The [release workflow](.github/workflows/release.yml) runs the type check, the tests and the build, verifies that the tag matches `manifest.json`, and attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

## License

[MIT](LICENSE) © Beta777

---

## 中文说明

一个由 Beta777 编写的 Obsidian 插件，为 Markdown 表格添加拖拽调整列宽和行高的能力。

与那些会改写表格源码的编辑器不同，本插件是纯视觉方案：调整发生在渲染后的表格上，尺寸按笔记保存在插件自己的数据文件中，**不会修改你的 Markdown 原文**。

> **仅支持桌面端。** 拖拽依赖精确的指针操作，插件不在 Obsidian 移动端提供。

### 特性

- 拖拽**列边界**调整列宽，拖拽**行边界**调整行高。
- **插入、删除、重排表格都不会影响其它表格的尺寸** —— 表格按内容识别，而不是按出现顺序。
- **表头改动不会丢尺寸** —— 表头相似度匹配会兜住改名的情况。
- **按笔记持久化**，重启后仍然生效。
- 可配置最小列宽与最小行高。
- 提供「重置当前笔记的表格尺寸」命令与设置面板按钮。

### 使用

1. 在阅读视图或实时预览中打开包含 Markdown 表格的笔记。
2. 将鼠标移到列边界或行边界的拖拽手柄上，指针会变为缩放样式。
3. 拖拽到目标尺寸后松开鼠标，尺寸自动保存。

### 构建与测试

```bash
npm install
npm run build
npm test      # 场景测试，使用 Node 自带测试运行器，无需额外框架
```

将生成的 `main.js`、`manifest.json` 和 `styles.css` 放在 vault 的 `.obsidian/plugins/table-sizer/` 目录中即可加载。

### 表格是如何被识别的

表格按**内容**匹配，而非按位置。每张渲染出的表格会根据表头文本生成签名，并结合正文哈希，然后对整篇笔记做多轮配对：

1. 签名与正文都相同 —— 同一张表，内容未变；
2. 签名相同 —— 同一张表，正文有改动；
3. 表头相似度超过阈值 —— 同一张表，表头被改名；
4. 文档位置 —— 兜底。

第 1–3 轮会先对**所有**表格跑完，才轮到位置兜底。这正是「新插入的表格不会被误分配」的原因：原有表格先各自认领自己的记录，新表就没有可继承的东西。从未调整过尺寸的表格本来就没有记录。

两个诚实的边界：

- **表头和正文都完全相同的两张表无法区分**，因此往它们上方再插入一张一模一样的表，仍会串位。不往 Markdown 里写入标识就无法根治，而本插件刻意不改写你的笔记。
- 位置兜底**只对 0.2 之前版本写入的、不含签名的记录生效**。这类记录会在笔记表格数量一致时首次打开就地升级，因此原有尺寸完整保留。已经知道自己长什么样的记录，绝不会被交给一张内容对不上的表 —— 否则会把一张表的尺寸静默套用到另一张上。
