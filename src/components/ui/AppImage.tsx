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
  /**
   * Duração do fade de entrada, em ms. Vale zerar em imagens que remontam com
   * frequência — o hero da viagem é redesenhado a cada troca de aba, e refazer
   * o fade toda vez faz a mesma foto piscar contra ela própria.
   */
  transition?: number;
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
  transition = 220,
}: AppImageProps) {
  const theme = useTheme();
  // Guarda *qual* uri falhou, não um booleano: o mesmo componente permanece
  // montado quando a viagem selecionada na Home muda, e um booleano manteria o
  // fallback preso na foto seguinte. Comparar com a uri atual limpa a falha
  // sozinho, sem effect e sem render extra.
  const [failedUri, setFailedUri] = useState<string | undefined>();
  const showFallback = !uri || failedUri === uri;

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
          transition={transition}
          onError={() => setFailedUri(uri)}
          accessible={Boolean(accessibilityLabel)}
          accessibilityLabel={accessibilityLabel}
          cachePolicy="disk"
        />
      )}

      {overlay ? (
        // Deliberadamente fora do tema: este scrim existe para escurecer a
        // fotografia e garantir contraste do texto `onImage`, e a foto é a
        // mesma no Claro e no Escuro. Clareá-lo no tema claro só tiraria
        // legibilidade sem ganho nenhum (§30).
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
