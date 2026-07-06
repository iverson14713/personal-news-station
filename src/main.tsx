import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppStoreScreenshots from "./AppStoreScreenshots";
import { AiAnchorAudioProvider } from "./AiAnchorAudioProvider";
import { initSupabaseAuth, isSupabaseConfigured } from "./supabaseClient";
import { setupNativeKeyboard } from "./keyboardSetup";

if (isSupabaseConfigured()) {
  void initSupabaseAuth();
}
void setupNativeKeyboard();

function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/app-store-screenshot")) {
    return <AppStoreScreenshots />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AiAnchorAudioProvider>
      <Root />
    </AiAnchorAudioProvider>
  </React.StrictMode>
);
