import type { DnsRecord, DnsRecordData, DnsZone } from '@ultimate-dash/shared';
import { dnsRecordData } from '@ultimate-dash/shared';

export type Params = Record<string, string | number | boolean>;

/** Technitium-Eintrag, soweit wir ihn lesen. */
export interface RawRecord {
  disabled?: boolean;
  name: string;
  type: string;
  ttl: number;
  rData: Record<string, unknown>;
  comments?: string | null;
}

export interface RawZone {
  name: string;
  type: string;
  internal?: boolean;
  disabled?: boolean;
  dnssecStatus?: string | null;
}

export const toZone = (raw: RawZone): DnsZone => ({
  name: raw.name,
  type: raw.type,
  internal: raw.internal ?? false,
  disabled: raw.disabled ?? false,
  dnssecStatus: raw.dnssecStatus ?? null,
});

/** Liest rData in unsere Form; null bei Typen, die wir nur anzeigen. */
function toData(raw: RawRecord): DnsRecordData | null {
  const r = raw.rData;
  const candidate = (() => {
    switch (raw.type) {
      case 'A':
      case 'AAAA':
        return { type: raw.type, ipAddress: r.ipAddress };
      case 'CNAME':
        return { type: 'CNAME', cname: r.cname };
      case 'PTR':
        return { type: 'PTR', ptrName: r.ptrName };
      case 'MX':
        return { type: 'MX', preference: r.preference, exchange: r.exchange };
      case 'TXT':
        return { type: 'TXT', text: r.text };
      case 'NS':
        return { type: 'NS', nameServer: r.nameServer };
      case 'SRV':
        return {
          type: 'SRV',
          priority: r.priority,
          weight: r.weight,
          port: r.port,
          target: r.target,
        };
      default:
        return null;
    }
  })();
  const parsed = candidate ? dnsRecordData.safeParse(candidate) : null;
  return parsed?.success ? parsed.data : null;
}

/** Kurze Textform für alle Typen, auch die nur angezeigten. */
function display(raw: RawRecord, data: DnsRecordData | null): string {
  if (data) {
    switch (data.type) {
      case 'A':
      case 'AAAA':
        return data.ipAddress;
      case 'CNAME':
        return data.cname;
      case 'PTR':
        return data.ptrName;
      case 'MX':
        return `${data.preference} ${data.exchange}`;
      case 'TXT':
        return data.text;
      case 'NS':
        return data.nameServer;
      case 'SRV':
        return `${data.priority} ${data.weight} ${data.port} ${data.target}`;
    }
  }
  return Object.values(raw.rData)
    .filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .join(' ');
}

export function toRecord(raw: RawRecord): DnsRecord {
  const data = toData(raw);
  return {
    domain: raw.name,
    type: raw.type,
    ttl: raw.ttl,
    disabled: raw.disabled ?? false,
    comments: raw.comments || null,
    display: display(raw, data),
    data,
  };
}

/** Parameter zum Anlegen: Werte unter ihren normalen Namen. */
export function valueParams(data: DnsRecordData): Params {
  switch (data.type) {
    case 'A':
    case 'AAAA':
      return { ipAddress: data.ipAddress };
    case 'CNAME':
      return { cname: data.cname };
    case 'PTR':
      return { ptrName: data.ptrName };
    case 'MX':
      return { preference: data.preference, exchange: data.exchange };
    case 'TXT':
      return { text: data.text };
    case 'NS':
      return { nameServer: data.nameServer };
    case 'SRV':
      return { priority: data.priority, weight: data.weight, port: data.port, target: data.target };
  }
}

/** Beim Ändern heißen die neuen Werte `newXyz`; CNAME ist die Ausnahme und nimmt `cname` direkt. */
export function newValueParams(data: DnsRecordData): Params {
  if (data.type === 'CNAME') return {};
  return Object.fromEntries(
    Object.entries(valueParams(data)).map(([key, value]) => [
      `new${key[0]!.toUpperCase()}${key.slice(1)}`,
      value,
    ]),
  );
}

/** Beim Löschen verlangt Technitium nur, was den Eintrag eindeutig macht. */
export function deleteParams(data: DnsRecordData): Params {
  return data.type === 'CNAME' ? {} : valueParams(data);
}

export const describeRecord = (domain: string, data: DnsRecordData) =>
  `${data.type} ${domain} → ${display({ rData: {} } as RawRecord, data)}`;
