import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // 暫時開啟 production sourcemap，協助定位 Capacitor 白屏錯誤
    sourcemap: true,
  },
});
