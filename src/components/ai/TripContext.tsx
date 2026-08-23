import { ChevronDown, MapPin, Plus, Sparkles } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText, BottomSheet, EmptyState } from '@/components/ui';
import { getTripStatus, TRIP_STATUS_LABEL } from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { formatDateRange } from '@/lib/date';
import { useTheme } from '@/theme';

/**
 * Escolha explícita da viagem que a IA analisa (§1).
 *
 * O que existia antes era contexto implícito: a tela usava a viagem ativa
 * global e apenas *informava* qual era. Quem quisesse perguntar sobre outra
 * viagem tinha de sair da Assessoria, trocar a viagem ativa em outra tela e
 * voltar — e, pior, o contexto podia mudar sozinho debaixo da conversa.
 *
 * Aqui a escolha é um controle de verdade, com estado próprio da tela. Estes
 * componentes são deliberadamente burros: recebem a lista de viagens já
 * carregada pela tela (que vem de `useTrips`, ou seja, do DataSource sob RLS) e
 * devolvem um id. Não buscam nada, então não há caminho por onde a viagem de
 * outra conta entre.
 */

/** Uma linha de contexto: "França · 22 – 31 de ago". */
function tripSubtitle(trip: Trip): string {
  return `${trip.destinationCountry} · ${formatDateRange(trip.startDate, trip.endDate)}`;
}

/**
 * Barra compacta de contexto (hotfix de UX).
 *
 * O que existia aqui era um card: rótulo "CONTEXTO ATIVO" em uma linha, cidade
 * em outra, país e datas em uma terceira — e, logo abaixo, o "Novo chat" em uma
 * quarta linha só dele. Somava perto de 120pt de cabeçalho antes da primeira
 * mensagem, e num aparelho pequeno a conversa cabia em pouco mais de meia tela.
 *
 * As duas funções continuam inteiras e continuam visíveis (nada foi para dentro
 * de um menu de três pontos): a esquerda diz qual viagem a IA está lendo e abre
 * o seletor, a direita começa uma conversa nova. O que saiu foi a altura — uma
 * linha de `hitTarget`, que é o mínimo tocável, e não menos que isso.
 */
export function TripContextBar({
  trip,
  onChangeTrip,
  onNewChat,
  disabled = false,
  newChatDisabled = false,
}: {
  trip: Trip | null;
  onChangeTrip: () => void;
  onNewChat: () => void;
  /** Enquanto a lista de viagens carrega, não há o que escolher. */
  disabled?: boolean;
  newChatDisabled?: boolean;
}) {
  const theme = useTheme();

  const label = trip
    ? `Contexto ativo: ${trip.destinationCity}. ${tripSubtitle(trip)}.`
    : 'Contexto da viagem. Nenhuma viagem selecionada.';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Pressable
        onPress={onChangeTrip}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={trip ? 'Toque para trocar a viagem' : 'Toque para selecionar uma viagem'}
        accessibilityState={{ disabled }}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          // Mesma superfície de marca do card antigo, mesmos tokens: o que
          // mudou foi a caixa, não a paleta — claro e escuro seguem saindo do
          // tema, sem nenhuma cor escrita à mão (§4).
          backgroundColor: theme.colors.surfaceAccent,
          borderColor: theme.colors.surfaceAccentBorder,
          borderWidth: 1,
          borderRadius: theme.radius.pill,
          paddingLeft: theme.spacing.md,
          paddingRight: theme.spacing.sm,
          height: theme.hitTarget,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        })}
      >
        <Sparkles size={16} color={theme.colors.primary} />

        {/*
          Cidade e período na mesma linha. `numberOfLines={1}` é o que garante
          que um destino de nome comprido encolha em vez de empurrar a barra
          para uma segunda linha — que era exatamente o problema a resolver.
        */}
        <AppText variant="bodySmall" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
          {trip ? `${trip.destinationCity} · ${formatDateRange(trip.startDate, trip.endDate)}` : 'Selecionar viagem'}
        </AppText>

        <AppText variant="caption" color="brand" weight="semibold">
          {trip ? 'Trocar' : 'Escolher'}
        </AppText>
        <ChevronDown size={16} color={theme.colors.primary} />
      </Pressable>

      <Pressable
        onPress={onNewChat}
        disabled={newChatDisabled}
        accessibilityRole="button"
        accessibilityLabel="Novo chat"
        accessibilityHint="Inicia uma conversa nova com a viagem selecionada"
        accessibilityState={{ disabled: newChatDisabled }}
        hitSlop={theme.hitSlop}
        style={({ pressed }) => ({
          width: theme.hitTarget,
          height: theme.hitTarget,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          opacity: newChatDisabled ? 0.5 : 1,
        })}
      >
        <Plus size={18} color={theme.colors.primary} />
      </Pressable>
    </View>
  );
}

export function TripPickerSheet({
  visible,
  trips,
  selectedTripId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  trips: Trip[];
  selectedTripId: string | null;
  onSelect: (tripId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Qual viagem a IA deve analisar?"
      subtitle="Roteiro, gastos, checklist e orçamento vêm da viagem escolhida."
    >
      {trips.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Você ainda não tem viagens"
          message="Crie uma viagem para o assistente ter o que analisar."
          compact
        />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {trips.map((trip) => {
            const selected = trip.id === selectedTripId;
            const status = TRIP_STATUS_LABEL[getTripStatus(trip)];

            return (
              <Pressable
                key={trip.id}
                onPress={() => onSelect(trip.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, selected }}
                // A seleção não pode viver só na borda azul: vai no rótulo.
                accessibilityLabel={`${trip.destinationCity}. ${tripSubtitle(trip)}. ${status}.${
                  selected ? ' Viagem selecionada.' : ''
                }`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 64,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  borderRadius: theme.radius.smallCard,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected
                    ? theme.colors.surfaceAccent
                    : pressed
                      ? theme.colors.surfaceMuted
                      : theme.colors.surface,
                })}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected ? (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: theme.colors.primary,
                      }}
                    />
                  ) : null}
                </View>

                <View style={{ flex: 1, gap: 1 }}>
                  <AppText variant="body" weight="semibold" numberOfLines={1}>
                    {trip.destinationCity}
                  </AppText>
                  <AppText variant="caption" color="secondary" numberOfLines={1}>
                    {tripSubtitle(trip)}
                  </AppText>
                  <AppText variant="caption" color="tertiary" numberOfLines={1}>
                    {status}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </BottomSheet>
  );
}
