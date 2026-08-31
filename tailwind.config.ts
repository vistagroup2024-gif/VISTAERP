import type { Config } from "tailwindcss";

// Vista Group design system — restrained enterprise palette.
// Primary brand is the Vista green (from logo.svg #08604f); orange is a rare
// accent only. Neutrals carry the UI; semantic colors are functional only.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      spacing: { "18": "4.5rem" },
      colors: {
        // Vista green — full scale. `brand` (DEFAULT/dark/light/orange) kept for
        // backward compatibility with existing bg-brand / text-brand usages.
        brand: {
          50: "#eef6f3",
          100: "#d6ebe4",
          200: "#aed7ca",
          300: "#7cbcaa",
          400: "#4a9d86",
          500: "#0e7d66",
          600: "#0b6a58",
          700: "#08604f",
          800: "#094c40",
          900: "#0a3f36",
          DEFAULT: "#0b6a58",
          dark: "#08604f",
          light: "#eef6f3",
          orange: "#e63c13",
        },
        // Functional semantic colors (used only where they carry meaning).
        success: { DEFAULT: "#15803d", soft: "#dcfce7", fg: "#166534" },
        warning: { DEFAULT: "#b45309", soft: "#fef3c7", fg: "#92400e" },
        danger: { DEFAULT: "#b91c1c", soft: "#fee2e2", fg: "#991b1b" },
        info: { DEFAULT: "#1d4ed8", soft: "#dbeafe", fg: "#1e40af" },
      },
      borderRadius: {
        DEFAULT: "0.375rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        pop: "0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)",
      },
    },
  },
  safelist: ["pt-18"],
  plugins: [],
};
export default config;
