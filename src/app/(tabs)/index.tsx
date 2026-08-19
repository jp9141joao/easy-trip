import { useRouter } from 'expo-router';
import {
  Bell,
  CalendarClock,
  ChevronRight,
  CloudSun,
  Clock3,
  LifeBuoy,
  Map as MapIcon,
  Receipt,
  Ticket as TicketIcon,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArticleCard, OfferCard, PlaceCard } from '@/components/cards';
import {
  AppImage,
  AppText,
  Avatar,
  Badge,
  EmptyState,
  GlassCard,
  IconButton,
  OfflineBanner,
  PageLabel,
  ProgressBar,
  SectionHeader,
  SkeletonCard,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { DOCK_CLEARANCE } from '@/constants/layout';
import {
  getBudgetUsagePercent,
  getCountdownLabel,
  getNextActivities,
  getRemainingBudget,
  getTripStatus,
  getTripTotalSpent,
  isOverBudget,
  TRIP_STATUS_LABEL,
} from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { useAlerts } from '@/hooks/useAlerts';
import { useArticles, useOffers, usePlaces } from '@/hooks/useContent';
import { useCurrentTrip } from '@/hooks/useTrips';
import { useChecklist, useExpenses, useItinerary } from '@/hooks/useTripData';
import { formatMoney } from '@/lib/currency';
import { formatDateRange, formatWeekdayDate } from '@/lib/date';
import { ITINERARY_TYPE_LABEL } from '@/lib/labels';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useTheme } from '@/theme';

