import { z } from 'zod';

/** Domainname wie in Zonendateien: Buchstaben, Ziffern, `_`, `-`, `*` und Punkte; ein Schlusspunkt wird entfernt. */
export const dnsName = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((value) => value.replace(/\.$/, ''))
  .refine(
    (value) =>
      /^(\*\.)?[A-Za-z0-9_]([A-Za-z0-9_-]{0,62})?(\.[A-Za-z0-9_]([A-Za-z0-9_-]{0,62})?)*$/.test(
        value,
      ),
    'Ungültiger Domainname',
  );

/** Typen, die sich in Ultimate Dash anlegen und ändern lassen. Andere werden nur angezeigt. */
export const editableRecordTypes = ['A', 'AAAA', 'CNAME', 'PTR', 'MX', 'TXT', 'NS', 'SRV'] as const;
export type EditableRecordType = (typeof editableRecordTypes)[number];

const port = z.number().int().min(0).max(65535);

export const dnsRecordData = z.discriminatedUnion('type', [
  z.object({ type: z.literal('A'), ipAddress: z.ipv4() }),
  z.object({ type: z.literal('AAAA'), ipAddress: z.ipv6() }),
  z.object({ type: z.literal('CNAME'), cname: dnsName }),
  z.object({ type: z.literal('PTR'), ptrName: dnsName }),
  z.object({
    type: z.literal('MX'),
    preference: z.number().int().min(0).max(65535),
    exchange: dnsName,
  }),
  z.object({ type: z.literal('TXT'), text: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('NS'), nameServer: dnsName }),
  z.object({
    type: z.literal('SRV'),
    priority: port,
    weight: port,
    port,
    target: dnsName,
  }),
]);
export type DnsRecordData = z.infer<typeof dnsRecordData>;

const recordCommon = {
  zone: dnsName,
  /** Vollständiger Name des Eintrags, z. B. `nas.home.lan` oder die Zone selbst */
  domain: dnsName,
  ttl: z.number().int().min(1).max(2_147_483_647),
  comments: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null),
  data: dnsRecordData,
};

export const dnsRecordCreate = z.object({
  ...recordCommon,
  /** Nur bei A/AAAA: passenden PTR-Eintrag mit anlegen (die Reverse-Zone wird bei Bedarf erstellt) */
  createPtr: z.boolean().default(false),
});
export type DnsRecordCreate = z.input<typeof dnsRecordCreate>;

export const dnsRecordUpdate = z.object({
  ...recordCommon,
  createPtr: z.boolean().default(false),
  disabled: z.boolean().default(false),
  /** Der Eintrag, wie er aktuell besteht; Technitium erkennt ihn an Name, Typ und Wert */
  current: z.object({ domain: dnsName, data: dnsRecordData }),
});
export type DnsRecordUpdate = z.input<typeof dnsRecordUpdate>;

export const dnsRecordDelete = z.object({
  zone: dnsName,
  domain: dnsName,
  data: dnsRecordData,
});
export type DnsRecordDelete = z.input<typeof dnsRecordDelete>;

export interface DnsZone {
  name: string;
  type: string;
  /** Von Technitium selbst verwaltet (z. B. localhost, Reverse-Zonen für 127.x) */
  internal: boolean;
  disabled: boolean;
  dnssecStatus: string | null;
}

export interface DnsRecord {
  domain: string;
  type: string;
  ttl: number;
  disabled: boolean;
  comments: string | null;
  /** Wert als lesbarer Text, auch für Typen, die sich nicht bearbeiten lassen */
  display: string;
  /** null = Typ wird nur angezeigt */
  data: DnsRecordData | null;
}

export interface DnsRecordList {
  zone: DnsZone;
  records: DnsRecord[];
}
