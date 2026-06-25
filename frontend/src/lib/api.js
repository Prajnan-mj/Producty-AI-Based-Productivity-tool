import axios from "axios";

function getApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (window.__PRODUCTY_CONFIG__?.API_URL) return window.__PRODUCTY_CONFIG__.API_URL;
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
