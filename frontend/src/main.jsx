import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import AppShell from "./App";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import CalendarPage from "./pages/Calendar";
import Tasks from "./pages/Tasks";
import Bills from "./pages/Bills";
import Habits from "./pages/Habits";
import Goals from "./pages/Goals";
import Journal from "./pages/Journal";
import Documents from "./pages/Documents";
import Notes from "./pages/Notes";
import SharedPanic from "./pages/SharedPanic";
import Focus from "./pages/Focus";
import Countdown from "./pages/Countdown";
import Rooms from "./pages/Rooms";
import Flashcards from "./pages/Flashcards";
import Rescue from "./pages/Rescue";
import Capture from "./pages/Capture";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/share/panic/:token" element={<SharedPanic />} />

          {/* Protected app shell */}
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/habits" element={<Habits />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/focus" element={<Focus />} />
            <Route path="/flashcards" element={<Flashcards />} />
            <Route path="/countdown" element={<Countdown />} />
            {/* <Route path="/rooms" element={<Rooms />} /> */}
            <Route path="/rescue" element={<Rescue />} />
            <Route path="/capture" element={<Capture />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
