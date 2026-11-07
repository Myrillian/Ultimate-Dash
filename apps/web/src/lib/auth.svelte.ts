import {
  oidcErrorMessages,
  type AuthStatus,
  type LoginInput,
  type OidcErrorCode,
  type ResetPasswordInput,
  type SetupInput,
  type User,
} from '@ultimate-dash/shared';
import { api, setUnauthorizedHandler } from './api.js';

class AuthState {
  /** null = noch nicht geladen */
  ready = $state(false);
  setupRequired = $state(false);
  user = $state<User | null>(null);
  error = $state<string | null>(null);
  oidc = $state<AuthStatus['oidc']>(null);
  /** „Passwort vergessen“ kann eine Mail schicken (sonst geht die Anfrage an einen Admin). */
  passwordResetMail = $state(false);
  /** Meldung nach einer fehlgeschlagenen OIDC-Anmeldung (kommt als ?login_error= zurück). */
  loginError = $state<string | null>(null);

  isAdmin = $derived(this.user?.role === 'admin');

  constructor() {
    setUnauthorizedHandler(() => {
      this.user = null;
    });
  }

  async load() {
    this.takeLoginError();
    try {
      const status = await api.authStatus();
      this.setupRequired = status.setupRequired;
      this.user = status.user;
      this.oidc = status.oidc;
      this.passwordResetMail = status.passwordResetMail;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Server nicht erreichbar';
    } finally {
      this.ready = true;
    }
  }

  private takeLoginError() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('login_error');
    if (!code) return;
    this.loginError =
      oidcErrorMessages[code as OidcErrorCode] ?? 'Die Anmeldung ist fehlgeschlagen.';
    url.searchParams.delete('login_error');
    history.replaceState(history.state, '', url);
  }

  async login(input: LoginInput) {
    this.user = await api.login(input);
  }

  async setup(input: SetupInput) {
    this.user = await api.setup(input);
    this.setupRequired = false;
  }

  /** Setzt das Passwort über einen Reset-Link und meldet direkt an. */
  async resetPassword(input: ResetPasswordInput) {
    this.user = await api.resetPassword(input);
    this.setupRequired = false;
  }

  async logout() {
    await api.logout().catch(() => undefined);
    this.user = null;
  }
}

export const auth = new AuthState();
