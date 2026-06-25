import { Toaster } from "react-hot-toast";

export default function Notifications() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3500,
        style: {
          background: "#FFFFFF",
          color: "#211D18",
          border: "1px solid #E4DCCE",
          borderRadius: "12px",
          fontSize: "13px",
          fontFamily: "Inter, sans-serif",
        },
        success: { iconTheme: { primary: "#B4522E", secondary: "#FFFFFF" } },
        error: { iconTheme: { primary: "#C2334D", secondary: "#FFFFFF" } },
      }}
    />
  );
}
