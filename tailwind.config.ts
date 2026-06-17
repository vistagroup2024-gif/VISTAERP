import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      spacing: { "18": "4.5rem" },
      colors: {
        brand: {
          DEFAULT: "#1a6b5a",
          dark: "#124a3e",
          light: "#2a9b82",
          orange: "#e8511a",
        },
      },
    },
  },
  safelist: ["pt-18"],
  plugins: [],
};
export default config;
