/** Dialoge, die sowohl aus dem Benutzermenü als auch vom Dashboard aus geöffnet werden. */
class MenuState {
  importOpen = $state(false);
  copyOpen = $state(false);
  technitiumOpen = $state(false);
  feedsOpen = $state(false);
}

export const menus = new MenuState();
