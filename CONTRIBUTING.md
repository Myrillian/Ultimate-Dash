# Mitmachen

Danke, dass du helfen möchtest. Fehlerberichte, Ideen und Pull Requests sind willkommen.

## Bevor du anfängst

- **Fehler oder Idee:** Lege zuerst ein Issue an, dafür gibt es Vorlagen. Bei größeren Änderungen spart eine kurze Abstimmung vorher Arbeit auf beiden Seiten.
- **Sicherheitslücken** bitte nicht öffentlich melden, siehe [SECURITY.md](SECURITY.md).

## Entwicklung

Voraussetzungen: Node.js 22 und pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev     # Backend auf :3000, Frontend mit Hot Reload auf :5173
```

Ohne echte Server helfen die Simulationen:

```bash
pnpm --filter @ultimate-dash/server fake:technitium   # Port 5380, Token dev-token
pnpm --filter @ultimate-dash/server fake:proxmox      # Port 8006
```

Aufbau des Monorepos:

| Ordner            | Inhalt                                         |
| ----------------- | ---------------------------------------------- |
| `apps/web`        | SvelteKit-SPA (Svelte 5 mit Runes, Tailwind 4) |
| `apps/server`     | Fastify 5, Drizzle ORM mit better-sqlite3      |
| `packages/shared` | Zod-Schemas und Typen für Frontend und Backend |
| `docs/`           | Planung, Entscheidungen, Anleitungen           |

## Regeln

- **Sprache:** Oberfläche, Doku, Kommentare und Commit-Messages auf Deutsch.
- **Validierung** gehört in `packages/shared`, damit Frontend und Backend dieselben Regeln nutzen.
- **Fremde APIs** (Technitium, Proxmox, Docker, Widgets) nur über das Backend ansprechen, nie direkt aus dem Browser.
- **Datenbank:** `apps/server/src/db/schema.ts` anpassen, dann `pnpm --filter @ultimate-dash/server db:generate --name <name>` und die erzeugte Migration mit committen.
- **Grundsatzentscheidungen** unten in `docs/04-entscheidungen.md` anhängen.
- **Keine echten Daten** in Tests, Beispielen oder Screenshots: keine eigenen IPs, Hostnamen, Tokens oder Namen. Nimm `example.org`, `home.lan` und Adressen wie `192.168.1.x`.

Vor jedem Push müssen diese Prüfungen durchlaufen (die CI macht dasselbe):

```bash
pnpm format:check && pnpm check && pnpm test && pnpm build
```

## Lizenz

Mit einem Beitrag erklärst du dich einverstanden, dass er unter der [MIT-Lizenz](LICENSE) des Projekts veröffentlicht wird. Übernimm keinen Code aus Projekten mit unverträglicher Lizenz (z. B. GPL) und nenne die Quelle, wenn du freizügig lizenzierten fremden Code übernimmst.
