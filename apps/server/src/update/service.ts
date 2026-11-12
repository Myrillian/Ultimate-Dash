import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  normalizeVersion,
  type UpdateInstallInput,
  type UpdateMode,
  type UpdateProgress,
  type UpdateRelease,
  type UpdateStatus,
  type User,
} from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';

export interface UpdateConfig {
  /** Installierte Version (aus der package.json des Servers). */
  version: string;
  /** `UPDATE_CHECK=false` schaltet jede Anfrage bei GitHub ab. */
  checkEnabled: boolean;
  /** GitHub-Repository `besitzer/name`, dessen Veröffentlichungen geprüft werden. */
  repo: string;
  /**
   * Gesetzt, wenn das Installationsskript den Update-Dienst eingerichtet hat: Anfrage-Datei,
   * die der Update-Dienst (root) beobachtet, und die Statusdatei, die er schreibt.
   */
  selfUpdate: { requestFile: string; statusFile: string } | null;
}

export type UpdateErrorKind = 'invalid' | 'unavailable' | 'busy';

export class UpdateError extends Error {
  constructor(
    message: string,
    readonly kind: UpdateErrorKind,
  ) {
    super(message);
  }

  get statusCode(): number {
    if (this.kind === 'invalid') return 400;
    return 409;
  }
}

const DEFAULT_REPO = 'myrillian/ultimate-dash';
const CACHE_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const MAX_BODY = 20_000;
const MAX_RELEASES = 30;

/** Liest die Version aus der package.json des Servers (im Build eine Ebene höher als im Quelltext). */
export function readServerVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(candidate, `file://${here}/`), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === '@ultimate-dash/server' && pkg.version) return pkg.version;
    } catch {
      // nächster Kandidat
    }
  }
  return '0.0.0';
}

export function updateConfigFromEnv(env: NodeJS.ProcessEnv = process.env): UpdateConfig {
  const repo = env.UPDATE_REPO?.trim() || DEFAULT_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('UPDATE_REPO muss die Form besitzer/name haben');
  }
  const requestFile = env.UD_UPDATE_REQUEST_FILE?.trim();
  const statusFile = env.UD_UPDATE_STATUS_FILE?.trim();
  return {
    version: readServerVersion(),
    checkEnabled: env.UPDATE_CHECK?.trim().toLowerCase() !== 'false',
    repo,
    selfUpdate: requestFile && statusFile ? { requestFile, statusFile } : null,
  };
}

interface GithubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

