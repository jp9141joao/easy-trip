import { useRouter } from 'expo-router';
import { ChevronRight, Sparkles } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, GlassCard } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * A porta de entrada das Sugestões, agora dentro da Jornada (§15, §16).
 *
 * POR QUE SAIU DO NÍVEL PRIMÁRIO
 *
 * `Roteiro · Carteira · Reservas · Sugestões` colocava lado a lado três áreas
 * onde a pessoa GUARDA o que já decidiu e uma onde ela DESCOBRE o que ainda não
 * decidiu. A quarta pastilha ainda obrigava a barra a rolar em aparelho estreito
 * — quatro rótulos de largura igual truncavam "Sugestões". Sugestão é matéria
 * de quem está montando o roteiro, e é ao lado do roteiro que ela pertence.
 *
 * POR QUE ESTE CARTÃO NÃO BUSCA NADA
 *
 * Deliberadamente não chama `useSuggestions`. Aquele hook faz `ensure`, que
 * GERA sugestões quando a lista está abaixo do mínimo — e a janela de 6 h (§43)
 * seria consumida por quem só abriu a Jornada para ver o roteiro do dia. Um
 * número no cartão não paga esse preço. Quem entra na tela é que dispara a
 * geração, exatamente como antes.
 *
 * `push`, e não `replace`: Sugestões passou a ser um degrau ABAIXO da Jornada,
 * então voltar tem de devolver a pessoa à Jornada (§17).
 */
export function SuggestionsEntryCard({ tripId, city }: { tripId: string; city: string }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <GlassCard
      onPress={() => router.push(`/trip/${tripId}/suggestions`)}
      accessibilityLabel={`Sugestões para ${city}`}
      accessibilityHint="Abre lugares e experiências para adicionar ao roteiro"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: theme.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sparkles size={18} color={theme.colors.primary} />
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="body" weight="semibold">
            Sugestões
          </AppText>
          <AppText variant="caption" color="secondary" numberOfLines={2}>
            {`Lugares e experiências para completar o roteiro em ${city}.`}
          </AppText>
        </View>

        <ChevronRight size={18} color={theme.colors.textTertiary} />
      </View>
    </GlassCard>
  );
}
