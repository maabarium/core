import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Apply the saved theme before the first paint so dark-mode users do not
// see a light flash (and light-mode users no dark one).
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("maabarium-theme") === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
