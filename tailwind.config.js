/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#111110',
          sidebar: '#0e0e0d',
          card: '#1a1a18',
          hover: '#222220',
          input: '#161614',
        },
        border: {
          DEFAULT: '#2a2a28',
          subtle: '#222220',
          focus: '#3a3a38',
        },
        accent: {
          DEFAULT: '#c96a2a',
          hover: '#d97a3a',
          muted: 'rgba(201, 106, 42, 0.15)',
          text: '#e8944a',
        },
        success: {
          DEFAULT: '#6a9955',
          hover: '#7ab965',
          muted: 'rgba(106, 153, 85, 0.15)',
          text: '#8abf6a',
        },
        text: {
          DEFAULT: '#e8e6e1',
          secondary: '#a8a49e',
          muted: '#6a6860',
          inverse: '#111110',
        },
        danger: {
          DEFAULT: '#d45555',
          hover: '#e06565',
          muted: 'rgba(212, 85, 85, 0.15)',
        },
        warning: {
          DEFAULT: '#d4a855',
          muted: 'rgba(212, 168, 85, 0.15)',
          text: '#e8c46a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
        'fade-in': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        'slide-up': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