export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { profile } = useAuth();
  const { isOffline } = useConnectivity();

  const { trip, trips, isLoading } = useCurrentTrip();
  const { data: expenses = [] } = useExpenses(trip?.id);
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: checklist = [] } = useChecklist(trip?.id);
  const { data: offers = [] } = useOffers();
  const { data: articles = [] } = useArticles();
  const { data: places = [] } = usePlaces();
  const alerts = useAlerts();

  const cardWidth = Math.min(width * 0.72, 300);
  const nextActivities = useMemo(() => getNextActivities(itinerary, 3), [itinerary]);

  const greeting = getGreeting();
  const firstName = profile?.name?.split(' ')[0] ?? 'viajante';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingBottom: DOCK_CLEARANCE + theme.spacing.xl,
          gap: theme.spacing['2xl'],
        }}
      >
        {/* ------------------------------- Header ------------------------------ */}
        <View style={{ paddingHorizontal: theme.spacing.screen }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <PageLabel>Visão geral</PageLabel>
              <AppText variant="h2" numberOfLines={1}>
                {greeting}, {firstName}
              </AppText>
            </View>

            <View style={{ position: 'relative' }}>
              <IconButton
                icon={Bell}
                accessibilityLabel={
                  alerts.length > 0
                    ? `Central de alertas, ${alerts.length} alertas`
                    : 'Central de alertas'
                }
                onPress={() => router.push('/alerts')}
                background="surface"
                style={theme.shadows.sm}
              />
              {alerts.length > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    minWidth: 18,
                    height: 18,
                    paddingHorizontal: 4,
                    borderRadius: 9,
                    backgroundColor: theme.colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AppText variant="label" style={{ color: '#FFFFFF', fontSize: 10 }}>
                    {alerts.length}
                  </AppText>
                </View>
              ) : null}
            </View>

            <Avatar
              uri={profile?.avatarUrl}
              name={profile?.name}
              onPress={() => router.push('/profile')}
              accessibilityLabel="Abrir perfil"
            />
          </View>
        </View>

        {isOffline ? (
          <View style={{ paddingHorizontal: theme.spacing.screen }}>
            <OfflineBanner />
          </View>
        ) : null}

        {/* -------------------------- Hero / trip carousel --------------------- */}
        {isLoading ? (
          <View style={{ paddingHorizontal: theme.spacing.screen }}>
            <SkeletonCard lines={4} height={260} />
          </View>
        ) : !trip ? (
          <View style={{ paddingHorizontal: theme.spacing.screen }}>
            <GlassCard>
              <EmptyState
                icon={MapIcon}
                title="Sua próxima viagem começa aqui"
                message="Crie sua primeira viagem para organizar roteiro, orçamento, documentos e muito mais em um só lugar."
                actionLabel="Planejar primeira viagem"
                onAction={() => router.push('/trips/new')}
                compact
              />
            </GlassCard>
          </View>
        ) : (
          <>
            <TripHero trip={trip} expensesTotal={getTripTotalSpent(expenses, trip)} />

            {trips.length > 1 ? (
              <View>
                <SectionHeader
                  title="Suas viagens"
                  actionLabel="Ver todas"
                  onAction={() => router.push('/(tabs)/trips')}
                  style={{ paddingHorizontal: theme.spacing.screen }}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // Peeking the next card signals that the row scrolls (§27).
                  contentContainerStyle={{
                    paddingHorizontal: theme.spacing.screen,
                    gap: theme.spacing.md,
                  }}
                  snapToInterval={cardWidth + theme.spacing.md}
                  decelerationRate="fast"
                >
                  {trips.map((item) => (
                    <TripChip key={item.id} trip={item} active={item.id === trip.id} />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* ---------------------------- Quick actions ------------------------ */}
            <View style={{ paddingHorizontal: theme.spacing.screen }}>
              <SectionHeader title="Ações rápidas" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
                <QuickAction
                  icon={CalendarClock}
                  label="Roteiro"
                  onPress={() => router.push(`/trip/${trip.id}/itinerary`)}
                />
                <QuickAction
                  icon={Receipt}
                  label="Gastos"
                  onPress={() => router.push(`/trip/${trip.id}/finance`)}
                />
                <QuickAction
                  icon={TicketIcon}
                  label="Tickets"
                  onPress={() => router.push(`/trip/${trip.id}/tickets`)}
                />
                <QuickAction
                  icon={CloudSun}
                  label="Clima"
                  onPress={() => router.push('/utilities/weather')}
                />
                <QuickAction
                  icon={Clock3}
                  label="Fuso"
                  onPress={() => router.push('/utilities/timezone')}
                />
                <QuickAction
                  icon={LifeBuoy}
                  label="SOS"
                  tone="accent"
                  onPress={() => router.push('/utilities/sos')}
                />
              </View>
            </View>

            {/* --------------------------- Next activities ----------------------- */}
            <View style={{ paddingHorizontal: theme.spacing.screen }}>
              <SectionHeader
                title="Próximas atividades"
                actionLabel="Ver roteiro"
                onAction={() => router.push(`/trip/${trip.id}/itinerary`)}
              />

              {nextActivities.length === 0 ? (
                <GlassCard>
                  <EmptyState
                    icon={CalendarClock}
                    title="Nenhuma atividade planejada"
                    message="Comece pela chegada e pela hospedagem."
                    actionLabel="Adicionar atividade"
                    onAction={() => router.push(`/trip/${trip.id}/itinerary`)}
                    compact
                  />
                </GlassCard>
              ) : (
                <View style={{ gap: theme.spacing.md }}>
                  {nextActivities.map((activity) => (
                    <GlassCard
                      key={activity.id}
                      onPress={() => router.push(`/trip/${trip.id}/itinerary`)}
                      accessibilityLabel={`${activity.title}, ${formatWeekdayDate(activity.date)}`}
                      accessibilityHint="Abre o roteiro"
                    >
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}
                      >
                        <View
                          style={{
                            alignItems: 'center',
                            backgroundColor: theme.colors.primarySoft,
                            borderRadius: theme.radius.smallCard,
                            paddingVertical: theme.spacing.sm,
                            paddingHorizontal: theme.spacing.md,
                            minWidth: 58,
                          }}
                        >
                          <AppText variant="caption" color="brand" mono weight="bold">
                            {activity.startTime ?? '--:--'}
                          </AppText>
                        </View>

                        <View style={{ flex: 1, gap: 2 }}>
                          <AppText variant="body" weight="semibold" numberOfLines={1}>
                            {activity.title}
                          </AppText>
                          <AppText variant="caption" color="secondary" numberOfLines={1}>
                            {formatWeekdayDate(activity.date)} ·{' '}
                            {ITINERARY_TYPE_LABEL[activity.type]}
                          </AppText>
                        </View>

                        <ChevronRight size={18} color={theme.colors.textTertiary} />
                      </View>
                    </GlassCard>
                  ))}
                </View>
              )}
            </View>

            {/* ------------------------------- Budget ---------------------------- */}
            <View style={{ paddingHorizontal: theme.spacing.screen }}>
              <SectionHeader
                title="Orçamento"
                actionLabel="Ver carteira"
                onAction={() => router.push(`/trip/${trip.id}/finance`)}
              />
              <BudgetSummary trip={trip} expenses={expenses} />
            </View>

            {/* ----------------------------- Checklist --------------------------- */}
            {checklist.length > 0 ? (
              <View style={{ paddingHorizontal: theme.spacing.screen }}>
                <GlassCard
                  onPress={() => router.push(`/trip/${trip.id}/checklist`)}
                  accessibilityLabel="Abrir checklist"
                >
                  <View style={{ gap: theme.spacing.md }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText variant="body" weight="semibold">
                        Checklist
                      </AppText>
                      <AppText variant="bodySmall" color="secondary" mono>
                        {checklist.filter((item) => item.completed).length}/{checklist.length}
                      </AppText>
                    </View>
                    <ProgressBar
                      percent={
                        (checklist.filter((item) => item.completed).length / checklist.length) * 100
                      }
                      label="Progresso do checklist"
                    />
                  </View>
                </GlassCard>
              </View>
            ) : null}
          </>
        )}

        {/* -------------------------------- Em alta ---------------------------- */}
        {offers.length > 0 ? (
          <View>
            <SectionHeader
              title="Em alta"
              subtitle="Destinos com ofertas nesta temporada"
              actionLabel="Ver todas"
              onAction={() => router.push('/offers')}
              style={{ paddingHorizontal: theme.spacing.screen }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: theme.spacing.screen,
                gap: theme.spacing.md,
              }}
              snapToInterval={cardWidth + theme.spacing.md}
              decelerationRate="fast"
            >
              {offers.slice(0, 6).map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  width={cardWidth}
                  onPress={() => router.push(`/offers/${offer.id}`)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ------------------------------ Comunidade --------------------------- */}
        {articles.length > 0 ? (
          <View>
            <SectionHeader
              title="Para a comunidade"
              subtitle="Guias e preparação escritos pelo time"
              actionLabel="Ver tudo"
              onAction={() => router.push('/community')}
              style={{ paddingHorizontal: theme.spacing.screen }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: theme.spacing.screen,
                gap: theme.spacing.md,
              }}
              snapToInterval={cardWidth + theme.spacing.md}
              decelerationRate="fast"
            >
              {articles.slice(0, 5).map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  width={cardWidth}
                  onPress={() => router.push(`/community/${article.id}`)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* --------------------------- Restaurantes e hotéis -------------------- */}
        {places.length > 0 ? (
          <View>
            <SectionHeader
              title="Restaurantes e hotéis"
              subtitle="Selecionados pelo Easy Trip"
              actionLabel="Explorar"
              onAction={() => router.push('/places')}
              style={{ paddingHorizontal: theme.spacing.screen }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: theme.spacing.screen,
                gap: theme.spacing.md,
              }}
              snapToInterval={cardWidth + theme.spacing.md}
              decelerationRate="fast"
            >
              {places
                .filter((place) => place.type !== 'attraction')
                .slice(0, 6)
                .map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    width={cardWidth}
                    onPress={() => router.push(`/places/${place.id}`)}
                  />
                ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/* --------------------------------- pieces --------------------------------- */

function TripHero({ trip, expensesTotal }: { trip: Trip; expensesTotal: number }) {
  const theme = useTheme();
  const router = useRouter();
  const status = getTripStatus(trip);

  return (
    <View style={{ paddingHorizontal: theme.spacing.screen }}>
      <Pressable
        onPress={() => router.push(`/trip/${trip.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Viagem para ${trip.destinationCity}. ${getCountdownLabel(trip)}`}
        accessibilityHint="Abre o painel da viagem"
        style={({ pressed }) => [
          {
            borderRadius: theme.radius.heroCard,
            overflow: 'hidden',
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
          theme.shadows.lg,
        ]}
      >
        <AppImage
          uri={trip.coverImageUrl}
          style={{ height: 280, width: '100%' }}
          fallbackLabel={trip.destinationCity}
          overlay
        />

        <View
          style={{
            position: 'absolute',
            top: theme.spacing.lg,
            left: theme.spacing.lg,
            right: theme.spacing.lg,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Badge
            label={TRIP_STATUS_LABEL[status]}
            tone={status === 'active' ? 'success' : status === 'upcoming' ? 'brand' : 'neutral'}
          />
          <Badge label={getCountdownLabel(trip)} tone="accent" />
        </View>

        <View
          style={{
            position: 'absolute',
            left: theme.spacing.xl,
            right: theme.spacing.xl,
            bottom: theme.spacing.xl,
            gap: 4,
          }}
        >
          <AppText variant="display" color="onImage" weight="bold" numberOfLines={1}>
            {trip.destinationCity}
          </AppText>
          <AppText variant="body" color="onImage" numberOfLines={1}>
            {trip.destinationCountry}
          </AppText>
          <AppText variant="bodySmall" color="onImage" style={{ opacity: 0.85 }}>
            {formatDateRange(trip.startDate, trip.endDate)}
          </AppText>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: theme.spacing.sm,
            }}
          >
            <Wallet size={14} color={theme.colors.textOnImage} />
            <AppText variant="caption" color="onImage" mono>
              {formatMoney(trip.budgetTotal - expensesTotal, trip.budgetCurrency)} restantes
            </AppText>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function TripChip({ trip, active }: { trip: Trip; active: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { setCurrentTripId } = useCurrentTrip();

  return (
    <Pressable
      onPress={() => {
        setCurrentTripId(trip.id);
        router.push(`/trip/${trip.id}`);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Selecionar viagem para ${trip.destinationCity}`}
      style={{
        width: 150,
        borderRadius: theme.radius.smallCard,
        overflow: 'hidden',
        borderWidth: active ? 2 : 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
      }}
    >
      <AppImage
        uri={trip.coverImageUrl}
        style={{ height: 84, width: '100%' }}
        fallbackLabel={trip.destinationCity}
        overlay
      />
      <View
        style={{ padding: theme.spacing.md, backgroundColor: theme.colors.surface }}
      >
        <AppText variant="caption" weight="semibold" numberOfLines={1}>
          {trip.destinationCity}
        </AppText>
        <AppText variant="caption" color="tertiary" numberOfLines={1}>
          {getCountdownLabel(trip)}
        </AppText>
      </View>
    </Pressable>
  );
}

function BudgetSummary({
  trip,
  expenses,
}: {
  trip: Trip;
  expenses: Parameters<typeof getTripTotalSpent>[0];
}) {
  const theme = useTheme();
  const spent = getTripTotalSpent(expenses, trip);
  const remaining = getRemainingBudget(expenses, trip);
  const percent = getBudgetUsagePercent(expenses, trip);
  const over = isOverBudget(expenses, trip);

  return (
    <GlassCard>
      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <AppText variant="caption" color="secondary">
              {over ? 'Excedido em' : 'Restante'}
            </AppText>
            <AppText
              variant="h2"
              mono
              weight="bold"
              color={over ? 'error' : 'primary'}
            >
              {formatMoney(over ? Math.abs(remaining) : remaining, trip.budgetCurrency)}
            </AppText>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <AppText variant="caption" color="secondary">
              de {formatMoney(trip.budgetTotal, trip.budgetCurrency)}
            </AppText>
            <AppText variant="bodySmall" color={over ? 'error' : 'brand'} weight="semibold" mono>
              {Math.round(percent)}% usado
            </AppText>
          </View>
        </View>

        <ProgressBar
          percent={percent}
          tone={over ? 'error' : percent > 80 ? 'warning' : 'brand'}
          label="Uso do orçamento"
        />

        {over ? (
          <View
            style={{
              backgroundColor: theme.colors.errorSoft,
              borderRadius: theme.radius.smallCard,
              padding: theme.spacing.md,
            }}
          >
            <AppText variant="caption" color="error" weight="semibold">
              Orçamento excedido
            </AppText>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="caption" color="tertiary">
            Gasto: {formatMoney(spent, trip.budgetCurrency)}
          </AppText>
          <AppText variant="caption" color="tertiary">
            {expenses.length} {expenses.length === 1 ? 'despesa' : 'despesas'}
          </AppText>
        </View>
      </View>
    </GlassCard>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onPress,
  tone = 'brand',
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: 'brand' | 'accent';
}) {
  const theme = useTheme();
  const color = tone === 'accent' ? theme.colors.accent : theme.colors.primary;
  const background = tone === 'accent' ? theme.colors.accentSoft : theme.colors.primarySoft;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        // Three per row on a 360pt screen, wrapping gracefully on smaller ones.
        flexBasis: '30%',
        flexGrow: 1,
        alignItems: 'center',
        gap: 6,
        paddingVertical: theme.spacing.lg,
        borderRadius: theme.radius.smallCard,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        minHeight: 84,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={18} color={color} />
      </View>
      <AppText variant="caption" color="secondary" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

function getGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
