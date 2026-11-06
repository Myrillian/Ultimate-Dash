/** Dialoge, die sowohl aus dem Benutzermenü als auch vom Dashboard aus geöffnet werden. */
class MenuState {
  importOpen = $state(false);
  technitiumOpen = $state(false);
}

export const menus = new MenuState();
