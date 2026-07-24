#!/bin/bash
set -euo pipefail

mkdir -p /home/container/logs /home/container/data

if [[ ! -f /home/container/config.json && -f /app/config.json ]]; then
	export STREAM_NOTIFIER_SUPPRESS_INITIAL_ONLINE=true
	echo "Legacy Coolify config detected; suppressing initial online notifications"
fi

echo "Stream Notifier data directory: /home/container"

MODIFIED_STARTUP=$(eval echo "$(echo "${STARTUP:-/opt/stream-notifier/stream-notifier}" | sed -e 's/{{/${/g' -e 's/}}/}/g')")
echo ":/home/container$ ${MODIFIED_STARTUP}"

exec bash -lc "${MODIFIED_STARTUP}"
