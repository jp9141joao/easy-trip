import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { CalendarClock, Pencil, Plus, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ScrollView, View } from 'react-native';

import { ActivityCard } from '@/components/cards';
import { VisibilityField } from '@/components/collaboration';
import { ActivityWeather, DayRouteCard } from '@/components/trip';
import { MembersSummary } from '@/components/collaboration/MemberRow';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  DateField,
  EmptyState,
  FadeIn,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  InlineNotice,
  SectionHeader,
  SelectField,
  SkeletonList,
  TextField,
  TimeField,
  useToast,
} from '@/components/ui';
import { groupItineraryByDate, sortItinerary } from '@/domain/selectors';
import { itineraryItemSchema, type ItineraryItemInput } from '@/domain/schemas';
import { ITINERARY_TYPES, type ItineraryItem, type ItineraryType } from '@/domain/types';
import { TripHero, TripScreenShell, TripTabs } from '@/features/trip/TripScaffold';
import { RoteiroModules } from '@/features/trip/RoteiroModules';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useItinerary, useItineraryMutations } from '@/hooks/useTripData';
import { useMemberNames, useTripInvites, useTripPermissions } from '@/hooks/useCollaboration';
import { useTripRealtime } from '@/hooks/useTripRealtime';
import { authorshipLabel } from '@/domain/collaboration';
import { DEFAULT_VISIBILITY, type Visibility } from '@/domain/visibility';
import { useAuth } from '@/providers/AuthProvider';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { formatWeekdayDate, isWithin } from '@/lib/date';
import { ITINERARY_TYPE_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

export default function ItineraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { tripId, trip, isLoading, isError, notFound, errorMessage, refetch } = useTripRoute();
  const { user } = useAuth();

  // A viagem aberta é a única assinada (§8, §58). Sai da tela, sai a assinatura.
  useTripRealtime(tripId);

  const { data: items = [], isLoading: loadingItems } = useItinerary(tripId);
  const mutations = useItineraryMutations(tripId);
  const permissions = useTripPermissions(tripId);
  const memberNames = useMemberNames(tripId);
  const invitesQuery = useTripInvites(tripId, permissions.canManageMembers);
  const invites = invitesQuery.data ?? [];

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ItineraryItem | null>(null);
  const [deleting, setDeleting] = useState<ItineraryItem | null>(null);

  const days = useMemo(() => groupItineraryByDate(items), [items]);

  if (isLoading) {
    return (
      <TripScreenShell>
        <View style={{ padding: theme.spacing.screen, paddingTop: 80 }}>
          <SkeletonList count={3} lines={3} />
        </View>
      </TripScreenShell>
    );
  }

  if (isError || notFound || !trip) {
    return (
      <TripScreenShell>
        <View style={{ padding: theme.spacing.screen, paddingTop: 100 }}>
          <GlassCard>
            <ErrorState
              title={notFound ? 'Viagem não encontrada' : 'Não foi possível carregar'}
              message={
                notFound
                  ? 'Esta viagem pode ter sido excluída.'
                  : errorMessage
              }
              onRetry={notFound ? () => router.replace('/(tabs)/trips') : () => void refetch()}
              retryLabel={notFound ? 'Voltar para viagens' : 'Tentar novamente'}
            />
          </GlassCard>
        </View>
      </TripScreenShell>
    );
  }

  const openEditor = (item?: ItineraryItem) => {
    setEditing(item ?? null);
    setEditorOpen(true);
  };

  const toggleComplete = async (item: ItineraryItem) => {
    try {
      await mutations.update.mutateAsync({ id: item.id, patch: { completed: !item.completed } });
    } catch {
      toast.error('Não foi possível atualizar a atividade.');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await mutations.remove.mutateAsync(deleting.id);
      toast.success('Atividade excluída');
      setDeleting(null);
    } catch {
      toast.error('Não foi possível excluir a atividade.');
    }
  };

  // Um único CTA para a primeira criação: quando o empty state já oferece a
  // ação, o FAB logo abaixo seria o mesmo botão duas vezes (§20). Assim que
  // existe conteúdo, o FAB volta ao comportamento normal.
  const emptyCtaVisible = !loadingItems && items.length === 0;

  return (
    <TripScreenShell>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <TripHero
          trip={trip}
          onEdit={
            // Editar destino, datas e orçamento é do proprietário (§3). Sem
            // isto, um editor veria o lápis e receberia a recusa da RLS.
            permissions.role === 'owner' ? () => router.push(`/trip/${tripId}/edit`) : undefined
          }
        />
        <TripTabs tripId={tripId} active="itinerary" />
        <RoteiroModules tripId={tripId} active="itinerary" />

        <View style={{ paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.md }}>
          <MembersSummary
            count={permissions.memberCount}
            pendingInvites={invites.length}
            onPress={() => router.push(`/trip/${tripId}/members`)}
          />
          {invitesQuery.isError ? (
            <View style={{ marginTop: theme.spacing.sm }}>
              <InlineNotice icon={TriangleAlert} tone="error">
                {describeBackendCapability(invitesQuery.error) ??
                  'Não foi possível carregar os convites desta viagem.'}
              </InlineNotice>
            </View>
          ) : null}
        </View>

        <FadeIn style={{ paddingHorizontal: theme.spacing.screen }}>
          {loadingItems ? (
            <SkeletonList count={3} lines={2} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nenhuma atividade planejada ainda"
              message="Comece pela chegada, a hospedagem e o que você não quer perder."
              actionLabel={permissions.canEdit ? 'Adicionar atividade' : undefined}
              onAction={permissions.canEdit ? () => openEditor() : undefined}
            />
          ) : (
            days.map((day) => (
              <View key={day.date} style={{ marginBottom: theme.spacing.lg }}>
                <SectionHeader
                  title={formatWeekdayDate(day.date)}
                  subtitle={`${day.items.length} ${day.items.length === 1 ? 'atividade' : 'atividades'}`}
                />
                {day.items.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onPress={permissions.canEdit ? () => openEditor(item) : undefined}
                    onToggle={permissions.canEdit ? () => void toggleComplete(item) : undefined}
                    onMenu={permissions.canEdit ? () => setDeleting(item) : undefined}
                    showVisibility={permissions.isShared}
                    authorLabel={authorshipLabel(item.createdBy, user?.id, memberNames)}
                    weather={
                      <ActivityWeather
                        latitude={item.latitude}
                        longitude={item.longitude}
                        date={item.date}
                        startTime={item.startTime}
                      />
                    }
                  />
                ))}

                {/*
                  A rota entra DEPOIS da lista do dia, e não antes: o roteiro é
                  o conteúdo, o mapa é a leitura dele. O card não aparece com
                  menos de duas paradas com coordenada — ver `buildDayRoute`.
                */}
                <DayRouteCard
                  items={day.items}
                  date={day.date}
                  onOpenFullMap={() => router.push('/utilities/map')}
                />
              </View>
            ))
          )}
        </FadeIn>
      </ScrollView>

      {emptyCtaVisible || !permissions.canEdit ? null : (
        <FloatingActionButton icon={Plus} label="Atividade" onPress={() => openEditor()} />
      )}

      <ActivityEditorSheet
        visible={editorOpen}
        item={editing}
        tripStart={trip.startDate}
        tripEnd={trip.endDate}
        nextSortOrder={sortItinerary(items).length}
        isShared={permissions.isShared}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          toast.success(editing ? 'Atividade atualizada' : 'Atividade adicionada');
        }}
        mutations={mutations}
      />

      <ConfirmDialog
        visible={Boolean(deleting)}
        title="Excluir atividade?"
        message={`"${deleting?.title}" será removida do roteiro. Essa ação não poderá ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </TripScreenShell>
  );
}

/* ------------------------------ coordenadas ------------------------------- */

/**
 * Texto do campo → número, ou nada.
 *
 * "Ou nada" é a parte que importa: campo vazio tem de virar `undefined`, e não
 * `0`. Latitude 0 e longitude 0 são um ponto real no Atlântico, e uma atividade
 * que caísse lá apareceria no mini mapa com um marcador numerado — sem que
 * ninguém tivesse digitado coordenada nenhuma.
 */
function parseCoordinate(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A pessoa mexeu na coordenada? Só então a origem passa a ser `manual`. */
function coordinatesChanged(item: ItineraryItem, values: ItineraryItemInput): boolean {
  return (
    parseCoordinate(values.latitude) !== item.latitude ||
    parseCoordinate(values.longitude) !== item.longitude
  );
}

/* ----------------------------- activity editor ---------------------------- */

function ActivityEditorSheet({
  visible,
  item,
  tripStart,
  tripEnd,
  nextSortOrder,
  isShared,
  onClose,
  onSaved,
  mutations,
}: {
  visible: boolean;
  item: ItineraryItem | null;
  tripStart: string;
  tripEnd: string;
  nextSortOrder: number;
  isShared: boolean;
  onClose: () => void;
  onSaved: () => void;
  mutations: ReturnType<typeof useItineraryMutations>;
}) {
  const theme = useTheme();
  const toast = useToast();
  const [confirmOutside, setConfirmOutside] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(
    item?.visibility ?? DEFAULT_VISIBILITY.itinerary,
  );

  const { control, handleSubmit, reset, formState } = useForm<ItineraryItemInput>({
    resolver: zodResolver(itineraryItemSchema),
    values: {
      // Defaults to the trip's first day, never a hardcoded "dia 1" (§35).
      date: item?.date ?? tripStart,
      startTime: item?.startTime,
      endTime: item?.endTime,
      type: item?.type ?? 'atividade',
      title: item?.title ?? '',
      description: item?.description,
      placeName: item?.placeName,
      address: item?.address,
      latitude: item?.latitude !== undefined ? String(item.latitude) : undefined,
      longitude: item?.longitude !== undefined ? String(item.longitude) : undefined,
      reservationReference: item?.reservationReference,
    },
  });

  const chosenDate = useWatch({ control, name: 'date' });
  const outsideTrip = chosenDate ? !isWithin(chosenDate, tripStart, tripEnd) : false;

  const persist = async (values: ItineraryItemInput) => {
    try {
      if (item) {
        await mutations.update.mutateAsync({
          id: item.id,
          patch: {
            date: values.date,
            startTime: values.startTime,
            endTime: values.endTime,
            type: values.type as ItineraryType,
            title: values.title,
            description: values.description,
            placeName: values.placeName,
            address: values.address,
            latitude: parseCoordinate(values.latitude),
            longitude: parseCoordinate(values.longitude),
            placeSource: coordinatesChanged(item, values) ? 'manual' : item.placeSource,
            reservationReference: values.reservationReference,
            visibility,
          },
        });
      } else {
        await mutations.create.mutateAsync({
          date: values.date,
          startTime: values.startTime,
          endTime: values.endTime,
          type: values.type as ItineraryType,
          title: values.title,
          description: values.description,
          placeName: values.placeName,
          address: values.address,
          latitude: parseCoordinate(values.latitude),
          longitude: parseCoordinate(values.longitude),
          placeSource: parseCoordinate(values.latitude) === undefined ? undefined : 'manual',
          reservationReference: values.reservationReference,
          completed: false,
          sortOrder: nextSortOrder,
          visibility,
        });
      }
      reset();
      setConfirmOutside(false);
      onSaved();
    } catch {
      toast.error('Não foi possível salvar a atividade. Tente novamente.');
    }
  };

  const onSubmit = async (values: ItineraryItemInput) => {
    // A date outside the trip is allowed, but only with explicit confirmation.
    if (outsideTrip && !confirmOutside) {
      setConfirmOutside(true);
      return;
    }
    await persist(values);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Editar atividade' : 'Nova atividade'}
      subtitle={item ? undefined : 'Adicione ao roteiro desta viagem'}
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="Título"
              placeholder="Ex.: Visita ao Museu do Louvre"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="type"
          render={({ field, fieldState }) => (
            <SelectField
              label="Tipo"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              options={ITINERARY_TYPES.map((type) => ({
                value: type,
                label: ITINERARY_TYPE_LABEL[type],
              }))}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="date"
          render={({ field, fieldState }) => (
            <DateField
              label="Data"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        {outsideTrip ? (
          <InlineNotice icon={TriangleAlert} tone="warning">
            Essa data está fora do período da viagem. Toque em salvar novamente para confirmar.
          </InlineNotice>
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Controller
            control={control}
            name="startTime"
            render={({ field, fieldState }) => (
              <View style={{ flex: 1 }}>
                <TimeField
                  label="Início"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              </View>
            )}
          />
          <Controller
            control={control}
            name="endTime"
            render={({ field, fieldState }) => (
              <View style={{ flex: 1 }}>
                <TimeField
                  label="Fim"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              </View>
            )}
          />
        </View>

        <Controller
          control={control}
          name="placeName"
          render={({ field, fieldState }) => (
            <TextField
              label="Local"
              placeholder="Nome do lugar"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        {/*
          Localização (§17).

          O endereço é texto livre; as coordenadas são o que faz o item entrar
          no mapa do dia, na distância e na previsão por horário. Sem elas o
          item continua perfeitamente válido — só não é desenhável.

          O caminho preferido para preencher isto não é digitar: é adicionar
          pelo módulo Sugestões, que já traz a coordenada do catálogo. Estes
          campos existem para o caso em que a pessoa tem o ponto e quer
          registrá-lo à mão.
        */}
        <Controller
          control={control}
          name="address"
          render={({ field, fieldState }) => (
            <TextField
              label="Endereço"
              placeholder="Rua, número, bairro"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Controller
            control={control}
            name="latitude"
            render={({ field, fieldState }) => (
              <View style={{ flex: 1 }}>
                <TextField
                  label="Latitude"
                  placeholder="48.8606"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            )}
          />
          <Controller
            control={control}
            name="longitude"
            render={({ field, fieldState }) => (
              <View style={{ flex: 1 }}>
                <TextField
                  label="Longitude"
                  placeholder="2.3376"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            )}
          />
        </View>

        <VisibilityField
          value={visibility}
          onChange={setVisibility}
          visible={isShared}
          scope="Itens compartilhados aparecem no roteiro de todos os viajantes."
        />

        <Controller
          control={control}
          name="reservationReference"
          render={({ field, fieldState }) => (
            <TextField
              label="Reserva / localizador"
              placeholder="Código da reserva, se houver"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              autoCapitalize="characters"
            />
          )}
        />

        <Controller
          control={control}
          name="description"
          render={({ field, fieldState }) => (
            <TextField
              label="Observações"
              placeholder="Detalhes úteis para o dia"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              multiline
            />
          )}
        />

        <Button
          label={item ? 'Salvar alterações' : 'Adicionar ao roteiro'}
          icon={item ? Pencil : Plus}
          size="lg"
          fullWidth
          loading={formState.isSubmitting}
          onPress={handleSubmit(onSubmit)}
          haptic
        />
      </View>
    </BottomSheet>
  );
}
