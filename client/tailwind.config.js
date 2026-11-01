/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#070b14',
          900: '#0b1120',
          850: '#0e172a',
          800: '#121e36',
          700: '#1a2b4c',
          600: '#233966',
        },
        aqi: {
          good: '#10B981',        // 0-30
          satisfactory: '#34D399',// 31-60
          moderate: '#FBBF24',    // 61-90
          poor: '#F97316',        // 91-120
          veryPoor: '#EF4444',    // 121-250
          severe: '#7F1D1D',      // 250+
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
}
