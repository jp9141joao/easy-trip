import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { clampPercent } from '@/domain/selectors';
import { useTheme } from '@/theme';
import { AppText } from './AppText';
import { AppImage } from './AppImage';

/* ---------------------------------- Badge --------------------------------- */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'error' | 'accent';

export function Badge({
  label,
  tone = 'neutral',
  icon: Icon,
  style,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  const tones: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: theme.colors.surfaceMuted, fg: theme.colors.textSecondary },
    brand: { bg: theme.colors.primarySoft, fg: theme.colors.primary },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
    warning: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
    error: { bg: theme.colors.errorSoft, fg: theme.colors.error },
    accent: { bg: theme.colors.accentSoft, fg: theme.colors.accent },
  };
  const colors = tones[tone];

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          backgroundColor: colors.bg,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 5,
        },
        style,
      ]}
    >
      {Icon ? <Icon size={12} color={colors.fg} /> : null}
      <AppText variant="label" style={{ color: colors.fg }}>
        {label}
      </AppText>
    </View>
  );
}

/* ------------------------------- ProgressBar ------------------------------ */

export function ProgressBar({
  percent,
  tone = 'brand',
  height = 8,
  label,
}: {
  percent: number;
  tone?: 'brand' | 'success' | 'warning' | 'error';
  height?: number;
  label?: string;
}) {
  const theme = useTheme();
  const value = clampPercent(percent);
  const [width] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(width, {
      toValue: value,
      duration: theme.duration.slow,
      useNativeDriver: false,
    }).start();
  }, [value, width, theme.duration.slow]);

  const colors = {
    brand: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
  };

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
      style={{
        height,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surfaceMuted,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: theme.radius.pill,
          backgroundColor: colors[tone],
          width: width.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          }),
        }}
      />
    </View>
  );
}

/* --------------------------------- Avatar --------------------------------- */

export function Avatar({
  uri,
  name,
  size = 44,
  onPress,
  accessibilityLabel,
}: {
  uri?: string;
  name?: string;
  size?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const initials = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  const content = uri ? (
    <AppImage
      uri={uri}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      fallbackLabel={name}
      accessibilityLabel={accessibilityLabel}
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AppText
        variant={size >= 56 ? 'h3' : 'bodySmall'}
        weight="bold"
        style={{ color: theme.colors.primary }}
      >
        {initials}
      </AppText>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Perfil de ${name ?? 'usuário'}`}
      hitSlop={theme.hitSlop}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      {content}
    </Pressable>
  );
}

/* -------------------------------- StatCard -------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  style,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  const tones: Record<BadgeTone, string> = {
    neutral: theme.colors.textSecondary,
    brand: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
    accent: theme.colors.accent,
  };

  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 140,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.smallCard,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.spacing.lg,
          gap: 4,
        },
        style,
      ]}
    >
      {Icon ? <Icon size={18} color={tones[tone]} /> : null}
      <AppText variant="h3" mono weight="bold" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" color="secondary" numberOfLines={2}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="caption" color="tertiary" numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------ SegmentedTabs ----------------------------- */

export interface SegmentedTabItem<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  scrollable = false,
}: {
  items: SegmentedTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;
}) {
  const theme = useTheme();

  const content = (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radius.pill,
        padding: 4,
        gap: 4,
      }}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            onPress={() => onChange(item.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            style={{
              flex: scrollable ? undefined : 1,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm + 2,
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.colors.surface : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              minHeight: 40,
              ...(active ? theme.shadows.sm : {}),
            }}
          >
            <AppText
              variant="button"
              color={active ? 'brand' : 'secondary'}
              numberOfLines={1}
            >
              {item.label}
            </AppText>
            {typeof item.badge === 'number' && item.badge > 0 ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 4,
                  borderRadius: 9,
                  backgroundColor: active ? theme.colors.primary : theme.colors.borderStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="label" style={{ color: theme.colors.textOnPrimary, fontSize: 10 }}>
                  {item.badge}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) return content;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
}

/* --------------------------------- FadeIn --------------------------------- */

/**
 * Entrada suave para o conteúdo que troca dentro de uma mesma tela (§2).
 *
 * Apenas opacidade, no driver nativo: a animação roda na thread de UI, sem
 * layout e sem re-render. É o bastante para a troca de painel parecer orgânica
 * em vez de um corte seco, e curta o suficiente para nunca virar espera. O hero
 * fica de fora de propósito — ele é o que precisa parecer imóvel.
 */
export function FadeIn({
  children,
  duration = 160,
  style,
}: {
  children: ReactNode;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, duration]);

  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

/* ---------------------------------- Chip ---------------------------------- */

export function Chip({
  label,
  selected = false,
  onPress,
  icon: Icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.lg,
        minHeight: 38,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected
          ? theme.colors.primarySoft
          : pressed
            ? theme.colors.surfaceMuted
            : theme.colors.surface,
      })}
    >
      {Icon ? (
        <Icon size={14} color={selected ? theme.colors.primary : theme.colors.textSecondary} />
      ) : null}
      <AppText variant="bodySmall" color={selected ? 'brand' : 'secondary'} weight={selected ? 'semibold' : 'regular'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Horizontal row of filter chips with consistent spacing. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.screen }}
    >
      {children}
    </ScrollView>
  );
}
