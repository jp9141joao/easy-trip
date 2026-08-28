import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  CloudSun,
  Clock3,
  LifeBuoy,
  Map as MapIcon,
  Pencil,
  TriangleAlert,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppImage,
  AppText,
  IconButton,
  InlineNotice,
  SegmentedTabs,
  type SegmentedTabItem,
} from '@/components/ui';
import { TripStatusChip, TripTimingChip } from '@/components/trip';
import { tripCoverUri } from '@/domain/tripCover';
import type { Trip } from '@/domain/types';
import { useTripPermissions } from '@/hooks/useCollaboration';
import { formatDateRange } from '@/lib/date';
import { formatMoney } from '@/lib/currency';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { useTheme } from '@/theme';

export type TripSection = 'itinerary' | 'finance' | 'reservations';
export type RoteiroSection = 'itinerary' | 'checklist' | 'journal';

/**
 * Shared chrome for every trip screen (§33).
 *
 * The hero always renders the trip whose `tripId` is in the route, which is why
 * the header can never disagree with the content below it (CA-01).
 */
export function TripHero({
  trip,
  spent,
  onEdit,
}: {
  trip: Trip;
  spent?: number;
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View>
      <AppImage
        uri={tripCoverUri(trip)}
        style={{ height: 240 + insets.top, width: '100%' }}
        fallbackLabel={trip.destinationCity}
        overlay
        // As seções da viagem desenham este mesmo hero. Sem zerar o fade, a
        // foto reaparece animada a cada troca de aba e a tela lê como três
        // telas batendo uma na outra em vez de uma só (§2).
        transition={0}
      />

      <View
        style={{
          position: 'absolute',
          top: insets.top + theme.spacing.sm,
          left: theme.spacing.screen,
          right: theme.spacing.screen,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Voltar"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/trips'))}
          background="onImage"
        />

        <View style={{ flex: 1 }} />

        <IconButton
          icon={CloudSun}
          accessibilityLabel="Clima do destino"
          onPress={() => router.push('/utilities/weather')}
          background="onImage"
        />
        <IconButton
          icon={Clock3}
          accessibilityLabel="Fuso horário"
          onPress={() => router.push('/utilities/timezone')}
          background="onImage"
        />
        <IconButton
          icon={MapIcon}
          accessibilityLabel="Mapa"
          onPress={() => router.push('/utilities/map')}
          background="onImage"
        />
        <IconButton
          icon={LifeBuoy}
          accessibilityLabel="Emergência e SOS"
          onPress={() => router.push('/utilities/sos')}
          background="onImage"
        />
      </View>

      {/*
        Ordem de leitura do hero (§29): destino → período → status → tempo
        restante. Os chips ficam abaixo do texto, e não acima, porque é o
        destino que identifica a tela; status e contagem qualificam o que já
        foi identificado.
      */}
      <View
        style={{
          position: 'absolute',
          left: theme.spacing.screen,
          right: theme.spacing.screen,
          bottom: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <AppText
            variant="h1"
            color="onImage"
            weight="bold"
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {trip.destinationCity}
          </AppText>
          {onEdit ? (
            <IconButton
              icon={Pencil}
              accessibilityLabel="Editar viagem"
              onPress={onEdit}
              background="onImage"
              size={16}
            />
          ) : null}
        </View>

        <AppText variant="bodySmall" color="onImage" numberOfLines={1}>
          {trip.destinationCountry} · {formatDateRange(trip.startDate, trip.endDate)}
        </AppText>

        {/* `flexWrap` porque "Em andamento" + "Faltam 127 dias" não cabem em
            uma linha em telas estreitas (§35). */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
          }}
        >
          <TripStatusChip trip={trip} />
          <TripTimingChip trip={trip} />
        </View>

        {spent !== undefined ? (
          <AppText variant="caption" color="onImage" mono style={{ opacity: 0.9 }}>
            {formatMoney(trip.budgetTotal - spent, trip.budgetCurrency)} de{' '}
            {formatMoney(trip.budgetTotal, trip.budgetCurrency)} restantes
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/**
 * As seções da viagem: Roteiro · Carteira · Reservas (§15 do handoff).
 *
 * "Tickets" virou "Reservas" — mudança de produto, não de rótulo: a área
 * deixou de guardar um documento com título e passou a guardar uma reserva com
 * modalidade, localizador e horários (§22–§24).
 *
 * SUGESTÕES SAIU DAQUI — e a funcionalidade não foi tocada.
 *
 * As três que ficaram são onde a pessoa GUARDA o que já decidiu. Sugestões é
 * onde ela DESCOBRE o que ainda não decidiu, e isso pertence a quem está
 * montando o roteiro: passou a ser um degrau abaixo, em Roteiro → Jornada →
 * Sugestões (§16). A rota `/trip/:id/suggestions` continua existindo e
 * navegável (§18); o que mudou foi por onde se chega a ela.
 *
 * Com a saída da quarta pastilha a barra deixou de precisar rolar: três
 * rótulos de largura igual cabem sem truncar em aparelho de 320 pt, que era
 * exatamente o motivo do `scrollable`.
 */
export function TripTabs({ tripId, active }: { tripId: string; active: TripSection }) {
  const theme = useTheme();
  const router = useRouter();
  const permissions = useTripPermissions(tripId);

  const items: SegmentedTabItem<TripSection>[] = [
    { value: 'itinerary', label: 'Roteiro' },
    { value: 'finance', label: 'Carteira' },
    { value: 'reservations', label: 'Reservas' },
  ];

  return (
    <View style={{ paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.lg }}>
      <SegmentedTabs<TripSection>
        items={items}
        value={active}
        onChange={(value) => {
          if (value === active) return;
          router.replace(`/trip/${tripId}/${value}`);
        }}
      />

      {permissions.status === 'error' || permissions.status === 'unavailable' ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <InlineNotice icon={TriangleAlert} tone="error">
            {permissions.status === 'unavailable'
              ? 'Sua participação nesta viagem não foi encontrada. A edição permanece bloqueada até que o acesso seja corrigido.'
              : describeBackendCapability(permissions.error) ??
                'Não foi possível confirmar sua permissão nesta viagem. Verifique a conexão e tente novamente.'}
          </InlineNotice>
        </View>
      ) : null}
    </View>
  );
}

export function TripScreenShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>{children}</View>;
}
