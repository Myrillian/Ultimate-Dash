import { XMLParser } from 'fast-xml-parser';

export interface ParsedItem {
  guid: string;
  title: string;
  link: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

export interface ParsedFeed {
  title: string | null;
  items: ParsedItem[];
}

export class FeedParseError extends Error {}

const MAX_ITEMS = 100;
const SUMMARY_LENGTH = 280;

/** Elemente, die mehrfach vorkommen können, immer als Liste lesen. */
const ARRAY_TAGS = new Set([
  'item',
  'entry',
  'link',
  'media:content',
  'media:thumbnail',
  'media:group',
  'enclosure',
  'category',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Zahlen und true/false als Text lassen (Titel wie „2026.11“ sollen nicht zu 2026.11 werden).
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;

const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** Textinhalt eines Elements, egal ob schlicht, mit Attributen oder als Liste. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return text((value as Node)['#text']);
  return null;
}

const attr = (value: unknown, name: string): string | null =>
  value && typeof value === 'object' ? text((value as Node)[`@_${name}`]) : null;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : +code.slice(1);
      return Number.isFinite(point) && point > 0 && point < 0x110000
        ? String.fromCodePoint(point)
        : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** HTML zu schlichtem Text: Tags weg, Entities auflösen, Leerraum zusammenziehen. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      // Manche Feeds kodieren HTML doppelt (&lt;p&gt;).
      .replace(/&lt;[^&]*?&gt;/g, ' '),
  )
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  const cut = value.slice(0, length);
  const space = cut.lastIndexOf(' ');
  return `${(space > length * 0.6 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

/** Nur absolute http(s)-Adressen; relative werden gegen die Basis aufgelöst. */
function httpUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Erstes <img> im HTML-Inhalt, ohne winzige Zählpixel. */
function firstImage(html: string | null): string | null {
  if (!html) return null;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src || src.startsWith('data:')) continue;
    const width = Number(/\swidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? NaN);
    const height = Number(/\sheight\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? NaN);
    if (width <= 2 || height <= 2) continue;
    return src;
  }
  return null;
}

const isImageType = (type: string | null) => !type || type.startsWith('image/');

/** Bild aus Media-RSS, Enclosure oder dem Inhalt. */
function imageFrom(node: Node, html: (string | null)[]): string | null {
  const groups = asArray(node['media:group']).filter((g): g is Node => typeof g === 'object');
  const holders = [node, ...groups];
  for (const holder of holders) {
    for (const thumb of asArray(holder['media:thumbnail'])) {
      const url = attr(thumb, 'url');
      if (url) return url;
    }
  }
  for (const holder of holders) {
    for (const content of asArray(holder['media:content'])) {
      const url = attr(content, 'url');
      const medium = attr(content, 'medium');
      const type = attr(content, 'type');
      if (url && (medium === 'image' || (medium === null && isImageType(type)))) {
        if (type === null && medium === null && !/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url))
          continue;
        return url;
      }
    }
  }
  for (const enclosure of asArray(node.enclosure)) {
    const url = attr(enclosure, 'url');
    if (url && attr(enclosure, 'type')?.startsWith('image/')) return url;
  }
  for (const link of asArray(node.link)) {
    if (attr(link, 'rel') === 'enclosure' && attr(link, 'type')?.startsWith('image/'))
      return attr(link, 'href');
  }
  for (const value of html) {
    const found = firstImage(value);
    if (found) return found;
  }
  return null;
}

function atomLink(node: Node): string | null {
  const links = asArray(node.link);
  const alternate =
    links.find((link) => {
      const rel = attr(link, 'rel');
      return rel === null || rel === 'alternate';
    }) ?? links[0];
  return attr(alternate, 'href') ?? text(alternate);
}

function buildItem(
  raw: {
    guid: string | null;
    title: string | null;
    link: string | null;
    html: (string | null)[];
    date: string | null;
    node: Node;
  },
  base: string,
): ParsedItem | null {
  const link = httpUrl(raw.link, base) ?? httpUrl(raw.guid, base);
  const title = raw.title ? plainText(raw.title) : '';
  if (!link || !title) return null;
  const body = raw.html.find((value) => value && plainText(value));
  const summary = body ? truncate(plainText(body), SUMMARY_LENGTH) : null;
  return {
    guid: (raw.guid ?? link).slice(0, 500),
    title: truncate(title, 300),
    link,
    summary: summary && summary !== title ? summary : null,
    imageUrl: httpUrl(imageFrom(raw.node, raw.html), link),
    publishedAt: isoDate(raw.date),
  };
}

/** Liest RSS 2.0, RSS 1.0 (RDF) und Atom. `base` ist die Adresse des Feeds. */
export function parseFeed(xml: string, base: string): ParsedFeed {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (error) {
    throw new FeedParseError(`Kein gültiges XML: ${(error as Error).message}`);
  }

  const items: ParsedItem[] = [];
  let title: string | null = null;

  const rss = doc.rss as Node | undefined;
  const rdf = doc['rdf:RDF'] as Node | undefined;
  const atom = doc.feed as Node | undefined;

  if (rss || rdf) {
    const channel = (asArray((rss ?? rdf)!.channel)[0] ?? {}) as Node;
    title = text(channel.title);
    const siteLink = httpUrl(text(asArray(channel.link)[0]), base) ?? base;
    const rawItems = asArray(rss ? channel.item : (rdf!.item ?? channel.item));
    for (const entry of rawItems.slice(0, MAX_ITEMS)) {
      if (!entry || typeof entry !== 'object') continue;
      const node = entry as Node;
      const guid = text(node.guid) ?? attr(node, 'rdf:about');
      const item = buildItem(
        {
          guid,
          title: text(node.title),
          link: text(asArray(node.link)[0]) ?? attr(asArray(node.link)[0], 'href'),
          html: [text(node.description), text(node['content:encoded'])],
          date: text(node.pubDate) ?? text(node['dc:date']) ?? text(node.published),
          node,
        },
        siteLink,
      );
      if (item) items.push(item);
    }
  } else if (atom) {
    title = text(atom.title);
    const siteLink = httpUrl(atomLink(atom), base) ?? base;
    for (const entry of asArray(atom.entry).slice(0, MAX_ITEMS)) {
      if (!entry || typeof entry !== 'object') continue;
      const node = entry as Node;
      const item = buildItem(
        {
          guid: text(node.id),
          title: text(node.title),
          link: atomLink(node),
          html: [text(node.summary), text(node.content)],
          date: text(node.published) ?? text(node.updated),
          node,
        },
        siteLink,
      );
      if (item) items.push(item);
    }
  } else {
    throw new FeedParseError('Kein RSS- oder Atom-Feed');
  }

  return { title: title ? plainText(title) : null, items };
}
