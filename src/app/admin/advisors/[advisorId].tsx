import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditorialImageField } from '@/components/admin/EditorialImageField';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  GlassCard,
  InlineNotice,
  SectionHeader,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { advisorFormSchema, type AdvisorFormInput } from '@/domain/schemas';
import type { Advisor } from '@/domain/types';
import { useAdminAdvisors, useDeleteAdvisor, useSaveAdvisor } from '@/hooks/useAdminContent';
import { createId } from '@/lib/id';
import type { PendingEditorialImage } from '@/repositories/editorialImage';
import { useTheme } from '@/theme';

/**
 * Cadastro de especialista (F9 — fecha a D-06 pelo lado da interface).
 *
 * Sem preenchimento por IA, por decisão registrada (§49): são pessoas reais, e
 * bio, especialidade e nota não se pedem a um modelo.
 *
 * A foto vai para o bucket `content`, com o prefixo `advisors/`, e **não** para
 * `avatars`. Não é preciosismo: `avatars` é privado e a policy prende o
 * caminho a `auth.uid()` — um especialista não tem conta no aplicativo, então
 * não haveria uid nenhum para pôr no caminho, e a foto precisa aparecer na
 * Assessoria para todo mundo.
 */
export default function AdminAdvisorFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { advisorId } = useLocalSearchParams<{ advisorId: string }>();

  const isNew = advisorId === 'new';
  const { data: advisors } = useAdminAdvisors();
  const existing = isNew ? undefined : advisors?.find((a) => a.id === advisorId);

  const save = useSaveAdvisor();
  const remove = useDeleteAdvisor();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingEditorialImage>(undefined);

  const { control, handleSubmit, reset, formState } = useForm<AdvisorFormInput>({
    resolver: zodResolver(advisorFormSchema),
    defaultValues: {
      name: '',
      specialty: '',
      bio: '',
      status: 'offline',
      active: true,
    },
  });

  useEffect(() => {
    if (!existing) return;
    setPendingImage(undefined);
    reset({
      name: existing.name,
      specialty: existing.specialty,
      bio: existing.bio ?? '',
      rating: existing.rating,
      status: existing.status,
      active: existing.active,
    });
  }, [existing, reset]);

  const currentImageUrl = existing?.avatarUrl;

  const onSubmit = async (values: AdvisorFormInput) => {
    const advisor: Advisor = {
      id: existing?.id ?? createId(),
      name: values.name,
      specialty: values.specialty,
      avatarUrl: currentImageUrl,
      rating: values.rating,
      status: values.status,
      bio: values.bio?.trim() ? values.bio.trim() : undefined,
      active: values.active,
    };

    try {
      await save.mutateAsync({ record: advisor, pendingImage, currentImageUrl });
      toast.success(values.active ? 'Especialista salvo.' : 'Especialista salvo como inativo.');
      router.back();
    } catch {
      toast.error('Não foi possível salvar o especialista. Tente novamente.');
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    try {
      await remove.mutateAsync({ id: existing.id, imageUrl: existing.avatarUrl });
      toast.success('Especialista excluído.');
      router.back();
    } catch {
      toast.error('Não foi possível excluir o especialista.');
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Especialistas"
          title={isNew ? 'Novo especialista' : 'Editar especialista'}
          showBack
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: insets.bottom + theme.spacing['3xl'],
            gap: theme.spacing.lg,
          }}
        >
          <InlineNotice>
            Especialistas são pessoas reais. Use foto e biografia fornecidas pela própria pessoa —
            este cadastro não tem preenchimento por IA.
          </InlineNotice>

          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <TextField
                label="Nome"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                required
              />
            )}
          />

          <Controller
            control={control}
            name="specialty"
            render={({ field, fieldState }) => (
              <TextField
                label="Especialidade"
                placeholder="Ex.: Europa, Gastronomia, Lua de mel"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                required
              />
            )}
          />

          <Controller
            control={control}
            name="bio"
            render={({ field, fieldState }) => (
              <TextField
                label="Biografia"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                multiline
                helper="Aparece no cartão do especialista na Assessoria."
              />
            )}
          />

          <EditorialImageField
            label="Foto do especialista"
            value={currentImageUrl}
            pending={pendingImage}
            onChange={setPendingImage}
            disabled={save.isPending}
            fallbackLabel="Sem foto"
            helper="JPG, PNG ou WEBP, até 5 MB. Fica no armazenamento do Easy Trip, não no bucket de fotos de conta."
          />

          <View>
            <SectionHeader title="Disponibilidade" />
            <GlassCard>
              <View style={{ gap: theme.spacing.lg }}>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <SelectField
                      label="Presença"
                      value={field.value}
                      onChange={field.onChange}
                      options={[
                        { value: 'online', label: 'Disponível', description: 'Pode atender agora' },
                        { value: 'busy', label: 'Ocupado', description: 'Em atendimento' },
                        { value: 'offline', label: 'Offline', description: 'Fora do expediente' },
                      ]}
                      helper="Muda várias vezes por dia. Não tira ninguém do diretório."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="active"
                  render={({ field }) => (
                    <SelectField
                      label="Cadastro"
                      value={field.value ? 'active' : 'inactive'}
                      onChange={(value) => field.onChange(value === 'active')}
                      options={[
                        {
                          value: 'active',
                          label: 'No time',
                          description: 'Aparece na Assessoria',
                        },
                        {
                          value: 'inactive',
                          label: 'Inativo',
                          description: 'Sai do diretório; consultas antigas ficam de pé',
                        },
                      ]}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="rating"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Nota (0 a 5)"
                      value={field.value === undefined ? '' : String(field.value)}
                      onChangeText={(text) => {
                        const clean = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                        field.onChange(clean === '' ? undefined : Number(clean));
                      }}
                      error={fieldState.error?.message}
                      keyboardType="decimal-pad"
                      helper="Em branco quando ainda não houver avaliação."
                    />
                  )}
                />
              </View>
            </GlassCard>
          </View>

          <Button
            label="Salvar"
            size="lg"
            fullWidth
            loading={formState.isSubmitting || save.isPending}
            onPress={handleSubmit(onSubmit)}
          />

          {existing ? (
            <Button
              label="Excluir especialista"
              variant="danger"
              icon={Trash2}
              fullWidth
              onPress={() => setConfirmDelete(true)}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Excluir este especialista?"
        message="O cadastro sai do diretório. As consultas já registradas continuam onde estão. Para apenas tirá-lo do ar, use “Inativo” em vez de excluir."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}
