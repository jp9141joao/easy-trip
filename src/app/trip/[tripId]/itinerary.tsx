import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { CalendarClock, Pencil, Plus, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ScrollView, View } from 'react-native';

import { ActivityCard } from '@/components/cards';
import { VisibilityField } from '@/components/collaboration';
import {
  ActivityWeather,
  DayRouteCard,
  LocationPicker,
  SuggestionsEntryCard,
  TripLanguageCard,
  type PickedLocation,
} from '@/components/trip';
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
import type { Coordinates } from '@/domain/route';
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

        <View
          style={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.md,
          }}
        >
          <MembersSummary
            count={permissions.memberCount}
            pendingInvites={invites.length}
            onPress={() => router.push(`/trip/${tripId}/members`)}
          />
          {invitesQuery.isError ? (
            <InlineNotice icon={TriangleAlert} tone="error">
              {describeBackendCapability(invitesQuery.error) ??
                'Não foi possível carregar os convites desta viagem.'}
            </InlineNotice>
          ) : null}

          {/*
            As utilidades da Jornada, ACIMA da lista de dias e abaixo do que
            identifica a viagem.

            Sugestões vive aqui desde que saiu do nível primário (§15, §16):
            é onde se descobre o que ainda não está no roteiro, e o roteiro está
            logo abaixo. `viewer` também a vê — a tela de Sugestões já distingue
            quem pode adicionar de quem só olha (§48 do handoff anterior), e
            esconder a entrada tiraria dele a leitura sem proteger nada.

            O idioma só aparece quando difere do da pessoa; nos demais casos
            `TripLanguageCard` não renderiza nada e o `gap` não abre buraco
            (§11).
          */}
          <SuggestionsEntryCard tripId={tripId} city={trip.destinationCity} />
          <TripLanguageCard trip={trip} />
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
        // O destino da viagem é onde o mapa abre quando o item ainda não tem
        // ponto. Sem isso, a primeira marcação começaria no meio do oceano.
        tripCenter={
          trip.latitude !== undefined && trip.longitude !== undefined
            ? { latitude: trip.latitude, longitude: trip.longitude }
            : undefined
        }
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
 * A pessoa mexeu no ponto? Só então a origem passa a ser `manual`.
 *
 * Compara com o que o mapa devolveu, e não mais com o texto de dois campos:
 * um item que veio do catálogo de Sugestões e foi salvo sem tocar no mapa
 * continua marcado como do catálogo, que é a informação verdadeira sobre a
 * procedência daquela coordenada.
 */
function coordinatesChanged(item: ItineraryItem, ponto: PickedLocation | null): boolean {
  return ponto?.latitude !== item.latitude || ponto?.longitude !== item.longitude;
}

/* ----------------------------- activity editor ---------------------------- */

function ActivityEditorSheet({
  visible,
  item,
  tripStart,
  tripEnd,
  tripCenter,
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
  tripCenter?: Coordinates;
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
      // `placeName`, `address`, `latitude` e `longitude` continuam no schema —
      // o banco os quer, e a rota, o clima e o "Como chegar" dependem deles —
      // mas saíram do formulário: quem os escreve agora é o `LocationPicker`,
      // a partir do ponto tocado no mapa (§20–§23 do handoff).
      reservationReference: item?.reservationReference,
    },
  });

  const chosenDate = useWatch({ control, name: 'date' });
  const outsideTrip = chosenDate ? !isWithin(chosenDate, tripStart, tripEnd) : false;

  /*
   * O ponto marcado no mapa.
   *
   * Fica fora do `react-hook-form` porque não é um campo de texto e não tem
   * validação de string: é um par de números que existe ou não existe. O
   * `null` inicial significa "a pessoa não mexeu", e aí vale o que está no
   * item — do mesmo jeito que o formulário de reservas resolve a modalidade,
   * e pelo mesmo motivo: estado que só lê o valor inicial fica para trás
   * quando a folha é reaproveitada.
   */
  const identidade = item?.id ?? 'novo';
  const [pontoEscolhido, setPontoEscolhido] = useState<{
    identidade: string;
    value: PickedLocation | null;
  } | null>(null);

  /*
   * Editar abre no ponto que está gravado, com o endereço que está gravado
   * (§26). `address` vem definido — mesmo vazio — para o mapa entender que
   * este ponto já foi resolvido e não pedir ao geocoder de novo a cada
   * abertura da folha.
   */
  const coordinates: PickedLocation | null =
    pontoEscolhido?.identidade === identidade
      ? pontoEscolhido.value
      : item?.latitude !== undefined && item?.longitude !== undefined
        ? {
            latitude: item.latitude,
            longitude: item.longitude,
            address: item.address ?? '',
            placeName: item.placeName,
          }
        : null;

  const setCoordinates = (value: PickedLocation | null) =>
    setPontoEscolhido({ identidade, value });

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
            // Resolvidos pelo mapa, não digitados. Vazio vira `undefined`
            // para não gravar string vazia onde o certo é "não sei" (§24).
            placeName: coordinates?.placeName || undefined,
            address: coordinates?.address || undefined,
            latitude: coordinates?.latitude,
            longitude: coordinates?.longitude,
            placeSource: coordinatesChanged(item, coordinates) ? 'manual' : item.placeSource,
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
          placeName: coordinates?.placeName || undefined,
          address: coordinates?.address || undefined,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
          placeSource: coordinates ? 'manual' : undefined,
          reservationReference: values.reservationReference,
          completed: false,
          sortOrder: nextSortOrder,
          visibility,
        });
      }
      reset();
      setPontoEscolhido(null);
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

        {/*
          LOCALIZAÇÃO — só o mapa (§20, §21 do handoff).

          Saíram daqui, nesta ordem: "Latitude" e "Longitude" (rodada
          anterior), e agora "Local" e "Endereço". Nenhum dos quatro é
          pergunta que se faça a quem está planejando uma viagem — quem sabe o
          endereço de um restaurante em Tóquio é o aparelho, não a pessoa.

          O mapa passou a ser a FONTE DA VERDADE: um toque define o ponto, o
          geocoder do sistema resolve o endereço, e os dois são gravados
          juntos. Continuam existindo no banco `latitude`, `longitude`,
          `address` e `placeName` — sem eles não há rota do dia, distância,
          "Como chegar", clima por horário nem contexto para a IA (§23). O que
          mudou foi quem os escreve.
        */}
        <LocationPicker
          value={coordinates}
          onChange={setCoordinates}
          // Sem ponto ainda, o mapa abre no destino da viagem: é onde a
          // atividade quase certamente é, e poupa a pessoa de atravessar o
          // planeta arrastando.
          fallbackCenter={tripCenter}
        />

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
