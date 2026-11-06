import type {
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
} from '@ultimate-dash/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: { path: (string | number)[]; message: string }[] = [],
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
    throw new ApiError(data.error ?? `Fehler ${response.status}`, response.status, data.issues);
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
};
