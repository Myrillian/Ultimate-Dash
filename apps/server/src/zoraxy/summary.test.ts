import { describe, expect, it } from 'vitest';
import {
  certCovers,
  hostOf,
  parseCertificates,
  parseHits,
  parseUptime,
  parseVersion,
  summarize,
} from './summary.js';

const now = new Date('2026-11-12T08:00:00Z');

describe('Zoraxy-Auswertung', () => {
  it('zieht den Host aus Adressen', () => {
    expect(hostOf('https://Wiki.Example.org:8443/x')).toBe('wiki.example.org');
    expect(hostOf('wiki.example.org')).toBe('wiki.example.org');
    expect(hostOf('')).toBe('');
  });

  it('prüft Wildcard-Zertifikate nur für eine Ebene', () => {
    expect(certCovers('*.example.org', 'a.example.org')).toBe(true);
    expect(certCovers('*.example.org', 'a.b.example.org')).toBe(false);
    expect(certCovers('*.example.org', 'example.org')).toBe(false);
    expect(certCovers('a.example.org', 'a.example.org')).toBe(true);
  });

  it('liest Zertifikate mit und ohne Datum', () => {
    const certs = parseCertificates([
      { Domain: '_.example.org', ExpireDate: '2026-12-12 08:00:00' },
      'plain.example.org',
      { nothing: true },
    ]);
    expect(certs).toHaveLength(2);
    expect(certs[0]).toMatchObject({ domain: '*.example.org' });
    expect(certs[0]!.expiresAt?.toISOString()).toBe('2026-12-12T08:00:00.000Z');
    expect(certs[1]).toEqual({ domain: 'plain.example.org', expiresAt: null });
  });

  it('ordnet den Uptime-Monitor über die ID der Regel zu, nicht über die Zieladresse', () => {
    const entries = parseUptime({
      'a.example.org': [
        { ID: 'a.example.org', URL: 'http://10.0.0.5:80', Online: true },
        { ID: 'a.example.org', URL: 'http://10.0.0.5:80', Online: false },
      ],
      'b.example.org (upstream:0)': [
        { ID: 'b.example.org (upstream:0)', URL: 'http://10.0.0.6:80', Online: false },
      ],
      'b.example.org (upstream:1)': [
        { ID: 'b.example.org (upstream:1)', URL: 'http://10.0.0.7:80', Online: true },
      ],
    });
    // Mehrere Ziele: erreichbar, solange eines antwortet.
    expect(entries).toEqual([
      { host: 'a.example.org', online: false },
      { host: 'b.example.org', online: true },
    ]);
    expect(parseUptime(null)).toEqual([]);
  });

  it('liest die Aufrufe je Hostname', () => {
    const hits = parseHits({
      Downstreams: { 'A.example.org': 5, 'a.example.org:443': 2, x: 'kaputt' },
    });
    expect(hits?.get('a.example.org')).toBe(7);
    expect(hits?.has('x')).toBe(false);
    expect(parseHits({ TotalRequest: 1 })).toBeNull();
  });

  it('liest die Version aus verschiedenen Formen', () => {
    expect(parseVersion({ Version: '3.3.4' })).toBe('3.3.4');
    expect(parseVersion({ zoraxyVersion: '3.3.4' })).toBe('3.3.4');
    expect(parseVersion('3.3.4')).toBe('3.3.4');
    expect(parseVersion({})).toBeNull();
  });

  it('fasst Hosts, Zertifikate, Uptime und Anfragen zusammen', () => {
    const summary = summarize(
      {
        hosts: [
          {
            RootOrMatchingDomain: 'b.example.org',
            MatchingDomainAlias: ['c.example.org'],
            ActiveOrigins: [{ OriginIpOrDomain: '10.0.0.2:80', RequireTLS: true }],
            InactiveOrigins: [{ OriginIpOrDomain: '10.0.0.3:80' }],
            Disabled: false,
            Tags: ['x'],
          },
          { RootOrMatchingDomain: 'a.example.org', Disabled: true },
          { RootOrMatchingDomain: 'd.example.org', ActiveOrigins: [] },
          { broken: true },
        ],
        certificates: [
          { Domain: '_.example.org', ExpireDate: '2026-11-20 08:00:00' },
          { Domain: 'd.example.org', ExpireDate: '2026-11-17 08:00:00' },
        ],
        uptime: {
          'b.example.org': [{ ID: 'b.example.org', URL: 'http://10.0.0.2:80', Online: false }],
        },
        stats: {
          TotalRequest: 10,
          ErrorRequest: 2,
          Downstreams: { 'b.example.org': 4, 'c.example.org': 3 },
        },
        version: '3.3.4',
        warnings: [],
      },
      now,
    );
    expect(summary.hosts.map((h) => h.domain)).toEqual([
      'b.example.org',
      'd.example.org',
      'a.example.org',
    ]);
    const b = summary.hosts[0]!;
    expect(b.upstreams).toEqual([
      { target: '10.0.0.2:80', tls: true, active: true },
      { target: '10.0.0.3:80', tls: false, active: false },
    ]);
    expect(b).toMatchObject({
      online: false,
      certDays: 8,
      enabled: true,
      aliases: ['c.example.org'],
    });
    // Exakt und per Wildcard abgedeckt: das genau passende Zertifikat gilt.
    expect(summary.hosts[1]).toMatchObject({ online: null, certDays: 5, hitsToday: 0 });
    expect(summary.counts).toEqual({ hosts: 3, enabled: 2, online: 0, offline: 1 });
    expect(summary.nextExpiryDays).toBe(5);
    expect(summary.certificates[0]!.domain).toBe('d.example.org');
    expect(summary.requests).toEqual({ total: 10, errors: 2 });
  });

  it('kommt ohne optionale Teile aus', () => {
    const summary = summarize(
      {
        hosts: [{ RootOrMatchingDomain: 'a.example.org' }],
        certificates: null,
        uptime: null,
        stats: null,
        version: null,
        warnings: ['Zertifikate konnten nicht gelesen werden'],
      },
      now,
    );
    expect(summary.hosts[0]).toMatchObject({ online: null, certDays: null, hitsToday: null });
    expect(summary.requests).toBeNull();
    expect(summary.nextExpiryDays).toBeNull();
    expect(summary.warnings).toHaveLength(1);
  });
});
