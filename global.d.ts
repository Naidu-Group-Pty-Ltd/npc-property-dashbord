// Deno `npm:` specifiers used by shared edge-function modules that `src/` also
// imports. Declared repo-wide so any typecheck config resolves them; at runtime
// Deno resolves the real package and Vitest rewrites the specifier.
declare module 'npm:zod@3.25.76' {
  export * from 'zod';
}
