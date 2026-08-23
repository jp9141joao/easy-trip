import { CheckCircle2, Sparkles } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Button, ButtonRow } from '@/components/ui';
import { describeAction, type AITripAction } from '@/domain/aiActions';
import { useTheme } from '@/theme';

/**
 * O card compacto que aparece **abaixo** de uma resposta que trouxe propostas.
 *
 * Compacto é requisito, não estilo: se toda resposta virasse um bloco de botões
 * grandes, a conversa deixaria de parecer conversa e o botão perderia sentido
 * de urgência justamente onde ele importa. Respostas de leitura ("quanto já
 * gastei?") não trazem action nenhuma, e portanto não trazem card (§10, §17).
 *
 * Três estados, e só:
 *
 *   proposta   → [Revisar] [Implementar]
 *   aplicando  → botão em loading, os dois desabilitados
 *   aplicada   → "Adicionado à viagem", sem botão de aplicar
 *
 * O terceiro estado é o que impede o toque duplo de gravar duas vezes. Ele vem
 * do id da proposta, não de um `useRef` de "já cliquei": rolar a conversa,
 * desmontar e remontar a bolha não devolve o botão (§10).
 */
export function AIActionCard({
  actions,
  applied,
  pending,
  onReview,
  onImplement,
}: {
  actions: AITripAction[];
  applied: boolean;
  pending: boolean;
  onReview: () => void;
  onImplement: () => void;
}) {
  const theme = useTheme();
  if (actions.length === 0) return null;

  const single = actions.length === 1 ? actions[0] : null;

  if (applied) {
    return (
      <View
        accessible
        accessibilityLabel="Sugestão aplicada à viagem"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          alignSelf: 'flex-start',
          maxWidth: '96%',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.smallCard,
          backgroundColor: theme.colors.successSoft,
        }}
      >
        <CheckCircle2 size={16} color={theme.colors.success} />
        <AppText variant="caption" weight="semibold" style={{ color: theme.colors.success }}>
          Adicionado à viagem
        </AppText>
      </View>
    );
  }

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '96%',
        width: '96%',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.smallCard,
        borderWidth: 1,
        borderColor: theme.colors.surfaceAccentBorder,
        backgroundColor: theme.colors.surfaceAccent,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Sparkles size={16} color={theme.colors.primary} />
        <AppText variant="bodySmall" weight="semibold" style={{ flex: 1 }}>
          {single ? single.label : 'Posso aplicar isso na viagem'}
        </AppText>
      </View>

      <View style={{ gap: 2 }}>
        {actions.map((action) => (
          <AppText key={action.id} variant="caption" color="secondary">
            • {describeAction(action)}
          </AppText>
        ))}
      </View>

      <ButtonRow>
        <View style={{ flex: 1 }}>
          <Button
            label="Revisar"
            variant="secondary"
            size="sm"
            fullWidth
            disabled={pending}
            onPress={onReview}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={pending ? 'Adicionando…' : 'Implementar'}
            size="sm"
            fullWidth
            loading={pending}
            haptic
            onPress={onImplement}
          />
        </View>
      </ButtonRow>
    </View>
  );
}
