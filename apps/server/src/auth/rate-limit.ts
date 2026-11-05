/** Einfache Begrenzung fehlgeschlagener Logins pro Schlüssel (z. B. IP + Benutzername). */
export class LoginRateLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  /** Sekunden bis zum nächsten erlaubten Versuch, oder 0. */
  retryAfter(key: string): number {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= Date.now()) return 0;
    return entry.count >= this.maxAttempts ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
  }

  fail(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now)
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else entry.count += 1;
    if (this.attempts.size > 10_000) this.prune();
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.resetAt <= now) this.attempts.delete(key);
  }
}
