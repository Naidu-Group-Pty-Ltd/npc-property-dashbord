# MCP & Agent Skills Setup

This repo ships a shared **Claude Code** configuration for frontend design work:
Model Context Protocol (MCP) servers in [`.mcp.json`](./.mcp.json) and agent skills
under [`.claude/skills/`](./.claude/skills/). Everything here is checked in except
secrets — no API keys are committed.

## What's included

### MCP servers (`.mcp.json`)

| Server            | Package                        | Purpose                                                                 |
| ----------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `shadcn`          | `shadcn@latest mcp`            | Browse/add shadcn/ui components and blocks (this repo already uses shadcn — see `components.json`). |
| `chrome-devtools` | `chrome-devtools-mcp@latest`   | Drive a real Chrome instance — inspect the DOM, network, console, and take screenshots. |
| `@21st-dev/magic` | `@21st-dev/magic@latest`       | Generate/refine UI components from natural language. **Requires an API key.** |

Each server launches on demand via `npx`, so there is nothing to install ahead of
time — the packages are fetched the first time Claude Code starts the server.

### Agent skills (`.claude/skills/`)

| Skill                    | Source                                                                                          | Purpose                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `web-design-guidelines`  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Reviews UI code against Vercel's Web Interface Guidelines (accessibility, UX, best practices). |
| `frontend-design`        | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design)     | Guidance for distinctive, intentional visual design — palette, typography, layout. (Apache-2.0, see `LICENSE.txt`.) |

Skills load automatically when Claude Code detects a matching request (e.g. "review
my UI" or "design a new landing page"), and can be invoked explicitly with
`/web-design-guidelines` or `/frontend-design`.

## One-time setup: Magic API key

The `@21st-dev/magic` server needs an API key. It is **not** committed — `.mcp.json`
passes the `${MAGIC_API_KEY}` environment variable to the server through the MCP
client's `env` configuration, rather than as a command-line argument.

1. Sign in and create a key at the **21st.dev Magic console**: <https://21st.dev/magic/console>
2. Provide the key to your shell via **either** option:

   **Option A — shell export (simplest):**
   ```bash
   export MAGIC_API_KEY="your-key-here"
   ```
   Add that line to your shell profile (`~/.zshrc`, `~/.bashrc`, …) so it persists.

   **Option B — local env file:**
   ```bash
   cp .env.example .env.local          # .env.local is git-ignored
   # edit .env.local and set MAGIC_API_KEY="your-key-here"
   set -a && source .env.local && set +a   # export it before launching Claude Code
   ```

3. Start (or restart) Claude Code from that shell. It supplies `${MAGIC_API_KEY}` to
   the Magic server's environment at launch. The other two servers (`shadcn`,
   `chrome-devtools`) need no key.

The `shadcn` and `chrome-devtools` servers work with no additional configuration.

## Secret hygiene

- **Never commit a real key.** Only the `${MAGIC_API_KEY}` placeholder lives in
  `.mcp.json`, and it must remain in the server's `env` configuration so it is not
  exposed in process arguments.
- `.env`, `.env.local`, and every `.env.*` (except `.env.example`) are git-ignored —
  see [`.gitignore`](./.gitignore). Keep the real key in one of those local files or in
  your shell environment.
- `.env.example` documents the `MAGIC_API_KEY` placeholder with an empty value; copy it
  to a local file rather than editing it in place.

## Verifying

From the repo root:

```bash
claude mcp list          # shows shadcn, chrome-devtools, @21st-dev/magic
```

Inside a Claude Code session, `/mcp` shows connection status for each server, and the
`web-design-guidelines` / `frontend-design` skills appear in the skills list.
