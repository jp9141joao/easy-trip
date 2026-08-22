import type { LucideIcon } from 'lucide-react-native';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';
import type { HeroBadgeVariant } from '@/theme/theme';
import { AppText } from './AppText';

/**
 * Badge desenhado por cima de fotografia (§1–§6).
 *
 * O `Badge` comum não serve aqui. Ele preenche o fundo com um tom da cor
 * semântica a ~16% de opacidade — o que funciona sobre uma superfície de cor
 * conhecida, mas sobre uma foto vira sorte: em céu claro o preenchimento some e
 * sobra texto colorido sobre a imagem, que é o que deixava "Hotel", "★ 4.4",
 * "Moderado" e "Finanças" ilegíveis.
 *
 * Aqui o contraste vem do próprio badge — um scrim opaco o bastante com borda
 * sutil — e não da imagem. A cor semântica continua existindo, mas no texto, em
 * tons claros escolhidos para passarem em AA mesmo contra uma foto totalmente
 * branca (§2, §4).
 */
export function HeroBadge({
  label,
  variant = 'neutral',
  icon: Icon,
  style,
}: {
  label: string;
  variant?: HeroBadgeVariant;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { surface, border, foreground } = theme.colors.heroBadge;
  const color = foreground[variant];

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-start',
          backgroundColor: surface,
          borderWidth: 1,
          borderColor: border,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 5,
        },
        style,
      ]}
    >
      {Icon ? <Icon size={12} color={color} /> : null}
      <AppText variant="label" weight="semibold" style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}
