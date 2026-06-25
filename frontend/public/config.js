// Runtime config — overwritten by Docker entrypoint in production.
// In local dev this file is served as-is (empty API_URL = use /api proxy).
window.__PRODUCTY_CONFIG__ = {
  API_URL: "",
};
