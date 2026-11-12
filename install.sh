#!/usr/bin/env bash
# Ultimate Dash – interaktives Installations- und Wartungsskript für Ubuntu/Debian.
#
# Installiert Ultimate Dash ohne Docker als systemd-Dienst auf einem (leeren) Host.
# Start als root:   sudo ./install.sh
# Ohne Menü:        sudo ./install.sh <deps|install|repair|update-deps|update|backup|restore|restart|uninstall|migrate-docker>
# Updates aus der Oberfläche führt der systemd-Dienst ultimate-dash-update aus (apply-update-request).
#
# Anpassbar über Umgebungsvariablen (alle optional):
#   UD_REPO_URL   Git-Quelle           (Standard: https://github.com/myrillian/ultimate-dash.git)
#   UD_BRANCH     Branch               (Standard: main)
#   UD_APP_DIR    Programmordner       (Standard: /opt/ultimate-dash)
#   UD_DATA_DIR   Datenordner          (Standard: /var/lib/ultimate-dash)
#   UD_CONF_DIR   Konfigurationsordner (Standard: /etc/ultimate-dash)
#   UD_BACKUP_DIR Backup-Ordner        (Standard: /var/backups/ultimate-dash)
#   UD_PORT       Port bei Neuinstallation (Standard: 3000)
#   UD_ASSUME_YES=1  Rückfragen automatisch mit „ja“ beantworten (für Automatisierung)
#   UD_PURGE=1       Bei „uninstall“ auch Daten, Konfiguration und Benutzer löschen
#   UD_TARGET_REF    Bei „update“ ein Release-Tag (z. B. v1.2.0) statt des Branch-Stands installieren
set -Eeuo pipefail

REPO_URL="${UD_REPO_URL:-https://github.com/myrillian/ultimate-dash.git}"
BRANCH="${UD_BRANCH:-main}"
APP_DIR="${UD_APP_DIR:-/opt/ultimate-dash}"
DATA_DIR="${UD_DATA_DIR:-/var/lib/ultimate-dash}"
CONF_DIR="${UD_CONF_DIR:-/etc/ultimate-dash}"
BACKUP_DIR="${UD_BACKUP_DIR:-/var/backups/ultimate-dash}"
ENV_FILE="$CONF_DIR/ultimate-dash.env"
SERVICE_NAME="ultimate-dash"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SERVICE_USER="ultimate-dash"
# Update aus der Oberfläche: Der Dienst legt die Anfrage in UPDATE_DIR ab, eine systemd-Path-Unit
# (root) startet daraufhin ultimate-dash-update.service. Den Status schreibt nur root nach /run.
UPDATE_NAME="ultimate-dash-update"
UPDATE_DIR="$DATA_DIR/update"
UPDATE_REQUEST_FILE="$UPDATE_DIR/request"
UPDATE_STATUS_FILE="/run/${UPDATE_NAME}/status.json"
UPDATE_SERVICE_FILE="/etc/systemd/system/${UPDATE_NAME}.service"
UPDATE_PATH_FILE="/etc/systemd/system/${UPDATE_NAME}.path"
DB_NAME="ultimate-dash.db"
NODE_MAJOR=22 # package.json: engines.node ">=22"
DEFAULT_PORT="${UD_PORT:-3000}"
ASSUME_YES="${UD_ASSUME_YES:-0}"

APT_PACKAGES=(ca-certificates curl gnupg git tar gzip build-essential python3 make g++ iputils-ping sqlite3)

