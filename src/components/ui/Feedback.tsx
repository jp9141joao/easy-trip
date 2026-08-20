import { CloudOff, RefreshCw, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/* -------------------------------- Skeleton -------------------------------- */

export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [pulse] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.smallCard / 2,
          backgroundColor: theme.colors.skeleton,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton used by list screens while data loads (§83). */
export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.card,
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        height,
      }}
    >
      <Skeleton width="60%" height={20} />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '40%' : '100%'} height={12} />
      ))}
    </View>
  );
}

export function SkeletonList({ count = 3, lines = 2 }: { count?: number; lines?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.lg }}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={lines} />
      ))}
    </View>
  );
}

/* ------------------------------- EmptyState ------------------------------- */

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

/** Every module needs one of these (§82). */
export function EmptyState({
  icon: Icon,
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: compact ? theme.spacing['2xl'] : theme.spacing['4xl'],
        paddingHorizontal: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      {Icon ? (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={28} color={theme.colors.primary} />
        </View>
      ) : null}

      <AppText variant="h3" align="center">
        {title}
      </AppText>

      {message ? (
        <AppText variant="bodySmall" color="secondary" align="center">
          {message}
        </AppText>
      ) : null}

      {actionLabel && onAction ? (
        // `Button` usa `alignSelf: 'flex-start'` por padrão, e `alignSelf`
        // sobrepõe o `alignItems: 'center'` do container — era por isso que o
        // CTA aparecia deslocado para a esquerda dentro do card (§19).
        <Button
          label={actionLabel}
          onPress={onAction}
          style={{ marginTop: theme.spacing.sm, alignSelf: 'center' }}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------- ErrorState ------------------------------- */

/**
 * Errors explain what happened and what to do about it — never a bare "Erro"
 * (§84).
 */
export function ErrorState({
  title = 'Algo deu errado',
  message,
  onRetry,
  retryLabel = 'Tentar novamente',
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const theme = useTheme();

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignItems: 'center',
        paddingVertical: theme.spacing['3xl'],
        paddingHorizontal: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.errorSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <RefreshCw size={26} color={theme.colors.error} />
      </View>

      <AppText variant="h3" align="center">
        {title}
      </AppText>
      <AppText variant="bodySmall" color="secondary" align="center">
        {message}
      </AppText>

      {onRetry ? (
        <Button
          label={retryLabel}
          variant="secondary"
          onPress={onRetry}
          style={{ marginTop: theme.spacing.sm }}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------ OfflineBanner ----------------------------- */

export function OfflineBanner({ message }: { message?: string }) {
  const theme = useTheme();

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.warningSoft,
        borderRadius: theme.radius.smallCard,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <CloudOff size={16} color={theme.colors.warning} />
      <AppText variant="caption" color="secondary" style={{ flex: 1 }}>
        {message ?? 'Você está offline. Mostrando os dados salvos neste dispositivo.'}
      </AppText>
    </View>
  );
}

/**
 * Um texto com interpolação (`texto {valor}`) chega como array de nós, não como
 * string. Checar apenas `typeof children === 'string'` jogava esse caso no ramo
 * "já é JSX pronto" e o React Native quebrava a tela inteira com "Text strings
 * must be rendered within a <Text> component" — o conteúdo precisa ser
 * envolvido sempre que for texto, esteja ele partido em pedaços ou não.
 */
function isTextContent(node: ReactNode): boolean {
  // `null`/`undefined`/booleanos não renderizam nada e não atrapalham o ramo de
  // texto — um `{cond && 'algo'}` falso não deve mudar a decisão.
  if (node === null || node === undefined || typeof node === 'boolean') return true;
  if (typeof node === 'string' || typeof node === 'number') return true;
  if (Array.isArray(node)) return node.every(isTextContent);
  return false;
}

/** Small inline notice — used for "modo demonstração" and stale-data hints. */
export function InlineNotice({
  icon: Icon,
  children,
  tone = 'info',
}: {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success' | 'error';
}) {
  const theme = useTheme();

  const tones = {
    info: { bg: theme.colors.primarySoft, fg: theme.colors.primary },
    warning: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
    error: { bg: theme.colors.errorSoft, fg: theme.colors.error },
  }[tone];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.spacing.sm,
        backgroundColor: tones.bg,
        borderRadius: theme.radius.smallCard,
        padding: theme.spacing.lg,
      }}
    >
      {Icon ? <Icon size={16} color={tones.fg} style={{ marginTop: 2 }} /> : null}
      <View style={{ flex: 1 }}>
        {isTextContent(children) ? (
          <AppText variant="caption" color="secondary">
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
