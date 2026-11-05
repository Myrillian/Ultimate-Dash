# Ultimate Dash – Hinweise für Claude

- Sprache: UI-Texte, Doku, Kommentare und Commit-Messages auf Deutsch.
- Monorepo mit pnpm: `apps/web` (SvelteKit SPA, Svelte 5 Runes, Tailwind 4), `apps/server` (Fastify 5, Drizzle + better-sqlite3), `packages/shared` (Zod-Schemas und Typen, von beiden genutzt).
- Vor jedem Push: `pnpm format:check && pnpm check && pnpm test && pnpm build`.
- Schemaänderungen: `apps/server/src/db/schema.ts` anpassen, dann `pnpm --filter @ultimate-dash/server db:generate --name <name>`; die erzeugte Migration mit committen.
- Validierung gehört in `packages/shared`, damit Frontend und Backend dieselben Regeln nutzen.
- Fremd-APIs (Technitium, Docker, Widgets) nur über das Backend ansprechen, nie direkt aus dem Browser.
- Planung und Entscheidungen: `docs/`. Neue Grundsatzentscheidungen in `docs/04-entscheidungen.md` anhängen.
