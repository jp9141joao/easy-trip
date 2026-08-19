import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme';
import type { TypographyVariant } from '@/theme/tokens';

type ColorRole =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'onPrimary'
  | 'onImage'
  | 'accent'
  | 'brand'
  | 'success'
  | 'warning'
  | 'error';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: ColorRole;
  /** Renders numbers in JetBrains Mono for tabular legibility (§70). */
  mono?: boolean;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  align?: TextStyle['textAlign'];
  /** Uppercased tracking-wide treatment used by section labels. */
  uppercase?: boolean;
}

/**
 * The single text primitive. Font scaling is deliberately left enabled so the
 * OS text-size preference is respected (§70, §87).
 */
export function AppText({
  variant = 'body',
  color = 'primary',
  mono = false,
  weight,
  align,
  uppercase = false,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const spec = theme.typography[variant];

  const colorMap: Record<ColorRole, string> = {
    primary: theme.colors.textPrimary,
    secondary: theme.colors.textSecondary,
    tertiary: theme.colors.textTertiary,
    onPrimary: theme.colors.textOnPrimary,
    onImage: theme.colors.textOnImage,
    accent: theme.colors.accent,
    brand: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
  };

  const weightFamily = () => {
    if (mono) return weight === 'bold' ? theme.fontFamily.monoBold : theme.fontFamily.mono;
    switch (weight) {
      case 'regular':
        return theme.fontFamily.body;
      case 'medium':
        return theme.fontFamily.bodyMedium;
      case 'semibold':
        return theme.fontFamily.bodySemiBold;
      case 'bold':
        return theme.fontFamily.bodyBold;
      default:
        return spec.family;
    }
  };

  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: spec.size,
          lineHeight: spec.lineHeight,
          fontFamily: weightFamily(),
          color: colorMap[color],
          textAlign: align,
          letterSpacing: uppercase ? 1.2 : 0,
        },
        uppercase && { textTransform: 'uppercase' },
        style,
      ]}
    />
  );
}
