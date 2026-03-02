import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/components/**/*.{ts,tsx}", "./src/app/**/*.{ts,tsx}", "./src/lib/**/*.{ts,tsx}"],
  theme: {
    /* ── Responsive Breakpoint Scale ─────────────────────── */
    screens: {
      xs: "375px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1440px",
    },

    extend: {
      /* ── Brand Color Scale (SA-flag inspired) ──────────── */
      colors: {
        // SA flag: Green
        "brand-green": {
          50: "#edfcf2",
          100: "#d4f7df",
          200: "#abedC4",
          300: "#73dea0",
          400: "#3ac878",
          500: "#00833e",
          600: "#006b32",
          700: "#00552a",
          800: "#004422",
          900: "#00361c",
          950: "#001f10",
          DEFAULT: "#00833e",
        },
        // SA flag: Gold
        "brand-gold": {
          50: "#fffbeb",
          100: "#fff3c6",
          200: "#ffe588",
          300: "#ffd34a",
          400: "#ffb81c",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#783610",
          950: "#451a03",
          DEFAULT: "#ffb81c",
        },
        // SA flag: Blue
        "brand-blue": {
          50: "#eff2ff",
          100: "#dce2ff",
          200: "#b9c5ff",
          300: "#8aa1ff",
          400: "#5574fc",
          500: "#2f4cf5",
          600: "#1a2fe0",
          700: "#002395",
          800: "#001d7a",
          900: "#001a66",
          950: "#000f3d",
          DEFAULT: "#002395",
        },
        // SA flag: Red
        "brand-red": {
          50: "#fef2f2",
          100: "#ffe1e1",
          200: "#ffc8c8",
          300: "#ffa2a1",
          400: "#fd6c6a",
          500: "#de3831",
          600: "#c22d27",
          700: "#a3231e",
          800: "#87201d",
          900: "#70211f",
          950: "#3d0c0b",
          DEFAULT: "#de3831",
        },
        // Warm neutral scale (earthy SA tones)
        warm: {
          50: "#faf8f5",
          100: "#f3efe9",
          200: "#e7dfd4",
          300: "#d5c9b8",
          400: "#bfad96",
          500: "#a99378",
          600: "#957e65",
          700: "#7c6854",
          800: "#665647",
          900: "#55483d",
          950: "#2d251f",
        },
        // Semantic colors via CSS variables (shadcn)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Trust Scale colors
        trust: {
          unregistered: "#9ca3af",
          incomplete: "#d5c9b8",
          pending: "#ffb81c",
          verified: "#00833e",
          premium: "#ffd700",
        },
      },

      /* ── Spacing Scale (8pt grid) ─────────────────────── */
      spacing: {
        "0.5": "2px",
        "1": "4px",
        "1.5": "6px",
        "2": "8px",
        "2.5": "10px",
        "3": "12px",
        "3.5": "14px",
        "4": "16px",
        "5": "20px",
        "6": "24px",
        "7": "28px",
        "8": "32px",
        "9": "36px",
        "10": "40px",
        "11": "44px",
        "12": "48px",
        "14": "56px",
        "16": "64px",
        "18": "72px",
        "20": "80px",
        "24": "96px",
        "28": "112px",
        "32": "128px",
      },

      /* ── Typography Scale (Major Third 1.25) ──────────── */
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.025em" }],
        sm: ["0.875rem", { lineHeight: "1.25rem", letterSpacing: "0.015em" }],
        base: ["1rem", { lineHeight: "1.5rem", letterSpacing: "0" }],
        md: ["1.125rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
        lg: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }],
        xl: ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.02em" }],
        "2xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.025em" }],
        "3xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em" }],
        "4xl": ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.03em" }],
        hero: ["4rem", { lineHeight: "4.25rem", letterSpacing: "-0.035em" }],
      },

      /* ── Border Radius Scale ──────────────────────────── */
      borderRadius: {
        none: "0",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        full: "9999px",
      },

      /* ── Elevation (Box Shadow) Scale ─────────────────── */
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        sm: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        md: "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)",
        lg: "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08)",
        xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
        "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.2)",
        // Trust scale glows
        "trust-pending": "0 0 16px 2px rgba(255, 184, 28, 0.2)",
        "trust-verified": "0 0 16px 2px rgba(0, 131, 62, 0.2)",
        "trust-premium":
          "0 0 20px 4px rgba(0, 131, 62, 0.15), 0 0 20px 4px rgba(255, 184, 28, 0.15)",
      },

      /* ── Transition Duration Scale ────────────────────── */
      transitionDuration: {
        fast: "100ms",
        normal: "200ms",
        slow: "400ms",
        slower: "600ms",
      },

      /* ── Custom Animations ────────────────────────────── */
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(24px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "trust-glow": {
          "0%, 100%": { boxShadow: "0 0 16px 2px rgba(0, 131, 62, 0.2)" },
          "50%": { boxShadow: "0 0 24px 4px rgba(0, 131, 62, 0.35)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s ease-out forwards",
        "slide-in-right": "slide-in-right 0.4s ease-out forwards",
        "scale-in": "scale-in 0.3s ease-out forwards",
        shimmer: "shimmer 2s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "trust-glow": "trust-glow 2.5s ease-in-out infinite",
      },

      /* ── Layout ───────────────────────────────────────── */
      maxWidth: {
        container: "1440px",
      },
    },
  },
  plugins: [tailwindcssAnimate],
  safelist: [
    // Trust-level badge colors (dynamically applied based on seller verification status)
    "bg-trust-unregistered",
    "bg-trust-incomplete",
    "bg-trust-pending",
    "bg-trust-verified",
    "bg-trust-premium",
    "text-trust-unregistered",
    "text-trust-incomplete",
    "text-trust-pending",
    "text-trust-verified",
    "text-trust-premium",
    "border-trust-unregistered",
    "border-trust-incomplete",
    "border-trust-pending",
    "border-trust-verified",
    "border-trust-premium",
    "shadow-trust-pending",
    "shadow-trust-verified",
    "shadow-trust-premium",
  ],
};

export default config;
