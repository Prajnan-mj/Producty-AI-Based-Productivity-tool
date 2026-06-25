import { Toaster } from "react-hot-toast";

export default function Notifications() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3500,
        style: {
          background: "#141A21",
          color: "#E7EAED",
          border: "1px solid #2A2F36",
          borderRadius: "12px",
          fontSize: "13px",
          fontFamily: "Inter, sans-serif",
        },
        success: { iconTheme: { primary: "#FFB000", secondary: "#141A21" } },
        error: { iconTheme: { primary: "#FF4D4D", secondary: "#141A21" } },
      }}
    />
  );
}
