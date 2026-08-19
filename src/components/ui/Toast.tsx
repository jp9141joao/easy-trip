import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';
import { AppText } from './AppText';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastPayload {
  message: string;
  tone?: ToastTone;
  /** Milliseconds on screen. */
  duration?: number;
}

interface ToastContextValue {
  show: (payload: ToastPayload) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Discreet success/error feedback (§85). Replaces `Alert.alert` as the default
 * confirmation channel so routine actions never block the user.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((payload: ToastPayload) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(payload);
    timer.current = setTimeout(() => setToast(null), payload.duration ?? 2800);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message) => show({ message, tone: 'success' }),
      error: (message) => show({ message, tone: 'error', duration: 4000 }),
      info: (message) => show({ message, tone: 'info' }),
      warning: (message) => show({ message, tone: 'warning', duration: 3500 }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView payload={toast} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ payload }: { payload: ToastPayload }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(-80));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: theme.duration.base,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: theme.duration.base,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, opacity, theme.duration.base]);

  const tone = payload.tone ?? 'info';
  const config = {
    success: { Icon: CheckCircle2, color: theme.colors.success },
    error: { Icon: XCircle, color: theme.colors.error },
    warning: { Icon: AlertTriangle, color: theme.colors.warning },
    info: { Icon: Info, color: theme.colors.primary },
  }[tone];

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        top: insets.top + theme.spacing.sm,
        left: theme.spacing.screen,
        right: theme.spacing.screen,
        transform: [{ translateY }],
        opacity,
        zIndex: 1000,
      }}
    >
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            backgroundColor: theme.colors.surfaceElevated,
            borderRadius: theme.radius.smallCard,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingVertical: theme.spacing.lg,
            paddingHorizontal: theme.spacing.lg,
          },
          theme.shadows.md,
        ]}
      >
        <config.Icon size={20} color={config.color} />
        <AppText variant="bodySmall" style={{ flex: 1 }}>
          {payload.message}
        </AppText>
      </View>
    </Animated.View>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return context;
}
