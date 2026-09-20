/**
 * Stand-in for the `obsidian` module, aliased in by the test runner. The
 * bundled tests only need the runtime values that `src/` imports; everything
 * else it uses from that package is type-only and erased at build time.
 */
export class MarkdownView {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class App {}
