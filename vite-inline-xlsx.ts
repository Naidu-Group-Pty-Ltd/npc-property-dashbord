import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Vite 5 does not support `?inline` on binary assets (CSS only), so an
 * `import wb from "…xlsx?inline"` would emit a file under /assets/ and break
 * downloads on deployments that prune unreferenced assets. This plugin turns
 * such imports into a self-contained base64 data URL instead.
 */
export function inlineXlsxPlugin(): Plugin {
  const suffix = ".xlsx?inline";
  return {
    name: "npc-inline-xlsx",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(suffix)) return null;
      const resolved = await this.resolve(source.slice(0, -"?inline".length), importer, {
        skipSelf: true,
      });
      return resolved ? `${resolved.id}?inline` : null;
    },
    load(id) {
      if (!id.endsWith(suffix)) return null;
      const file = id.slice(0, -"?inline".length);
      const base64 = readFileSync(file).toString("base64");
      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return `export default "data:${mime};base64,${base64}";`;
    },
  };
}
