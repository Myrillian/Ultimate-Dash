import type { FastifyInstance } from 'fastify';
import { parse, stringify, YAMLParseError } from 'yaml';
import { configFile, importRequest } from '@ultimate-dash/shared';
import { ValidationError, type Repository } from '../db/repository.js';
import type { EventHub } from '../events.js';

const HEADER = `# Ultimate Dash – Konfiguration
# Kann bearbeitet und über „Konfiguration importieren“ wieder eingelesen werden.
`;

export async function configRoutes(
  app: FastifyInstance,
  { repo, events }: { repo: Repository; events: EventHub },
) {
  app.get('/config/export', async (request, reply) => {
    // Enthält interne Adressen; Nur-lesen-Benutzer sehen zwar die Links, bekommen aber keine Datei.
    if (request.user!.role !== 'admin')
      return reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/yaml; charset=utf-8')
      .header('content-disposition', `attachment; filename="ultimate-dash-${date}.yaml"`)
      .send(HEADER + stringify(repo.exportConfig(), { lineWidth: 0 }));
  });

  app.post('/config/import', async (request) => {
    const { yaml, mode, dryRun } = importRequest.parse(request.body);
    let data: unknown;
    try {
      data = parse(yaml, { maxAliasCount: 50 });
    } catch (error) {
      if (error instanceof YAMLParseError) {
        const line = error.linePos?.[0]?.line;
        throw new ValidationError(
          `Die Datei ist kein gültiges YAML${line ? ` (Zeile ${line})` : ''}`,
        );
      }
      throw error;
    }
    const file = configFile.parse(data);
    const summary = repo.importConfig(file, mode, dryRun);
    if (!dryRun) {
      events.publish({ type: 'dashboard-changed' });
      request.log.info({ mode, ...summary }, 'Konfiguration importiert');
    }
    return summary;
  });
}
