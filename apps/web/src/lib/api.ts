import type {
  Feed,
  FeedInput,
  FeedItemsPage,
  FeedPreview,
  FeedUpdate,
  SavedView,
  SavedViewInput,
  ViewScope,
  IpamIpDetail,
  CopyDashboardInput,
  CopySummary,
  DashboardSource,
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
  IpamHistory,
  AuthStatus,
  EmailChangeInput,
  ForgotPasswordInput,
  ResetLink,
  ResetPasswordInput,
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
  DhcpServer,
  DhcpServerInput,
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
  changeEmail: (input: EmailChangeInput) => request<User>('PUT', '/auth/email', input),
  forgotPassword: (input: ForgotPasswordInput) =>
    request<{ ok: true }>('POST', '/auth/forgot', input),
  checkReset: (token: string) =>
    request<{ username: string }>('POST', '/auth/reset/check', { token }),
  resetPassword: (input: ResetPasswordInput) => request<User>('POST', '/auth/reset', input),
  createResetLink: (id: number) => request<ResetLink>('POST', `/users/${id}/reset-link`),
  listUsers: () => request<User[]>('GET', '/users'),
  createUser: (input: UserCreateInput) => request<User>('POST', '/users', input),
  updateUser: (id: number, input: UserUpdateInput) => request<User>('PUT', `/users/${id}`, input),
  deleteUser: (id: number) => request<void>('DELETE', `/users/${id}`),

  dashboard: () => request<DashboardData>('GET', '/dashboard'),
  dashboardSources: () => request<DashboardSource[]>('GET', '/dashboards'),
  copyDashboard: (input: CopyDashboardInput) =>
    request<CopySummary>('POST', '/dashboard/copy', input),
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
  dhcpServers: () => request<DhcpServer[]>('GET', '/technitium/dhcp/servers'),
  addDhcpServer: (input: DhcpServerInput) =>
    request<DhcpServer>('POST', '/technitium/dhcp/servers', input),
  updateDhcpServer: (id: string, input: DhcpServerInput) =>
    request<DhcpServer>('PUT', `/technitium/dhcp/servers/${encodeURIComponent(id)}`, input),
  deleteDhcpServer: (id: string) =>
    request<void>('DELETE', `/technitium/dhcp/servers/${encodeURIComponent(id)}`),
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
  audit: (limit = 500) => request<AuditEntry[]>('GET', `/audit?limit=${limit}`),

  feedItems: (params: { topic?: string; before?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.topic) query.set('topic', params.topic);
    if (params.before) query.set('before', params.before);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.size > 0 ? `?${query}` : '';
    return request<FeedItemsPage>('GET', `/feeds/items${suffix}`);
  },
  feeds: () => request<Feed[]>('GET', '/feeds'),
  previewFeed: (url: string) => request<FeedPreview>('POST', '/feeds/preview', { url }),
  createFeed: (input: FeedInput) => request<Feed>('POST', '/feeds', input),
  updateFeed: (id: number, input: FeedUpdate) => request<Feed>('PUT', `/feeds/${id}`, input),
  deleteFeed: (id: number) => request<void>('DELETE', `/feeds/${id}`),
  refreshFeed: (id: number) => request<Feed>('POST', `/feeds/${id}/refresh`),
  restoreDefaultFeeds: () => request<{ added: number }>('POST', '/feeds/defaults'),

  views: (scope: ViewScope) => request<SavedView[]>('GET', `/views?scope=${scope}`),
  saveView: (input: SavedViewInput) => request<SavedView>('PUT', '/views', input),
  deleteView: (id: number) => request<void>('DELETE', `/views/${id}`),
  ipam: () => request<IpamData>('GET', '/ipam'),
  ipamVendors: (prefixes: string[]) =>
    request<Record<string, string | null>>('GET', `/ipam/vendors?prefixes=${prefixes.join(',')}`),
  ipamIp: (address: string) => request<IpamIpDetail>('GET', `/ipam/ip/${address}`),
  ipamUsage: () => request<IpamUsage>('GET', '/ipam/usage'),
  ipamHistory: (days = 30) => request<IpamHistory>('GET', `/ipam/history?days=${days}`),
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
