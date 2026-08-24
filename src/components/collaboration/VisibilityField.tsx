import { Lock, Users } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import {
  VISIBILITY_CHIP,
  VISIBILITY_LABEL,
  type Visibility,
  visibilityAccessibilityLabel,
} from '@/domain/visibility';
import { useTheme } from '@/theme';

/**
 * O seletor de visibilidade (§10).
 *
 * Duas opções lado a lado, cada uma com ícone **e** texto. O par é obrigatório
 * (§70): num aplicativo em que a diferença entre as duas é "o resto do grupo lê
 * ou não lê o seu diário", a informação não pode depender de o usuário
 * reconhecer um cadeado. E ícone sozinho também não passa por leitor de tela.
 *
 * Some inteiro quando a viagem tem uma pessoa só. Não porque a escolha deixaria
 * de funcionar — ela funciona —, mas porque "Todos da viagem" e "Somente eu"
 * são a mesma coisa quando a viagem é de um, e oferecer a decisão faria o
 * usuário procurar uma diferença que não existe.
 */
export function VisibilityField({
  value,
  onChange,
  scope,
  visible = true,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
  /** Texto de apoio explicando o que "todos" significa nesta tela. */
  scope?: string;
  visible?: boolean;
}) {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="label" color="secondary">
        Visibilidade
      </AppText>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <VisibilityOption
          option="shared"
          selected={value === 'shared'}
          onPress={() => onChange('shared')}
        />
        <VisibilityOption
          option="private"
          selected={value === 'private'}
          onPress={() => onChange('private')}
        />
      </View>

      {scope ? (
        <AppText variant="caption" color="tertiary">
          {scope}
        </AppText>
      ) : null}
    </View>
  );
}

function VisibilityOption({
  option,
  selected,
  onPress,
}: {
  option: Visibility;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Icon = option === 'shared' ? Users : Lock;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={visibilityAccessibilityLabel(option)}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.radius.smallCard,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon size={16} color={selected ? theme.colors.primary : theme.colors.textTertiary} />
      <AppText
        variant="bodySmall"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? 'brand' : 'primary'}
        numberOfLines={2}
        style={{ flex: 1 }}
      >
        {VISIBILITY_LABEL[option]}
      </AppText>
    </Pressable>
  );
}

/**
 * A etiqueta que aparece na lista.
 *
 * `showShared` existe porque numa viagem individual toda linha seria
 * "Compartilhado", e uma etiqueta que está em todos os itens não informa nada —
 * só ocupa espaço. Em viagem compartilhada os dois estados aparecem, porque aí
 * a diferença é a informação.
 */
export function VisibilityBadge({
  visibility,
  showShared = true,
}: {
  visibility: Visibility;
  showShared?: boolean;
}) {
  if (visibility === 'shared' && !showShared) return null;

  return (
    <Badge
      label={VISIBILITY_CHIP[visibility]}
      tone={visibility === 'shared' ? 'brand' : 'neutral'}
      icon={visibility === 'shared' ? Users : Lock}
    />
  );
}
