export type Theme = 'light' | 'dark';

class ThemeState {
  current = $state<Theme>(
    (typeof document !== 'undefined' && (document.documentElement.dataset.theme as Theme)) ||
      'dark',
  );

  toggle() {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme) {
    this.current = theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ud-theme', theme);
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus): Theme gilt nur für diese Sitzung.
    }
  }
}

export const theme = new ThemeState();
