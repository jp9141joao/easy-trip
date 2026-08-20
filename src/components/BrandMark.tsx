import { LinearGradient } from 'expo-linear-gradient';
import { Plane } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';

/** The Easy Trip lockup — logo tile plus wordmark. */
export function BrandMark({
  size = 'md',
  showWordmark = true,
}: {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
}) {
  const theme = useTheme();
  const dimension = size === 'sm' ? 40 : size === 'md' ? 56 : 72;
  const iconSize = size === 'sm' ? 20 : size === 'md' ? 28 : 36;

  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <LinearGradient
        colors={[theme.colors.primary, theme.colors.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: dimension,
          height: dimension,
          borderRadius: dimension / 3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityRole="image"
        accessibilityLabel="Easy Trip"
      >
        <Plane size={iconSize} color={theme.colors.textOnPrimary} />
      </LinearGradient>

      {showWordmark ? (
        <AppText variant={size === 'lg' ? 'h1' : 'h2'} weight="bold">
          Easy Trip
        </AppText>
      ) : null}
    </View>
  );
}
