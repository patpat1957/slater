/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'space-950': '#060612',
        'space-900': '#0d0d20',
        'space-800': '#10102a',
        'space-700': '#16163a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'ball-pop': 'ballPop 0.4s cubic-bezier(0.34,1.56,0.64,1)',
        'slide-up': 'slideUp 0.5s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        ballPop: {
          '0%': { transform: 'scale(0) rotate(-15deg)', opacity: '0' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-purple': '0 0 20px rgba(124,58,237,0.4), 0 0 60px rgba(124,58,237,0.15)',
        'glow-amber': '0 0 20px rgba(245,158,11,0.4), 0 0 60px rgba(245,158,11,0.15)',
        'glow-green': '0 0 20px rgba(16,185,129,0.4)',
        'card': '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
        'card-hover': '0 16px 48px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08)',
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        lotto: {
          "primary": "#7c3aed",
          "primary-content": "#ffffff",
          "secondary": "#f59e0b",
          "secondary-content": "#000000",
          "accent": "#10b981",
          "accent-content": "#ffffff",
          "neutral": "#16163a",
          "neutral-content": "#e8eaf0",
          "base-100": "#060612",
          "base-200": "#0d0d20",
          "base-300": "#10102a",
          "base-content": "#e8eaf0",
          "info": "#3b82f6",
          "success": "#10b981",
          "warning": "#f59e0b",
          "error": "#ef4444",
        },
      },
    ],
    darkTheme: "lotto",
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
};
