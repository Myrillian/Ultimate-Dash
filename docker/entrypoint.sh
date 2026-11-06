#!/bin/sh
# Startet als root, sorgt dafür, dass der Datenordner beschreibbar ist,
# und führt die App danach als Benutzer „node“ (UID 1000) aus.
# Hintergrund: Docker legt fehlende Bind-Mount-Ordner (z. B. ./data) als root an.
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Nur anpassen, wenn nötig, damit große Ordner nicht bei jedem Start durchlaufen werden.
  if [ "$(stat -c %u "$DATA_DIR")" != "1000" ]; then
    echo "Setze Besitzer von $DATA_DIR auf node (1000:1000)"
    chown -R 1000:1000 "$DATA_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# Läuft der Container bereits ohne root (z. B. „user:“ in der Compose-Datei),
# muss der Ordner für diesen Benutzer beschreibbar sein.
if [ ! -w "$DATA_DIR" ]; then
  echo "Fehler: $DATA_DIR ist für UID $(id -u) nicht beschreibbar." >&2
  echo "Lösung: chown -R $(id -u):$(id -g) <Ordner auf dem Host>" >&2
  exit 1
fi
exec "$@"
