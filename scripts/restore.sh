#!/usr/bin/env bash
# ==============================================================================
# scripts/restore.sh — Pulihkan database CBT Sekolah dari berkas backup .sql/.sql.gz
#
# PERINGATAN: skrip ini MENIMPA SELURUH ISI database tujuan.
# Sengaja dibuat CLI-only (tidak ada endpoint web) agar pemulihan selalu
# melalui langkah sadar dengan akses terminal/SSH ke server, bukan satu
# klik yang bisa terjadi tanpa sengaja dari browser.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Muat .env jika ada (tanpa menimpa variabel env yang sudah diset di shell)
if [ -f "$PROJECT_ROOT/.env" ]; then
    while IFS='=' read -r key val || [ -n "$key" ]; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key="$(echo "$key" | tr -d '[:space:]')"
        val="$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
        if [ -n "$key" ] && [ -z "${!key:-}" ]; then
            export "$key"="$val"
        fi
    done < "$PROJECT_ROOT/.env"
fi

TARGET_DB="${DB_NAME:-cbt_sekolah}"
DB_USER_VAL="${DB_USER:-root}"
DB_PASS_VAL="${DB_PASSWORD:-}"
DB_HOST_VAL="${DB_HOST:-127.0.0.1}"
DB_PORT_VAL="${DB_PORT:-3306}"
DB_SOCKET_VAL="${DB_SOCKET:-}"
BACKUP_FILE=""
CONFIRM=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --file=*) BACKUP_FILE="${1#*=}"; shift ;;
        --db=*) TARGET_DB="${1#*=}"; shift ;;
        --user=*) DB_USER_VAL="${1#*=}"; shift ;;
        --password=*) DB_PASS_VAL="${1#*=}"; shift ;;
        --host=*) DB_HOST_VAL="${1#*=}"; shift ;;
        --port=*) DB_PORT_VAL="${1#*=}"; shift ;;
        --socket=*) DB_SOCKET_VAL="${1#*=}"; shift ;;
        --confirm=*) CONFIRM="${1#*=}"; shift ;;
        --help|-h)
            echo "Penggunaan: $0 --file=<berkas_backup.sql.gz> --confirm=TIMPA [opsi]"
            echo "Opsi:"
            echo "  --file=<path>        Berkas backup .sql atau .sql.gz (wajib)"
            echo "  --confirm=TIMPA      Wajib diisi persis 'TIMPA' sebagai pengaman"
            echo "  --db=<nama_db>       Database tujuan (default: DB_NAME atau cbt_sekolah)"
            echo "  --user=<db_user>     User database (default: DB_USER atau root)"
            echo "  --password=<db_pass> Password database (default: DB_PASSWORD)"
            echo "  --host=<db_host>     Host database (default: DB_HOST atau 127.0.0.1)"
            echo "  --port=<db_port>     Port database (default: DB_PORT atau 3306)"
            echo "  --socket=<path>      UNIX domain socket (default: DB_SOCKET)"
            exit 0
            ;;
        *) echo "[ERROR] Opsi tidak dikenal: $1" >&2; exit 1 ;;
    esac
done

if [ -z "$BACKUP_FILE" ]; then
    echo "[ERROR] --file=<berkas_backup> wajib diisi. Gunakan --help untuk bantuan." >&2
    exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
    echo "[ERROR] Berkas backup tidak ditemukan: $BACKUP_FILE" >&2
    exit 1
fi
if [ "$CONFIRM" != "TIMPA" ]; then
    echo "[ERROR] Pemulihan akan MENIMPA SELURUH ISI database '$TARGET_DB'." >&2
    echo "[ERROR] Jalankan ulang dengan --confirm=TIMPA jika Anda benar-benar yakin." >&2
    exit 1
fi

if command -v mariadb >/dev/null 2>&1; then
    CLIENT_BIN="mariadb"
elif command -v mysql >/dev/null 2>&1; then
    CLIENT_BIN="mysql"
else
    echo "[ERROR] Tidak ditemukan mariadb atau mysql pada sistem." >&2
    exit 1
fi

CONN_ARGS=(-u "$DB_USER_VAL")
if [ -n "$DB_PASS_VAL" ]; then
    CONN_ARGS+=("-p$DB_PASS_VAL")
fi
if [ -n "$DB_SOCKET_VAL" ] && [ -S "$DB_SOCKET_VAL" ]; then
    CONN_ARGS+=(-S "$DB_SOCKET_VAL")
else
    CONN_ARGS+=(-h "$DB_HOST_VAL" -P "$DB_PORT_VAL")
fi

echo "[RESTORE] Memulihkan '$BACKUP_FILE' ke database '$TARGET_DB' menggunakan $CLIENT_BIN..."

if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | "$CLIENT_BIN" "${CONN_ARGS[@]}" "$TARGET_DB"
else
    "$CLIENT_BIN" "${CONN_ARGS[@]}" "$TARGET_DB" < "$BACKUP_FILE"
fi

echo "[RESTORE] Pemulihan selesai dengan sukses ke database '$TARGET_DB'."
