import { App, PluginSettingTab, Setting } from "obsidian";
import type TableDragPlugin from "./main";

export class TableDragSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TableDragPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("启用列宽拖拽")
      .setDesc("显示表格列边界的拖拽手柄。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableColumnResize)
        .onChange(async (value) => {
          this.plugin.settings.enableColumnResize = value;
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));

    new Setting(containerEl)
      .setName("启用行高拖拽")
      .setDesc("显示表格行边界的拖拽手柄。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableRowResize)
        .onChange(async (value) => {
          this.plugin.settings.enableRowResize = value;
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));

    new Setting(containerEl)
      .setName("最小列宽")
      .setDesc("拖拽时允许的最小列宽（像素）。")
      .addText((text) => text
        .setValue(String(this.plugin.settings.minColumnWidth))
        .setPlaceholder("48")
        .onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 24) return;
          this.plugin.settings.minColumnWidth = Math.round(parsed);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("最小行高")
      .setDesc("拖拽时允许的最小行高（像素）。")
      .addText((text) => text
        .setValue(String(this.plugin.settings.minRowHeight))
        .setPlaceholder("24")
        .onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 16) return;
          this.plugin.settings.minRowHeight = Math.round(parsed);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("重置当前笔记的表格尺寸")
      .setDesc("清除当前笔记中保存的列宽和行高。")
      .addButton((button) => button
        .setButtonText("重置")
        .setWarning()
        .onClick(async () => {
          await this.plugin.resetCurrentNote();
        }));
  }
}
