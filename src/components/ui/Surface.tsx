import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';
import { AppText } from './AppText';
import { IconButton } from './Button';

/**
 * The soft aurora that sits behind every screen (§68).
 * Opacity is deliberately low — it must never compete with content.
 */
export function AuroraBackground() {
  const theme = useTheme();

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 520 }} pointerEvents="none">
      <LinearGradient
        colors={[theme.aurora.cyan, 'transparent']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ position: 'absolute', top: -140, left: -80, width: 340, height: 340, borderRadius: 999 }}
      />
      <LinearGradient
        colors={[theme.aurora.rose, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: -60, right: -100, width: 300, height: 300, borderRadius: 999 }}
      />
      <LinearGradient
        colors={[theme.aurora.blue, 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', top: 140, left: 40, width: 280, height: 280, borderRadius: 999 }}
      />
    </View>
  );
}

export interface ScreenContainerProps {
  children: ReactNode;
  /** Adds the standard 20pt horizontal gutter. */
  padded?: boolean;
  aurora?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Root wrapper for every screen: background + aurora + safe gutters. */
export function ScreenContainer({
  children,
  padded = true,
  aurora = true,
  style,
}: ScreenContainerProps) {
  const theme = useTheme();

  return (
    <View style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}>
      {aurora ? <AuroraBackground /> : null}
      <View style={{ flex: 1, paddingHorizontal: padded ? theme.spacing.screen : 0 }}>
        {children}
      </View>
    </View>
  );
}

export interface GlassCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** `flat` drops the shadow — for cards inside an already-elevated surface. */
  elevation?: 'flat' | 'sm' | 'md';
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * The signature translucent surface (§69). When `onPress` is provided it
 * renders as a real button, never a `View` with a tap handler (§87).
 */
export function GlassCard({
  children,
  style,
  padded = true,
  elevation = 'sm',
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: GlassCardProps) {
  const theme = useTheme();

  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.colors.glass,
      borderRadius: theme.radius.card,
      borderWidth: 1,
      borderColor: theme.colors.glassBorder,
      padding: padded ? theme.spacing.xl : 0,
      overflow: 'hidden',
    },
    elevation === 'sm' ? theme.shadows.sm : elevation === 'md' ? theme.shadows.md : null,
    style,
  ];

  if (!onPress) return <View style={base}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, pressed ? { opacity: 0.85, transform: [{ scale: 0.995 }] } : null]}
    >
      {children}
    </Pressable>
  );
}

/** The small uppercase eyebrow above a screen title, e.g. `VISÃO GERAL`. */
export function PageLabel({ children }: { children: string }) {
  return (
    <AppText variant="label" color="brand" uppercase>
      {children}
    </AppText>
  );
}

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
}: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.md,
        },
        style,
      ]}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="h3">{title}</AppText>
        {subtitle ? (
          <AppText variant="bodySmall" color="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={theme.hitSlop}
        >
          <AppText variant="button" color="brand">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  /** Shows the platform back affordance. */
  showBack?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  /** Renders above the title, e.g. `VISÃO GERAL`. */
  label?: string;
  transparent?: boolean;
}

export function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  right,
  label,
  transparent = true,
}: AppHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingBottom: theme.spacing.md,
        backgroundColor: transparent ? 'transparent' : theme.colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
      }}
    >
      {showBack ? (
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Voltar"
          onPress={handleBack}
          background="surface"
          style={theme.shadows.sm}
        />
      ) : null}

      <View style={{ flex: 1 }}>
        {label ? <PageLabel>{label}</PageLabel> : null}
        {title ? (
          <AppText variant="h2" numberOfLines={1}>
            {title}
          </AppText>
        ) : null}
        {subtitle ? (
          <AppText variant="bodySmall" color="secondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {right}
    </View>
  );
}

export function Divider({ spacing = 0 }: { spacing?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.colors.border,
        marginVertical: spacing,
      }}
    />
  );
}

/** A labelled row used across detail screens (Informações, Contato, ...). */
export function InfoRow({
  icon: Icon,
  label,
  value,
  onPress,
  accessibilityHint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const theme = useTheme();

  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.md }}>
      {Icon ? <Icon size={18} color={theme.colors.textSecondary} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color="tertiary">
          {label}
        </AppText>
        <AppText variant="body" color={onPress ? 'brand' : 'primary'}>
          {value}
        </AppText>
      </View>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
    >
      {content}
    </Pressable>
  );
}
