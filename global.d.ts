// Deno `npm:` specifiers used by shared edge-function modules that `src/` also
// imports. Declared repo-wide so any typecheck config resolves them; at runtime
// Deno resolves the real package and Vitest rewrites the specifier.
declare module 'npm:zod@3.25.76' {
  export * from 'zod';
}

// Deno remote (`https:`) specifiers used by shared edge-function modules. Deno
// resolves and types these at runtime; a repo-wide typecheck cannot fetch them,
// so declare them as `any` shapes here rather than weakening the call sites.
declare module 'https://esm.sh/jszip@3.10.1' {
  const JSZip: any;
  export default JSZip;
}
declare module 'https://esm.sh/xlsx@0.18.5' {
  const XLSX: any;
  export default XLSX;
  export const read: any;
  export const utils: any;
}
declare module 'https://esm.sh/unpdf@0.12.1' {
  export const extractText: any;
  export const getDocumentProxy: any;
}
