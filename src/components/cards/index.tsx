import * as Haptics from 'expo-haptics';
import {
  Bed,
  Bus,
  Calendar,
  Camera,
  Check,
  Clock,
  Heart,
  MapPin,
  MoreVertical,
  Plane,
  Star,
  Bell,
  Car,
  FileText,
  Ticket as TicketIcon,
  TrainFront,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppImage, AppText, Badge, GlassCard, IconButton, ProgressBar } from '@/components/ui';
import { getGoalProgress } from '@/domain/selectors';
import type {
  Advisor,
  Article,
  ChecklistItem,
  Expense,
  Goal,
  ItineraryItem,
  ItineraryType,
  Offer,
  Place,
  Reservation,
  Trip,
} from '@/domain/types';
import { formatMoney } from '@/lib/currency';
import { formatLongDate, formatShortDate } from '@/lib/date';
import {
  ADVISOR_STATUS_LABEL,
  COST_LEVEL_LABEL,
  EXPENSE_CATEGORY_LABEL,
  GOAL_TYPE_LABEL,
  ITINERARY_TYPE_LABEL,
  PLACE_TYPE_LABEL,
  RESERVATION_TYPE_LABEL,
} from '@/lib/labels';
import type { ReactNode } from 'react';
import { VisibilityBadge } from '@/components/collaboration/VisibilityField';
import type { ReservationType } from '@/domain/reservations';
import { visibilityAccessibilityLabel } from '@/domain/visibility';
import { useTheme } from '@/theme';

export { TripCard } from './TripCard';

/* ------------------------------ ActivityCard ------------------------------ */

const ITINERARY_ICON: Record<ItineraryType, LucideIcon> = {
  voo: Plane,
  hospedagem: Bed,
  refeicao: Utensils,
  atracao: Camera,
  transporte: Bus,
  atividade: MapPin,
  outro: Calendar,
};

export function ActivityCard({
  item,
  onPress,
  onToggle,
  onMenu,
  showVisibility = false,
  authorLabel,
  weather,
}: {
  item: ItineraryItem;
  onPress?: () => void;
  onToggle?: () => void;
  onMenu?: () => void;
  /** Etiqueta de compartilhado/privado — só em viagem com mais de um viajante. */
  showVisibility?: boolean;
  /** "Adicionado por Maria". Vazio quando o autor é quem está lendo (§9). */
  authorLabel?: string;
  /** Previsão do horário desta atividade. Injetada para o card não ir à rede. */
  weather?: ReactNode;
}) {
  const theme = useTheme();
  const Icon = ITINERARY_ICON[item.type];

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      {/* Timeline rail */}
      <View style={{ alignItems: 'center', width: 52 }}>
        <AppText variant="caption" color={item.completed ? 'tertiary' : 'brand'} weight="semibold" mono>
          {item.startTime ?? '--:--'}
        </AppText>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            marginTop: 4,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: item.completed ? theme.colors.successSoft : theme.colors.primarySoft,
          }}
        >
          <Icon size={15} color={item.completed ? theme.colors.success : theme.colors.primary} />
        </View>
        <View style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginTop: 4 }} />
      </View>

      <GlassCard
        style={{ flex: 1, marginBottom: theme.spacing.lg, opacity: item.completed ? 0.7 : 1 }}
        onPress={onPress}
        accessibilityLabel={[
          item.title,
          ITINERARY_TYPE_LABEL[item.type],
          item.startTime ? `às ${item.startTime}` : null,
          item.completed ? 'Concluída' : null,
          showVisibility ? visibilityAccessibilityLabel(item.visibility) : null,
          authorLabel,
        ]
          .filter(Boolean)
          .join('. ')}
        accessibilityHint={onPress ? 'Abre a atividade para edição' : undefined}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText
              variant="body"
              weight="semibold"
              numberOfLines={2}
              style={item.completed ? { textDecorationLine: 'line-through' } : undefined}
            >
              {item.title}
            </AppText>

            {item.placeName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="secondary" numberOfLines={1}>
                  {item.placeName}
                </AppText>
              </View>
            ) : null}

            {item.description ? (
              <AppText variant="caption" color="secondary" numberOfLines={2}>
                {item.description}
              </AppText>
            ) : null}

            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: 2 }}>
              <Badge label={ITINERARY_TYPE_LABEL[item.type]} tone="neutral" />
              {item.endTime ? (
                <Badge label={`até ${item.endTime}`} tone="neutral" icon={Clock} />
              ) : null}
              {showVisibility ? <VisibilityBadge visibility={item.visibility} /> : null}
            </View>

            {weather}

            {/*
              A autoria é discreta de propósito (§9): quem adicionou importa
              quando duas pessoas montam o dia juntas, e não importa o
              suficiente para competir com o título da atividade.
            */}
            {authorLabel ? (
              <AppText variant="caption" color="tertiary" numberOfLines={1}>
                {authorLabel}
              </AppText>
            ) : null}
          </View>

          <View style={{ gap: theme.spacing.xs }}>
            {onToggle ? (
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                  onToggle();
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.completed }}
                accessibilityLabel={item.completed ? 'Marcar como pendente' : 'Marcar como concluída'}
                hitSlop={theme.hitSlop}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  borderWidth: 2,
                  borderColor: item.completed ? theme.colors.success : theme.colors.borderStrong,
                  backgroundColor: item.completed ? theme.colors.success : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.completed ? <Check size={14} color={theme.colors.textOnPrimary} /> : null}
              </Pressable>
            ) : null}

            {onMenu ? (
              <IconButton
                icon={MoreVertical}
                accessibilityLabel={`Ações para ${item.title}`}
                onPress={onMenu}
                size={16}
                style={{ width: 26, height: 26 }}
              />
            ) : null}
          </View>
        </View>
      </GlassCard>
    </View>
  );
}

