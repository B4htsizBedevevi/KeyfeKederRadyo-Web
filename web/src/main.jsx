import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import "./styles.css";

const rootElement =
  document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "React root elementi bulunamadı."
  );
}

ReactDOM.createRoot(
  rootElement
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);