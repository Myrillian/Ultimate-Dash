## Was ändert sich?

<!-- Kurz beschreiben, was und warum. Zugehöriges Issue: #… -->

## Wie getestet?

<!-- Tests, Simulation (fake:technitium / fake:proxmox) oder echtes System -->

## Checkliste

- [ ] `pnpm format:check && pnpm check && pnpm test && pnpm build` läuft durch
- [ ] Doku angepasst (README, `docs/anleitungen/`), falls sich Bedienung oder Konfiguration ändert
- [ ] Bei Schemaänderung: Migration erzeugt und committet
- [ ] Bei Grundsatzentscheidung: Eintrag in `docs/04-entscheidungen.md`
- [ ] Keine echten IPs, Hostnamen, Tokens oder Namen in Code, Tests und Screenshots
