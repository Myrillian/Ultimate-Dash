import { setAriaStrings, SHADOW_ITEM_MARKER_PROPERTY_NAME } from 'svelte-dnd-action';

/** Ansagen für Screenreader beim Verschieben per Tastatur, auf Deutsch. */
setAriaStrings({
  dragStarted: ({ itemLabel, position, count, canMoveBetweenZones }) =>
    `${itemLabel} aufgenommen, Position ${position} von ${count}. Mit den Pfeiltasten verschieben${
      canMoveBetweenZones ? ', mit Tab in eine andere Gruppe wechseln' : ''
    }, mit Leertaste oder Enter ablegen, mit Escape abbrechen.`,
  movedToPosition: ({ itemLabel, position, count }) =>
    `${itemLabel} auf Position ${position} von ${count}`,
  movedToZoneStart: ({ itemLabel, zoneLabel }) => `${itemLabel} an den Anfang von ${zoneLabel}`,
  movedToZoneEnd: ({ itemLabel, zoneLabel }) => `${itemLabel} an das Ende von ${zoneLabel}`,
  dropped: ({ itemLabel, zoneLabel, position }) =>
    `${itemLabel} in ${zoneLabel} auf Position ${position} abgelegt`,
  zoneActiveInstruction: 'Hierher verschieben mit Leertaste oder Enter',
  zoneDragDisabledInstruction: 'Verschieben ist hier nicht möglich',
});

/** IDs ohne den Platzhalter, den die Bibliothek während des Ziehens einfügt. */
export function idsOf(items: { id: number }[]): number[] {
  return items
    .filter((item) => !(item as Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME])
    .map((item) => item.id);
}

export const FLIP_MS = 150;
