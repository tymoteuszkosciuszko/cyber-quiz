/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        heading: ['"Space Grotesk"', '"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        main: 'var(--main)',
        overlay: 'var(--overlay)',
        background: 'var(--background)',
        'secondary-background': 'var(--secondary-background)',
        foreground: 'var(--foreground)',
        'main-foreground': 'var(--main-foreground)',
        border: 'var(--border)',
        ring: 'var(--ring)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        info: 'var(--info)',
        purple: 'var(--purple)',
      },
      borderRadius: {
        base: '5px',
      },
      boxShadow: {
        shadow: 'var(--shadow)',
      },
      translate: {
        boxShadowX: '4px',
        boxShadowY: '4px',
        reverseBoxShadowX: '-4px',
        reverseBoxShadowY: '-4px',
      },
      fontWeight: {
        base: '500',
        heading: '700',
      },
    },
  },
  plugins: [],
};
