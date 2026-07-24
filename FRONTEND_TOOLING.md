# Frontend AI Tooling — Cross-Tool Reference

**This is the single source of truth for AI-assisted frontend work in this repo.**
It applies to **every** AI coding tool — Codex, Claude Code, Lovable, Cursor,
GitHub Copilot, or any other — not just one. If you are an assistant making a
**UI / frontend change**, read this first and use the packages below.

> Backend, security, and AML rules live in [`AGENTS.md`](./AGENTS.md) and
> [`AGENTS_NPC_Property_Dashboard.md`](./AGENTS_NPC_Property_Dashboard.md). Those
> still apply — this file is additive and scoped to the UI layer.

---

## 1. Installed frontend packages — use them

The repo ships a shared toolchain in [`.mcp.json`](./.mcp.json) (MCP servers) and
[`.claude/skills/`](./.claude/skills/) (agent skills). Setup and API-key steps are
in [`MCP_SETUP.md`](./MCP_SETUP.md). When your tool supports MCP and/or skills,
these are the preferred way to do frontend work:

### MCP servers (`.mcp.json`)

| Server | Package | Use it to… |
| --- | --- | --- |
| **shadcn** | `shadcn@latest mcp` | Discover and add UI from the shadcn registry. This app is **already built on shadcn/ui** (`components.json`) — reach for a registry component before hand-rolling one. |
| **chrome-devtools** | `chrome-devtools-mcp@latest` | Actually run the change in a browser — inspect the DOM, console, and network, and take screenshots to verify the result before claiming it works. |
| **@21st-dev/magic** | `@21st-dev/magic@latest` | Generate or refine net-new UI components from a natural-language description, then adapt the output to this repo's tokens and conventions. Needs `MAGIC_API_KEY` (see `MCP_SETUP.md`). |

### Agent skills (`.claude/skills/`)

| Skill | Source | Use it to… |
| --- | --- | --- |
| **frontend-design** | Anthropic `anthropics/skills` | Set the aesthetic direction for new or reshaped UI — palette, typography, layout — so it looks intentional, not templated. Invoke before building a new surface. |
| **web-design-guidelines** | Vercel `vercel-labs/agent-skills` | Review UI code for accessibility, UX, and Web Interface Guidelines compliance. Invoke after building, before finishing. |

If your tool does **not** support MCP/skills, still follow the same intent: prefer
shadcn components, design deliberately, verify in a browser, and review for
accessibility.

---

## 2. The frontend loop (apply to every UI change)

1. **Design** — for a new or significantly reshaped surface, use **frontend-design**
   to choose palette, type, and layout deliberately. Derive colors from this repo's
   semantic tokens (§3), not arbitrary hexes.
2. **Build** — prefer a **shadcn** registry component; use **@21st-dev/magic** for
   net-new components, then adapt the output to our tokens, aliases, and patterns.
   Never paste generated code that hardcodes colors or fonts.
3. **Review** — run **web-design-guidelines** over the changed files (a11y, focus
   states, semantics, reduced-motion, responsive down to mobile).
4. **Verify** — use **chrome-devtools** to load the app, exercise the change, check
   the console for errors, and screenshot the result. Do not report success on an
   unverified UI change.

---

## 3. Non-negotiable frontend rules (repo-specific)

These are enforced by tooling and CI — respect them regardless of which AI tool
generated the code:

- **Semantic design tokens only.** Never emit raw Tailwind palette classes
  (`bg-blue-500`, `text-red-600`, …) or hardcoded hex/font values in shared UI.
  Consume the white-label CSS tokens. See
  [`docs/WHITE_LABEL_TOKEN_CONTRACT.md`](./docs/WHITE_LABEL_TOKEN_CONTRACT.md) and
  [`docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md`](./docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md).
  The ratchet `npm run audit:style` fails the build if hardcoded-color/font counts
  rise above the committed baseline — new violations must be **zero**.
- **Theming is dynamic.** Branding (colors, logos, light/dark) comes from
  `whitelabel_settings` via `BrandProvider` → CSS vars on `:root` / `.dark`. Build
  UI that reads tokens so it re-themes automatically; never assume a fixed brand.
- **Use the shadcn setup as-is.** Respect `components.json` aliases (`@/components`,
  `@/components/ui`, `@/lib`, `@/hooks`) and the existing Tailwind config
  (`tailwind.config.ts`, `src/index.css`). Add primitives via the shadcn registry
  rather than duplicating them.
- **Accessibility floor.** Visible keyboard focus, correct semantics/labels,
  respects `prefers-reduced-motion`, responsive to mobile. This is what
  web-design-guidelines checks — clear it before finishing.
- **Feature flags / module gates stay intact.** UI behind `ModuleGuard` and feature
  flags must remain gated; don't expose flagged surfaces by default.

---

## 4. Stack map (where frontend lives)

- **Framework:** Vite + React + TypeScript. Dev: `npm run dev`, build: `npm run build`.
- **UI kit:** shadcn/ui + Tailwind (`components.json`, `tailwind.config.ts`, `src/index.css`).
- **App code:** `src/` — pages in `src/pages/*`, components in `src/components/*`,
  shared UI primitives in `src/components/ui/*`, hooks in `src/hooks/*`, utils in `src/lib/*`.
- **Design system docs:** `docs/WHITE_LABEL_TOKEN_CONTRACT.md`,
  `docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md`, `docs/dashboard-theme-foundation.md`.
- **Style enforcement:** `npm run audit:style` (ratchet) and `npm run lint`.

Before finishing any UI change, run at minimum: `npm run lint`, `npm run audit:style`,
and `npm run build`.

---

## 5. How each tool picks this file up

The same guidance is wired into every tool's native entry point so it applies no
matter what is driving the change. Keep this file as the source of truth; the others
are thin pointers back here.

| Tool | Entry point that points here |
| --- | --- |
| **Codex / generic** | [`AGENTS.md`](./AGENTS.md) |
| **Claude Code** | [`CLAUDE.md`](./CLAUDE.md) + `.claude/skills/`, `.mcp.json` |
| **GitHub Copilot** | [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) |
| **Cursor** | [`.cursor/rules/frontend-tooling.mdc`](./.cursor/rules/frontend-tooling.mdc) |
| **Lovable** | Reads repo docs; add this file to project knowledge if prompted UI work isn't honoring it. |

If you add another AI tool, point its rules file back to this document rather than
copying the content, so there is one source of truth.
