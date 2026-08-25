import { zodResolver } from '@hookform/resolvers/zod';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, View } from 'react-native';

import { ReservationCard } from '@/components/cards';
import { ReminderField, VisibilityField } from '@/components/collaboration';
import {
  AppImage,
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  FadeIn,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  InfoRow,
  InlineNotice,
  SkeletonList,
  TextField,
  DateField,
  TimeField,
  useToast,
} from '@/components/ui';
import { reservationSchema, type ReservationInput } from '@/domain/schemas';
import {
  RESERVATION_CATEGORIES,
  RESERVATION_PLACE_LABELS,
  RESERVATION_PROVIDER_LABEL,
  RESERVATION_TIME_LABELS,
  anchorLabel,
  reminderAnchors,
  reservationCategory,
  type Reservation,
  type ReservationType,
} from '@/domain/reservations';
import { DEFAULT_VISIBILITY, type Visibility } from '@/domain/visibility';
import { ATTACHMENT_POLICY, validateUpload } from '@/domain/upload';
import { TripHero, TripScreenShell, TripTabs } from '@/features/trip/TripScaffold';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useTripPermissions } from '@/hooks/useCollaboration';
import {
  findReminder,
  useReminderMutations,
  useReminders,
  useReservationMutations,
  useReservations,
} from '@/hooks/useReservations';
import { useTripRealtime } from '@/hooks/useTripRealtime';
import { guessMimeType, isImageMime, isPdfMime, storedFileExists } from '@/lib/files';
import { RESERVATION_TYPE_LABEL } from '@/lib/labels';
import { dataSource, type UploadableFile } from '@/repositories';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { useTheme } from '@/theme';

/* ------------------------------ data/hora ISO ----------------------------- */

/**
 * `startAt`/`endAt` são um instante ISO; a interface pede data e hora
 * separadas, que é como as pessoas leem uma reserva ("dia 24, às 15h").
 *
 * A conversão é local de propósito: o que a pessoa digita é hora de parede do
 * lugar onde ela vai estar, e é isso que o `new Date(ano, mês, dia, h, m)` do
 * aparelho produz. Interpretar como UTC deslocaria o check-in em três horas
 * para quem cadastra do Brasil uma reserva em Paris.
 */
function splitInstant(value?: string): { date?: string; time?: string } {
  if (!value) return {};
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return {};
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

function joinInstant(date?: string, time?: string): string | undefined {
  if (!date) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = (time ?? '00:00').split(':').map(Number);
  const composed = new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0);
  return Number.isNaN(composed.getTime()) ? undefined : composed.toISOString();
}

