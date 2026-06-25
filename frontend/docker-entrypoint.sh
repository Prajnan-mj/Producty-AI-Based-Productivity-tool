#!/bin/sh
# Inject runtime API_URL into config.js so the React app can discover the backend.
cat > /usr/share/nginx/html/config.js <<EOF
window.__PRODUCTY_CONFIG__ = {
  API_URL: "${API_URL:-}",
};
EOF

exec "$@"