# ---------------------------------------------------------------------------
# Ausgabe und Hilfsfunktionen
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m' C_BOLD=$'\033[1m' C_OFF=$'\033[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_BOLD='' C_OFF=''
fi

info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
ok() { printf '%s ✓%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s !%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
err() { printf '%s ✗%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
die() {
  err "$*"
  exit 1
}

# Eingaben kommen vom Terminal, auch wenn das Skript über eine Pipe gestartet wurde.
if [[ -t 0 ]]; then
  TTY_IN=/dev/stdin
elif [[ -r /dev/tty ]]; then
  TTY_IN=/dev/tty
else
  TTY_IN=''
fi

ask() { # ask <Frage> [Standard] -> Antwort auf stdout
  local prompt="$1" default="${2:-}" answer=''
  if [[ -z "$TTY_IN" ]]; then
    printf '%s' "$default"
    return
  fi
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " answer <"$TTY_IN" || true
  else
    read -r -p "$prompt: " answer <"$TTY_IN" || true
  fi
  printf '%s' "${answer:-$default}"
}

confirm() { # confirm <Frage> [j|n als Standard]
  local default="${2:-n}" answer
  if [[ "$ASSUME_YES" == "1" ]]; then return 0; fi
  answer="$(ask "$1 (j/n)" "$default")"
  [[ "$answer" =~ ^([jJyY]|[jJ][aA]|[yY][eE][sS])$ ]]
}

pause() {
  [[ -n "$TTY_IN" && "$ASSUME_YES" != "1" ]] || return 0
  read -r -p "Weiter mit Enter …" _ <"$TTY_IN" || true
}

TMP_DIRS=()
make_tmp() {
  local d
  d="$(mktemp -d)"
  TMP_DIRS+=("$d")
  printf '%s' "$d"
}
cleanup() {
  local d
  for d in "${TMP_DIRS[@]:-}"; do
    if [[ -n "$d" ]]; then rm -rf "$d"; fi
  done
  # Kopie des Skripts bei Updates aus der Oberfläche (siehe main)
  if [[ -n "${UD_SELF_COPY:-}" ]]; then rm -f "$UD_SELF_COPY"; fi
  return 0
}
trap cleanup EXIT

on_error() {
  err "Abgebrochen in Zeile $1 (Befehl: $2)"
}
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Dieses Skript braucht root-Rechte. Starte es mit: sudo $0"
}

require_os() {
  [[ -r /etc/os-release ]] || die "/etc/os-release fehlt – unterstütztes System: Ubuntu oder Debian."
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${ID_LIKE:-}" in
    ubuntu:* | debian:* | *:*debian* | *:*ubuntu*) ;;
    *) die "Nicht unterstütztes System (${PRETTY_NAME:-unbekannt}). Dieses Skript läuft nur unter Ubuntu und Debian." ;;
  esac
  command -v apt-get >/dev/null || die "apt-get nicht gefunden."
  command -v systemctl >/dev/null || die "systemd (systemctl) wird benötigt."
  [[ -d /run/systemd/system ]] || die "systemd läuft nicht als Init-System (z. B. in einem Container ohne systemd)."
}

# Verhindert, dass zwei Läufe gleichzeitig Pakete oder Dateien ändern.
acquire_lock() {
  exec 9>/var/lock/ultimate-dash-install.lock
  flock -n 9 || die "Ein anderer Lauf des Installationsskripts ist noch aktiv."
}

apt_run() {
  DEBIAN_FRONTEND=noninteractive apt-get "$@"
}

# ---------------------------------------------------------------------------
# Zustandsabfragen
# ---------------------------------------------------------------------------
service_exists() { [[ -f "$SERVICE_FILE" ]]; }
service_active() { systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; }
app_installed() { [[ -d "$APP_DIR/.git" ]]; }

node_major() {
  command -v node >/dev/null 2>&1 || {
    echo 0
    return
  }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

env_value() { # env_value <NAME> [Standard]
  local value=''
  if [[ -f "$ENV_FILE" ]]; then
    value="$(sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1)"
  fi
  printf '%s' "${value:-${2:-}}"
}

app_port() { env_value PORT "$DEFAULT_PORT"; }

health_check() { # health_check [Sekunden]
  local port timeout="${1:-30}" i
  port="$(app_port)"
  for ((i = 0; i < timeout; i++)); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

pnpm_version() { # aus package.json (packageManager), sonst Fallback
  local v=''
  if [[ -f "$APP_DIR/package.json" ]]; then
    v="$(sed -n 's/.*"packageManager": *"pnpm@\([0-9.]*\)".*/\1/p' "$APP_DIR/package.json" | head -n1)"
  fi
  printf '%s' "${v:-10.28.0}"
}

# Führt einen Befehl als Dienstbenutzer im Programmordner aus.
as_service_user() {
  runuser -u "$SERVICE_USER" -- env HOME="$APP_DIR" PATH="$PATH" COREPACK_HOME="$APP_DIR/.corepack" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"
}

# ---------------------------------------------------------------------------
# 1 / 4: Abhängigkeiten
# ---------------------------------------------------------------------------
install_node() {
  local current
  current="$(node_major)"
  if ((current >= NODE_MAJOR)); then
    ok "Node.js $(node -v) ist vorhanden"
    return
  fi
  info "Installiere Node.js ${NODE_MAJOR}.x (NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt_run update -qq
  apt_run install -y -qq nodejs
  [[ "$(node_major)" -ge "$NODE_MAJOR" ]] || die "Node.js ${NODE_MAJOR} konnte nicht installiert werden."
  ok "Node.js $(node -v) installiert"
}

install_pnpm() {
  local want
  want="$(pnpm_version)"
  if ! command -v corepack >/dev/null 2>&1; then
    info "Installiere corepack"
    npm install -g corepack >/dev/null
  fi
  corepack enable
  # Vorab laden, damit der erste Build keine Netzwerkabfrage braucht.
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@${want}" --activate >/dev/null
  ok "pnpm $want bereit (corepack)"
}

cmd_deps() {
  info "Installiere Abhängigkeiten (Pakete, Node.js ${NODE_MAJOR}, pnpm)"
  apt_run update -qq
  apt_run install -y -qq "${APT_PACKAGES[@]}"
  ok "Systempakete: ${APT_PACKAGES[*]}"
  install_node
  install_pnpm
  ok "Abhängigkeiten sind installiert"
}

cmd_update_deps() {
  info "Aktualisiere Abhängigkeiten"
  apt_run update -qq
  apt_run install -y -qq --only-upgrade "${APT_PACKAGES[@]}" nodejs 2>/dev/null ||
    apt_run install -y -qq "${APT_PACKAGES[@]}"
  ok "Systempakete aktualisiert"
  install_node
  install_pnpm
  if app_installed; then
    info "Aktualisiere Node-Module der Anwendung (laut pnpm-lock.yaml) und baue native Module neu"
    local was_active=0
    service_active && was_active=1
    ((was_active)) && systemctl stop "$SERVICE_NAME"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
    as_service_user bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm rebuild better-sqlite3"
    ((was_active)) && systemctl start "$SERVICE_NAME" && health_check 30 && ok "Dienst läuft wieder"
  fi
  ok "Abhängigkeiten sind aktuell"
}

# ---------------------------------------------------------------------------
# Benutzer, Ordner, Konfiguration, Dienst
# ---------------------------------------------------------------------------
ensure_user_and_dirs() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    info "Lege Systembenutzer $SERVICE_USER an"
    useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin --user-group "$SERVICE_USER"
  fi
  install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$UPDATE_DIR"
  install -d -m 0750 -o root -g "$SERVICE_USER" "$CONF_DIR"
  install -d -m 0700 -o root -g root "$BACKUP_DIR"
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    ok "Konfiguration vorhanden: $ENV_FILE"
  else
    local port public_url
    port="$(ask 'Port, auf dem Ultimate Dash lauscht' "$DEFAULT_PORT")"
    [[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)) || die "Ungültiger Port: $port"
    public_url="$(ask 'Öffentliche Adresse (z. B. https://dash.example.org, leer = später)' '')"
    info "Schreibe $ENV_FILE"
    {
      echo "# Konfiguration von Ultimate Dash – Erklärung: docs/anleitungen/konfiguration.md"
      echo "# Nach Änderungen: systemctl restart $SERVICE_NAME"
      echo "NODE_ENV=production"
      echo "HOST=0.0.0.0"
      echo "PORT=$port"
      echo "DATA_DIR=$DATA_DIR"
      echo "WEB_ROOT=$APP_DIR/apps/web/build"
      [[ -n "$public_url" ]] && echo "PUBLIC_URL=$public_url"
      echo "# Weitere Variablen (Technitium, Proxmox, SMTP, OIDC …) siehe $APP_DIR/.env.example"
    } >"$ENV_FILE"
  fi
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
}

write_service() {
  local content
  content="[Unit]
Description=Ultimate Dash – Dashboard für Homelab und Services
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/apps/server
EnvironmentFile=$ENV_FILE
Environment=UD_UPDATE_REQUEST_FILE=$UPDATE_REQUEST_FILE
Environment=UD_UPDATE_STATUS_FILE=$UPDATE_STATUS_FILE
ExecStart=$(command -v node) dist/main.js
Restart=on-failure
RestartSec=5
# Ping-Prüfung im IPAM ohne root
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
"
  if [[ -f "$SERVICE_FILE" ]] && [[ "$(cat "$SERVICE_FILE")" == "${content%$'\n'}" ]]; then
    ok "systemd-Dienst ist aktuell"
  else
    printf '%s' "$content" >"$SERVICE_FILE"
    chmod 0644 "$SERVICE_FILE"
    systemctl daemon-reload
    ok "systemd-Dienst geschrieben: $SERVICE_FILE"
  fi
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  write_update_units
}

# Einrichtung des Update-Dienstes, damit Admins Updates aus der Oberfläche anstoßen können.
write_update_units() {
  local unit path changed=0
  unit="[Unit]
Description=Ultimate Dash – Update aus der Oberfläche installieren
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RuntimeDirectory=$UPDATE_NAME
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=yes
Environment=UD_ASSUME_YES=1
Environment=UD_REPO_URL=$REPO_URL
Environment=UD_BRANCH=$BRANCH
Environment=UD_APP_DIR=$APP_DIR
Environment=UD_DATA_DIR=$DATA_DIR
Environment=UD_CONF_DIR=$CONF_DIR
Environment=UD_BACKUP_DIR=$BACKUP_DIR
ExecStart=/bin/bash $APP_DIR/install.sh apply-update-request
TimeoutStartSec=3600
"
  path="[Unit]
Description=Ultimate Dash – wartet auf eine Update-Anfrage aus der Oberfläche

[Path]
PathExists=$UPDATE_REQUEST_FILE
Unit=${UPDATE_NAME}.service

[Install]
WantedBy=multi-user.target
"
  if [[ ! -f "$UPDATE_SERVICE_FILE" ]] || [[ "$(cat "$UPDATE_SERVICE_FILE")" != "${unit%$'\n'}" ]]; then
    printf '%s' "$unit" >"$UPDATE_SERVICE_FILE"
    chmod 0644 "$UPDATE_SERVICE_FILE"
    changed=1
  fi
  if [[ ! -f "$UPDATE_PATH_FILE" ]] || [[ "$(cat "$UPDATE_PATH_FILE")" != "${path%$'\n'}" ]]; then
    printf '%s' "$path" >"$UPDATE_PATH_FILE"
    chmod 0644 "$UPDATE_PATH_FILE"
    changed=1
  fi
  ((changed)) && systemctl daemon-reload
  systemctl enable "${UPDATE_NAME}.path" >/dev/null 2>&1
  # Ein Neustart des Path-Units wäre mitten in einem laufenden Update unnötig riskant.
  systemctl is-active --quiet "${UPDATE_NAME}.path" || systemctl start "${UPDATE_NAME}.path"
  ((changed)) && ok "Update-Dienst für die Oberfläche eingerichtet" || true
}

fetch_source() {
  if app_installed; then
    info "Hole Änderungen von $REPO_URL ($BRANCH)"
    git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
    if [[ -n "${UD_TARGET_REF:-}" ]]; then
      git -C "$APP_DIR" fetch --prune --tags --force origin || return 1
      git -C "$APP_DIR" checkout -q --detach -f "refs/tags/$UD_TARGET_REF" || return 1
      git -C "$APP_DIR" reset -q --hard "refs/tags/$UD_TARGET_REF" || return 1
    else
      git -C "$APP_DIR" fetch --prune origin "$BRANCH" || return 1
      git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH" || return 1
      git -C "$APP_DIR" reset -q --hard "origin/$BRANCH" || return 1
    fi
  else
    [[ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]] ||
      die "$APP_DIR ist nicht leer und kein Git-Checkout. Verschiebe den Inhalt oder setze UD_APP_DIR."
    info "Klone $REPO_URL ($BRANCH) nach $APP_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  fi
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
}

build_app() {
  info "Installiere Node-Module und baue Ultimate Dash (dauert einige Minuten)"
  as_service_user bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm build" ||
    { err "pnpm install/build ist fehlgeschlagen"; return 1; }
  [[ -f "$APP_DIR/apps/server/dist/main.js" && -f "$APP_DIR/apps/web/build/index.html" ]] ||
    { err "Build unvollständig: dist/main.js oder web/build/index.html fehlt"; return 1; }
  ok "Build abgeschlossen"
}

start_service() {
  systemctl restart "$SERVICE_NAME"
  if health_check 40; then
    ok "Ultimate Dash läuft: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$(app_port)"
  else
    err "Der Dienst antwortet nicht. Log: journalctl -u $SERVICE_NAME -n 50 --no-pager"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 2: Ultimate Dash installieren
# ---------------------------------------------------------------------------
cmd_install() {
  if app_installed && service_exists; then
    warn "Ultimate Dash ist bereits installiert ($APP_DIR)."
    confirm "Trotzdem fortfahren (Programm neu holen und bauen, Daten bleiben erhalten)?" n || return 0
  fi
  cmd_deps
  ensure_user_and_dirs
  ensure_env_file
  fetch_source
  build_app
  write_service
  start_service
  cat <<EOF

${C_BOLD}Fertig.${C_OFF} Öffne das Dashboard im Browser und lege das erste Administrator-Konto an.
  Konfiguration:  $ENV_FILE
  Daten:          $DATA_DIR
  Log:            journalctl -u $SERVICE_NAME -f
EOF
}

# ---------------------------------------------------------------------------
# 6: Backup
# ---------------------------------------------------------------------------
create_backup() { # create_backup [Dateiname-Präfix] -> gibt Pfad aus
  local prefix="${1:-ultimate-dash}" stamp stage archive
  [[ -d "$DATA_DIR" ]] || die "Datenordner $DATA_DIR existiert nicht – ist Ultimate Dash installiert?"
  install -d -m 0700 "$BACKUP_DIR"
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive="$BACKUP_DIR/${prefix}-${stamp}.tar.gz"
  stage="$(make_tmp)"
  mkdir -p "$stage/data" "$stage/config"

  # Datenbank konsistent sichern (SQLite-Online-Backup, auch bei laufendem Dienst).
  if [[ -f "$DATA_DIR/$DB_NAME" ]]; then
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$DATA_DIR/$DB_NAME" ".timeout 10000" ".backup '$stage/data/$DB_NAME'"
    else
      warn "sqlite3 fehlt – stoppe den Dienst kurz für ein konsistentes Backup"
      local was_active=0
      service_active && was_active=1
      ((was_active)) && systemctl stop "$SERVICE_NAME"
      cp -a "$DATA_DIR/$DB_NAME" "$stage/data/"
      ((was_active)) && systemctl start "$SERVICE_NAME"
    fi
  else
    warn "Noch keine Datenbank vorhanden ($DATA_DIR/$DB_NAME) – sichere nur Konfiguration und übrige Daten"
  fi
  # Übrige Dateien (z. B. Icon-Zwischenspeicher), ohne Datenbank und deren WAL/SHM-Dateien.
  (cd "$DATA_DIR" && find . -mindepth 1 -maxdepth 1 ! -name "$DB_NAME" ! -name "$DB_NAME-wal" ! -name "$DB_NAME-shm" \
    -exec cp -a {} "$stage/data/" \;)
  [[ -f "$ENV_FILE" ]] && cp -a "$ENV_FILE" "$stage/config/"
  {
    echo "created=$(date -Is)"
    echo "host=$(hostname)"
    echo "commit=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo unbekannt)"
  } >"$stage/MANIFEST"

  (umask 077 && tar -C "$stage" -czf "$archive" .)
  chmod 0600 "$archive"
  # Archiv prüfen
  tar -tzf "$archive" >/dev/null || die "Das Backup ist beschädigt: $archive"
  ok "Backup erstellt: $archive ($(du -h "$archive" | cut -f1))"
  rm -rf "$stage"
  LAST_BACKUP="$archive"
}

cmd_backup() {
  warn "Das Backup enthält Zugangsdaten (Datenbank, .env) und ist nur für root lesbar (Ordner $BACKUP_DIR)."
  create_backup ultimate-dash
}

# ---------------------------------------------------------------------------
# 7: Restore
# ---------------------------------------------------------------------------
cmd_restore() {
  local -a files=()
  local choice archive stage safety was_active=0 i
  shopt -s nullglob
  files=("$BACKUP_DIR"/*.tar.gz)
  shopt -u nullglob
  ((${#files[@]} > 0)) || {
    warn "Keine Backups in $BACKUP_DIR gefunden."
    return 0
  }
  echo "Verfügbare Backups (neueste zuletzt):"
  for i in "${!files[@]}"; do
    printf '  %2d) %s  (%s)\n' "$((i + 1))" "$(basename "${files[$i]}")" "$(du -h "${files[$i]}" | cut -f1)"
  done
  choice="$(ask "Nummer des Backups (0 = abbrechen)" "${#files[@]}")"
  [[ "$choice" =~ ^[0-9]+$ ]] || die "Ungültige Auswahl."
  ((choice > 0)) || return 0
  ((choice <= ${#files[@]})) || die "Ungültige Auswahl."
  archive="${files[$((choice - 1))]}"

  # Archiv prüfen, bevor etwas verändert wird.
  tar -tzf "$archive" >/dev/null 2>&1 || die "Archiv nicht lesbar: $archive"
  if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die "Archiv enthält unsichere Pfade und wird nicht eingespielt."
  fi
  stage="$(make_tmp)"
  tar -xzf "$archive" -C "$stage"
  [[ -d "$stage/data" ]] || die "Kein gültiges Ultimate-Dash-Backup (Ordner data fehlt)."

  warn "Achtung: Die aktuellen Daten in $DATA_DIR werden durch das Backup ersetzt."
  confirm "Backup $(basename "$archive") jetzt einspielen?" n || {
    info "Abgebrochen."
    return 0
  }

  ensure_user_and_dirs
  if [[ -f "$DATA_DIR/$DB_NAME" ]]; then
    info "Sichere den aktuellen Stand vorsichtshalber (Präfix vor-restore)"
    create_backup vor-restore
    safety="$LAST_BACKUP"
  fi
  service_active && was_active=1
  ((was_active)) && systemctl stop "$SERVICE_NAME"

  find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$stage/data/." "$DATA_DIR/"
  if [[ -f "$stage/config/ultimate-dash.env" ]]; then
    if [[ -f "$ENV_FILE" ]] && ! cmp -s "$stage/config/ultimate-dash.env" "$ENV_FILE"; then
      if confirm "Auch die gesicherte Konfiguration ($ENV_FILE) wiederherstellen?" j; then
        cp -a "$stage/config/ultimate-dash.env" "$ENV_FILE"
      fi
    elif [[ ! -f "$ENV_FILE" ]]; then
      cp -a "$stage/config/ultimate-dash.env" "$ENV_FILE"
    fi
    chown root:"$SERVICE_USER" "$ENV_FILE"
    chmod 0640 "$ENV_FILE"
  fi
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
  chmod 0750 "$DATA_DIR"
  ok "Daten aus $(basename "$archive") wiederhergestellt"

  if service_exists; then
    if start_service; then
      :
    else
      [[ -n "${safety:-}" ]] && warn "Den Stand von vor dem Restore findest du in: $safety"
      return 1
    fi
  else
    warn "Dienst ist noch nicht eingerichtet – Menüpunkt 2 (install ultimate dash) ausführen."
  fi
}

# ---------------------------------------------------------------------------
# Umstieg von Docker (git pull + docker compose) auf diese Installation
# ---------------------------------------------------------------------------
# Übernimmt Datenbank, Datenordner und Einstellungen (.env) einer Docker-Installation.
# Der alte Ordner und seine Daten bleiben unverändert (Rollback: docker compose start).
cmd_migrate_docker() { # migrate_docker [Ordner der Docker-Installation]
  local src="${1:-${UD_DOCKER_DIR:-}}" src_data src_env was_active=0 key line stamp pre_archive
  local -a tar_items=(data)
  local fresh=0
  if [[ -z "$src" ]]; then
    src="$(ask 'Ordner der Docker-Installation (mit docker-compose.yml und data/)' "$PWD")"
  fi
  src="$(readlink -f "$src" 2>/dev/null || echo "$src")"
  src_data="$src/data"
  src_env="$src/.env"
  [[ -f "$src_data/$DB_NAME" ]] || die "Keine Datenbank gefunden: $src_data/$DB_NAME (Ordner mit docker-compose.yml angeben)."
  [[ "$src_data" != "$DATA_DIR" ]] || die "Quelle und Ziel sind derselbe Ordner."

  warn "Der Docker-Container wird gestoppt (nicht gelöscht). Danach übernimmt der systemd-Dienst die Daten."
  confirm "Umstieg von $src auf $APP_DIR jetzt durchführen?" n || {
    info "Abgebrochen."
    return 0
  }

  # 1. Docker anhalten, damit die Datenbank konsistent ist (WAL wird beim Beenden geschrieben).
  if command -v docker >/dev/null 2>&1; then
    if [[ -f "$src/docker-compose.yml" ]]; then
      info "Stoppe den Docker-Container"
      (cd "$src" && docker compose stop) || warn "docker compose stop ist fehlgeschlagen – bitte den Container selbst stoppen"
    fi
    if [[ -n "$(docker ps -q --filter name=^ultimate-dash$ 2>/dev/null)" ]]; then
      die "Der Container ultimate-dash läuft noch. Erst stoppen: docker stop ultimate-dash"
    fi
  else
    warn "Docker nicht gefunden – stelle sicher, dass der Container gestoppt ist."
  fi

  # 2. Sicherung der alten Daten (unabhängig vom Ziel)
  install -d -m 0700 "$BACKUP_DIR"
  stamp="$(date +%Y%m%d-%H%M%S)"
  pre_archive="$BACKUP_DIR/docker-vor-umstieg-${stamp}.tar.gz"
  [[ -f "$src_env" ]] && tar_items+=(.env)
  (umask 077 && tar -C "$src" -czf "$pre_archive" "${tar_items[@]}")
  ok "Sicherung der Docker-Daten: $pre_archive"

  # 3. Programm installieren, falls noch nicht vorhanden (fragt nach Port und Adresse).
  if ! app_installed || ! service_exists; then
    cmd_install
    fresh=1
  fi
  ensure_user_and_dirs
  if service_active; then
    was_active=1
    systemctl stop "$SERVICE_NAME"
  fi

  # 4. Daten übernehmen. Vorhandene Daten im Ziel werden vorher gesichert.
  if ((!fresh)) && [[ -f "$DATA_DIR/$DB_NAME" ]]; then
    warn "Im Ziel ($DATA_DIR) liegt bereits eine Datenbank. Sie wird durch die Docker-Daten ersetzt."
    confirm "Ziel-Daten ersetzen?" n || {
      ((was_active)) && systemctl start "$SERVICE_NAME"
      die "Abgebrochen – nichts verändert."
    }
    (umask 077 && tar -C "$DATA_DIR" -czf "$BACKUP_DIR/ziel-vor-umstieg-${stamp}.tar.gz" .)
  fi
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name update -exec rm -rf {} +
  cp -a "$src_data/." "$DATA_DIR/"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
  chmod 0750 "$DATA_DIR"
  ok "Daten nach $DATA_DIR kopiert"

  # 5. Einstellungen aus der .env übernehmen (ohne die von diesem Skript verwalteten Schlüssel).
  if [[ -f "$src_env" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
      key="${line%%=*}"
      case "$key" in
        NODE_ENV | HOST | PORT | DATA_DIR | WEB_ROOT) continue ;;
      esac
      if grep -q "^${key}=" "$ENV_FILE"; then
        warn "$key steht schon in $ENV_FILE – nicht überschrieben"
      else
        printf '%s\n' "$line" >>"$ENV_FILE"
      fi
    done <"$src_env"
    ok "Einstellungen aus $src_env nach $ENV_FILE übernommen"
  else
    info "Keine .env im alten Ordner – es gibt nichts zu übernehmen"
  fi
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"

  # 6. Starten
  if start_service; then
    cat <<EOF

${C_BOLD}Umstieg abgeschlossen.${C_OFF} Melde dich mit deinem bisherigen Konto an.
  Der Docker-Container bleibt gestoppt: $src (nach einigen Tagen aufräumen: docker compose down)
  Rollback: sudo systemctl stop $SERVICE_NAME && (cd $src && docker compose start)
EOF
  else
    err "Start fehlgeschlagen. Rollback: sudo systemctl stop $SERVICE_NAME && (cd $src && docker compose start)"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 5: Update
# ---------------------------------------------------------------------------
cmd_update() {
  app_installed || die "Ultimate Dash ist nicht installiert (Menüpunkt 2)."
  local old_rev new_rev
  old_rev="$(git -C "$APP_DIR" rev-parse HEAD)"
  git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  if [[ -n "${UD_TARGET_REF:-}" ]]; then
    git -C "$APP_DIR" fetch --prune --tags --force origin
    new_rev="$(git -C "$APP_DIR" rev-parse --verify -q "refs/tags/${UD_TARGET_REF}^{commit}")" ||
      die "Release $UD_TARGET_REF existiert nicht in $REPO_URL."
  else
    git -C "$APP_DIR" fetch --prune origin "$BRANCH"
    new_rev="$(git -C "$APP_DIR" rev-parse "origin/$BRANCH")"
  fi
  if [[ "$old_rev" == "$new_rev" ]] && [[ -f "$APP_DIR/apps/server/dist/main.js" ]]; then
    ok "Bereits auf dem neuesten Stand (${old_rev:0:8})"
    return 0
  fi
  info "Update ${old_rev:0:8} → ${new_rev:0:8}"
  info "Sichere vorher die Daten"
  create_backup vor-update

  cmd_deps # Node/pnpm-Anforderungen können sich geändert haben
  ensure_user_and_dirs
  local was_active=0
  service_active && was_active=1
  ((was_active)) && systemctl stop "$SERVICE_NAME"

  if ! { fetch_source && build_app; }; then
    err "Update fehlgeschlagen – setze auf ${old_rev:0:8} zurück"
    git -C "$APP_DIR" reset -q --hard "$old_rev"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
    as_service_user bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm build" || true
    ((was_active)) && systemctl start "$SERVICE_NAME" || true
    die "Update fehlgeschlagen. Der alte Stand wurde wiederhergestellt."
  fi
  write_service
  if ! start_service; then
    warn "Neuer Stand startet nicht. Zurücksetzen: Backup einspielen (Menüpunkt 7) und UD_BRANCH prüfen."
    return 1
  fi
  ok "Update abgeschlossen"
}

# ---------------------------------------------------------------------------
# 3: Repair
# ---------------------------------------------------------------------------
cmd_repair() {
  local problems=0 fixed=0
  note_fixed() {
    fixed=$((fixed + 1))
    ok "Repariert: $*"
  }
  note_problem() {
    problems=$((problems + 1))
    err "Problem: $*"
  }

  info "Prüfe Systemabhängigkeiten"
  local pkg missing=()
  for pkg in "${APT_PACKAGES[@]}"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if ((${#missing[@]} > 0)); then
    warn "Fehlende Pakete: ${missing[*]}"
    apt_run update -qq && apt_run install -y -qq "${missing[@]}" && note_fixed "Pakete installiert" ||
      note_problem "Pakete konnten nicht installiert werden"
  fi
  if (($(node_major) < NODE_MAJOR)); then
    warn "Node.js fehlt oder ist älter als ${NODE_MAJOR}"
    install_node && note_fixed "Node.js $(node -v)" || note_problem "Node.js"
  else
    ok "Node.js $(node -v)"
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    warn "pnpm fehlt"
    install_pnpm && note_fixed "pnpm $(pnpm_version)" || note_problem "pnpm"
  else
    ok "pnpm vorhanden (corepack)"
  fi

  info "Prüfe Benutzer, Ordner und Rechte"
  id "$SERVICE_USER" >/dev/null 2>&1 || warn "Systembenutzer $SERVICE_USER fehlt"
  ensure_user_and_dirs
  if app_installed; then
    chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR" "$DATA_DIR"
    chmod 0750 "$DATA_DIR"
    [[ -f "$DATA_DIR/$DB_NAME" ]] && chmod 0640 "$DATA_DIR/$DB_NAME"
    ok "Besitzer und Rechte gesetzt"
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    warn "Konfiguration fehlt"
    ensure_env_file && note_fixed "Konfiguration neu erstellt"
  else
    chown root:"$SERVICE_USER" "$ENV_FILE"
    chmod 0640 "$ENV_FILE"
    ok "Konfiguration: $ENV_FILE"
  fi

  if ! app_installed; then
    note_problem "Ultimate Dash ist nicht installiert (Menüpunkt 2)"
  else
    info "Prüfe Programmdateien"
    git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
    if ! git -C "$APP_DIR" diff --quiet HEAD 2>/dev/null; then
      warn "Lokale Änderungen im Programmordner – setze sie zurück"
      git -C "$APP_DIR" reset -q --hard HEAD && note_fixed "Programmdateien zurückgesetzt"
    fi
    local need_build=0
    [[ -d "$APP_DIR/node_modules" ]] || need_build=1
    [[ -f "$APP_DIR/apps/server/dist/main.js" ]] || need_build=1
    [[ -f "$APP_DIR/apps/web/build/index.html" ]] || need_build=1
    if ((need_build == 0)); then
      as_service_user node -e "require('$APP_DIR/apps/server/node_modules/better-sqlite3')(':memory:').close()" \
        >/dev/null 2>&1 || {
        warn "better-sqlite3 lässt sich nicht laden"
        need_build=1
      }
    fi
    if ((need_build)); then
      warn "Node-Module oder Build unvollständig – installiere und baue neu"
      if as_service_user bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm rebuild better-sqlite3 && pnpm build"; then
        note_fixed "Node-Module und Build"
      else
        note_problem "pnpm install/build ist fehlgeschlagen"
      fi
    else
      ok "Node-Module und Build sind vollständig"
    fi

    if [[ -f "$DATA_DIR/$DB_NAME" ]] && command -v sqlite3 >/dev/null 2>&1; then
      if [[ "$(sqlite3 "$DATA_DIR/$DB_NAME" 'PRAGMA integrity_check;' 2>&1)" == "ok" ]]; then
        ok "Datenbank ist in Ordnung"
      else
        note_problem "Datenbank fehlerhaft – Backup einspielen (Menüpunkt 7)"
      fi
    fi
  fi

  info "Prüfe systemd-Dienst"
  if app_installed; then
    write_service
    systemctl is-enabled --quiet "$SERVICE_NAME" || systemctl enable "$SERVICE_NAME" >/dev/null
    if ! service_active || ! health_check 5; then
      warn "Dienst läuft nicht oder antwortet nicht – starte neu"
      if start_service; then note_fixed "Dienst läuft"; else note_problem "Dienst startet nicht"; fi
    else
      ok "Dienst läuft und antwortet auf Port $(app_port)"
    fi
  fi

  echo
  if ((problems == 0)); then
    ok "Alles in Ordnung ($fixed Reparatur(en))"
  else
    err "$problems Problem(e) bleiben. Details oben und im Log: journalctl -u $SERVICE_NAME -n 50"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 8: Dienste neu starten
# ---------------------------------------------------------------------------
cmd_restart() {
  service_exists || die "Der Dienst $SERVICE_NAME ist nicht eingerichtet (Menüpunkt 2)."
  info "Starte $SERVICE_NAME neu"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  if health_check 40; then
    ok "Dienst läuft und antwortet auf Port $(app_port)"
  else
    err "Der Dienst antwortet nicht. Log: journalctl -u $SERVICE_NAME -n 50 --no-pager"
    return 1
  fi
  systemctl --no-pager --lines=0 status "$SERVICE_NAME" || true
}

# ---------------------------------------------------------------------------
# 9: Deinstallieren
# ---------------------------------------------------------------------------
cmd_uninstall() {
  if ! app_installed && ! service_exists && [[ ! -d "$DATA_DIR" ]]; then
    warn "Ultimate Dash ist nicht installiert."
    return 0
  fi
  warn "Entfernt Dienst und Programm ($APP_DIR). Daten, Konfiguration und Backups bleiben standardmäßig erhalten."
  confirm "Ultimate Dash wirklich deinstallieren?" n || {
    info "Abgebrochen."
    return 0
  }
  if [[ -f "$DATA_DIR/$DB_NAME" ]] && confirm "Vorher ein Backup anlegen?" j; then
    create_backup vor-uninstall
  fi

  if service_exists; then
    info "Entferne systemd-Dienst"
    systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -f "$UPDATE_PATH_FILE" || -f "$UPDATE_SERVICE_FILE" ]]; then
    systemctl disable --now "${UPDATE_NAME}.path" >/dev/null 2>&1 || true
    rm -f "$UPDATE_PATH_FILE" "$UPDATE_SERVICE_FILE"
    systemctl daemon-reload
  fi
  if [[ -d "$APP_DIR" ]]; then
    info "Entferne Programmordner $APP_DIR"
    rm -rf "$APP_DIR"
  fi
  git config --global --unset-all safe.directory "$APP_DIR" 2>/dev/null || true

  # Daten nur nach ausdrücklicher Eingabe löschen (UD_PURGE=1 für Automatisierung).
  local purge=0
  if [[ "${UD_PURGE:-0}" == "1" ]]; then
    purge=1
  elif [[ -d "$DATA_DIR" || -d "$CONF_DIR" ]]; then
    warn "Daten ($DATA_DIR) und Konfiguration ($CONF_DIR) enthalten Datenbank und Zugangsdaten."
    [[ "$(ask "Zum endgültigen Löschen 'loeschen' eingeben, sonst Enter" '')" == "loeschen" ]] && purge=1
  fi
  if ((purge)); then
    rm -rf "$DATA_DIR" "$CONF_DIR"
    ok "Daten und Konfiguration gelöscht"
    if id "$SERVICE_USER" >/dev/null 2>&1; then
      userdel "$SERVICE_USER" 2>/dev/null && ok "Benutzer $SERVICE_USER entfernt" || true
    fi
  else
    ok "Daten ($DATA_DIR) und Konfiguration ($CONF_DIR) bleiben erhalten"
  fi
  ok "Ultimate Dash ist deinstalliert. Backups liegen weiterhin in $BACKUP_DIR."
  info "Node.js, pnpm und Systempakete bleiben installiert (können andere Programme nutzen)."
}

# ---------------------------------------------------------------------------
# Update aus der Oberfläche
# ---------------------------------------------------------------------------
# Status für die Oberfläche; nur root schreibt ihn (liegt unter /run, nicht im Datenordner).
update_status() { # update_status <ok|running|failed> <Version> <Meldung>
  local msg="${3//[\"\\]/}"
  msg="$(printf '%s' "$msg" | tr -d '\n\r' | cut -c1-300)"
  install -d -m 0755 "$(dirname "$UPDATE_STATUS_FILE")"
  printf '{"state":"%s","version":"%s","message":"%s","at":"%s"}\n' \
    "$1" "$2" "$msg" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$UPDATE_STATUS_FILE.tmp"
  mv -f "$UPDATE_STATUS_FILE.tmp" "$UPDATE_STATUS_FILE"
}

# Wird von ultimate-dash-update.service gestartet, sobald das Dashboard eine Anfrage ablegt.
# Die Anfrage stammt vom (unprivilegierten) Dienstbenutzer: Sie wird streng geprüft und nur als
# Release-Tag des eigenen Repositorys verwendet, nie als Befehl.
cmd_apply_update_request() {
  local raw tag rc
  if [[ ! -f "$UPDATE_REQUEST_FILE" || -L "$UPDATE_REQUEST_FILE" ]]; then
    info "Keine Update-Anfrage vorhanden"
    rm -f "$UPDATE_REQUEST_FILE"
    return 0
  fi
  raw="$(head -c 100 "$UPDATE_REQUEST_FILE" | head -n1 | tr -d '[:space:]')"
  rm -f "$UPDATE_REQUEST_FILE" # zuerst entfernen, sonst startet die Path-Unit endlos neu
  if [[ ! "$raw" =~ ^v[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(-[0-9A-Za-z.-]{1,40})?$ ]]; then
    update_status failed unbekannt "Ungültige Update-Anfrage"
    err "Ungültige Update-Anfrage verworfen"
    return 1
  fi
  tag="$raw"

  exec 9>/var/lock/ultimate-dash-install.lock
  if ! flock -w 60 9; then
    update_status failed "$tag" "Ein anderer Lauf des Installationsskripts ist noch aktiv (Menü oder Update im Terminal beenden)"
    return 1
  fi
  if ! app_installed; then
    update_status failed "$tag" "Ultimate Dash ist nicht per install.sh installiert"
    return 1
  fi
  update_status running "$tag" "Update wird installiert"
  info "Update-Anfrage aus der Oberfläche: $tag"

  set +e
  (
    set -e
    UD_TARGET_REF="$tag"
    cmd_update
  )
  rc=$?
  set -e
  if ((rc == 0)); then
    update_status ok "$tag" "Update abgeschlossen"
  else
    update_status failed "$tag" "Update fehlgeschlagen, der alte Stand wurde wiederhergestellt. Details: journalctl -u $UPDATE_NAME"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Menü
# ---------------------------------------------------------------------------
status_line() {
  local state='nicht installiert'
  if app_installed; then
    service_active && state="${C_GREEN}läuft${C_OFF}" || state="${C_YELLOW}installiert, Dienst gestoppt${C_OFF}"
  fi
  printf 'Status: %s   (Programm: %s, Daten: %s)\n' "$state" "$APP_DIR" "$DATA_DIR"
}

run_action() { # Fehler einer Aktion beenden nicht das Menü
  local rc=0
  trap - ERR
  set +e
  # Die Sperre gilt nur während der Aktion (Subshell), nicht für das offene Menü: Sonst blockiert
  # ein im Terminal vergessenes Menü Updates aus der Oberfläche.
  ( trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR; set -e; acquire_lock; "$@" )
  rc=$?
  set -e
  trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR
  ((rc == 0)) || err "Aktion mit Fehler beendet (Code $rc)"
  return 0
}

menu() {
  local choice
  while true; do
    echo
    printf '%sUltimate Dash – Installation und Wartung%s\n' "$C_BOLD" "$C_OFF"
    status_line
    cat <<'EOF'

  1) install dependencies
  2) install ultimate dash
  3) repair system
  4) update dependencies
  5) update ultimate dash
  6) create local backup
  7) restore local backup
  8) restart services
  9) uninstall ultimate dash
  10) exit

EOF
    choice="$(ask 'Auswahl' '')"
    case "$choice" in
      1) run_action cmd_deps ;;
      2) run_action cmd_install ;;
      3) run_action cmd_repair ;;
      4) run_action cmd_update_deps ;;
      5) run_action cmd_update ;;
      6) run_action cmd_backup ;;
      7) run_action cmd_restore ;;
      8) run_action cmd_restart ;;
      9) run_action cmd_uninstall ;;
      10 | 0 | q | exit) exit 0 ;;
      '') [[ -n "$TTY_IN" ]] || die "Kein Terminal für das Menü. Aufruf mit Unterbefehl, z. B.: $0 install" ;;
      *) warn "Ungültige Auswahl: $choice" ;;
    esac
    pause
  done
}

usage() {
  cat <<EOF
Aufruf: sudo $0 [deps|install|repair|update-deps|update|backup|restore|restart|uninstall|migrate-docker [Ordner]]
Update auf ein Release: sudo UD_TARGET_REF=v1.2.0 $0 update
Ohne Argument startet das interaktive Menü.
EOF
}

main() {
  case "${1:-}" in
    -h | --help | help)
      usage
      exit 0
      ;;
  esac
  require_root
  require_os
  if [[ "${1:-}" == "apply-update-request" ]]; then
    # Das Update ersetzt install.sh im Git-Checkout; bash liest Skripte beim Ausführen nach.
    # Deshalb läuft eine Kopie, die vom Checkout unabhängig ist.
    if [[ -z "${UD_SELF_COPY:-}" ]]; then
      local copy
      copy="$(mktemp --suffix=.sh)"
      cp "${BASH_SOURCE[0]}" "$copy"
      exec env UD_SELF_COPY="$copy" bash "$copy" apply-update-request
    fi
    cmd_apply_update_request
    return
  fi
  if [[ -n "${1:-}" ]]; then acquire_lock; fi
  case "${1:-}" in
    '') menu ;; # Sperre erst je Aktion (run_action)
    deps) cmd_deps ;;
    install) cmd_install ;;
    repair) cmd_repair ;;
    update-deps) cmd_update_deps ;;
    update) cmd_update ;;
    backup) cmd_backup ;;
    restore) cmd_restore ;;
    restart) cmd_restart ;;
    uninstall) cmd_uninstall ;;
    migrate-docker) cmd_migrate_docker "${2:-}" ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
