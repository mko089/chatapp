import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0e1117',
          elevated: '#11161d',
          muted: '#1a212c',
        },
        primary: {
          DEFAULT: '#4ade80',
          foreground: '#032310',
        },
        accent: {
          DEFAULT: '#60a5fa',
          foreground: '#0a1f3c',
        },
        danger: '#f87171',
        warning: '#facc15',
      },
      boxShadow: {
        card: '0 8px 20px -8px rgba(15, 23, 42, 0.5)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.02)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '1rem',
      },
    },
  },
  plugins: [],
};

export default config;
