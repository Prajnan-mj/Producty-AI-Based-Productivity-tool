import axios from "axios";

function getApiBase() {
  const vite = import.meta.env.VITE_API_URL;
  if (vite && vite.length > 0) return vite;
  const runtime = window.__PRODUCTY_CONFIG__?.API_URL;
  if (runtime && runtime.length > 0) return runtime;
  return "/api";
}

const api = axios.create({
  baseURL: getApiBase(),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }
  return Promise.reject(error);
});

export default api;
