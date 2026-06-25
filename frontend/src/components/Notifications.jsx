import { Toaster } from "react-hot-toast";

export default function Notifications() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3500,
        style: {
          background: "#1A1D27",
          color: "#F1F5F9",
          border: "1px solid #2D3148",
          borderRadius: "12px",
          fontSize: "13px",
          fontFamily: "Inter, sans-serif",
        },
        success: { iconTheme: { primary: "#34D399", secondary: "#1A1D27" } },
        error: { iconTheme: { primary: "#F87171", secondary: "#1A1D27" } },
      }}
    />
  );
}
