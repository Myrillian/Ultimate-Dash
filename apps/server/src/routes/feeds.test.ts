import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { defaultFeeds, type Feed, type FeedItemsPage } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder,
  webRoot: null,
  statusIntervalSeconds: 60,
  feedIntervalMinutes: 30,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
};
const PASSWORD = 'ein-langes-passwort';
const FEED_URL = 'https://news.example.org/feed.xml';

const recent = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toUTCString();
const feedXml = () => `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Beispiel-News</title>
  <item><title>Neu</title><link>https://news.example.org/1</link><guid>1</guid>
    <pubDate>${recent(1)}</pubDate><media:thumbnail url="https://news.example.org/1.jpg"/></item>
  <item><title>Älter</title><link>https://news.example.org/2</link><guid>2</guid>
    <pubDate>${recent(5)}</pubDate></item>
  <item><title>Uralt</title><link>https://news.example.org/3</link><guid>3</guid>
    <pubDate>${recent(24 * 60)}</pubDate></item>
</channel></rss>`;

let requests: string[] = [];
const fakeFetch = (async (input: string | URL) => {
  const url = String(input);
  requests.push(url);
  if (url === FEED_URL) return new Response(feedXml(), { headers: { etag: '"v1"' } });
  if (url.endsWith('1.jpg'))
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      headers: { 'content-type': 'image/jpeg' },
    });
  if (url.endsWith('.svg'))
    return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
  return new Response('nicht da', { status: 404 });
}) as typeof fetch;

let ctx: Awaited<ReturnType<typeof buildApp>>;
let admin = '';
let viewer = '';

const call = (
  as: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
) => ctx.app.inject({ method, url, payload, headers: { cookie: as } });

beforeEach(async () => {
  requests = [];
  ctx = await buildApp(config, { logger: false, startMonitor: false, feedFetch: fakeFetch });
  const setup = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'admin', password: PASSWORD },
  });
  admin = String(setup.headers['set-cookie']).split(';')[0]!;
  await call(admin, 'POST', '/api/users', { username: 'gast', password: PASSWORD });
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'gast', password: PASSWORD },
  });
  viewer = String(login.headers['set-cookie']).split(';')[0]!;
});
afterEach(async () => {
  await ctx.app.close();
});

const listFeeds = async () => (await call(admin, 'GET', '/api/feeds')).json<Feed[]>();
const addFeed = () =>
  call(admin, 'POST', '/api/feeds', { name: 'Beispiel', url: FEED_URL, topic: 'IT' });

describe('RSS-Feeds', () => {
  it('trägt beim ersten Start die Standardfeeds ein', async () => {
    const feeds = await listFeeds();
    expect(feeds).toHaveLength(defaultFeeds.length);
    expect(new Set(feeds.map((feed) => feed.topic))).toEqual(
      new Set(['Security', 'Smart-Home', 'Netzwerk', 'IT']),
    );
  });

  it('legt einen Feed an, ruft ihn sofort ab und lässt zu alte Meldungen weg', async () => {
    const created = await addFeed();
    expect(created.statusCode).toBe(201);
    expect(created.json<Feed>()).toMatchObject({ itemCount: 2, lastError: null });

    const page = (await call(viewer, 'GET', '/api/feeds/items?topic=IT')).json<FeedItemsPage>();
    expect(page.items.map((item) => item.title)).toEqual(['Neu', 'Älter']);
    expect(page.items[0]).toMatchObject({ feedName: 'Beispiel', hasImage: true });
    expect(page.items[1]!.hasImage).toBe(false);
    expect(page.topics).toEqual(['Security', 'Smart-Home', 'Netzwerk', 'IT']);

    const more = (
      await call(
        viewer,
        'GET',
        `/api/feeds/items?topic=IT&before=${encodeURIComponent(page.items[0]!.publishedAt)}`,
      )
    ).json<FeedItemsPage>();
    expect(more.items.map((item) => item.title)).toEqual(['Älter']);
  });

  it('liefert Vorschaubilder über den Server, aber kein SVG', async () => {
    await addFeed();
    const [item] = (await call(viewer, 'GET', '/api/feeds/items?topic=IT')).json<FeedItemsPage>()
      .items;
    const image = await call(viewer, 'GET', `/api/feeds/images/${item!.id}`);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['content-security-policy']).toContain("default-src 'none'");
    // Zweiter Aufruf kommt aus dem Cache.
    await call(viewer, 'GET', `/api/feeds/images/${item!.id}`);
    expect(requests.filter((url) => url.endsWith('1.jpg'))).toHaveLength(1);

    const noImage = (await call(viewer, 'GET', '/api/feeds/items?topic=IT')).json<FeedItemsPage>()
      .items[1]!;
    expect((await call(viewer, 'GET', `/api/feeds/images/${noImage.id}`)).statusCode).toBe(404);
  });

  it('merkt sich Abruffehler und lehnt doppelte Adressen ab', async () => {
    const broken = await call(admin, 'POST', '/api/feeds', {
      name: 'Kaputt',
      url: 'https://news.example.org/fehlt.xml',
      topic: 'IT',
    });
    expect(broken.json<Feed>()).toMatchObject({ lastError: 'HTTP 404', itemCount: 0 });
    await addFeed();
    expect((await addFeed()).statusCode).toBe(400);
  });

  it('prüft eine Adresse vorab', async () => {
    const preview = await call(admin, 'POST', '/api/feeds/preview', { url: FEED_URL });
    expect(preview.json().title).toBe('Beispiel-News');
    expect(preview.json().items[0].title).toBe('Neu');
    const bad = await call(admin, 'POST', '/api/feeds/preview', {
      url: 'https://news.example.org/fehlt.xml',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('Feed nicht lesbar: HTTP 404');
  });

  it('blendet deaktivierte Feeds aus und stellt gelöschte Standardfeeds wieder her', async () => {
    const created = (await addFeed()).json<Feed>();
    await call(admin, 'PUT', `/api/feeds/${created.id}`, { enabled: false });
    const page = (await call(viewer, 'GET', '/api/feeds/items?topic=IT')).json<FeedItemsPage>();
    expect(page.items).toHaveLength(0);

    const first = (await listFeeds())[0]!;
    expect((await call(admin, 'DELETE', `/api/feeds/${first.id}`)).statusCode).toBe(204);
    const restored = await call(admin, 'POST', '/api/feeds/defaults');
    expect(restored.json()).toEqual({ added: 1 });
  });

  it('erlaubt die Verwaltung nur Admins', async () => {
    expect(
      (await call(viewer, 'POST', '/api/feeds', { name: 'x', url: FEED_URL, topic: 'IT' }))
        .statusCode,
    ).toBe(403);
    expect((await call(viewer, 'POST', '/api/feeds/preview', { url: FEED_URL })).statusCode).toBe(
      403,
    );
    expect(requests).toHaveLength(0);
  });
});
