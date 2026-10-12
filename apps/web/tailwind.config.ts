import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ocean: {
          950: "#060913",
          900: "#0a1124",
          850: "#0e1833",
          800: "#132347",
          700: "#1c3266",
          600: "#27458b",
        },
        drift: {
          high: "#ef4444",
          moderate: "#f59e0b",
          low: "#3b82f6",
          neutral: "#64748b",
        },
        sensor: {
          viirs: "#38bdf8",
          tracking: "#10b981",
          weather: "#a855f7",
        }
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      }
    },
  },
  plugins: [],
};
export default config;
