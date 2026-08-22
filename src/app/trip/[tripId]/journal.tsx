import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { BookOpen, Camera, MapPin, Plus, Trash2, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, View } from 'react-native';

import {
  AppImage,
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  DateField,
  EmptyState,
  FadeIn,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  IconButton,
  SkeletonList,
  TextField,
  useToast,
} from '@/components/ui';
import { journalEntrySchema, type JournalEntryInput } from '@/domain/schemas';
import type { JournalEntry } from '@/domain/types';
import { TripHero, TripScreenShell, TripTabs } from '@/features/trip/TripScaffold';
import { RoteiroModules } from '@/features/trip/RoteiroModules';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useJournal, useJournalMedia, useJournalMutations } from '@/hooks/useTripData';
import { formatWeekdayDate, todayISO } from '@/lib/date';
import { JOURNAL_POLICY, validateUpload } from '@/domain/upload';
import { guessMimeType } from '@/lib/files';
import type { UploadableFile } from '@/repositories';
import { useTheme } from '@/theme';

export default function JournalScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { tripId, trip, isLoading, isError, notFound, refetch } = useTripRoute();

  const { data: entries = [], isLoading: loadingEntries } = useJournal(tripId);
  const entryIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const { data: media = [] } = useJournalMedia(tripId, entryIds);
  const mutations = useJournalMutations(tripId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [deleting, setDeleting] = useState<JournalEntry | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const mediaByEntry = useMemo(() => {
    const map = new Map<string, typeof media>();
    for (const item of media) {
      map.set(item.journalEntryId, [...(map.get(item.journalEntryId) ?? []), item]);
    }
    return map;
  }, [media]);

  if (isLoading || isError || notFound || !trip) {
    return (
      <TripScreenShell>
        <View style={{ padding: theme.spacing.screen, paddingTop: 100 }}>
          {isLoading ? (
            <SkeletonList count={3} lines={3} />
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
      toast.success('Registro excluído');
      setDeleting(null);
    } catch {
      toast.error('Não foi possível excluir o registro.');
    }
  };

  // Um único CTA para a primeira criação: quando o empty state já oferece a
  // ação, o FAB logo abaixo seria o mesmo botão duas vezes (§20). Assim que
  // existe conteúdo, o FAB volta ao comportamento normal.
  const emptyCtaVisible = !loadingEntries && entries.length === 0;

  return (
    <TripScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <TripHero trip={trip} />
        <TripTabs tripId={tripId} active="itinerary" />
        <RoteiroModules tripId={tripId} active="journal" />

        <FadeIn style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.lg }}>
          {loadingEntries ? (
            <SkeletonList count={2} lines={4} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Nenhuma memória registrada"
              message="Escreva sobre o dia, anexe fotos e guarde o que você não quer esquecer."
              actionLabel="Criar primeira entrada"
              onAction={() => setEditorOpen(true)}
            />
          ) : (
            entries.map((entry) => {
              const photos = mediaByEntry.get(entry.id) ?? [];
              return (
                <GlassCard key={entry.id}>
                  <View style={{ gap: theme.spacing.md }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        gap: theme.spacing.sm,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <AppText variant="body" weight="semibold">
                          {formatWeekdayDate(entry.entryDate)}
                        </AppText>
                        {entry.placeName ? (
                          <View
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}
                          >
                            <MapPin size={12} color={theme.colors.textTertiary} />
                            <AppText variant="caption" color="secondary">
                              {entry.placeName}
                            </AppText>
                          </View>
                        ) : null}
                      </View>

                      <IconButton
                        icon={Trash2}
                        accessibilityLabel={`Excluir registro de ${formatWeekdayDate(entry.entryDate)}`}
                        onPress={() => setDeleting(entry)}
                        size={16}
                        color={theme.colors.textTertiary}
                        style={{ width: 32, height: 32 }}
                      />
                    </View>

                    <Pressable
                      onPress={() => {
                        setEditing(entry);
                        setEditorOpen(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Editar registro: ${entry.content.slice(0, 60)}`}
                    >
                      <AppText variant="body" color="secondary">
                        {entry.content}
                      </AppText>
                    </Pressable>

                    {photos.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: theme.spacing.sm }}
                      >
                        {photos.map((photo) => (
                          <Pressable
                            key={photo.id}
                            onPress={() => setPreview(photo.fileUrl)}
                            accessibilityRole="imagebutton"
                            accessibilityLabel="Ampliar foto"
                          >
                            <AppImage
                              uri={photo.fileUrl}
                              style={{ width: 110, height: 110 }}
                              radius={theme.radius.smallCard}
                            />
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : null}
                  </View>
                </GlassCard>
              );
            })
          )}
        </FadeIn>
      </ScrollView>

      {emptyCtaVisible ? null : (
        <FloatingActionButton
          icon={Plus}
          label="Registro"
          onPress={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        />
      )}

      <JournalEditorSheet
        visible={editorOpen}
        entry={editing}
        tripStart={trip.startDate}
        mutations={mutations}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setEditorOpen(false);
          toast.success(editing ? 'Registro atualizado' : 'Registro salvo');
          setEditing(null);
        }}
      />

      {/* Full-size photo viewer */}
      <BottomSheet visible={Boolean(preview)} onClose={() => setPreview(null)} title="Foto">
        {preview ? (
          <AppImage
            uri={preview}
            style={{ width: '100%', height: 380 }}
            contentFit="contain"
            radius={theme.radius.card}
            accessibilityLabel="Foto do diário"
          />
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={Boolean(deleting)}
        title="Excluir registro?"
        message="O texto e as fotos deste registro serão removidos. Essa ação não poderá ser desfeita."
        confirmLabel="Excluir"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </TripScreenShell>
  );
}

function JournalEditorSheet({
  visible,
  entry,
  tripStart,
  mutations,
  onClose,
  onSaved,
}: {
  visible: boolean;
  entry: JournalEntry | null;
  tripStart: string;
  mutations: ReturnType<typeof useJournalMutations>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const [files, setFiles] = useState<UploadableFile[]>([]);

  const { control, handleSubmit, reset, formState } = useForm<JournalEntryInput>({
    resolver: zodResolver(journalEntrySchema),
    values: {
      entryDate: entry?.entryDate ?? maxDate(todayISO(), tripStart),
      content: entry?.content ?? '',
      placeName: entry?.placeName,
    },
  });

  const pickPhotos = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.warning('Permita o acesso às fotos para anexar imagens.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 6,
        quality: 0.8,
      });
      if (result.canceled) return;

      const candidatos = result.assets.map((asset) => {
        const name = asset.fileName ?? `foto-${Date.now()}.jpg`;
        return {
          uri: asset.uri,
          name,
          mimeType: asset.mimeType ?? guessMimeType(name, 'image/jpeg'),
          size: asset.fileSize,
        };
      });

      // Numa seleção múltipla, uma foto recusada não pode derrubar as outras:
      // quem escolheu seis imagens e tem uma acima do limite fica com cinco e
      // uma explicação, não com um erro e nenhuma.
      const aceitos = candidatos.filter((c) => validateUpload(c, JOURNAL_POLICY).ok);
      const recusados = candidatos.length - aceitos.length;
      if (recusados > 0) {
        toast.warning(
          recusados === 1
            ? 'Uma foto foi ignorada: só JPG, PNG ou WEBP de até 10 MB.'
            : `${recusados} fotos foram ignoradas: só JPG, PNG ou WEBP de até 10 MB.`,
        );
      }
      if (aceitos.length === 0) return;
      setFiles((current) => [...current, ...aceitos]);
    } catch {
      toast.error('Não foi possível selecionar as fotos.');
    }
  };

  const onSubmit = async (values: JournalEntryInput) => {
    try {
      if (entry) {
        await mutations.update.mutateAsync({
          id: entry.id,
          patch: {
            entryDate: values.entryDate,
            content: values.content,
            placeName: values.placeName,
          },
          files,
        });
      } else {
        await mutations.create.mutateAsync({
          input: {
            entryDate: values.entryDate,
            content: values.content,
            placeName: values.placeName,
          },
          files,
        });
      }
      reset();
      setFiles([]);
      onSaved();
    } catch {
      toast.error('Não foi possível salvar o registro. Tente novamente.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={entry ? 'Editar registro' : 'Novo registro'}
      subtitle="Como foi o seu dia?"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Controller
          control={control}
          name="entryDate"
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

        <Controller
          control={control}
          name="content"
          render={({ field, fieldState }) => (
            <TextField
              label="Registro"
              placeholder="O que aconteceu, o que você sentiu, o que quer lembrar…"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              multiline
              required
            />
          )}
        />

        <Controller
          control={control}
          name="placeName"
          render={({ field, fieldState }) => (
            <TextField
              label="Local"
              placeholder="Onde você estava?"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        {files.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            {files.map((file, index) => (
              <View key={`${file.uri}-${index}`}>
                <AppImage
                  uri={file.uri}
                  style={{ width: 88, height: 88 }}
                  radius={theme.radius.smallCard}
                />
                <View style={{ position: 'absolute', top: -6, right: -6 }}>
                  <IconButton
                    icon={X}
                    accessibilityLabel={`Remover ${file.name}`}
                    onPress={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    background="surface"
                    size={14}
                    style={{ width: 28, height: 28 }}
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <Button
          label="Adicionar fotos"
          icon={Camera}
          variant="secondary"
          fullWidth
          onPress={() => void pickPhotos()}
        />

        <Button
          label={entry ? 'Salvar alterações' : 'Salvar registro'}
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

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
