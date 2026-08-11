import { inlineXlsxPlugin } from "./vite-inline-xlsx";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Lets a test import a `supabase/functions/_shared` module that uses a Deno
 * `npm:` specifier.
 *
 * Those modules are shared deliberately — the report client, the workflow
 * engine, the metering wrapper — and `src/` unit tests import them so that one
 * implementation is tested once. But Deno resolves `npm:@supabase/supabase-js@2.55.0`
 * from the registry and Vite has no idea what that is, so any test whose import
 * graph reaches one dies at collection with "Failed to resolve import" — a
 * failure about the *bundler*, in a file that has nothing wrong with it.
 *
 * That had taken out `reportDesign`'s conformance and provenance specs, which
 * reach `meteredFetch.ts` through `weasyprintClient.ts`. Nobody had seen it:
 * the `verify` job died at an earlier step, so the one that runs them had never
 * been reached.
 *
 * Stripping the prefix and the version pins resolution back at the node_modules
 * copy, which is the same package. Test-time only — nothing here reaches a
 * bundle or the Deno deploy, where the specifier is correct as written.
 */
function denoNpmSpecifiers(): Plugin {
  return {
    name: "deno-npm-specifiers",
    enforce: "pre",
    resolveId(id) {
      if (!id.startsWith("npm:")) return null;
      const bare = id.slice("npm:".length);
      // Scoped packages keep their leading @; only a trailing @version goes.
      const at = bare.lastIndexOf("@");
      const name = at > 0 ? bare.slice(0, at) : bare;
      return this.resolve(name, undefined, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [denoNpmSpecifiers(), inlineXlsxPlugin(), react()],
  assetsInclude: ["**/*.xlsx", "**/*.docx"],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
