import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary title="Ghost Fleet X hit an error. Reload the page to continue.">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
