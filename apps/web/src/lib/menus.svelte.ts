/** Dialoge, die sowohl aus dem Einstellungen-Menü als auch von den Seiten aus geöffnet werden. */
class MenuState {
  importOpen = $state(false);
  copyOpen = $state(false);
  technitiumOpen = $state(false);
  proxmoxOpen = $state(false);
  feedsOpen = $state(false);
}

export const menus = new MenuState();
