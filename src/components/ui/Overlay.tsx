import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button, IconButton } from './Button';

/**
 * Bottom sheet built on React Native primitives.
 *
 * A dedicated sheet library would pull in a native module that Expo Go does not
 * ship, so §79 tells us to build it from primitives instead — Modal + Animated
 * gets the same behaviour with zero compatibility risk.
 */
export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Caps the sheet height as a fraction of the screen. */
  maxHeightRatio?: number;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightRatio = 0.85,
}: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [translateY] = useState(() => new Animated.Value(height));
  const [backdrop] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: theme.duration.base,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: theme.duration.base,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      translateY.setValue(height);
      backdrop.setValue(0);
    }
  }, [visible, height, translateY, backdrop, theme.duration.base]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ ...StyleSheetAbsolute, opacity: backdrop }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{ flex: 1, backgroundColor: theme.colors.scrim }}
          />
        </Animated.View>

        <Animated.View
          style={[
            {
              transform: [{ translateY }],
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.modal,
              borderTopRightRadius: theme.radius.modal,
              paddingBottom: insets.bottom + theme.spacing.lg,
              maxHeight: height * maxHeightRatio,
            },
            theme.shadows.lg,
          ]}
        >
          <View style={{ alignItems: 'center', paddingTop: theme.spacing.md }}>
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colors.borderStrong,
              }}
            />
          </View>

          {title ? (
            <View
              style={{
                paddingHorizontal: theme.spacing.screen,
                paddingTop: theme.spacing.lg,
                paddingBottom: theme.spacing.sm,
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="h3">{title}</AppText>
                {subtitle ? (
                  <AppText variant="bodySmall" color="secondary" style={{ marginTop: 2 }}>
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
              <IconButton icon={X} accessibilityLabel="Fechar" onPress={onClose} />
            </View>
          ) : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.screen,
              paddingTop: title ? theme.spacing.sm : theme.spacing.lg,
              paddingBottom: theme.spacing.lg,
            }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const StyleSheetAbsolute = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

/** Centred modal — for confirmations and short critical actions (§79). */
export interface AppModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function AppModal({ visible, onClose, title, children }: AppModalProps) {
  const theme = useTheme();
  const [scale] = useState(() => new Animated.Value(0.94));

  useEffect(() => {
    if (visible) {
      scale.setValue(0.94);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 9 }).start();
    }
  }, [visible, scale]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fechar"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: theme.colors.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.screen,
        }}
      >
        {/* Stops taps inside the card from dismissing the modal. */}
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
          <Animated.View
            style={[
              {
                transform: [{ scale }],
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.modal,
                padding: theme.spacing['2xl'],
                gap: theme.spacing.md,
              },
              theme.shadows.lg,
            ]}
          >
            {title ? <AppText variant="h3">{title}</AppText> : null}
            {children}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces `Alert.alert` so confirmations look and behave identically across
 * platforms (§86, §116 — `window.confirm` has no place here).
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const theme = useTheme();

  return (
    <AppModal visible={visible} onClose={onCancel} title={title}>
      <AppText variant="body" color="secondary">
        {message}
      </AppText>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
        <Button
          label={cancelLabel}
          variant="secondary"
          onPress={onCancel}
          style={{ flex: 1 }}
          disabled={loading}
        />
        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          onPress={onConfirm}
          loading={loading}
          style={{ flex: 1 }}
          haptic
        />
      </View>
    </AppModal>
  );
}

/** Frosted surface used by headers and the tab dock, with a solid fallback. */
export function Frosted({
  children,
  intensity = 30,
  style,
}: {
  children: ReactNode;
  intensity?: number;
  style?: React.ComponentProps<typeof View>['style'];
}) {
  const theme = useTheme();

  // Blur is expensive on low-end Android; there we use a solid surface instead,
  // which keeps the same visual weight without the frame cost (§69).
  if (Platform.OS === 'android') {
    return (
      <View style={[{ backgroundColor: theme.colors.surface }, style]}>{children}</View>
    );
  }

  return (
    <BlurView intensity={intensity} tint={theme.scheme === 'dark' ? 'dark' : 'light'} style={style}>
      {children}
    </BlurView>
  );
}
