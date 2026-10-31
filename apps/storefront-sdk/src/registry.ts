import type * as Email from "./email";
import type * as Feed from "./feed";
import type * as Sms from "./sms";
import type * as Toast from "./toast";
import type * as Upsell from "./upsell";

/**
 * Per-tool renderers are separate scripts, loaded the first time a campaign of that tool is eligible, so a page that
 * only uses a popup never downloads the feed or the recommendation block. Each script registers its module here; the
 * core reads it back. Type-only imports above: nothing in this file pulls a renderer into the core.
 */
export interface ToolMods { toast: typeof Toast; feed: typeof Feed; upsell: typeof Upsell; email: typeof Email; sms: typeof Sms }
export type ToolName = keyof ToolMods;
type Registry = { [K in ToolName]?: ToolMods[K] };

declare global {
  interface Window { __cfTools?: Registry }
}

export function register<K extends ToolName>(name: K, mod: ToolMods[K]): void {
  (window.__cfTools ??= {})[name] = mod;
}
