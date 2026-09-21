/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#F7F7F5",
        "surface-raised": "#FFFFFF",
        ink: { DEFAULT: "#15181D", muted: "#5B6169" },
        line: "#E4E3DF",
        brand: { DEFAULT: "#125C4E", tint: "#E4F1EE" },
        accent: "#C77B3B",
        success: "#1E8E5A",
        warning: "#B8860B",
        danger: "#B23B3B",
        info: "#3B6EA8",
        "dark-surface": "#0F1512",
        "dark-ink": "#EDEDE8",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        sans: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: { control: "6px", card: "12px" },
      boxShadow: { float: "0 1px 2px rgba(15,23,18,.06), 0 8px 24px rgba(15,23,18,.06)" },
    },
  },
  plugins: [],
};
