/**
 * CodeGuard AI - Design System & Brand Guide
 *
 * BRAND PERSONALITY
 * - Modern & Approachable: Developer-friendly, clean, minimal
 * - Trustworthy: Security-focused without being intimidating
 * - Intelligent: AI-powered but human-centered
 *
 * VISUAL INSPIRATION
 * - Linear: Minimal elegance, smooth animations, subtle depth
 * - Vercel: Developer-focused, geometric, clean grids
 * - Stripe: Professional polish, thoughtful gradients, attention to detail
 *
 * THEME
 * - Primary: Light mode with dark accents
 * - Color base: Green (emerald to teal) - represents safety, success, reliability
 */

// ============================================
// COLOR PALETTE
// ============================================

export const colors = {
  // Primary Brand Colors (Emerald/Teal spectrum)
  brand: {
    50: '#ecfdf5',   // Lightest - backgrounds
    100: '#d1fae5',  // Light backgrounds, hover states
    200: '#a7f3d0',  // Borders, subtle accents
    300: '#6ee7b7',  // Interactive elements hover
    400: '#34d399',  // Interactive elements
    500: '#10b981',  // PRIMARY - buttons, links, key actions
    600: '#059669',  // Primary hover, emphasis
    700: '#047857',  // Strong emphasis, headers
    800: '#065f46',  // Dark text on light backgrounds
    900: '#064e3b',  // Darkest - headings, strong text
    950: '#022c22',  // Near-black brand tone
  },

  // Neutral Grays (Slightly warm, modern)
  gray: {
    50: '#fafafa',   // Page background
    100: '#f4f4f5',  // Card backgrounds, subtle borders
    200: '#e4e4e7',  // Borders, dividers
    300: '#d4d4d8',  // Disabled states
    400: '#a1a1aa',  // Placeholder text
    500: '#71717a',  // Secondary text
    600: '#52525b',  // Body text
    700: '#3f3f46',  // Strong text
    800: '#27272a',  // Headings
    900: '#18181b',  // Near-black text
    950: '#09090b',  // Pure dark
  },

  // Semantic Colors - Issue Severities
  severity: {
    critical: {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#991b1b',
      solid: '#ef4444',
      solidHover: '#dc2626',
    },
    high: {
      bg: '#fff7ed',
      border: '#fed7aa',
      text: '#9a3412',
      solid: '#f97316',
      solidHover: '#ea580c',
    },
    medium: {
      bg: '#fefce8',
      border: '#fef08a',
      text: '#854d0e',
      solid: '#eab308',
      solidHover: '#ca8a04',
    },
    low: {
      bg: '#f0fdf4',
      border: '#bbf7d0',
      text: '#166534',
      solid: '#22c55e',
      solidHover: '#16a34a',
    },
  },

  // Accent Colors (for variety, charts, tags)
  accent: {
    blue: '#3b82f6',
    purple: '#8b5cf6',
    pink: '#ec4899',
    cyan: '#06b6d4',
    amber: '#f59e0b',
  },

  // Issue Type Colors (matches agent specializations)
  issueType: {
    security: {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#991b1b',
      solid: '#ef4444',
    },
    reliability: {
      bg: '#fefce8',
      border: '#fef08a',
      text: '#854d0e',
      solid: '#eab308',
    },
    resilience: {
      bg: '#fff7ed',
      border: '#fed7aa',
      text: '#9a3412',
      solid: '#f97316',
    },
    concurrency: {
      bg: '#fffbeb',
      border: '#fde68a',
      text: '#92400e',
      solid: '#f59e0b',
    },
    kafka: {
      bg: '#faf5ff',
      border: '#e9d5ff',
      text: '#6b21a8',
      solid: '#a855f7',
    },
    database: {
      bg: '#eff6ff',
      border: '#bfdbfe',
      text: '#1e40af',
      solid: '#3b82f6',
    },
    distributed: {
      bg: '#ecfeff',
      border: '#a5f3fc',
      text: '#155e75',
      solid: '#06b6d4',
    },
  },
};

// ============================================
// TYPOGRAPHY
// ============================================

export const typography = {
  // Font Families
  fonts: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
  },

  // Font Sizes (with line heights)
  sizes: {
    xs: { size: '0.75rem', lineHeight: '1rem' },      // 12px
    sm: { size: '0.875rem', lineHeight: '1.25rem' },  // 14px
    base: { size: '1rem', lineHeight: '1.5rem' },     // 16px
    lg: { size: '1.125rem', lineHeight: '1.75rem' }, // 18px
    xl: { size: '1.25rem', lineHeight: '1.75rem' },  // 20px
    '2xl': { size: '1.5rem', lineHeight: '2rem' },   // 24px
    '3xl': { size: '1.875rem', lineHeight: '2.25rem' }, // 30px
    '4xl': { size: '2.25rem', lineHeight: '2.5rem' },   // 36px
    '5xl': { size: '3rem', lineHeight: '1' },           // 48px
  },

  // Font Weights
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Letter Spacing
  tracking: {
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
};

