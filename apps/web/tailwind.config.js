/** @type {import('tailwindcss').Config} */

// Warm neutrals instead of Tailwind's default blue-grey: every existing
// `slate-*` class in the app picks these up without touching the markup.
const ink = {
  50: "#f7f6f3",
  100: "#efede8",
  200: "#e4e1da",
  300: "#d0ccc3",
  400: "#a5a095",
  500: "#78736a",
  600: "#5c5851",
  700: "#46433e",
  800: "#2e2c29",
  900: "#1c1b19",
  950: "#121110",
};

// Workwear yellow — used sparingly: active nav, links, focus.
const accent = {
  50: "#fdf8e7",
  100: "#faefc4",
  200: "#f5df8a",
  300: "#f0cd52",
  400: "#ebbd2a",
  500: "#d8a712",
  600: "#b3870b",
  700: "#86640c",
};

export default {
  content: ["./public/**/*.html", "./public/js/**/*.js"],
  theme: {
    extend: {
      colors: { slate: ink, accent },
      fontFamily: {
        sans: ['"Instrument Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
