import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { AuthGate } from "./components/LoginScreen";
import { installFieldArrowNav } from "./lib/fieldNav";
import { installNoteColors } from "./lib/noteColors";

installFieldArrowNav();
installNoteColors();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
