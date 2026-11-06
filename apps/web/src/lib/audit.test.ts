import { describe, expect, it } from 'vitest';
import { actionLabel, areaOf } from './audit';

describe('Protokoll-Bezeichnungen', () => {
  it('übersetzt bekannte Aktionen und lässt unbekannte unverändert', () => {
    expect(actionLabel('technitium.record.add')).toBe('DNS-Eintrag angelegt');
    expect(actionLabel('neu.unbekannt')).toBe('neu.unbekannt');
  });
  it('ordnet Aktionen einem Bereich zu', () => {
    expect(areaOf('ipam.scan.run')).toBe('ipam');
    expect(areaOf('technitium.dhcp.reservation.add')).toBe('dhcp');
    expect(areaOf('technitium.record.delete')).toBe('dns');
    expect(areaOf('technitium.connect')).toBe('system');
  });
});