function toRelease(raw: GithubRelease): UpdateRelease | null {
  if (raw.draft === true || raw.prerelease === true) return null;
  if (typeof raw.tag_name !== 'string') return null;
  const version = normalizeVersion(raw.tag_name);
  if (!version) return null;
  const url = typeof raw.html_url === 'string' ? raw.html_url : '';
  return {
    version,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Version ${version}`,
    // Nur Links auf GitHub, nie ein beliebiges Schema (javascript: …).
    url: url.startsWith('https://github.com/') ? url : '',
    publishedAt: typeof raw.published_at === 'string' ? raw.published_at : null,
    body: typeof raw.body === 'string' ? raw.body.slice(0, MAX_BODY) : '',
  };
}

export class UpdateService {
  private releases: UpdateRelease[] = [];
  private checkedAt: Date | null = null;
  private error: string | null = null;
  private nextCheck = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      config: UpdateConfig;
      audit: AuditLog;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  get mode(): UpdateMode {
    const { config } = this.deps;
    if (!config.checkEnabled) return 'disabled';
    return config.selfUpdate ? 'self' : 'manual';
  }

  /** Fragt GitHub höchstens einmal pro Stunde, außer `force` (Knopf „Jetzt prüfen“). */
  private async refresh(force: boolean): Promise<void> {
    if (this.mode === 'disabled') return;
    if (!force && this.now < this.nextCheck) return;
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  private async load(): Promise<void> {
    const { config } = this.deps;
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(
        `https://api.github.com/repos/${config.repo}/releases?per_page=${MAX_RELEASES}`,
        {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'ultimate-dash' },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub begrenzt die Anfragen gerade. Bitte später erneut prüfen.');
      }
      if (res.status === 404) {
        throw new Error('Das Repository oder seine Veröffentlichungen wurden nicht gefunden.');
      }
      if (!res.ok) throw new Error(`GitHub antwortete mit Status ${res.status}.`);
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error('Unerwartete Antwort von GitHub.');
      this.releases = data
        .map((entry) => toRelease(entry as GithubRelease))
        .filter((release): release is UpdateRelease => release !== null)
        .sort((a, b) => compareVersions(b.version, a.version));
      this.error = null;
      this.checkedAt = new Date(this.now);
      this.nextCheck = this.now + CACHE_MS;
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'GitHub antwortet nicht.'
          : error instanceof Error
            ? error.message
            : 'Unbekannter Fehler';
      this.error = `Prüfung fehlgeschlagen: ${reason}`;
      this.nextCheck = this.now + RETRY_MS;
    }
  }

  private progress(): UpdateProgress | null {
    const self = this.deps.config.selfUpdate;
    if (!self) return null;
    if (existsSync(self.requestFile)) {
      const version = this.readSmall(self.requestFile).trim();
      return { state: 'queued', version, message: 'Update wartet auf den Start', at: null };
    }
    const raw = this.readSmall(self.statusFile);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as Partial<UpdateProgress>;
      if (
        typeof data.version === 'string' &&
        (data.state === 'running' || data.state === 'ok' || data.state === 'failed')
      ) {
        return {
          state: data.state,
          version: data.version,
          message: typeof data.message === 'string' ? data.message.slice(0, 500) : '',
          at: typeof data.at === 'string' ? data.at : null,
        };
      }
    } catch {
      // beschädigte Statusdatei = kein Status
    }
    return null;
  }

  private readSmall(file: string): string {
    try {
      return readFileSync(file, 'utf8').slice(0, 2000);
    } catch {
      return '';
    }
  }

  async status(force = false): Promise<UpdateStatus> {
    await this.refresh(force);
    const { config } = this.deps;
    const newer = this.releases.filter((r) => compareVersions(r.version, config.version) > 0);
    const progress = this.progress();
    return {
      currentVersion: config.version,
      mode: this.mode,
      checkedAt: this.checkedAt?.toISOString() ?? null,
      error: this.error,
      updateAvailable: newer.length > 0,
      latest: newer[0] ?? this.releases[0] ?? null,
      releases: newer,
      // Ein erfolgreiches Update steht schon in der Versionsnummer, nur Fehlschläge bleiben sichtbar.
      progress: progress && progress.state === 'ok' ? null : progress,
      manualHint:
        this.mode === 'manual'
          ? 'Docker: `git pull && docker compose up -d --build` im Ordner mit der docker-compose.yml. Installationsskript: `sudo ./install.sh update` und einmalig `sudo ./install.sh repair`, damit Updates aus der Oberfläche möglich werden.'
          : null,
    };
  }

  /** Legt die Anfrage ab; der Update-Dienst (root) führt sie aus. Nur die geprüfte Version wird akzeptiert. */
  async install(input: UpdateInstallInput, user: User): Promise<UpdateStatus> {
    const self = this.deps.config.selfUpdate;
    if (!self || this.mode !== 'self') {
      throw new UpdateError(
        'Installation aus der Oberfläche ist hier nicht eingerichtet (nur mit install.sh).',
        'unavailable',
      );
    }
    const requested = normalizeVersion(input.version);
    if (!requested) throw new UpdateError('Ungültige Versionsnummer', 'invalid');

    const status = await this.status(true);
    if (this.error) throw new UpdateError(this.error, 'unavailable');
    // Nur die aktuell neueste, geprüfte Veröffentlichung – nie eine frei gewählte Version.
    if (!status.updateAvailable || status.latest?.version !== requested) {
      throw new UpdateError(
        'Diese Version ist nicht (mehr) die neueste. Bitte das Änderungsprotokoll neu laden und bestätigen.',
        'invalid',
      );
    }
    const current = status.progress;
    if (current && (current.state === 'queued' || current.state === 'running')) {
      throw new UpdateError('Es läuft bereits ein Update.', 'busy');
    }

    try {
      mkdirSync(dirname(self.requestFile), { recursive: true });
      writeFileSync(self.requestFile, `v${requested}\n`, { mode: 0o640 });
    } catch (error) {
      this.deps.audit.record({
        user,
        action: 'update.install',
        target: requested,
        ok: false,
        error: (error as Error).message,
      });
      throw new UpdateError(
        'Die Update-Anfrage konnte nicht geschrieben werden. Prüfe die Rechte am Datenordner.',
        'unavailable',
      );
    }
    this.deps.audit.record({
      user,
      action: 'update.install',
      target: requested,
      details: { from: this.deps.config.version },
      ok: true,
    });
    return this.status();
  }
}