/* ------------------------------ ChecklistRow ------------------------------ */

export function ChecklistRow({
  item,
  onToggle,
  onMenu,
  showVisibility = false,
  authorLabel,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onMenu?: () => void;
  showVisibility?: boolean;
  authorLabel?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.completed }}
      accessibilityLabel={[
        item.label,
        showVisibility ? visibilityAccessibilityLabel(item.visibility) : null,
        authorLabel,
      ]
        .filter(Boolean)
        .join('. ')}
      accessibilityHint="Toque para alternar a conclusão"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.smallCard,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        minHeight: 56,
        // Completed items stay in the list, just de-emphasised (§36).
        opacity: item.completed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: item.completed ? theme.colors.success : theme.colors.borderStrong,
          backgroundColor: item.completed ? theme.colors.success : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {item.completed ? <Check size={14} color={theme.colors.textOnPrimary} /> : null}
      </View>

      <View style={{ flex: 1 }}>
        <AppText
          variant="body"
          numberOfLines={2}
          style={item.completed ? { textDecorationLine: 'line-through' } : undefined}
        >
          {item.label}
        </AppText>
        {item.dueDate ? (
          <AppText variant="caption" color="tertiary">
            até {formatShortDate(item.dueDate)}
          </AppText>
        ) : null}
        {authorLabel ? (
          <AppText variant="caption" color="tertiary" numberOfLines={1}>
            {authorLabel}
          </AppText>
        ) : null}
      </View>

      {showVisibility ? <VisibilityBadge visibility={item.visibility} showShared={false} /> : null}

      {item.priority === 'high' && !item.completed ? (
        <Badge label="Alta" tone="error" />
      ) : null}

      {onMenu ? (
        <IconButton
          icon={MoreVertical}
          accessibilityLabel={`Ações para ${item.label}`}
          onPress={onMenu}
          size={16}
          style={{ width: 32, height: 32 }}
        />
      ) : null}
    </Pressable>
  );
}

/* ------------------------------- ExpenseCard ------------------------------ */