function formatInstant(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* --------------------------------- tela ----------------------------------- */

export default function ReservationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { tripId, trip, isLoading, isError, notFound, errorMessage, refetch } = useTripRoute();

  useTripRealtime(tripId);

  const reservationsQuery = useReservations(tripId);
  const reservations = useMemo(
    () => reservationsQuery.data ?? [],
    [reservationsQuery.data],
  );
  const remindersQuery = useReminders(tripId);
  const reminders = remindersQuery.data ?? [];
  const mutations = useReservationMutations(tripId);
  const permissions = useTripPermissions(tripId);

  const [filter, setFilter] = useState<ReservationType | null>(null);
  const [creatingType, setCreatingType] = useState<ReservationType | null>(null);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [viewing, setViewing] = useState<Reservation | null>(null);
  const [deleting, setDeleting] = useState<Reservation | null>(null);

  const counts = useMemo(() => {
    const map = new Map<ReservationType, number>();
    for (const reservation of reservations) {
      map.set(reservation.type, (map.get(reservation.type) ?? 0) + 1);
    }
    return map;
  }, [reservations]);

  const visible = filter ? reservations.filter((r) => r.type === filter) : reservations;

  if (isLoading || isError || notFound || !trip) {
    return (
      <TripScreenShell>
        <View style={{ padding: theme.spacing.screen, paddingTop: 100 }}>
          {isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : (
            <GlassCard>
              <ErrorState
                title={notFound ? 'Viagem não encontrada' : 'Não foi possível carregar'}
                message={
                  notFound
                    ? 'Esta viagem pode ter sido excluída.'
                    : errorMessage
                }
                onRetry={notFound ? () => router.replace('/(tabs)/trips') : () => void refetch()}
              />
            </GlassCard>
          )}
        </View>
      </TripScreenShell>
    );
  }

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await mutations.remove.mutateAsync(deleting.id);
      toast.success('Reserva excluída');
      setDeleting(null);
    } catch (error) {
      toast.error(
        describeBackendCapability(error) ?? 'Não foi possível excluir a reserva.',
      );
    }
  };

  const empty =
    !reservationsQuery.isLoading && !reservationsQuery.isError && reservations.length === 0;

  return (
    <TripScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <TripHero trip={trip} />
        <TripTabs tripId={tripId} active="reservations" />

        <FadeIn style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.lg }}>
          {/*
            A grade de categorias é a landing da área (§23). Ela é o índice e o
            filtro ao mesmo tempo: tocar em "Voos" mostra os voos, tocar de novo
            volta para tudo. Categoria sem nada continua visível — é ela que diz
            que dá para guardar um trem aqui, o que uma lista vazia não diria.
          */}
          <CategoryGrid
            counts={counts}
            selected={filter}
            onSelect={(type) => setFilter((current) => (current === type ? null : type))}
            onCreate={
              permissions.canEdit && !reservationsQuery.isError ? setCreatingType : undefined
            }
          />

          {reservationsQuery.isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : reservationsQuery.isError ? (
            <GlassCard>
              <ErrorState
                title="Reservas indisponíveis"
                message={
                  describeBackendCapability(reservationsQuery.error) ??
                  'Não foi possível carregar as reservas desta viagem.'
                }
                onRetry={() => void reservationsQuery.refetch()}
              />
            </GlassCard>
          ) : empty ? (
            <GlassCard>
              <EmptyState
                icon={FileText}
                title="Nenhuma reserva salva"
                message="Guarde voos, hospedagens, carros e ingressos aqui — com localizador, horários e o documento anexado."
                actionLabel={permissions.canEdit ? 'Adicionar reserva' : undefined}
                onAction={permissions.canEdit ? () => setCreatingType('flight') : undefined}
              />
            </GlassCard>
          ) : visible.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={reservationCategory(filter!).creatable ? FileText : FileText}
                title={`Nenhuma reserva de ${reservationCategory(filter!).label.toLowerCase()}`}
                message="Toque na categoria de novo para ver todas as reservas da viagem."
                compact
              />
            </GlassCard>
          ) : (
            visible.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                onPress={() => setViewing(reservation)}
                showVisibility={permissions.isShared}
                hasReminder={reminders.some((r) => r.entityId === reservation.id)}
              />
            ))
          )}

          {remindersQuery.isError && !reservationsQuery.isError ? (
            <InlineNotice tone="error">
              {describeBackendCapability(remindersQuery.error) ??
                'As reservas foram carregadas, mas os lembretes estão indisponíveis.'}
            </InlineNotice>
          ) : null}

          {permissions.role === 'viewer' ? (
            <InlineNotice>
              Você tem acesso somente de visualização nesta viagem. As reservas compartilhadas
              aparecem aqui, mas não podem ser alteradas.
            </InlineNotice>
          ) : null}
        </FadeIn>
      </ScrollView>

      {empty || reservationsQuery.isError || !permissions.canEdit ? null : (
        <FloatingActionButton
          icon={Plus}
          label="Reserva"
          onPress={() => setCreatingType('flight')}
        />
      )}

      <ReservationEditorSheet
        visible={
          permissions.canEdit &&
          !reservationsQuery.isError &&
          (Boolean(creatingType) || Boolean(editing))
        }
        reservation={editing}
        initialType={creatingType ?? 'flight'}
        isShared={permissions.isShared}
        mutations={mutations}
        onClose={() => {
          setCreatingType(null);
          setEditing(null);
        }}
        onSaved={() => {
          toast.success(editing ? 'Reserva atualizada' : 'Reserva salva');
          setCreatingType(null);
          setEditing(null);
        }}
      />

      <ReservationViewerSheet
        reservation={viewing}
        tripId={tripId}
        canEdit={permissions.canEdit}
        isShared={permissions.isShared}
        onClose={() => setViewing(null)}
        onEdit={(reservation) => {
          setViewing(null);
          setEditing(reservation);
        }}
        onDelete={(reservation) => {
          setViewing(null);
          setDeleting(reservation);
        }}
      />

      <ConfirmDialog
        visible={permissions.canEdit && !reservationsQuery.isError && Boolean(deleting)}
        title="Excluir reserva?"
        message={`"${deleting?.title}", o documento anexado e os lembretes ligados a ela serão removidos. Essa ação não poderá ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </TripScreenShell>
  );
}

/* ---------------------------- grade de categorias -------------------------- */

function CategoryGrid({
  counts,
  selected,
  onSelect,
  onCreate,
}: {
  counts: Map<ReservationType, number>;
  selected: ReservationType | null;
  onSelect: (type: ReservationType) => void;
  onCreate?: (type: ReservationType) => void;
}) {
  const theme = useTheme();

  // `other` só aparece quando existe algo lá dentro: é a categoria que recebeu
  // as reservas cujo tipo antigo não tinha tradução (0011), e oferecer "Outra"
  // para criação convidaria a pessoa a não classificar nada.
  const categories = RESERVATION_CATEGORIES.filter(
    (category) => category.creatable || (counts.get(category.type) ?? 0) > 0,
  );

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {categories.map((category) => {
        const count = counts.get(category.type) ?? 0;
        const active = selected === category.type;

        return (
          <Pressable
            key={category.type}
            onPress={() => (count > 0 || !onCreate ? onSelect(category.type) : onCreate(category.type))}
            onLongPress={onCreate ? () => onCreate(category.type) : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              count === 0
                ? `${category.plural}. Nenhuma reserva. Toque para adicionar.`
                : `${category.plural}. ${count} ${count === 1 ? 'reserva' : 'reservas'}.`
            }
            style={({ pressed }) => ({
              // Três por linha em telas estreitas, sem largura fixa: `48%` daria
              // duas colunas largas demais e `31%` quebra em 320 pt.
              flexBasis: '31%',
              flexGrow: 1,
              minWidth: 96,
              gap: 4,
              padding: theme.spacing.md,
              borderRadius: theme.radius.smallCard,
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <AppText variant="body">{category.emoji}</AppText>
            <AppText
              variant="caption"
              weight="semibold"
              color={active ? 'brand' : 'primary'}
              numberOfLines={1}
            >
              {category.plural}
            </AppText>
            <AppText variant="caption" color="tertiary">
              {count === 0 ? 'Nenhuma' : `${count}`}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------- viewer --------------------------------- */

function ReservationViewerSheet({
  reservation,
  tripId,
  canEdit,
  isShared,
  onClose,
  onEdit,
  onDelete,
}: {
  reservation: Reservation | null;
  tripId: string;
  canEdit: boolean;
  isShared: boolean;
  onClose: () => void;
  onEdit: (reservation: Reservation) => void;
  onDelete: (reservation: Reservation) => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const remindersQuery = useReminders(tripId);
  const reminders = remindersQuery.data ?? [];
  const reminderMutations = useReminderMutations(tripId);

  if (!reservation) return null;

  const timeLabels = RESERVATION_TIME_LABELS[reservation.type];
  const placeLabels = RESERVATION_PLACE_LABELS[reservation.type];
  const details = reservation.details as Record<string, unknown>;

  // `fileUrl` já vem resolvido pelo repositório: cópia local quando existe, URL
  // assinada quando não (D-04). Aqui só interessa saber se há alguma forma de
  // abrir, e se ela funciona sem rede.
  const available = reservation.fileUrl ? storedFileExists(reservation.fileUrl) : false;
  const offlineReady =
    Boolean(reservation.filePath) &&
    dataSource.files.isAvailableOffline('attachment', reservation.filePath!);

  const openFile = async () => {
    if (!reservation.fileUrl) return;
    try {
      // "Uma cópia local é gravada ao anexar **e ao baixar**" (D-04). Abrir com
      // rede é a única chance de garantir que a próxima abertura, sem rede,
      // funcione — então baixa-se agora e abre-se a cópia.
      const local = reservation.filePath
        ? await dataSource.files.ensureOfflineCopy('attachment', reservation.filePath)
        : undefined;
      const target = local ?? reservation.fileUrl;

      if (target.startsWith('http')) {
        await WebBrowser.openBrowserAsync(target);
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target, {
          mimeType: reservation.mimeType,
          dialogTitle: reservation.title,
        });
        return;
      }
      await Linking.openURL(target);
    } catch {
      toast.error('Não foi possível abrir o arquivo neste dispositivo.');
    }
  };

  const share = async () => {
    if (!reservation.fileUrl) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        toast.warning('Compartilhamento indisponível neste dispositivo.');
        return;
      }
      await Sharing.shareAsync(reservation.fileUrl, { mimeType: reservation.mimeType });
    } catch {
      toast.error('Não foi possível compartilhar o arquivo.');
    }
  };

  return (
    <BottomSheet
      visible={Boolean(reservation)}
      onClose={onClose}
      title={reservation.title}
      subtitle={RESERVATION_TYPE_LABEL[reservation.type]}
    >
      <View style={{ gap: theme.spacing.lg }}>
        {reservation.fileUrl && isImageMime(reservation.mimeType) && available ? (
          <AppImage
            uri={reservation.fileUrl}
            style={{ height: 220, width: '100%' }}
            radius={theme.radius.card}
            contentFit="contain"
            accessibilityLabel={`Documento de ${reservation.title}`}
          />
        ) : null}

        <GlassCard elevation="flat">
          {reservation.provider ? (
            <InfoRow
              label={RESERVATION_PROVIDER_LABEL[reservation.type]}
              value={reservation.provider}
            />
          ) : null}
          {reservation.confirmationCode ? (
            <InfoRow label="Localizador" value={reservation.confirmationCode} />
          ) : null}
          {timeLabels.start && formatInstant(reservation.startAt) ? (
            <InfoRow label={timeLabels.start} value={formatInstant(reservation.startAt)!} />
          ) : null}
          {timeLabels.end && formatInstant(reservation.endAt) ? (
            <InfoRow label={timeLabels.end} value={formatInstant(reservation.endAt)!} />
          ) : null}
          {placeLabels.origin && reservation.origin ? (
            <InfoRow label={placeLabels.origin} value={reservation.origin} />
          ) : null}
          {placeLabels.destination && reservation.destination ? (
            <InfoRow label={placeLabels.destination} value={reservation.destination} />
          ) : null}
          {reservation.address ? <InfoRow label="Endereço" value={reservation.address} /> : null}

          {DETAIL_FIELDS[reservation.type].map((field) => {
            const value = details[field.name];
            if (value === undefined || value === null || value === '') return null;
            return <InfoRow key={field.name} label={field.label} value={String(value)} />;
          })}

          {reservation.notes ? <InfoRow label="Observações" value={reservation.notes} /> : null}
          {isShared ? (
            <InfoRow
              label="Visibilidade"
              value={reservation.visibility === 'shared' ? 'Todos da viagem' : 'Somente eu'}
            />
          ) : null}
        </GlassCard>

        {/*
          Os lembretes ficam no visualizador, e não no formulário, de propósito:
          lembrete é do usuário e não da reserva (§31). Um `viewer` que não pode
          editar a reserva pode — e deve — poder lembrar do próprio check-in.
        */}
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="label" color="secondary">
            Lembretes
          </AppText>
          {remindersQuery.isLoading ? (
            <SkeletonList count={1} lines={1} />
          ) : remindersQuery.isError ? (
            <InlineNotice tone="error">
              {describeBackendCapability(remindersQuery.error) ??
                'Não foi possível carregar os lembretes desta reserva.'}
            </InlineNotice>
          ) : (
            reminderAnchors(reservation.type).map((anchor) => (
              <ReminderField
                key={anchor}
                label={anchorLabel(reservation.type, anchor)}
                anchorAt={anchor === 'start' ? reservation.startAt : reservation.endAt}
                reminder={findReminder(reminders, reservation.id, anchor)}
                pending={reminderMutations.set.isPending}
                onSet={(minutesBefore) => {
                  reminderMutations.set.mutate(
                    { reservation, anchor, minutesBefore },
                    {
                      onSuccess: () => toast.success('Lembrete ativado'),
                      onError: (error) =>
                        toast.error(
                          describeBackendCapability(error) ??
                            (error instanceof Error
                              ? error.message
                              : 'Não foi possível criar o lembrete.'),
                        ),
                    },
                  );
                }}
                onClear={() =>
                  reminderMutations.clear.mutate(
                    { entityId: reservation.id, anchor },
                    {
                      onSuccess: () => toast.success('Lembrete desativado'),
                      onError: (error) =>
                        toast.error(
                          describeBackendCapability(error) ??
                            'Não foi possível desativar o lembrete.',
                        ),
                    },
                  )
                }
              />
            ))
          )}
        </View>

        {reservation.fileUrl ? (
          available ? (
            <>
              <Button
                label={isPdfMime(reservation.mimeType) ? 'Abrir PDF' : 'Abrir documento'}
                icon={ExternalLink}
                fullWidth
                size="lg"
                onPress={() => void openFile()}
              />
              <Button
                label="Compartilhar"
                icon={Share2}
                variant="secondary"
                fullWidth
                onPress={() => void share()}
              />
              {/*
                Honestidade do §10: só diz "abre sem internet" quando o arquivo
                está mesmo no aparelho. Uma URL assinada não é offline — ela
                expira em uma hora.
              */}
              <AppText variant="caption" color="secondary">
                {offlineReady
                  ? 'Guardado neste aparelho — abre sem internet.'
                  : 'Abra uma vez com internet para guardá-lo no aparelho.'}
              </AppText>
            </>
          ) : (
            <InlineNotice icon={Paperclip} tone="warning">
              O documento anexado não está mais disponível neste dispositivo. Edite a reserva para
              anexá-lo novamente.
            </InlineNotice>
          )
        ) : (
          <InlineNotice icon={Paperclip}>Nenhum documento anexado a esta reserva.</InlineNotice>
        )}

        {canEdit ? (
          <>
            <Button
              label="Editar"
              variant="secondary"
              fullWidth
              onPress={() => onEdit(reservation)}
            />
            <Button
              label="Excluir reserva"
              variant="ghost"
              icon={Trash2}
              fullWidth
              onPress={() => onDelete(reservation)}
            />
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}

/* --------------------------- campos por modalidade ------------------------- */

interface DetailField {
  name: string;
  label: string;
  placeholder?: string;
  numeric?: boolean;
}

/**
 * Os campos específicos de cada modalidade (§25–§29).
 *
 * A lista é declarativa porque o formulário é o mesmo para as sete
 * modalidades: o que muda é qual conjunto de campos aparece. Escrevê-los como
 * sete formulários daria sete lugares para esquecer a visibilidade, o anexo ou
 * a validação — e as diferenças reais entre um voo e um ônibus cabem nestas
 * linhas.
 */
const DETAIL_FIELDS: Record<ReservationType, DetailField[]> = {
  flight: [
    { name: 'flightNumber', label: 'Número do voo', placeholder: 'AF457' },
    { name: 'departureTerminal', label: 'Terminal de partida', placeholder: 'T3' },
    { name: 'arrivalTerminal', label: 'Terminal de chegada', placeholder: '2E' },
    { name: 'seat', label: 'Assento', placeholder: '24A' },
    { name: 'baggage', label: 'Bagagem', placeholder: '1 despachada de 23 kg' },
  ],
  hotel: [
    { name: 'room', label: 'Quarto', placeholder: 'Duplo standard' },
    { name: 'phone', label: 'Telefone', placeholder: '+33 1 23 45 67 89' },
    { name: 'guests', label: 'Hóspedes', placeholder: '2', numeric: true },
  ],
  car: [
    { name: 'model', label: 'Modelo', placeholder: 'Peugeot 208 ou similar' },
    { name: 'category', label: 'Categoria', placeholder: 'Compacto' },
    { name: 'driver', label: 'Condutor principal', placeholder: 'Nome na reserva' },
  ],
  park_ticket: [
    { name: 'quantity', label: 'Quantidade', placeholder: '2', numeric: true },
    { name: 'entrance', label: 'Entrada', placeholder: 'Pirâmide' },
  ],
  train: [
    { name: 'seat', label: 'Assento', placeholder: '32' },
    { name: 'carriage', label: 'Vagão', placeholder: '7' },
    { name: 'platform', label: 'Plataforma', placeholder: '12' },
  ],
  bus: [
    { name: 'seat', label: 'Assento', placeholder: '12' },
    { name: 'carriage', label: 'Setor', placeholder: 'Leito' },
    { name: 'platform', label: 'Plataforma', placeholder: '4' },
  ],
  other: [],
};

/* --------------------------------- editor --------------------------------- */

function ReservationEditorSheet({
  visible,
  reservation,
  initialType,
  isShared,
  mutations,
  onClose,
  onSaved,
}: {
  visible: boolean;
  reservation: Reservation | null;
  initialType: ReservationType;
  isShared: boolean;
  mutations: ReturnType<typeof useReservationMutations>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();

  const [file, setFile] = useState<UploadableFile | null>(null);
  const [type, setType] = useState<ReservationType>(reservation?.type ?? initialType);
  const [visibility, setVisibility] = useState<Visibility>(
    reservation?.visibility ?? DEFAULT_VISIBILITY.reservation,
  );
  const [details, setDetails] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState<string | undefined>();
  const [startTime, setStartTime] = useState<string | undefined>();
  const [endDate, setEndDate] = useState<string | undefined>();
  const [endTime, setEndTime] = useState<string | undefined>();

  // A folha é montada de novo a cada abertura (a chave muda com o registro),
  // então este `useMemo` roda uma vez por edição e evita um `useEffect` de
  // sincronização — que seria mais uma fonte de estado que pode ficar velho.
  const seeded = useMemo(() => {
    const start = splitInstant(reservation?.startAt);
    const end = splitInstant(reservation?.endAt);
    return { start, end };
  }, [reservation?.startAt, reservation?.endAt]);

  const { control, handleSubmit, reset, formState } = useForm<ReservationInput>({
    resolver: zodResolver(reservationSchema),
    values: {
      type: reservation?.type ?? initialType,
      title: reservation?.title ?? '',
      provider: reservation?.provider,
      confirmationCode: reservation?.confirmationCode,
      origin: reservation?.origin,
      destination: reservation?.destination,
      address: reservation?.address,
      notes: reservation?.notes,
    },
  });

  const timeLabels = RESERVATION_TIME_LABELS[type];
  const placeLabels = RESERVATION_PLACE_LABELS[type];

  const currentStartDate = startDate ?? seeded.start.date;
  const currentStartTime = startTime ?? seeded.start.time;
  const currentEndDate = endDate ?? seeded.end.date;
  const currentEndTime = endTime ?? seeded.end.time;

  const currentDetails = useMemo(() => {
    const source = (reservation?.details ?? {}) as Record<string, unknown>;
    const merged: Record<string, string> = {};
    for (const field of DETAIL_FIELDS[type]) {
      const edited = details[field.name];
      merged[field.name] = edited ?? (source[field.name] != null ? String(source[field.name]) : '');
    }
    return merged;
  }, [details, reservation?.details, type]);

  const close = () => {
    reset();
    setFile(null);
    setDetails({});
    setStartDate(undefined);
    setStartTime(undefined);
    setEndDate(undefined);
    setEndTime(undefined);
    onClose();
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const candidate = {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? guessMimeType(asset.name),
        size: asset.size ?? undefined,
      };
      // Conferido aqui, e não no "Salvar": o `type` passado ao seletor é uma
      // sugestão ao sistema, e no Android costuma dar para escolher "todos os
      // arquivos". Recusar agora diz o motivo; recusar depois só produziria o
      // erro genérico do `catch`, com o formulário inteiro já preenchido.
      const validation = validateUpload(candidate, ATTACHMENT_POLICY);
      if (!validation.ok) {
        toast.warning(validation.message);
        return;
      }
      setFile(candidate);
    } catch {
      toast.error('Não foi possível selecionar o arquivo.');
    }
  };

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.warning('Permita o acesso às fotos para anexar uma imagem.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.fileName ?? `reserva-${Date.now()}.jpg`;
      const candidate = {
        uri: asset.uri,
        name,
        mimeType: asset.mimeType ?? guessMimeType(name, 'image/jpeg'),
        size: asset.fileSize,
      };
      const validation = validateUpload(candidate, ATTACHMENT_POLICY);
      if (!validation.ok) {
        toast.warning(validation.message);
        return;
      }
      setFile(candidate);
    } catch {
      toast.error('Não foi possível selecionar a imagem.');
    }
  };

  const onSubmit = async (values: ReservationInput) => {
    try {
      const cleanedDetails: Record<string, string | number> = {};
      for (const field of DETAIL_FIELDS[type]) {
        const raw = currentDetails[field.name]?.trim();
        if (!raw) continue;
        // Campo numérico ilegível não vira `NaN` no JSONB: fica de fora. Uma
        // "quantidade: NaN" gravada seria pior do que uma quantidade ausente.
        if (field.numeric) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) cleanedDetails[field.name] = parsed;
        } else {
          cleanedDetails[field.name] = raw;
        }
      }

      const payload = {
        type,
        title: values.title,
        provider: values.provider,
        confirmationCode: values.confirmationCode,
        origin: values.origin,
        destination: values.destination,
        address: values.address,
        notes: values.notes,
        status: reservation?.status ?? ('confirmed' as const),
        visibility,
        details: cleanedDetails,
        startAt: joinInstant(currentStartDate, currentStartTime),
        endAt: joinInstant(currentEndDate, currentEndTime),
      };

      if (reservation) {
        await mutations.update.mutateAsync({
          id: reservation.id,
          patch: payload,
          file: file ?? undefined,
        });
      } else {
        await mutations.create.mutateAsync({ input: payload, file: file ?? undefined });
      }

      close();
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Não foi possível salvar a reserva. Tente novamente.',
      );
    }
  };

  const category = reservationCategory(type);

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={reservation ? 'Editar reserva' : `Nova reserva · ${category.label}`}
      subtitle={reservation ? RESERVATION_TYPE_LABEL[reservation.type] : 'Escolha a modalidade'}
    >
      <View style={{ gap: theme.spacing.lg }}>
        {!reservation ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" color="secondary">
              Modalidade
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {RESERVATION_CATEGORIES.filter((c) => c.creatable).map((option) => {
                const selected = option.type === type;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => setType(option.type)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <AppText variant="caption">{option.emoji}</AppText>
                    <AppText variant="caption" color={selected ? 'brand' : 'secondary'}>
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="Título"
              placeholder={TITLE_PLACEHOLDER[type]}
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="provider"
          render={({ field, fieldState }) => (
            <TextField
              label={RESERVATION_PROVIDER_LABEL[type]}
              placeholder={PROVIDER_PLACEHOLDER[type]}
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="confirmationCode"
          render={({ field, fieldState }) => (
            <TextField
              label="Localizador"
              placeholder="Código da reserva"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              autoCapitalize="characters"
            />
          )}
        />

        {timeLabels.start ? (
          <View style={{ gap: theme.spacing.sm }}>
            <DateField
              label={timeLabels.start}
              value={currentStartDate}
              onChange={setStartDate}
            />
            <TimeField label="Horário" value={currentStartTime} onChange={setStartTime} />
          </View>
        ) : null}

        {timeLabels.end ? (
          <View style={{ gap: theme.spacing.sm }}>
            <DateField label={timeLabels.end} value={currentEndDate} onChange={setEndDate} />
            <TimeField label="Horário" value={currentEndTime} onChange={setEndTime} />
          </View>
        ) : null}

        {placeLabels.origin || placeLabels.destination ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            {placeLabels.origin ? (
              <Controller
                control={control}
                name="origin"
                render={({ field }) => (
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={placeLabels.origin!}
                      value={field.value}
                      onChangeText={field.onChange}
                    />
                  </View>
                )}
              />
            ) : null}
            {placeLabels.destination ? (
              <Controller
                control={control}
                name="destination"
                render={({ field }) => (
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={placeLabels.destination!}
                      value={field.value}
                      onChangeText={field.onChange}
                    />
                  </View>
                )}
              />
            ) : null}
          </View>
        ) : null}

        {placeLabels.address ? (
          <Controller
            control={control}
            name="address"
            render={({ field, fieldState }) => (
              <TextField
                label={placeLabels.address!}
                placeholder="Rua, número, cidade"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        ) : null}

        {DETAIL_FIELDS[type].map((field) => (
          <TextField
            key={field.name}
            label={field.label}
            placeholder={field.placeholder}
            value={currentDetails[field.name]}
            onChangeText={(value) => setDetails((current) => ({ ...current, [field.name]: value }))}
            keyboardType={field.numeric ? 'number-pad' : 'default'}
          />
        ))}

        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <TextField
              label="Observações"
              placeholder="Qualquer coisa que você vai querer lembrar na hora"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              multiline
            />
          )}
        />

        <VisibilityField
          value={visibility}
          onChange={setVisibility}
          visible={isShared}
          scope="Reservas compartilhadas aparecem para todos os viajantes, com o documento anexado."
        />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" color="secondary">
            Documento
          </AppText>

          {file ? (
            <GlassCard elevation="flat">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Paperclip size={18} color={theme.colors.primary} />
                <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                  {file.name}
                </AppText>
                <Button label="Remover" variant="ghost" size="sm" onPress={() => setFile(null)} />
              </View>
            </GlassCard>
          ) : reservation?.fileUrl ? (
            <InlineNotice icon={Paperclip} tone="success">
              Já existe um documento anexado. Selecione outro para substituí-lo.
            </InlineNotice>
          ) : null}

          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Button
              label="Arquivo"
              icon={FileText}
              variant="secondary"
              onPress={() => void pickDocument()}
              style={{ flex: 1 }}
            />
            <Button
              label="Foto"
              icon={ImageIcon}
              variant="secondary"
              onPress={() => void pickImage()}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        <Button
          label={reservation ? 'Salvar alterações' : 'Salvar reserva'}
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

const TITLE_PLACEHOLDER: Record<ReservationType, string> = {
  flight: 'Ex.: GRU → CDG',
  hotel: 'Ex.: Hôtel du Marais',
  car: 'Ex.: Carro em Paris',
  park_ticket: 'Ex.: Museu do Louvre',
  train: 'Ex.: Paris → Lyon',
  bus: 'Ex.: Lyon → Genebra',
  other: 'Ex.: Reserva',
};

const PROVIDER_PLACEHOLDER: Record<ReservationType, string> = {
  flight: 'Air France',
  hotel: 'Nome da hospedagem',
  car: 'Europcar',
  park_ticket: 'Nome da atração',
  train: 'SNCF',
  bus: 'FlixBus',
  other: 'Fornecedor',
};
