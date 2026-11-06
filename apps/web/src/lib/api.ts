import type {
  IpamCategory,
  IpamCategoryInput,
  IpamData,
  IpamNetwork,
  IpamNetworkInput,
  IpamImportInput,
  IpamHostUpdate,
  IpamRange,
  IpamReachability,
  IpamScanSettings,
  IpamScanStatus,
  IpamSync,
  IpamRangeInput,
  IpamUsage,
  AuthStatus,
  LoginInput,
  PasswordChangeInput,
  SetupInput,
  User,
  UserCreateInput,
  UserUpdateInput,
  DashboardData,
  IconCatalog,
  ImportRequest,
  ImportSummary,
  Group,
  GroupInput,
  Service,
  ServiceInput,
  ServiceStatus,
  AuditEntry,
  DhcpLease,
  DhcpLeaseAction,
  DhcpReservationDelete,
  DhcpReservationInput,
  DhcpReservationUpdate,
  DhcpScope,
  DhcpScopeState,
  DnsRecordCreate,
  DnsRecordDelete,
  DnsRecordList,
  DnsRecordUpdate,
  DnsZone,
  BlockingAction,
  DnsSummary,
  StatsRange,
  TechnitiumSettings,
  TechnitiumSettingsInput,
  TechnitiumTestResult,
} from '@ultimate-dash/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: { path: (string | number)[]; message: string }[] = [],
    /** Maschinenlesbarer Fehlercode, z. B. `not-configured` bei Technitium */
    readonly code?: string,
  ) {
    super(message);
  }

  /** Fehlermeldungen pro Feld, z. B. `{ url: 'Ungültige URL' }`. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((i) => [String(i.path[0] ?? ''), i.message]));
  }
}

let onUnauthorized: (() => void) | undefined;
/** Wird aufgerufen, wenn die Session abgelaufen ist (z. B. um zum Login zu wechseln). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      data.error ?? `Fehler ${response.status}`,
      response.status,
      data.issues,
      data.code,
    );
  }
  return data as T;
}

export const api = {
  authStatus: () => request<AuthStatus>('GET', '/auth/status'),
  setup: (input: SetupInput) => request<User>('POST', '/auth/setup', input),
  login: (input: LoginInput) => request<User>('POST', '/auth/login', input),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (input: PasswordChangeInput) => request<void>('POST', '/auth/password', input),
  listUsers: () => request<User[]>('GET', '/users'),
  createUser: (input: UserCreateInput) => request<User>('POST', '/users', input),
  updateUser: (id: number, input: UserUpdateInput) => request<User>('PUT', `/users/${id}`, input),
  deleteUser: (id: number) => request<void>('DELETE', `/users/${id}`),

  dashboard: () => request<DashboardData>('GET', '/dashboard'),
  importConfig: (input: ImportRequest) => request<ImportSummary>('POST', '/config/import', input),
  iconCatalog: () => request<IconCatalog>('GET', '/icons'),
  searchIconify: (q: string) =>
    request<{ icons: string[] }>('GET', `/icons/iconify?q=${encodeURIComponent(q)}`),
  status: () => request<ServiceStatus[]>('GET', '/status'),
  createGroup: (input: GroupInput) => request<Group>('POST', '/groups', input),
  updateGroup: (id: number, input: GroupInput) => request<Group>('PUT', `/groups/${id}`, input),
  deleteGroup: (id: number) => request<void>('DELETE', `/groups/${id}`),
  reorderGroups: (ids: number[]) => request<void>('PUT', '/groups/order', { ids }),
  createService: (input: ServiceInput) => request<Service>('POST', '/services', input),
  updateService: (id: number, input: ServiceInput) =>
    request<Service>('PUT', `/services/${id}`, input),
  deleteService: (id: number) => request<void>('DELETE', `/services/${id}`),
  arrangeServices: (groupId: number, ids: number[]) =>
    request<void>('PUT', '/services/arrange', { groupId, ids }),

  technitiumSettings: () => request<TechnitiumSettings>('GET', '/technitium/settings'),
  saveTechnitium: (input: TechnitiumSettingsInput) =>
    request<TechnitiumTestResult>('PUT', '/technitium/settings', input),
  testTechnitium: (input: TechnitiumSettingsInput) =>
    request<TechnitiumTestResult>('POST', '/technitium/test', input),
  disconnectTechnitium: () => request<void>('DELETE', '/technitium/settings'),
  dnsSummary: (range: StatsRange) =>
    request<DnsSummary>('GET', `/technitium/summary?range=${range}`),
  blocking: (action: BlockingAction) => request<void>('POST', '/technitium/blocking', action),
  dnsZones: () => request<DnsZone[]>('GET', '/technitium/zones'),
  dnsRecords: (zone: string) =>
    request<DnsRecordList>('GET', `/technitium/records?zone=${encodeURIComponent(zone)}`),
  addDnsRecord: (input: DnsRecordCreate) => request<void>('POST', '/technitium/records', input),
  updateDnsRecord: (input: DnsRecordUpdate) => request<void>('PUT', '/technitium/records', input),
  deleteDnsRecord: (input: DnsRecordDelete) =>
    request<void>('POST', '/technitium/records/delete', input),
  dhcpScopes: () => request<DhcpScope[]>('GET', '/technitium/dhcp/scopes'),
  dhcpLeases: () => request<DhcpLease[]>('GET', '/technitium/dhcp/leases'),
  setDhcpScope: (input: DhcpScopeState) =>
    request<void>('POST', '/technitium/dhcp/scopes/state', input),
  addDhcpReservation: (input: DhcpReservationInput) =>
    request<void>('POST', '/technitium/dhcp/reservations', input),
  updateDhcpReservation: (input: DhcpReservationUpdate) =>
    request<void>('PUT', '/technitium/dhcp/reservations', input),
  deleteDhcpReservation: (input: DhcpReservationDelete) =>
    request<void>('POST', '/technitium/dhcp/reservations/delete', input),
  dhcpLeaseAction: (input: DhcpLeaseAction) =>
    request<void>('POST', '/technitium/dhcp/leases/action', input),
  audit: () => request<AuditEntry[]>('GET', '/audit'),

  ipam: () => request<IpamData>('GET', '/ipam'),
  ipamUsage: () => request<IpamUsage>('GET', '/ipam/usage'),
  ipamScan: () => request<IpamScanStatus>('GET', '/ipam/scan'),
  saveIpamScan: (input: IpamScanSettings) => request<IpamScanStatus>('PUT', '/ipam/scan', input),
  runIpamScan: () => request<IpamScanStatus>('POST', '/ipam/scan/run'),
  ipamReachability: () => request<IpamReachability>('GET', '/ipam/reachability'),
  updateIpamHost: (id: number, input: IpamHostUpdate) =>
    request<void>('PUT', `/ipam/hosts/${id}`, input),
  deleteIpamHost: (id: number) => request<void>('DELETE', `/ipam/hosts/${id}`),
  ipamSync: () => request<IpamSync>('GET', '/ipam/sync'),
  importIpam: (input: IpamImportInput) => request<IpamNetwork[]>('POST', '/ipam/import', input),
  createIpamNetwork: (input: IpamNetworkInput) =>
    request<IpamNetwork>('POST', '/ipam/networks', input),
  updateIpamNetwork: (id: number, input: IpamNetworkInput) =>
    request<IpamNetwork>('PUT', `/ipam/networks/${id}`, input),
  deleteIpamNetwork: (id: number) => request<void>('DELETE', `/ipam/networks/${id}`),
  createIpamCategory: (input: IpamCategoryInput) =>
    request<IpamCategory>('POST', '/ipam/categories', input),
  updateIpamCategory: (id: number, input: IpamCategoryInput) =>
    request<IpamCategory>('PUT', `/ipam/categories/${id}`, input),
  deleteIpamCategory: (id: number) => request<void>('DELETE', `/ipam/categories/${id}`),
  createIpamRange: (input: IpamRangeInput) => request<IpamRange>('POST', '/ipam/ranges', input),
  updateIpamRange: (id: number, input: IpamRangeInput) =>
    request<IpamRange>('PUT', `/ipam/ranges/${id}`, input),
  deleteIpamRange: (id: number) => request<void>('DELETE', `/ipam/ranges/${id}`),
};
