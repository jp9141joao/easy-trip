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
  Ticket as TicketIcon,
  Trash2,
} from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, View } from 'react-native';

import { TicketCard } from '@/components/cards';
import {
  AppImage,
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  InfoRow,
  InlineNotice,
  SelectField,
  SkeletonList,
  TextField,
  useToast,
} from '@/components/ui';
import { ticketSchema, type TicketInput } from '@/domain/schemas';
import { TICKET_TYPES, type Ticket, type TicketType } from '@/domain/types';
import { TripHero, TripScreenShell, TripTabs } from '@/features/trip/TripScaffold';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useTicketMutations, useTickets } from '@/hooks/useTripData';
import { guessMimeType, isImageMime, isPdfMime, storedFileExists } from '@/lib/files';
import { TICKET_TYPE_LABEL } from '@/lib/labels';
import type { UploadableFile } from '@/repositories';
import { useTheme } from '@/theme';

export default function TicketsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { tripId, trip, isLoading, isError, notFound, refetch } = useTripRoute();

  const { data: tickets = [], isLoading: loadingTickets } = useTickets(tripId);
  const mutations = useTicketMutations(tripId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [viewing, setViewing] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState<Ticket | null>(null);

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
                    : 'Verifique sua conexão e tente novamente.'
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
      toast.success('Documento excluído');
      setDeleting(null);
    } catch {
      toast.error('Não foi possível excluir o documento.');
    }
  };

  return (
    <TripScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <TripHero trip={trip} />
        <TripTabs tripId={tripId} active="tickets" />

        <View style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.md }}>
          {loadingTickets ? (
            <SkeletonList count={3} lines={2} />
          ) : tickets.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={TicketIcon}
                title="Nenhum documento salvo"
                message="Guarde passagens, reservas e comprovantes aqui para acessá-los rapidamente."
                actionLabel="Adicionar ticket"
                onAction={() => setEditorOpen(true)}
              />
            </GlassCard>
          ) : (
            tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} onPress={() => setViewing(ticket)} />
            ))
          )}
        </View>
      </ScrollView>

      <FloatingActionButton
        icon={Plus}
        label="Documento"
        onPress={() => {
          setEditing(null);
          setEditorOpen(true);
        }}
      />

      <TicketEditorSheet
        visible={editorOpen}
        ticket={editing}
        mutations={mutations}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setEditorOpen(false);
          toast.success(editing ? 'Documento atualizado' : 'Documento salvo');
          setEditing(null);
        }}
      />

      <TicketViewerSheet
        ticket={viewing}
        onClose={() => setViewing(null)}
        onEdit={(ticket) => {
          setViewing(null);
          setEditing(ticket);
          setEditorOpen(true);
        }}
        onDelete={(ticket) => {
          setViewing(null);
          setDeleting(ticket);
        }}
      />

      <ConfirmDialog
        visible={Boolean(deleting)}
        title="Excluir documento?"
        message={`"${deleting?.title}" e o arquivo anexado serão removidos. Essa ação não poderá ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </TripScreenShell>
  );
}

/* ------------------------------ ticket viewer ----------------------------- */

function TicketViewerSheet({
  ticket,
  onClose,
  onEdit,
  onDelete,
}: {
  ticket: Ticket | null;
  onClose: () => void;
  onEdit: (ticket: Ticket) => void;
  onDelete: (ticket: Ticket) => void;
}) {
  const theme = useTheme();
  const toast = useToast();

  if (!ticket) return null;

  const available = ticket.fileUrl ? storedFileExists(ticket.fileUrl) : false;

  /**
   * Opens the attachment for real (§42). Images render inline; PDFs and other
   * documents open in the system viewer — rendering PDFs in-app would need a
   * native module Expo Go does not ship, so we preserve the intent with the
   * closest compatible behaviour.
   */
  const openFile = async () => {
    if (!ticket.fileUrl) return;
    try {
      if (ticket.fileUrl.startsWith('http')) {
        await WebBrowser.openBrowserAsync(ticket.fileUrl);
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(ticket.fileUrl, {
          mimeType: ticket.mimeType,
          dialogTitle: ticket.title,
        });
        return;
      }
      await Linking.openURL(ticket.fileUrl);
    } catch {
      toast.error('Não foi possível abrir o arquivo neste dispositivo.');
    }
  };

  const share = async () => {
    if (!ticket.fileUrl) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        toast.warning('Compartilhamento indisponível neste dispositivo.');
        return;
      }
      await Sharing.shareAsync(ticket.fileUrl, { mimeType: ticket.mimeType });
    } catch {
      toast.error('Não foi possível compartilhar o arquivo.');
    }
  };

  return (
    <BottomSheet
      visible={Boolean(ticket)}
      onClose={onClose}
      title={ticket.title}
      subtitle={TICKET_TYPE_LABEL[ticket.type]}
    >
      <View style={{ gap: theme.spacing.lg }}>
        {ticket.fileUrl && isImageMime(ticket.mimeType) && available ? (
          <AppImage
            uri={ticket.fileUrl}
            style={{ height: 220, width: '100%' }}
            radius={theme.radius.card}
            contentFit="contain"
            accessibilityLabel={`Anexo de ${ticket.title}`}
          />
        ) : null}

        <GlassCard elevation="flat">
          {ticket.provider ? <InfoRow label="Fornecedor" value={ticket.provider} /> : null}
          {ticket.reference ? <InfoRow label="Localizador" value={ticket.reference} /> : null}
          {ticket.origin ? <InfoRow label="Origem" value={ticket.origin} /> : null}
          {ticket.destination ? <InfoRow label="Destino" value={ticket.destination} /> : null}
          {ticket.notes ? <InfoRow label="Observações" value={ticket.notes} /> : null}
          {!ticket.provider && !ticket.reference && !ticket.origin && !ticket.notes ? (
            <AppText variant="bodySmall" color="secondary">
              Sem informações adicionais.
            </AppText>
          ) : null}
        </GlassCard>

        {ticket.fileUrl ? (
          available ? (
            <>
              <Button
                label={isPdfMime(ticket.mimeType) ? 'Abrir PDF' : 'Abrir arquivo'}
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
            </>
          ) : (
            // Never show an action that cannot work (§42).
            <InlineNotice icon={Paperclip} tone="warning">
              O arquivo anexado não está mais disponível neste dispositivo. Edite o documento para
              anexá-lo novamente.
            </InlineNotice>
          )
        ) : (
          <InlineNotice icon={Paperclip}>
            Nenhum arquivo anexado a este documento.
          </InlineNotice>
        )}

        <Button label="Editar" variant="secondary" fullWidth onPress={() => onEdit(ticket)} />
        <Button
          label="Excluir documento"
          variant="ghost"
          icon={Trash2}
          fullWidth
          onPress={() => onDelete(ticket)}
        />
      </View>
    </BottomSheet>
  );
}

/* ------------------------------ ticket editor ----------------------------- */

function TicketEditorSheet({
  visible,
  ticket,
  mutations,
  onClose,
  onSaved,
}: {
  visible: boolean;
  ticket: Ticket | null;
  mutations: ReturnType<typeof useTicketMutations>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const [file, setFile] = useState<UploadableFile | null>(null);

  const { control, handleSubmit, reset, formState } = useForm<TicketInput>({
    resolver: zodResolver(ticketSchema),
    values: {
      type: ticket?.type ?? 'voo',
      title: ticket?.title ?? '',
      provider: ticket?.provider,
      reference: ticket?.reference,
      origin: ticket?.origin,
      destination: ticket?.destination,
      notes: ticket?.notes,
    },
  });

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? guessMimeType(asset.name),
        size: asset.size ?? undefined,
      });
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
      const name = asset.fileName ?? `documento-${Date.now()}.jpg`;
      setFile({
        uri: asset.uri,
        name,
        mimeType: asset.mimeType ?? guessMimeType(name, 'image/jpeg'),
        size: asset.fileSize,
      });
    } catch {
      toast.error('Não foi possível selecionar a imagem.');
    }
  };

  const onSubmit = async (values: TicketInput) => {
    try {
      const payload = {
        type: values.type as TicketType,
        title: values.title,
        provider: values.provider,
        reference: values.reference,
        origin: values.origin,
        destination: values.destination,
        notes: values.notes,
      };

      if (ticket) {
        await mutations.update.mutateAsync({
          id: ticket.id,
          patch: payload,
          file: file ?? undefined,
        });
      } else {
        await mutations.create.mutateAsync({ input: payload, file: file ?? undefined });
      }

      reset();
      setFile(null);
      onSaved();
    } catch {
      toast.error('Não foi possível salvar o documento. Tente novamente.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={ticket ? 'Editar documento' : 'Novo documento'}
      subtitle="Passagens, reservas e comprovantes"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Controller
          control={control}
          name="type"
          render={({ field, fieldState }) => (
            <SelectField
              label="Tipo"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              options={TICKET_TYPES.map((type) => ({
                value: type,
                label: TICKET_TYPE_LABEL[type],
              }))}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="Título"
              placeholder="Ex.: Voo GRU → CDG"
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
              label="Fornecedor"
              placeholder="Companhia, hotel ou operadora"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="reference"
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

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Controller
            control={control}
            name="origin"
            render={({ field }) => (
              <View style={{ flex: 1 }}>
                <TextField label="Origem" placeholder="GRU" value={field.value} onChangeText={field.onChange} />
              </View>
            )}
          />
          <Controller
            control={control}
            name="destination"
            render={({ field }) => (
              <View style={{ flex: 1 }}>
                <TextField label="Destino" placeholder="CDG" value={field.value} onChangeText={field.onChange} />
              </View>
            )}
          />
        </View>

        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <TextField
              label="Observações"
              placeholder="Bagagem, assento, horário de check-in..."
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              multiline
            />
          )}
        />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" color="secondary">
            Anexo
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
          ) : ticket?.fileUrl ? (
            <InlineNotice icon={Paperclip} tone="success">
              Já existe um arquivo anexado. Selecione outro para substituí-lo.
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
          label={ticket ? 'Salvar alterações' : 'Salvar documento'}
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
