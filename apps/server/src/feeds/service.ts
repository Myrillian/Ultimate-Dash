import { and, asc, count, desc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  defaultFeeds,
  feedInput,
  feedItemsQuery,
  feedUpdate,
  sortTopics,
  type Feed,
  type FeedItem,
  type FeedItemsPage,
  type FeedPreview,
  type User,
} from '@ultimate-dash/shared';
import type { Db } from '../db/client.js';
import type { createAuditLog } from '../db/audit.js';
import { NotFoundError, ValidationError } from '../db/repository.js';
import { feedItems, feeds, settings } from '../db/schema.js';
import type { EventHub } from '../events.js';
import { describeError } from '../status/check.js';
import { FeedParseError, parseFeed, type ParsedFeed } from './parse.js';

type Audit = ReturnType<typeof createAuditLog>;
type FeedRow = typeof feeds.$inferSelect;

const USER_AGENT = 'UltimateDash-Feeds/1.0 (+https://github.com/myrillian/ultimate-dash)';
const MAX_FEED_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_CACHE_BYTES = 40 * 1024 * 1024;
/** Meldungen pro Feed und wie lange sie aufbewahrt werden. */
const KEEP_PER_FEED = 100;
const KEEP_DAYS = 14;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const SEEDED_KEY = 'feeds.seeded';

export interface FeedServiceOptions {
  db: Db;
  audit: Audit;
  events: EventHub;
  /** Abstand zwischen zwei Abrufen desselben Feeds. */
  intervalMs: number;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
  onError?: (error: unknown) => void;
}

export interface CachedImage {
  type: string;
  body: Buffer;
}

class FetchError extends Error {}

/** Liest einen Antwortkörper, bricht aber ab, sobald er zu groß wird. */
async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new FetchError('Antwort zu groß');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new FetchError('Antwort zu groß');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Zeichensatz aus Content-Type oder XML-Deklaration, sonst UTF-8. */
function decodeXml(body: Buffer, contentType: string | null): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
    /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(body.subarray(0, 200).toString('latin1'))?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** Ruft Feeds regelmäßig ab, speichert die Meldungen und liefert Vorschaubilder aus. */
export class FeedService {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private images = new Map<number, CachedImage>();
  private imageBytes = 0;
  private imageLoads = new Map<number, Promise<CachedImage | null>>();

  constructor(private readonly options: FeedServiceOptions) {}

  private get db() {
    return this.options.db;
  }

  /** Trägt beim allerersten Start die Standardfeeds ein (danach nie wieder automatisch). */
  seedDefaults(): void {
    const seeded = this.db.select().from(settings).where(eq(settings.key, SEEDED_KEY)).get();
    if (seeded) return;
    this.db.transaction((tx) => {
      this.insertDefaults(tx as unknown as Db);
      tx.insert(settings).values({ key: SEEDED_KEY, value: true }).run();
    });
  }

  private insertDefaults(db: Db): number {
    const existing = new Set(
      db
        .select({ url: feeds.url })
        .from(feeds)
        .all()
        .map((row) => row.url),
    );
    const missing = defaultFeeds.filter((feed) => !existing.has(feed.url));
    if (missing.length > 0) {
      const base = this.nextSortOrder(db);
      db.insert(feeds)
        .values(missing.map((feed, index) => ({ ...feed, sortOrder: base + index })))
        .run();
    }
    return missing.length;
  }

  private nextSortOrder(db: Db = this.db): number {
    const row = db
      .select({ max: sql<number | null>`max(${feeds.sortOrder})` })
      .from(feeds)
      .get();
    return (row?.max ?? -1) + 1;
  }

