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
          DEFAULT: "#0e7490",
          dark: "#155e75",
          light: "#06b6d4",
        },
      },
    },
  },
  safelist: ["pt-18"],
  plugins: [],
};
export default config;
