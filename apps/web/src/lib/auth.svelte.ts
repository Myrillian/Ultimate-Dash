import type { LoginInput, SetupInput, User } from '@ultimate-dash/shared';
import { api, setUnauthorizedHandler } from './api.js';

class AuthState {
  /** null = noch nicht geladen */
  ready = $state(false);
  setupRequired = $state(false);
  user = $state<User | null>(null);
  error = $state<string | null>(null);

  isAdmin = $derived(this.user?.role === 'admin');

  constructor() {
    setUnauthorizedHandler(() => {
      this.user = null;
    });
  }

  async load() {
    try {
      const status = await api.authStatus();
      this.setupRequired = status.setupRequired;
      this.user = status.user;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Server nicht erreichbar';
    } finally {
      this.ready = true;
    }
  }

  async login(input: LoginInput) {
    this.user = await api.login(input);
  }

  async setup(input: SetupInput) {
    this.user = await api.setup(input);
    this.setupRequired = false;
  }

  async logout() {
    await api.logout().catch(() => undefined);
    this.user = null;
  }
}

export const auth = new AuthState();
