import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tq: "#22b8c4", "tq-600": "#1aa0ab", "tq-dark": "#1c6e7e",
        ink: "#3a3f44", head: "#2f3438", muted: "#8a9499",
        line: "#ececec", soft: "#f7f8f8", orange: "#f2762e",
        spon: "#fbf2dc", "spon-ink": "#9a6b08", verified: "#1c8290",
      },
      fontFamily: { sans: ["Poppins", "Segoe UI", "Helvetica", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;

