import { ChevronRight, MapPin, Sparkles } from 'lucide-react-native';
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

export function TripContextCard({
  trip,
  onPress,
  disabled = false,
}: {
  trip: Trip | null;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  const label = trip
    ? `Contexto ativo: ${trip.destinationCity}. ${tripSubtitle(trip)}.`
    : 'Contexto da viagem. Nenhuma viagem selecionada.';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={trip ? 'Toque para trocar a viagem' : 'Toque para selecionar uma viagem'}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        // Superfície com identidade da marca: este card não é "mais um card
        // branco", é o que diz sobre o que a IA está falando (§4).
        backgroundColor: theme.colors.surfaceAccent,
        borderColor: theme.colors.surfaceAccentBorder,
        borderWidth: 1,
        borderRadius: theme.radius.card,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: theme.hitTarget,
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Sparkles size={18} color={theme.colors.primary} />
      </View>

      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="label" color="brand" uppercase>
          {trip ? 'Contexto ativo' : 'Contexto da viagem'}
        </AppText>
        <AppText variant="body" weight="semibold" numberOfLines={1}>
          {trip ? trip.destinationCity : 'Selecionar viagem'}
        </AppText>
        {trip ? (
          <AppText variant="caption" color="secondary" numberOfLines={1}>
            {tripSubtitle(trip)}
          </AppText>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {trip ? (
          <AppText variant="caption" color="brand" weight="semibold">
            Trocar viagem
          </AppText>
        ) : null}
        <ChevronRight size={18} color={theme.colors.primary} />
      </View>
    </Pressable>
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
