import { defineConfig, presetAttributify, presetWind } from "unocss"

export default defineConfig({
  presets: [
    presetWind(),
    presetAttributify({
      prefix: "un-",
      prefixedOnly: true,
    }),
  ],
  shortcuts: {
    "glass": "backdrop-blur-xl bg-[#0a0a1a]/80 border border-[#1a1a3e]/50 rounded-xl",
    "neon-text": "text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]",
    "neon-border": "border border-cyan-400/30 shadow-[0_0_15px_rgba(34,211,238,0.1)]",
    "btn-primary": "px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all duration-300 active:scale-95 cursor-pointer",
    "btn-ghost": "px-4 py-2 rounded-lg border border-[#1a1a3e]/50 text-gray-300 hover:border-cyan-400/30 hover:text-cyan-300 transition-all duration-300 cursor-pointer",
    "input-field": "w-full px-4 py-2 rounded-lg bg-[#0a0a1a]/60 border border-[#1a1a3e]/50 text-gray-200 placeholder-gray-500 focus:border-cyan-400/50 focus:outline-none focus:shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all duration-300",
    "card": "glass p-6 neon-border",
  },
  theme: {
    colors: {
      dark: {
        900: "#020212",
        800: "#0a0a1a",
        700: "#0f0f2a",
        600: "#1a1a3e",
      },
    },
  },
})
