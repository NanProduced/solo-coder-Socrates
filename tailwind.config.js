/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./popup.tsx",
    "./options.tsx",
    "./sidepanel.tsx",
    "./background.ts",
    "./contents/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
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
      spacing: {
        '0.5': '0.125rem',
        '1': '0.25rem',
        '1.5': '0.375rem',
        '2': '0.5rem',
        '3': '0.75rem',
        '4': '1rem',
        '5': '1.25rem',
        '6': '1.5rem',
        '8': '2rem',
      },
      borderRadius: {
        'md': '0.375rem',
        'lg': '0.5rem',
      },
      boxShadow: {
        'notion': '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
        'notion-hover': '0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)',
      }
    },
  },
  plugins: [],
}
