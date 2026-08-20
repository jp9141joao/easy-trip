import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Fires a light haptic on press — reserved for meaningful actions (§80). */
  haptic?: boolean;
}

const HEIGHTS: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 56 };

/**
 * The one button component. Covers every required state (§77):
 * default, pressed, disabled, loading and destructive.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconPosition = 'left',
  fullWidth = false,
  disabled,
  style,
  haptic = false,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const palette = () => {
    switch (variant) {
      case 'primary':
        return { bg: theme.colors.primary, pressed: theme.colors.primaryPressed, fg: theme.colors.textOnPrimary, border: 'transparent' };
      case 'secondary':
        return { bg: theme.colors.surface, pressed: theme.colors.surfaceMuted, fg: theme.colors.textPrimary, border: theme.colors.border };
      case 'ghost':
        return { bg: 'transparent', pressed: theme.colors.surfaceMuted, fg: theme.colors.primary, border: 'transparent' };
      case 'danger':
        return {
          bg: theme.colors.error,
          pressed: theme.colors.errorPressed,
          fg: theme.colors.textOnPrimary,
          border: 'transparent',
        };
    }
  };

  const colors = palette();
  const iconSize = size === 'sm' ? 16 : 18;

  return (
    <Pressable
      {...rest}
      onPress={(event) => {
        if (haptic) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        }
        onPress?.(event);
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        {
          height: HEIGHTS[size],
          minWidth: theme.hitTarget,
          paddingHorizontal: size === 'sm' ? theme.spacing.lg : theme.spacing['2xl'],
          borderRadius: theme.radius.button,
          backgroundColor: pressed && !isDisabled ? colors.pressed : colors.bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          opacity: isDisabled ? 0.5 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
        },
        variant === 'primary' && !isDisabled ? theme.shadows.sm : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : (
        <>
          {Icon && iconPosition === 'left' ? <Icon size={iconSize} color={colors.fg} /> : null}
          <AppText variant="button" style={{ color: colors.fg }} numberOfLines={1}>
            {label}
          </AppText>
          {Icon && iconPosition === 'right' ? <Icon size={iconSize} color={colors.fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: LucideIcon;
  /** Required — an icon-only control must announce itself (§74, §87). */
  accessibilityLabel: string;
  size?: number;
  color?: string;
  background?: 'none' | 'surface' | 'onImage' | 'primary';
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon: Icon,
  accessibilityLabel,
  size = 20,
  color,
  background = 'none',
  style,
  disabled,
  ...rest
}: IconButtonProps) {
  const theme = useTheme();

  const backgrounds: Record<NonNullable<IconButtonProps['background']>, string> = {
    none: 'transparent',
    surface: theme.colors.surface,
    onImage: theme.colors.onImage.background,
    primary: theme.colors.primary,
  };

  // Sobre fotografia o ícone claro vem junto com a superfície escura: são um
  // par, e deixar a cor por conta do chamador foi o que produziu botão branco
  // com ícone branco no tema claro.
  const defaultTint =
    background === 'primary'
      ? theme.colors.textOnPrimary
      : background === 'onImage'
        ? theme.colors.onImage.foreground
        : theme.colors.textPrimary;
  const tint = color ?? defaultTint;

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={theme.hitSlop}
      style={({ pressed }) => [
        {
          width: theme.hitTarget,
          height: theme.hitTarget,
          borderRadius: theme.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: backgrounds[background],
          borderWidth: background === 'onImage' ? 1 : 0,
          borderColor: theme.colors.onImage.border,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Icon size={size} color={tint} />
    </Pressable>
  );
}

export interface FloatingActionButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  /** Extra bottom offset so the FAB clears the tab dock. */
  bottomOffset?: number;
}

export function FloatingActionButton({
  icon: Icon,
  label,
  onPress,
  bottomOffset = 0,
}: FloatingActionButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          position: 'absolute',
          right: theme.spacing.xl,
          bottom: theme.spacing.xl + bottomOffset,
          height: 56,
          paddingHorizontal: theme.spacing.xl,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.primary,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        theme.shadows.lg,
      ]}
    >
      <Icon size={20} color={theme.colors.textOnPrimary} />
      <AppText variant="button" color="onPrimary">
        {label}
      </AppText>
    </Pressable>
  );
}

/** Groups the primary action row at the bottom of forms and sheets. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
      {children}
    </View>
  );
}