  start(): void {
    if (this.timer) return;
    // Erster Durchlauf kurz nach dem Start, danach jede Minute fällige Feeds abrufen.
    const first = setTimeout(() => void this.runDue(), 5_000);
    first.unref();
    this.timer = setInterval(() => void this.runDue(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ruft alle fälligen Feeds ab; überlappende Durchläufe werden zusammengelegt. */
  runDue(): Promise<void> {
    this.running ??= this.doRunDue().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRunDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = this.db
      .select()
      .from(feeds)
      .where(
        and(eq(feeds.enabled, true), or(isNull(feeds.nextFetchAt), lte(feeds.nextFetchAt, now))),
      )
      .orderBy(asc(feeds.nextFetchAt))
      .all();
    let added = 0;
    const queue = [...due];
    const workers = Array.from({ length: this.options.concurrency ?? 4 }, async () => {
      for (let feed = queue.shift(); feed; feed = queue.shift()) {
        try {
          added += await this.fetchFeed(feed);
        } catch (error) {
          this.options.onError?.(error);
        }
      }
    });
    await Promise.all(workers);
    if (due.length > 0) this.prune();
    if (added > 0) this.options.events.publish({ type: 'feeds-changed' });
  }

  private async download(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    return fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      headers: {
        'user-agent': USER_AGENT,
        accept:
          'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        ...headers,
      },
    });
  }

  private async load(
    url: string,
    conditional?: Pick<FeedRow, 'etag' | 'lastModified'>,
  ): Promise<{ parsed: ParsedFeed | null; etag: string | null; lastModified: string | null }> {
    const headers: Record<string, string> = {};
    if (conditional?.etag) headers['if-none-match'] = conditional.etag;
    if (conditional?.lastModified) headers['if-modified-since'] = conditional.lastModified;
    let response: Response;
    try {
      response = await this.download(url, headers);
    } catch (error) {
      throw new FetchError(describeError(error));
    }
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      return {
        parsed: null,
        etag: conditional?.etag ?? null,
        lastModified: conditional?.lastModified ?? null,
      };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchError(`HTTP ${response.status}`);
    }
    const xml = decodeXml(
      await readLimited(response, MAX_FEED_BYTES),
      response.headers.get('content-type'),
    );
    try {
      return {
        parsed: parseFeed(xml, response.url || url),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    } catch (error) {
      if (error instanceof FeedParseError) throw new FetchError(error.message);
      throw error;
    }
  }

  /** Ruft einen Feed ab und speichert neue Meldungen; liefert die Zahl neuer Meldungen. */
  async fetchFeed(feed: FeedRow): Promise<number> {
    const now = new Date();
    try {
      const { parsed, etag, lastModified } = await this.load(feed.url, feed);
      let added = 0;
      if (parsed) {
        const fetchedAt = now.toISOString();
        const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const rows = parsed.items.map((item) => ({
          feedId: feed.id,
          guid: item.guid,
          title: item.title,
          link: item.link,
          summary: item.summary,
          imageUrl: item.imageUrl,
          // Ohne Datum gilt der Abrufzeitpunkt; Zeiten in der Zukunft werden gekappt.
          publishedAt:
            item.publishedAt && item.publishedAt < fetchedAt ? item.publishedAt : fetchedAt,
          fetchedAt,
        }));
        this.db.transaction((tx) => {
          // Zu alte Meldungen gar nicht erst speichern, sonst kämen sie nach jedem Aufräumen „neu“ zurück.
          for (const row of rows.filter((entry) => entry.publishedAt >= cutoff)) {
            const result = tx
              .insert(feedItems)
              .values(row)
              .onConflictDoUpdate({
                target: [feedItems.feedId, feedItems.guid],
                set: {
                  title: row.title,
                  link: row.link,
                  summary: row.summary,
                  imageUrl: row.imageUrl,
                },
              })
              .returning({ fetchedAt: feedItems.fetchedAt })
              .get();
            if (result?.fetchedAt === fetchedAt) added++;
          }
        });
      }
      this.db
        .update(feeds)
        .set({
          etag,
          lastModified,
          lastFetchedAt: now.toISOString(),
          lastError: null,
          failures: 0,
          nextFetchAt: new Date(now.getTime() + this.options.intervalMs).toISOString(),
        })
        .where(eq(feeds.id, feed.id))
        .run();
      return added;
    } catch (error) {
      if (!(error instanceof FetchError)) throw error;
      const failures = feed.failures + 1;
      const delay = Math.min(
        this.options.intervalMs * 2 ** Math.min(failures - 1, 6),
        MAX_BACKOFF_MS,
      );
      this.db
        .update(feeds)
        .set({
          lastFetchedAt: now.toISOString(),
          lastError: error.message,
          failures,
          nextFetchAt: new Date(now.getTime() + delay).toISOString(),
        })
        .where(eq(feeds.id, feed.id))
        .run();
      return 0;
    }
  }

  /** Alte Meldungen entfernen: älter als 14 Tage oder über 100 pro Feed. */
  prune(): void {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.db.delete(feedItems).where(lt(feedItems.publishedAt, cutoff)).run();
    this.db.run(sql`
      DELETE FROM feed_items WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY feed_id ORDER BY published_at DESC) AS n
          FROM feed_items
        ) WHERE n > ${KEEP_PER_FEED}
      )`);
  }

  /** Prüft eine Adresse, ohne etwas zu speichern (für „Feed hinzufügen“). */
  async preview(url: string): Promise<FeedPreview> {
    try {
      const { parsed } = await this.load(url);
      return {
        title: parsed?.title ?? null,
        items: (parsed?.items ?? [])
          .slice(0, 5)
          .map((item) => ({ title: item.title, publishedAt: item.publishedAt })),
      };
    } catch (error) {
      if (error instanceof FetchError)
        throw new ValidationError(`Feed nicht lesbar: ${error.message}`);
      throw error;
    }
  }

  list(): Feed[] {
    const counts = new Map(
      this.db
        .select({ feedId: feedItems.feedId, n: count() })
        .from(feedItems)
        .groupBy(feedItems.feedId)
        .all()
        .map((row) => [row.feedId, row.n]),
    );
    return this.db
      .select()
      .from(feeds)
      .orderBy(asc(feeds.sortOrder), asc(feeds.id))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        topic: row.topic,
        enabled: row.enabled,
        lastFetchedAt: row.lastFetchedAt,
        lastError: row.lastError,
        itemCount: counts.get(row.id) ?? 0,
      }));
  }

  private get(id: number): FeedRow {
    const row = this.db.select().from(feeds).where(eq(feeds.id, id)).get();
    if (!row) throw new NotFoundError('Feed');
    return row;
  }

  private assertUniqueUrl(url: string, exceptId?: number) {
    const other = this.db.select({ id: feeds.id }).from(feeds).where(eq(feeds.url, url)).get();
    if (other && other.id !== exceptId)
      throw new ValidationError('Dieser Feed ist schon eingetragen');
  }

  private find(id: number): Feed {
    return this.list().find((feed) => feed.id === id)!;
  }

  async create(body: unknown, user: User): Promise<Feed> {
    const input = feedInput.parse(body);
    this.assertUniqueUrl(input.url);
    const row = this.db
      .insert(feeds)
      .values({ ...input, sortOrder: this.nextSortOrder() })
      .returning()
      .get();
    this.options.audit.record({ user, action: 'feeds.create', target: input.name, ok: true });
    await this.refresh(row.id);
    return this.find(row.id);
  }

  async update(id: number, body: unknown, user: User): Promise<Feed> {
    const input = feedUpdate.parse(body);
    const before = this.get(id);
    if (input.url) this.assertUniqueUrl(input.url, id);
    const urlChanged = input.url !== undefined && input.url !== before.url;
    this.db
      .update(feeds)
      .set({
        ...input,
        // Neue Adresse: frisch abrufen, ohne Bedingungen der alten.
        ...(urlChanged ? { etag: null, lastModified: null, nextFetchAt: null, failures: 0 } : {}),
      })
      .where(eq(feeds.id, id))
      .run();
    if (urlChanged) this.db.delete(feedItems).where(eq(feedItems.feedId, id)).run();
    this.options.audit.record({
      user,
      action: 'feeds.update',
      target: input.name ?? before.name,
      details: input as Record<string, unknown>,
      ok: true,
    });
    if (urlChanged || (input.enabled === true && !before.enabled)) await this.refresh(id);
    else this.options.events.publish({ type: 'feeds-changed' });
    return this.find(id);
  }

  delete(id: number, user: User): void {
    const row = this.get(id);
    this.db.delete(feeds).where(eq(feeds.id, id)).run();
    this.options.audit.record({ user, action: 'feeds.delete', target: row.name, ok: true });
    this.options.events.publish({ type: 'feeds-changed' });
  }

  /** Feed sofort abrufen (Button „Jetzt abrufen“ und nach dem Anlegen). */
  async refresh(id: number): Promise<Feed> {
    await this.fetchFeed(this.get(id));
    this.options.events.publish({ type: 'feeds-changed' });
    return this.find(id);
  }

  /** Fehlende Standardfeeds wieder anlegen. */
  async restoreDefaults(user: User): Promise<{ added: number }> {
    const added = this.insertDefaults(this.db);
    this.options.audit.record({
      user,
      action: 'feeds.defaults',
      details: { added },
      ok: true,
    });
    if (added > 0) void this.runDue();
    return { added };
  }

  items(query: unknown): FeedItemsPage {
    const { topic, before, limit } = feedItemsQuery.parse(query);
    const conditions = [eq(feeds.enabled, true)];
    if (topic) conditions.push(eq(feeds.topic, topic));
    if (before) conditions.push(lt(feedItems.publishedAt, before));
    const rows = this.db
      .select({
        id: feedItems.id,
        feedId: feedItems.feedId,
        feedName: feeds.name,
        topic: feeds.topic,
        title: feedItems.title,
        link: feedItems.link,
        summary: feedItems.summary,
        publishedAt: feedItems.publishedAt,
        fetchedAt: feedItems.fetchedAt,
        imageUrl: feedItems.imageUrl,
      })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .where(and(...conditions))
      .orderBy(desc(feedItems.publishedAt), desc(feedItems.id))
      .limit(limit)
      .all();
    const topics = this.db
      .selectDistinct({ topic: feeds.topic })
      .from(feeds)
      .where(eq(feeds.enabled, true))
      .all()
      .map((row) => row.topic);
    return {
      items: rows.map(({ imageUrl, ...row }): FeedItem => ({ ...row, hasImage: !!imageUrl })),
      topics: sortTopics(topics),
    };
  }

  /** Vorschaubild einer Meldung; wird nur für gespeicherte Meldungen geladen und im Speicher gehalten. */
  async image(itemId: number): Promise<CachedImage | null> {
    const cached = this.images.get(itemId);
    if (cached) {
      // Als zuletzt benutzt ans Ende stellen.
      this.images.delete(itemId);
      this.images.set(itemId, cached);
      return cached;
    }
    let pending = this.imageLoads.get(itemId);
    if (!pending) {
      pending = this.loadImage(itemId).finally(() => this.imageLoads.delete(itemId));
      this.imageLoads.set(itemId, pending);
    }
    return pending;
  }

  private async loadImage(itemId: number): Promise<CachedImage | null> {
    const row = this.db
      .select({ url: feedItems.imageUrl })
      .from(feedItems)
      .where(eq(feedItems.id, itemId))
      .get();
    if (!row?.url) return null;
    try {
      const response = await this.download(row.url, { accept: 'image/*' });
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      // SVG kann Skripte enthalten und wird deshalb nicht ausgeliefert.
      if (!response.ok || !type.startsWith('image/') || type.includes('svg')) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const image = { type, body: await readLimited(response, MAX_IMAGE_BYTES) };
      this.images.set(itemId, image);
      this.imageBytes += image.body.byteLength;
      for (const [id, old] of this.images) {
        if (this.imageBytes <= IMAGE_CACHE_BYTES) break;
        this.images.delete(id);
        this.imageBytes -= old.body.byteLength;
      }
      return image;
    } catch {
      return null;
    }
  }
}