export function ExpenseCard({
  expense,
  budgetCurrency,
  onPress,
  showVisibility = false,
  payerLabel,
}: {
  expense: Expense;
  budgetCurrency: Expense['currency'];
  onPress?: () => void;
  showVisibility?: boolean;
  /** "Pago por Maria". Vazio quando quem pagou é quem está lendo (§13). */
  payerLabel?: string;
}) {
  const theme = useTheme();
  const converted = expense.currency !== budgetCurrency;
  const unconverted = converted && typeof expense.amountInBudgetCurrency !== 'number';

  return (
    <GlassCard
      onPress={onPress}
      accessibilityLabel={[
        expense.description,
        formatMoney(expense.amount, expense.currency),
        payerLabel,
        showVisibility ? visibilityAccessibilityLabel(expense.visibility) : null,
      ]
        .filter(Boolean)
        .join('. ')}
      accessibilityHint={onPress ? 'Abre a despesa para edição' : undefined}
      style={{ marginBottom: theme.spacing.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="body" weight="semibold" numberOfLines={1}>
            {expense.description}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Badge label={EXPENSE_CATEGORY_LABEL[expense.category]} tone="neutral" />
            <AppText variant="caption" color="tertiary">
              {formatShortDate(expense.transactionDate)}
            </AppText>
          </View>
          {payerLabel ? (
            <AppText variant="caption" color="tertiary" numberOfLines={1}>
              {payerLabel}
            </AppText>
          ) : null}
          {showVisibility ? <VisibilityBadge visibility={expense.visibility} /> : null}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <AppText variant="body" weight="bold" mono>
            {formatMoney(expense.amount, expense.currency)}
          </AppText>

          {converted ? (
            unconverted ? (
              // Honest about what we could not convert (§41).
              <AppText variant="caption" color="warning">
                Cotação indisponível
              </AppText>
            ) : (
              <AppText variant="caption" color="tertiary" mono>
                ≈ {formatMoney(expense.amountInBudgetCurrency!, budgetCurrency)}
              </AppText>
            )
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

/* ---------------------------- ReservationCard ----------------------------- */

const RESERVATION_ICON: Record<ReservationType, LucideIcon> = {
  flight: Plane,
  hotel: Bed,
  car: Car,
  park_ticket: TicketIcon,
  train: TrainFront,
  bus: Bus,
  other: FileText,
};

/**
 * Uma reserva na lista (§23, §24).
 *
 * O que aparece no card é o que identifica a reserva de relance no aeroporto:
 * título, fornecedor, localizador em monoespaçada — porque é um código que se
 * digita — e as etiquetas de anexo e visibilidade.
 *
 * A visibilidade só aparece em viagem compartilhada (`showVisibility`). Numa
 * viagem individual toda linha seria "Compartilhado", e uma etiqueta presente
 * em 100% dos itens não informa nada: só ocupa a largura de que o título
 * precisa.
 */
export function ReservationCard({
  reservation,
  onPress,
  showVisibility = false,
  hasReminder = false,
}: {
  reservation: Reservation;
  onPress: () => void;
  showVisibility?: boolean;
  hasReminder?: boolean;
}) {
  const theme = useTheme();
  const Icon = RESERVATION_ICON[reservation.type] ?? FileText;

  return (
    <GlassCard
      onPress={onPress}
      accessibilityLabel={[
        reservation.title,
        RESERVATION_TYPE_LABEL[reservation.type],
        showVisibility ? visibilityAccessibilityLabel(reservation.visibility) : null,
        hasReminder ? 'Lembrete ativo' : null,
      ]
        .filter(Boolean)
        .join('. ')}
      accessibilityHint="Abre a reserva"
      style={{ marginBottom: theme.spacing.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.smallCard,
            backgroundColor: theme.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={20} color={theme.colors.primary} />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="body" weight="semibold" numberOfLines={1}>
            {reservation.title}
          </AppText>
          {reservation.provider ? (
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {reservation.provider}
            </AppText>
          ) : null}
          {reservation.confirmationCode ? (
            <AppText variant="caption" color="tertiary" mono numberOfLines={1}>
              {reservation.confirmationCode}
            </AppText>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Badge label={RESERVATION_TYPE_LABEL[reservation.type]} tone="brand" />
          {reservation.fileUrl ? <Badge label="Anexo" tone="success" /> : null}
          {hasReminder ? <Badge label="Lembrete" tone="accent" icon={Bell} /> : null}
          {showVisibility ? <VisibilityBadge visibility={reservation.visibility} /> : null}
        </View>
      </View>
    </GlassCard>
  );
}

/* -------------------------------- GoalCard -------------------------------- */

export function GoalCard({ goal, onPress }: { goal: Goal; onPress: () => void }) {
  const theme = useTheme();
  const progress = getGoalProgress(goal);
  const isMoney = goal.unit === 'R$' || goal.unit === '$';

  const format = (value: number) =>
    isMoney ? formatMoney(value, 'BRL') : `${value} ${goal.unit}`;

  return (
    <GlassCard
      onPress={onPress}
      accessibilityLabel={`${goal.title}. ${Math.round(progress.percent)} por cento concluído`}
      accessibilityHint="Abre a meta"
      style={{ marginBottom: theme.spacing.lg }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="body" weight="semibold" numberOfLines={2}>
              {goal.title}
            </AppText>
            <Badge label={GOAL_TYPE_LABEL[goal.type]} tone="brand" />
          </View>

          {goal.status === 'completed' || progress.reached ? (
            <Badge label="Concluída" tone="success" icon={Check} />
          ) : goal.deadline ? (
            <AppText variant="caption" color="tertiary">
              até {formatShortDate(goal.deadline)}
            </AppText>
          ) : null}
        </View>

        <ProgressBar
          percent={progress.percent}
          tone={progress.reached ? 'success' : 'brand'}
          label={`Progresso de ${goal.title}`}
        />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="caption" color="secondary" mono>
            {format(goal.currentValue)} / {format(goal.targetValue)}
          </AppText>
          <AppText variant="caption" color={progress.reached ? 'success' : 'brand'} weight="semibold">
            {Math.round(progress.percent)}%
          </AppText>
        </View>
      </View>
    </GlassCard>
  );
}

/* -------------------------------- OfferCard ------------------------------- */

export function OfferCard({
  offer,
  onPress,
  width,
}: {
  offer: Offer;
  onPress: () => void;
  width?: number;
}) {
  const theme = useTheme();

  const discountLabel = () => {
    if (!offer.discountType) return null;
    if (offer.discountType === 'percentage') return `-${offer.discountValue}%`;
    if (offer.discountType === 'fixed') {
      return `-${formatMoney(Number(offer.discountValue), offer.priceCurrency ?? 'BRL')}`;
    }
    return String(offer.discountValue);
  };
  const discount = discountLabel();

  return (
    <GlassCard
      padded={false}
      onPress={onPress}
      accessibilityLabel={`Oferta para ${offer.destination}`}
      accessibilityHint="Abre os detalhes da oferta"
      style={{ width, marginBottom: width ? 0 : theme.spacing.lg }}
    >
      <AppImage
        uri={offer.imageUrl}
        style={{ height: 140, width: '100%' }}
        fallbackLabel={offer.destination}
        overlay
      />

      {discount ? (
        <View style={{ position: 'absolute', top: theme.spacing.md, left: theme.spacing.md }}>
          <Badge label={discount} tone="accent" />
        </View>
      ) : null}

      <View style={{ padding: theme.spacing.lg, gap: 6 }}>
        <AppText variant="body" weight="semibold" numberOfLines={1}>
          {offer.destination}
        </AppText>
        <AppText variant="caption" color="secondary" numberOfLines={2}>
          {offer.description}
        </AppText>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <Badge label={COST_LEVEL_LABEL[offer.costLevel]} tone="neutral" />
          {offer.price !== undefined ? (
            <AppText variant="bodySmall" weight="bold" mono color="brand">
              {formatMoney(offer.price, offer.priceCurrency ?? 'BRL')}
            </AppText>
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

/* ------------------------------- ArticleCard ------------------------------ */

export function ArticleCard({
  article,
  onPress,
  liked,
  width,
}: {
  article: Article;
  onPress: () => void;
  liked?: boolean;
  width?: number;
}) {
  const theme = useTheme();

  return (
    <GlassCard
      padded={false}
      onPress={onPress}
      accessibilityLabel={`${article.title}. Por ${article.authorName}`}
      accessibilityHint="Abre o artigo"
      style={{ width, marginBottom: width ? 0 : theme.spacing.lg }}
    >
      <AppImage
        uri={article.imageUrl}
        style={{ height: 130, width: '100%' }}
        fallbackLabel={article.title}
        overlay
      />

      <View style={{ padding: theme.spacing.lg, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Badge label={article.category} tone="brand" />
          {liked ? <Heart size={13} color={theme.colors.accent} fill={theme.colors.accent} /> : null}
        </View>

        <AppText variant="body" weight="semibold" numberOfLines={2}>
          {article.title}
        </AppText>

        <AppText variant="caption" color="tertiary" numberOfLines={1}>
          {article.authorName} · {article.estimatedReadMinutes} min de leitura
        </AppText>
      </View>
    </GlassCard>
  );
}

/* -------------------------------- PlaceCard ------------------------------- */

export function PlaceCard({
  place,
  onPress,
  favorite,
  onToggleFavorite,
  width,
}: {
  place: Place;
  onPress: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  width?: number;
}) {
  const theme = useTheme();

  return (
    <GlassCard
      padded={false}
      onPress={onPress}
      accessibilityLabel={`${place.name}. ${PLACE_TYPE_LABEL[place.type]} em ${place.city}`}
      accessibilityHint="Abre os detalhes do lugar"
      style={{ width, marginBottom: width ? 0 : theme.spacing.lg }}
    >
      <AppImage
        uri={place.imageUrl}
        style={{ height: 130, width: '100%' }}
        fallbackLabel={place.name}
        overlay
      />

      {onToggleFavorite ? (
        <View style={{ position: 'absolute', top: theme.spacing.sm, right: theme.spacing.sm }}>
          <IconButton
            icon={Heart}
            accessibilityLabel={favorite ? `Remover ${place.name} dos favoritos` : `Favoritar ${place.name}`}
            onPress={onToggleFavorite}
            background="onImage"
            color={favorite ? theme.colors.accent : theme.colors.textOnImage}
            size={18}
          />
        </View>
      ) : null}

      <View style={{ padding: theme.spacing.lg, gap: 6 }}>
        <AppText variant="body" weight="semibold" numberOfLines={1}>
          {place.name}
        </AppText>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MapPin size={12} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="secondary" numberOfLines={1} style={{ flex: 1 }}>
            {place.city}, {place.country}
          </AppText>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Badge label={PLACE_TYPE_LABEL[place.type]} tone="neutral" />
          {place.rating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Star size={12} color={theme.colors.warning} fill={theme.colors.warning} />
              <AppText variant="caption" color="secondary" mono>
                {place.rating.toFixed(1)}
              </AppText>
            </View>
          ) : null}
          {place.priceLevel ? (
            <AppText variant="caption" color="tertiary">
              {'$'.repeat(place.priceLevel)}
            </AppText>
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

/* ------------------------------- AdvisorCard ------------------------------ */

export function AdvisorCard({
  advisor,
  onPress,
  actionLabel = 'Agendar consultoria',
}: {
  advisor: Advisor;
  onPress: () => void;
  actionLabel?: string;
}) {
  const theme = useTheme();

  const statusTone =
    advisor.status === 'online' ? 'success' : advisor.status === 'busy' ? 'warning' : 'neutral';

  return (
    <GlassCard
      onPress={onPress}
      accessibilityLabel={`${advisor.name}, especialista em ${advisor.specialty}. ${ADVISOR_STATUS_LABEL[advisor.status]}`}
      accessibilityHint={actionLabel}
      style={{ marginBottom: theme.spacing.lg }}
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
        <AppImage
          uri={advisor.avatarUrl}
          style={{ width: 56, height: 56, borderRadius: 28 }}
          fallbackLabel={advisor.name}
        />

        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <AppText variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
              {advisor.name}
            </AppText>
            <Badge label={ADVISOR_STATUS_LABEL[advisor.status]} tone={statusTone} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Badge label={advisor.specialty} tone="brand" />
            {advisor.rating ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Star size={12} color={theme.colors.warning} fill={theme.colors.warning} />
                <AppText variant="caption" color="secondary" mono>
                  {advisor.rating.toFixed(1)}
                </AppText>
              </View>
            ) : null}
          </View>

          {advisor.bio ? (
            <AppText variant="caption" color="secondary" numberOfLines={2}>
              {advisor.bio}
            </AppText>
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

/** Small helper used by trip detail headers. */
export function TripSummaryLine({ trip }: { trip: Trip }) {
  return (
    <AppText variant="bodySmall" color="secondary">
      {formatLongDate(trip.startDate)} — {formatLongDate(trip.endDate)}
    </AppText>
  );
}
