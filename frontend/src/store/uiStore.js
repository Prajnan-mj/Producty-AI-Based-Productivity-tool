import { create } from "zustand";

const useUiStore = create((set) => ({
  sidebarOpen: false,
  aiPanelOpen: false,
  activeTab: "dashboard",
  notifications: [],

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  addNotification: (n) =>
    set((s) => ({ notifications: [...s.notifications, { id: Date.now(), ...n }] })),
  clearNotifications: () => set({ notifications: [] }),
}));

export default useUiStore;
