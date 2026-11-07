import { z } from 'zod';
import { httpUrl } from './schemas.js';

/** Voreingestellte Themen; Admins können weitere anlegen. */
export const defaultFeedTopics = ['Security', 'Smart-Home', 'Netzwerk', 'IT'] as const;

export const feedInput = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  url: httpUrl.pipe(z.string().max(2000)),
  topic: z.string().trim().min(1, 'Thema fehlt').max(40),
  enabled: z.boolean().default(true),
});
export type FeedInput = z.input<typeof feedInput>;

export const feedUpdate = feedInput.partial();
export type FeedUpdate = z.input<typeof feedUpdate>;

export const feedPreviewInput = z.object({ url: httpUrl.pipe(z.string().max(2000)) });

export const feedItemsQuery = z.object({
  topic: z.string().trim().max(40).optional(),
  /** Nur Meldungen vor diesem Zeitpunkt (zum Nachladen). */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type FeedItemsQuery = z.input<typeof feedItemsQuery>;

/** Ein Feed mit seinem Abrufstatus, wie ihn die Verwaltung zeigt. */
export interface Feed {
  id: number;
  name: string;
  url: string;
  topic: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  /** Fehlermeldung des letzten Abrufs, null wenn er geklappt hat. */
  lastError: string | null;
  itemCount: number;
}

export interface FeedItem {
  id: number;
  feedId: number;
  feedName: string;
  topic: string;
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string;
  /** Wann der Server die Meldung zum ersten Mal gesehen hat (für „neu“). */
  fetchedAt: string;
  /** Vorschaubild über /api/feeds/images/:id abrufbar. */
  hasImage: boolean;
}

export interface FeedItemsPage {
  items: FeedItem[];
  /** Themen mit mindestens einem aktiven Feed, in fester Reihenfolge. */
  topics: string[];
}

export interface FeedPreview {
  title: string | null;
  items: { title: string; publishedAt: string | null }[];
}

export interface DefaultFeed {
  name: string;
  url: string;
  topic: (typeof defaultFeedTopics)[number];
}

/** Beim ersten Start eingetragene Feeds (geprüft am 07.11.2026, siehe docs/06-rss-feeds.md). */
export const defaultFeeds: DefaultFeed[] = [
  // Security
  {
    topic: 'Security',
    name: 'heise Security',
    url: 'https://www.heise.de/security/rss/news-atom.xml',
  },
  {
    topic: 'Security',
    name: 'Golem Security',
    url: 'https://rss.golem.de/rss.php?tp=sec&feed=ATOM1.0',
  },
  { topic: 'Security', name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
  { topic: 'Security', name: 'Schneier on Security', url: 'https://www.schneier.com/feed/atom/' },
  {
    topic: 'Security',
    name: 'The Hacker News',
    url: 'https://feeds.feedburner.com/TheHackersNews',
  },
  { topic: 'Security', name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  { topic: 'Security', name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml' },
  {
    topic: 'Security',
    name: 'SANS Internet Storm Center',
    url: 'https://isc.sans.edu/rssfeed_full.xml',
  },
  { topic: 'Security', name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/' },
  { topic: 'Security', name: 'Troy Hunt', url: 'https://www.troyhunt.com/rss/' },
  // Smart-Home
  {
    topic: 'Smart-Home',
    name: 'Home Assistant Blog',
    url: 'https://www.home-assistant.io/atom.xml',
  },
  { topic: 'Smart-Home', name: 'simon42', url: 'https://www.simon42.com/feed/' },
  { topic: 'Smart-Home', name: 'SmarthomeAssistent', url: 'https://smarthomeassistent.de/feed/' },
  {
    topic: 'Smart-Home',
    name: 'matter-smarthome.de',
    url: 'https://www.matter-smarthome.de/feed/',
  },
  { topic: 'Smart-Home', name: 'SmartDroid', url: 'https://www.smartdroid.de/feed/' },
  {
    topic: 'Smart-Home',
    name: 'Hackaday – Home Hacks',
    url: 'https://hackaday.com/category/home-hacks/feed/',
  },
  { topic: 'Smart-Home', name: 'CNX Software', url: 'https://www.cnx-software.com/feed/' },
  {
    topic: 'Smart-Home',
    name: 'ESPHome Releases',
    url: 'https://github.com/esphome/esphome/releases.atom',
  },
  {
    topic: 'Smart-Home',
    name: 'Zigbee2MQTT Releases',
    url: 'https://github.com/Koenkk/zigbee2mqtt/releases.atom',
  },
  {
    topic: 'Smart-Home',
    name: 'The Verge – Smart Home',
    url: 'https://www.theverge.com/rss/smart-home/index.xml',
  },
  // Netzwerk
  {
    topic: 'Netzwerk',
    name: 'Packet Pushers',
    url: 'https://feeds.packetpushers.net/packetpushersfullfeed',
  },
  { topic: 'Netzwerk', name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/' },
  { topic: 'Netzwerk', name: 'APNIC Blog', url: 'https://blog.apnic.net/feed/' },
  { topic: 'Netzwerk', name: 'RIPE Labs', url: 'https://labs.ripe.net/rss/' },
  { topic: 'Netzwerk', name: 'ipSpace.net', url: 'https://blog.ipspace.net/atom.xml' },
  { topic: 'Netzwerk', name: 'Netgate (pfSense)', url: 'https://www.netgate.com/blog/rss.xml' },
  {
    topic: 'Netzwerk',
    name: 'Technitium Blog',
    url: 'https://blog.technitium.com/feeds/posts/default',
  },
  { topic: 'Netzwerk', name: 'ServeTheHome', url: 'https://www.servethehome.com/feed/' },
  { topic: 'Netzwerk', name: 'Tailscale Blog', url: 'https://tailscale.com/blog/index.xml' },
  { topic: 'Netzwerk', name: 'IP-Insider', url: 'https://www.ip-insider.de/rss/news.xml' },
  // IT
  { topic: 'IT', name: 'heise online', url: 'https://www.heise.de/rss/heise-atom.xml' },
  { topic: 'IT', name: 'Golem.de', url: 'https://rss.golem.de/rss.php?feed=ATOM1.0' },
  { topic: 'IT', name: 'ComputerBase', url: 'https://www.computerbase.de/rss/news.xml' },
  { topic: 'IT', name: 't3n', url: 'https://t3n.de/rss.xml' },
  { topic: 'IT', name: 'Caschys Blog', url: 'https://stadt-bremerhaven.de/feed/' },
  { topic: 'IT', name: 'Borns IT- und Windows-Blog', url: 'https://www.borncity.com/blog/feed/' },
  { topic: 'IT', name: 'LWN.net', url: 'https://lwn.net/headlines/rss' },
  { topic: 'IT', name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { topic: 'IT', name: 'selfh.st', url: 'https://selfh.st/rss/' },
  { topic: 'IT', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

/** Themen in fester Reihenfolge: erst die voreingestellten, dann weitere alphabetisch. */
export function sortTopics(topics: Iterable<string>): string[] {
  const order = defaultFeedTopics as readonly string[];
  return [...new Set(topics)].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b, 'de');
  });
}
