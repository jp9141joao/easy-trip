import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { getCountdownLabel } from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { useCurrentTrip } from '@/hooks/useTrips';
import { useTheme } from '@/theme';

/**
 * Card de viagem da Home (§2–§6).
 *
 * Uma regra só governa tudo:
 *
 *     toque em viagem não selecionada  → seleciona
 *     toque em viagem já selecionada   → abre
 *
 * O duplo toque sai de graça dessa regra, sem nenhum detector de gesto: o
 * primeiro toque seleciona, e o segundo já encontra o card selecionado e abre.
 * Por isso não existe timer, não existe janela de espera e não existe o
 * clássico conflito entre single e double tap — dois toques rápidos e dois
 * toques lentos levam ao mesmo lugar, e o primeiro toque nunca "abre sem
 * querer". Também não atrapalha leitor de tela, onde o duplo toque tem
 * significado próprio: cada ativação é um toque simples com rótulo explícito.
 */
export function TripChip({ trip, active }: { trip: Trip; active: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { setCurrentTripId } = useCurrentTrip();

  return (
    <Pressable
      onPress={() => {
        if (active) {
          router.push(`/trip/${trip.id}`);
          return;
        }
        // Só seleciona: o usuário continua na Home e o hero acima troca.
        setCurrentTripId(trip.id);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      // A borda azul não pode ser o único portador da informação de seleção
      // (§26): o estado vai no rótulo e a consequência do toque vai na dica.
      accessibilityLabel={`${trip.destinationCity}. ${active ? 'Viagem selecionada' : 'Não selecionada'}.`}
      accessibilityHint={active ? 'Toque para abrir a viagem' : 'Toque para selecionar esta viagem'}
      style={({ pressed }) => ({
        width: 150,
        borderRadius: theme.radius.smallCard,
        overflow: 'hidden',
        borderWidth: active ? 2 : 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        // A seleção é a borda; o toque é a escala. Estados distintos, para um
        // não ser confundido com o outro (§8).
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <AppImage
        uri={trip.coverImageUrl}
        style={{ height: 84, width: '100%' }}
        fallbackLabel={trip.destinationCity}
        overlay
      />
      <View
        style={{
          padding: theme.spacing.md,
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
        }}
      >
        <AppText
          variant="caption"
          weight="semibold"
          color={active ? 'brand' : 'primary'}
          numberOfLines={1}
        >
          {trip.destinationCity}
        </AppText>
        <AppText variant="caption" color={active ? 'brand' : 'tertiary'} numberOfLines={1}>
          {getCountdownLabel(trip)}
        </AppText>
      </View>
    </Pressable>
  );
}
