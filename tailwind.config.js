/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: '#12302a',
        'forest-mid': '#1e4a3f',
        gold: '#b8935a',
        'gold-light': '#d4aa70',
        cream: '#f5f0e8',
        'cream-dark': '#ede6d6',
        warmwhite: '#faf8f4',
        charcoal: '#1a1a1a',
        border: 'rgba(18,48,42,0.12)',
      },
      fontFamily: {
        heading: ['Fraunces', 'serif'],
        body: ['Mulish', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

