import { Image, type ImageContentFit } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';
import { AppText } from './AppText';

export interface AppImageProps {
  uri?: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** Shown inside the fallback tile when the image cannot load (§75). */
  fallbackLabel?: string;
  accessibilityLabel?: string;
  /** Darkens the image so text laid over it keeps contrast. */
  overlay?: boolean;
  radius?: number;
}

/**
 * Photography with a guaranteed fallback. The catalogue is CDN-hosted, so every
 * image must degrade to a branded gradient rather than a broken box (§75).
 */
export function AppImage({
  uri,
  style,
  contentFit = 'cover',
  fallbackLabel,
  accessibilityLabel,
  overlay = false,
  radius,
}: AppImageProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const showFallback = !uri || failed;

  return (
    <View style={[{ overflow: 'hidden', borderRadius: radius }, style]}>
      {showFallback ? (
        <LinearGradient
          colors={[theme.colors.primary, theme.colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel ?? fallbackLabel ?? 'Imagem indisponível'}
        >
          {fallbackLabel ? (
            <AppText variant="h2" color="onImage" weight="bold">
              {fallbackLabel.trim().charAt(0).toUpperCase()}
            </AppText>
          ) : null}
        </LinearGradient>
      ) : (
        <Image
          source={{ uri }}
          style={{ flex: 1 }}
          contentFit={contentFit}
          transition={220}
          onError={() => setFailed(true)}
          accessible={Boolean(accessibilityLabel)}
          accessibilityLabel={accessibilityLabel}
          cachePolicy="disk"
        />
      )}

      {overlay ? (
        <LinearGradient
          colors={['transparent', 'rgba(2,6,23,0.15)', 'rgba(2,6,23,0.78)']}
          locations={[0, 0.45, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }}
          pointerEvents="none"
        />
      ) : null}
    </View>
  );
}
