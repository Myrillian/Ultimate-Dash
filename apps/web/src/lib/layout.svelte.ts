const KEY = 'ud-compact-groups';

/** Darstellung der Gruppen: Raster mit festen Zeilen oder lückenlos in Spalten. */
class LayoutState {
  compact = $state(false);

  constructor() {
    try {
      this.compact = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
    } catch {
      // Speicher nicht verfügbar: Standardlayout.
    }
  }

  toggle() {
    this.compact = !this.compact;
    try {
      localStorage.setItem(KEY, this.compact ? '1' : '0');
    } catch {
      // Einstellung gilt nur für diese Sitzung.
    }
  }
}

export const layout = new LayoutState();
