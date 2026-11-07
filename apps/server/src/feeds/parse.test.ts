import { describe, expect, it } from 'vitest';
import { parseFeed, plainText } from './parse.js';

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Beispiel &amp; Co</title>
    <link>https://example.org/</link>
    <item>
      <title>Neue Lücke in &lt;b&gt;OpenSSL&lt;/b&gt;</title>
      <link>https://example.org/a</link>
      <guid isPermaLink="false">a-1</guid>
      <pubDate>Fri, 06 Nov 2026 18:28:41 +0000</pubDate>
      <description><![CDATA[<p>Kurz <strong>erklärt</strong> &hellip;</p><img src="/pixel.gif" width="1" height="1">]]></description>
      <media:thumbnail url="https://example.org/a.jpg" />
    </item>
    <item>
      <title>2026.11</title>
      <link>/relativ</link>
      <content:encoded><![CDATA[<img src="https://example.org/track.gif" width="1" height="1"><img src="https://example.org/b.png" width="600">Text]]></content:encoded>
    </item>
    <item>
      <title>Mit Enclosure</title>
      <link>https://example.org/c</link>
      <enclosure url="https://example.org/c.webp" type="image/webp" length="1" />
    </item>
    <item><title>Ohne Link</title></item>
    <item><title>Böser Link</title><link>javascript:alert(1)</link></item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom-Blog</title>
  <link href="https://blog.example.com/" rel="alternate" />
  <link href="https://blog.example.com/atom.xml" rel="self" />
  <entry>
    <title>Release 1.2</title>
    <id>tag:example,2026:1</id>
    <link rel="alternate" href="https://blog.example.com/1-2" />
    <updated>2026-11-04T10:00:00Z</updated>
    <content type="html">&lt;p&gt;Hallo&lt;/p&gt;&lt;img src="https://blog.example.com/x.jpg"&gt;</content>
  </entry>
</feed>`;

const rdf = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example.net/"><title>RDF</title><link>https://rdf.example.net/</link></channel>
  <item rdf:about="https://rdf.example.net/1">
    <title>Erster</title><link>https://rdf.example.net/1</link><dc:date>2026-11-01T08:00:00+01:00</dc:date>
  </item>
</rdf:RDF>`;

describe('parseFeed', () => {
  it('liest RSS 2.0 mit Bildern, Text und relativen Links', () => {
    const feed = parseFeed(rss, 'https://example.org/feed');
    expect(feed.title).toBe('Beispiel & Co');
    expect(feed.items).toHaveLength(3);
    expect(feed.items[0]).toEqual({
      guid: 'a-1',
      title: 'Neue Lücke in OpenSSL',
      link: 'https://example.org/a',
      summary: 'Kurz erklärt …',
      imageUrl: 'https://example.org/a.jpg',
      publishedAt: '2026-11-06T18:28:41.000Z',
    });
    // Zahlen-Titel bleiben Text, Zählpixel werden übersprungen.
    expect(feed.items[1]).toMatchObject({
      title: '2026.11',
      link: 'https://example.org/relativ',
      imageUrl: 'https://example.org/b.png',
      publishedAt: null,
    });
    expect(feed.items[2]!.imageUrl).toBe('https://example.org/c.webp');
  });

  it('verwirft Meldungen ohne Link oder mit javascript:-Link', () => {
    const titles = parseFeed(rss, 'https://example.org/feed').items.map((item) => item.title);
    expect(titles).not.toContain('Ohne Link');
    expect(titles).not.toContain('Böser Link');
  });

  it('liest Atom', () => {
    const feed = parseFeed(atom, 'https://blog.example.com/atom.xml');
    expect(feed.title).toBe('Atom-Blog');
    expect(feed.items).toEqual([
      {
        guid: 'tag:example,2026:1',
        title: 'Release 1.2',
        link: 'https://blog.example.com/1-2',
        summary: 'Hallo',
        imageUrl: 'https://blog.example.com/x.jpg',
        publishedAt: '2026-11-04T10:00:00.000Z',
      },
    ]);
  });

  it('liest RSS 1.0 (RDF)', () => {
    const feed = parseFeed(rdf, 'https://rdf.example.net/rss');
    expect(feed.title).toBe('RDF');
    expect(feed.items[0]).toMatchObject({
      title: 'Erster',
      guid: 'https://rdf.example.net/1',
      publishedAt: '2026-11-01T07:00:00.000Z',
    });
  });

  it('meldet Dateien, die kein Feed sind', () => {
    expect(() => parseFeed('<html><body>Hallo</body></html>', 'https://x.example')).toThrow(
      'Kein RSS- oder Atom-Feed',
    );
  });
});

describe('plainText', () => {
  it('entfernt HTML und löst Entities auf', () => {
    expect(plainText('<p>A&nbsp;&amp;&#x20AC;<script>x()</script> B</p>')).toBe('A &€ B');
  });
});
