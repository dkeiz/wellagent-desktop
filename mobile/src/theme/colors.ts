export const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  surface2: '#1a1a28',
  surface3: '#222236',
  border: '#2a2a3a',
  borderLight: '#3a3a4a',
  text: '#e4e4ef',
  textSecondary: '#8888a0',
  textMuted: '#555570',
  accent: '#6c5ce7',
  accentLight: '#a29bfe',
  accentDark: '#4834d4',
  success: '#51cf66',
  warning: '#ffd43b',
  danger: '#ff6b6b',
  info: '#74c0fc',
} as const;

export const typography = {
  sizes: { xs: 11, sm: 13, md: 14, lg: 16, xl: 20, xxl: 24, title: 28 },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40,
} as const;

export const radius = {
  sm: 6, md: 12, lg: 16, xl: 20, round: 999,
} as const;
