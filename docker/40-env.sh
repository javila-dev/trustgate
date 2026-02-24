#!/bin/sh
set -eu

js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

SUPABASE_URL_ESCAPED="$(js_escape "${VITE_SUPABASE_URL:-}")"
SUPABASE_ANON_KEY_ESCAPED="$(js_escape "${VITE_SUPABASE_ANON_KEY:-}")"

cat > /usr/share/nginx/html/env.js <<EOF
window.__ENV__ = {
  VITE_SUPABASE_URL: "$SUPABASE_URL_ESCAPED",
  VITE_SUPABASE_ANON_KEY: "$SUPABASE_ANON_KEY_ESCAPED"
}
EOF
