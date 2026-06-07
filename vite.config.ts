import { defineConfig } from "vite"
import { resolve } from "path"
import UnoCSS from "unocss/vite"

export default defineConfig({
  plugins: [UnoCSS()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
result: resolve(__dirname, "result.html"),
      },
    },
  },
})
