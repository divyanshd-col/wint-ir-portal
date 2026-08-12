/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Tokens are wired to the CSS variables in globals.css so there is a
      // single source of truth. New/refactored components should use these
      // utilities (bg-accent, text-content-muted, border-edge, …) instead of
      // hardcoded inline hex.
      colors: {
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          weak: 'var(--accent-weak)',
          on: 'var(--accent-on)',
        },
        surface: {
          DEFAULT: 'var(--color-background-primary)',
          secondary: 'var(--color-background-secondary)',
          tertiary: 'var(--color-background-tertiary)',
        },
        content: {
          DEFAULT: 'var(--color-text-primary)',
          muted: 'var(--color-text-secondary)',
          subtle: 'var(--color-text-tertiary)',
        },
        edge: {
          DEFAULT: 'var(--color-border-tertiary)',
          strong: 'var(--color-border-secondary)',
        },
        status: {
          'danger-bg': 'var(--color-background-danger)',
          'danger-fg': 'var(--color-text-danger)',
          'warning-bg': 'var(--color-background-warning)',
          'warning-fg': 'var(--color-text-warning)',
          'success-bg': 'var(--color-background-success)',
          'success-fg': 'var(--color-text-success)',
          'info-bg': 'var(--color-background-info)',
          'info-fg': 'var(--color-text-info)',
        },
      },
      borderRadius: {
        md: 'var(--border-radius-md)',
        lg: 'var(--border-radius-lg)',
      },
    },
  },
  plugins: [],
};
