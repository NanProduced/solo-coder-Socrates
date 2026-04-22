/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./popup.tsx",
    "./options.tsx",
    "./sidepanel.tsx",
    "./background.ts",
    "./lib/**/*.{ts,tsx}",
    "./contents/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        'notion': {
          'bg': '#ffffff',
          'bg-secondary': '#f7f6f3',
          'text': '#37352f',
          'text-secondary': '#787774',
          'border': '#e3e2e0',
          'hover': '#f7f6f3',
          'accent': '#2eaadc',
          'accent-hover': '#1c96c5',
        }
      },
      boxShadow: {
        'notion': '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
        'notion-hover': '0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)',
      }
    },
  },
  plugins: [],
}
