import { describe, expect, it } from 'vitest';
import {
  certCovers,
  hostOf,
  parseCertificates,
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

  it('nimmt beim Uptime-Monitor den letzten Wert je Ziel', () => {
    const entries = parseUptime({
      a: [
        { URL: 'https://a.example.org', Online: true },
        { URL: 'https://a.example.org', Online: false },
      ],
      b: [{ URL: 'b.example.org', Online: true }],
    });
    expect(entries).toEqual([
      { host: 'a.example.org', online: false },
      { host: 'b.example.org', online: true },
    ]);
    expect(parseUptime(null)).toEqual([]);
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
        uptime: [[{ URL: 'https://b.example.org', Online: false }]],
        stats: { TotalRequest: 10, ErrorRequest: 2 },
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
    expect(summary.hosts[1]).toMatchObject({ online: null, certDays: 5 });
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
    expect(summary.hosts[0]).toMatchObject({ online: null, certDays: null });
    expect(summary.requests).toBeNull();
    expect(summary.nextExpiryDays).toBeNull();
    expect(summary.warnings).toHaveLength(1);
  });
});
