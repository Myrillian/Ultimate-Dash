import type { DnsRecordData, EditableRecordType } from '@ultimate-dash/shared';

/** Name relativ zur Zone anzeigen: Zone selbst als „@“, sonst ohne das Zonen-Suffix. */
export function relativeName(domain: string, zone: string): string {
  if (domain === zone) return '@';
  return domain.endsWith(`.${zone}`) ? domain.slice(0, -zone.length - 1) : domain;
}

/** Eingabe im Formular zum vollständigen Namen: leer oder „@“ = Zone, bereits vollständige Namen bleiben. */
export function fullName(input: string, zone: string): string {
  const name = input.trim().replace(/\.$/, '');
  if (name === '' || name === '@') return zone;
  if (name === zone || name.endsWith(`.${zone}`)) return name;
  return `${name}.${zone}`;
}

/** Zustand des Formulars, flach, damit sich Felder einfach binden lassen. */
export interface RecordDraft {
  type: EditableRecordType;
  name: string;
  ttl: number;
  comments: string;
  disabled: boolean;
  createPtr: boolean;
  ipAddress: string;
  cname: string;
  ptrName: string;
  preference: number;
  exchange: string;
  text: string;
  nameServer: string;
  priority: number;
  weight: number;
  port: number;
  target: string;
}

export const emptyDraft = (type: EditableRecordType = 'A'): RecordDraft => ({
  type,
  name: '',
  ttl: 3600,
  comments: '',
  disabled: false,
  createPtr: false,
  ipAddress: '',
  cname: '',
  ptrName: '',
  preference: 10,
  exchange: '',
  text: '',
  nameServer: '',
  priority: 10,
  weight: 10,
  port: 0,
  target: '',
});

export function draftData(draft: RecordDraft): DnsRecordData {
  switch (draft.type) {
    case 'A':
    case 'AAAA':
      return { type: draft.type, ipAddress: draft.ipAddress.trim() };
    case 'CNAME':
      return { type: 'CNAME', cname: draft.cname };
    case 'PTR':
      return { type: 'PTR', ptrName: draft.ptrName };
    case 'MX':
      return { type: 'MX', preference: Number(draft.preference), exchange: draft.exchange };
    case 'TXT':
      return { type: 'TXT', text: draft.text };
    case 'NS':
      return { type: 'NS', nameServer: draft.nameServer };
    case 'SRV':
      return {
        type: 'SRV',
        priority: Number(draft.priority),
        weight: Number(draft.weight),
        port: Number(draft.port),
        target: draft.target,
      };
  }
}

export function dataToDraft(data: DnsRecordData): Partial<RecordDraft> {
  const { type, ...rest } = data;
  return { type, ...rest } as Partial<RecordDraft>;
}

/** Fehlermeldungen des Servers (`['data','ipAddress']`) auf Formularfelder abbilden. */
export function fieldKey(path: (string | number)[]): string {
  return path[0] === 'domain' ? 'name' : String(path.at(-1) ?? '');
}

/** Was das Formular beim Speichern übergibt. */
export interface RecordFormValues {
  domain: string;
  ttl: number;
  comments: string;
  disabled: boolean;
  createPtr: boolean;
  data: DnsRecordData;
}