// ============================================
// SPACING & LAYOUT
// ============================================

export const spacing = {
  // Base spacing scale (4px increments)
  px: '1px',
  0: '0',
  0.5: '0.125rem',  // 2px
  1: '0.25rem',     // 4px
  1.5: '0.375rem',  // 6px
  2: '0.5rem',      // 8px
  2.5: '0.625rem',  // 10px
  3: '0.75rem',     // 12px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  8: '2rem',        // 32px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
};

export const layout = {
  // Max widths
  maxWidth: {
    xs: '20rem',    // 320px
    sm: '24rem',    // 384px
    md: '28rem',    // 448px
    lg: '32rem',    // 512px
    xl: '36rem',    // 576px
    '2xl': '42rem', // 672px
    '3xl': '48rem', // 768px
    '4xl': '56rem', // 896px
    '5xl': '64rem', // 1024px
    '6xl': '72rem', // 1152px
    '7xl': '80rem', // 1280px
    full: '100%',
  },

  // Container padding
  containerPadding: {
    mobile: '1rem',
    tablet: '2rem',
    desktop: '4rem',
  },

  // Border Radius
  borderRadius: {
    none: '0',
    sm: '0.25rem',   // 4px
    DEFAULT: '0.5rem', // 8px - Primary radius
    md: '0.5rem',    // 8px
    lg: '0.75rem',   // 12px
    xl: '1rem',      // 16px
    '2xl': '1.5rem', // 24px
    full: '9999px',
  },
};

// ============================================
// SHADOWS & DEPTH
// ============================================

export const shadows = {
  // Subtle, modern shadows (Linear-inspired)
  none: 'none',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
  DEFAULT: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.05)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.15)',

  // Colored shadows for depth
  brand: '0 4px 14px 0 rgb(16 185 129 / 0.25)',
  brandLg: '0 10px 40px 0 rgb(16 185 129 / 0.2)',

  // Inner shadow
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
};

// ============================================
// ANIMATIONS & TRANSITIONS
// ============================================

export const animation = {
  // Durations
  duration: {
    instant: '0ms',
    fast: '100ms',
    normal: '200ms',
    slow: '300ms',
    slower: '500ms',
  },

  // Easing curves (modern, snappy)
  easing: {
    linear: 'linear',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    // Spring-like (Linear-inspired)
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    // Smooth deceleration
    smooth: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  },

  // Common transition presets
  transitions: {
    default: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    fast: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
    colors: 'color, background-color, border-color 200ms ease',
    transform: 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    opacity: 'opacity 200ms ease',
  },
};

// ============================================
// COMPONENT PATTERNS
// ============================================

export const components = {
  // Card styles
  card: {
    base: 'bg-white rounded-xl border border-gray-200',
    hover: 'hover:border-gray-300 hover:shadow-md transition-all duration-200',
    elevated: 'bg-white rounded-xl shadow-md border border-gray-100',
  },

  // Button styles
  button: {
    base: 'inline-flex items-center justify-center font-medium transition-all duration-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2',
    sizes: {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    },
    variants: {
      primary: 'bg-brand-500 text-white hover:bg-brand-600 focus:ring-brand-500 shadow-sm',
      secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500',
      outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-gray-500',
      ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
      danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
    },
  },

  // Input styles
  input: {
    base: 'w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder-gray-400 transition-all duration-200',
    focus: 'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none',
    error: 'border-red-300 focus:border-red-500 focus:ring-red-500/20',
  },

  // Badge styles
  badge: {
    base: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
    variants: {
      default: 'bg-gray-100 text-gray-700',
      brand: 'bg-brand-100 text-brand-700',
      success: 'bg-green-100 text-green-700',
      warning: 'bg-yellow-100 text-yellow-700',
      error: 'bg-red-100 text-red-700',
    },
  },
};

// ============================================
// GRADIENTS
// ============================================

export const gradients = {
  // Brand gradients
  brand: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  brandSubtle: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
  brandRadial: 'radial-gradient(circle at top right, #34d399, #10b981, #059669)',

  // Hero/Feature gradients
  heroLight: 'linear-gradient(180deg, #ffffff 0%, #f4f4f5 100%)',
  heroMesh: 'radial-gradient(at 40% 20%, #d1fae5 0px, transparent 50%), radial-gradient(at 80% 0%, #ecfdf5 0px, transparent 50%), radial-gradient(at 0% 50%, #f0fdf4 0px, transparent 50%)',

  // Text gradients
  textBrand: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
};

// ============================================
// Z-INDEX SCALE
// ============================================

export const zIndex = {
  behind: -1,
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  toast: 80,
  max: 9999,
};

// Export all tokens
const designTokens = {
  colors,
  typography,
  spacing,
  layout,
  shadows,
  animation,
  components,
  gradients,
  zIndex,
};

export default designTokens;
