#!/bin/sh
# Project-local PostgreSQL 15 for development. Data lives in backend/.pgdata (git-ignored), port 54329,
# password authentication (scram-sha-256) only. Two roles:
#   tessera_owner  owns the schema, runs migrations and seeding
#   tessera_app    what the API connects as: no DDL, no UPDATE/DELETE on the audit log, row-level security applies
set -e
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8   # Postgres refuses to start on macOS without an explicit locale
cd "$(dirname "$0")/.."
PG=/opt/homebrew/opt/postgresql@15/bin
DATA=.pgdata
PORT=54329
ENVF=.env
case "$1" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      node scripts/genenv.mjs
      PWF=$(mktemp); grep ^OWNER_PASSWORD $ENVF | cut -d= -f2 | tr -d '\n' > "$PWF"
      $PG/initdb -D $DATA -U postgres --auth=scram-sha-256 --pwfile="$PWF" -E UTF8 >/dev/null
      rm -f "$PWF"
      echo "listen_addresses = 'localhost'" >> $DATA/postgresql.conf
      echo "port = $PORT" >> $DATA/postgresql.conf
      echo "password_encryption = scram-sha-256" >> $DATA/postgresql.conf
    fi
    $PG/pg_ctl -D $DATA -l $DATA/server.log -w start >/dev/null && echo "postgres running on localhost:$PORT"
    ;;
  stop) $PG/pg_ctl -D $DATA -w stop >/dev/null && echo "postgres stopped" ;;
  reset) $PG/pg_ctl -D $DATA -w stop >/dev/null 2>&1 || true; rm -rf $DATA; echo "data removed (secrets in $ENVF kept)" ;;
  *) echo "usage: db.sh start|stop|reset"; exit 1 ;;
esac
