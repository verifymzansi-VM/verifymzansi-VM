import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";

const mediaPositionUtilities = plugin(({ addUtilities }) => {
  const utilities: Record<string, Record<string, string>> = {
    ".focal-position-object": {
      objectPosition: "var(--focal-pos-x, 50%) var(--focal-pos-y, 50%)",
    },
  };

  for (let i = 0; i <= 100; i += 1) {
    utilities[`.focal-pos-x-${i}`] = { "--focal-pos-x": `${i}%` };
    utilities[`.focal-pos-y-${i}`] = { "--focal-pos-y": `${i}%` };
    utilities[`.progress-w-${i}`] = { width: `${i}%` };
  }

  addUtilities(utilities);
});

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
      /* ── Brand Color Scale ("Mzansi Modern") ──────────────
         Scale names are kept stable so every surface picks up the refreshed
         identity; the values are the new palette, not literal flag colours.
         brand-green  → Verified Emerald  (trust, primary actions, Mzansi Market)
         brand-blue   → Ocean Indigo      (Mzansi Business)
         sunset       → Sunset Coral      (Tourism & Events)
         brand-gold   → Marigold          (highlights, featured, premium)
         brand-red    → Protea            (errors, urgent, destructive)
         warm         → Stone             (neutral surfaces and text)        */
      colors: {
        "brand-green": {
          50: "#edfaf4",
          100: "#d3f3e4",
          200: "#a8e6cb",
          300: "#72d2ab",
          400: "#3bb888",
          500: "#149a6b",
          600: "#0b7a55",
          700: "#08624a",
          800: "#084e3c",
          900: "#073f32",
          950: "#03241d",
          DEFAULT: "#0b7a55",
        },
        "brand-gold": {
          50: "#fff8eb",
          100: "#ffedc7",
          200: "#ffd98a",
          300: "#ffc24d",
          400: "#f9a826",
          500: "#ec8d0c",
          600: "#cc6c07",
          700: "#a94f0a",
          800: "#893e10",
          900: "#713411",
          950: "#411904",
          DEFAULT: "#f9a826",
        },
        "brand-blue": {
          50: "#eef1fe",
          100: "#dde3fd",
          200: "#c0cbfb",
          300: "#97a8f6",
          400: "#6a80ef",
          500: "#4a5fe4",
          600: "#3450d8",
          700: "#2c3fb8",
          800: "#283795",
          900: "#263276",
          950: "#181e45",
          DEFAULT: "#3450d8",
        },
        "brand-red": {
          50: "#fff3f1",
          100: "#ffe4df",
          200: "#ffcdc4",
          300: "#ffa99a",
          400: "#fd7a63",
          500: "#ea4a2f",
          600: "#d63b22",
          700: "#b42f1b",
          800: "#95291a",
          900: "#7b271b",
          950: "#431009",
          DEFAULT: "#d63b22",
        },
        sunset: {
          50: "#fff5ed",
          100: "#ffe8d4",
          200: "#ffcda8",
          300: "#ffa970",
          400: "#fd7d3a",
          500: "#f26a21",
          600: "#d9541a",
          700: "#b8420f",
          800: "#93360f",
          900: "#772f10",
          950: "#401506",
          DEFAULT: "#e4581c",
        },
        warm: {
          50: "#f8f8f6",
          100: "#f1f1ee",
          200: "#e4e4df",
          300: "#cfcfc8",
          400: "#a6a69d",
          500: "#7f7f76",
          600: "#64645c",
          700: "#4e4e48",
          800: "#393935",
          900: "#262623",
          950: "#161614",
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
          incomplete: "#cfcfc8",
          pending: "#f9a826",
          verified: "#0b7a55",
          premium: "#f9a826",
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
        "3xl": "28px",
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
        "trust-pending":
          "0 0 0 1px rgba(249, 168, 38, 0.35), 0 8px 24px -12px rgba(249, 168, 38, 0.45)",
        "trust-verified":
          "0 0 0 1px rgba(11, 122, 85, 0.22), 0 8px 24px -12px rgba(11, 122, 85, 0.45)",
        "trust-premium":
          "0 0 0 1px rgba(249, 168, 38, 0.45), 0 10px 28px -12px rgba(11, 122, 85, 0.5)",
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
          "0%, 100%": { boxShadow: "0 0 16px 2px rgba(11, 122, 85, 0.2)" },
          "50%": { boxShadow: "0 0 24px 4px rgba(11, 122, 85, 0.35)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "badge-pop": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "feed-tap-indicator": {
          "0%": { opacity: "0", transform: "scale(0.7)" },
          "15%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s ease-out forwards",
        "slide-in-right": "slide-in-right 0.4s ease-out forwards",
        "scale-in": "scale-in 0.3s ease-out forwards",
        shimmer: "shimmer 2s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "trust-glow": "trust-glow 2.5s ease-in-out infinite",
        "feed-tap-indicator": "feed-tap-indicator 0.8s ease-out forwards",
        float: "float 6s ease-in-out infinite",
        "badge-pop": "badge-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
      },

      /* ── Layout ───────────────────────────────────────── */
      maxWidth: {
        container: "1600px",
      },
    },
  },
  plugins: [tailwindcssAnimate, mediaPositionUtilities],
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
    { pattern: /focal-pos-x-(\d|[1-9]\d|100)/ },
    { pattern: /focal-pos-y-(\d|[1-9]\d|100)/ },
    { pattern: /progress-w-(\d|[1-9]\d|100)/ },
  ],
};

export default config;
