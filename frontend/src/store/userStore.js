import { create } from "zustand";

const useUserStore = create((set) => ({
  user: null,
  token: localStorage.getItem("token") || null,

  setUser: (user) => set({ user }),

  setToken: (token) => {
    if (token) localStorage.setItem("token", token);
    else localStorage.removeItem("token");
    set({ token });
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ user: null, token: null });
    window.location.href = "/login";
  },
}));

export default useUserStore;
