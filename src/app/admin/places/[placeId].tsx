import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Sparkles, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIFillSheet } from '@/components/admin/AIFillSheet';
import { EditorialImageField } from '@/components/admin/EditorialImageField';
import {
  AppHeader,
  AppText,
  Button,
  ConfirmDialog,
  InlineNotice,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { groundPlaceDraft } from '@/domain/aiGrounding';
import { placeFormSchema, type GeneratedPlaceDraft, type PlaceFormInput } from '@/domain/schemas';
import type { Place } from '@/domain/types';
import { useAdminPlaces, useDeletePlace, useSavePlace } from '@/hooks/useAdminContent';
import type { PendingEditorialImage } from '@/repositories/editorialImage';
import { createId } from '@/lib/id';
import { normalizeExternalUrl } from '@/lib/url';
import { useAuth } from '@/providers/AuthProvider';
import { adminContentService } from '@/services/adminContent';
import { useTheme } from '@/theme';

/**
 * Cadastro manual de restaurante/hotel, com preenchimento assistido (§20–§24, §51).
 *
 * A decisão anterior continua valendo: os locais são cadastrados à mão, sem API
 * externa. A IA acelera a parte editorial e nada mais — nota, preço, horários e
 * coordenadas continuam sendo campos que só o administrador preenche, e nem
 * chegam a existir na saída do modelo.
 */
export default function AdminPlaceFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { placeId } = useLocalSearchParams<{ placeId: string }>();
  const { session } = useAuth();

  const isNew = placeId === 'new';
  const { data: places } = useAdminPlaces();
  const existing = isNew ? undefined : places?.find((p) => p.id === placeId);

  const save = useSavePlace();
  const remove = useDeletePlace();

  const [aiOpen, setAiOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  /** Arquivo escolhido e ainda não enviado — sobe só no "Salvar" (§8). */
  const [pendingImage, setPendingImage] = useState<PendingEditorialImage>(undefined);

  const { control, handleSubmit, reset, getValues, setValue, watch, formState } =
    useForm<PlaceFormInput>({
      resolver: zodResolver(placeFormSchema),
      defaultValues: {
        name: '',
        type: 'restaurant',
        city: '',
        country: '',
        description: '',
        address: '',
        phone: '',
        partnerUrl: '',
      },
    });

  useEffect(() => {
    if (!existing) return;
    setPendingImage(undefined);
    reset({
      name: existing.name,
      type: existing.type,
      city: existing.city,
      country: existing.country,
      description: existing.description ?? '',
      address: existing.address ?? '',
      phone: existing.phone ?? '',
      partnerUrl: existing.partnerUrl ?? '',
      rating: existing.rating,
      priceLevel: existing.priceLevel,
      amenities: existing.amenities,
    });
  }, [existing, reset]);

  const type = watch('type');

  const applyGenerated = (generated: GeneratedPlaceDraft, mode: 'empty' | 'all') => {
    const current = getValues();
    const filled = new Set<string>();
    const options = { shouldDirty: true, shouldValidate: true } as const;

    const put = (field: keyof PlaceFormInput, write: () => void) => {
      const value = current[field];
      const isEmpty = value === '' || value === undefined || value === null;
      if (mode !== 'all' && !isEmpty) return;
      write();
      filled.add(field);
    };

    if (generated.name) put('name', () => setValue('name', generated.name!, options));
    if (generated.city) put('city', () => setValue('city', generated.city!, options));
    if (generated.country) put('country', () => setValue('country', generated.country!, options));
    if (generated.description) {
      put('description', () => setValue('description', generated.description!, options));
    }
    if (generated.address) put('address', () => setValue('address', generated.address!, options));
    if (generated.phone) put('phone', () => setValue('phone', generated.phone!, options));
    if (generated.partnerUrl) {
      put('partnerUrl', () => setValue('partnerUrl', generated.partnerUrl!, options));
    }
    if (generated.amenities?.length) {
      put('amenities', () => setValue('amenities', generated.amenities!, options));
    }

    setAiFields(filled);
    toast.success('Campos preenchidos. Revise antes de salvar.');
  };

  const onSubmit = async (values: PlaceFormInput) => {
    const place: Place = {
      ...existing,
      id: existing?.id ?? createId(),
      name: values.name,
      type: values.type,
      city: values.city,
      country: values.country,
      description: blank(values.description),
      address: blank(values.address),
      phone: blank(values.phone),
      imageUrl: existing?.imageUrl,
      // Normaliza na gravação: o que fica no banco já é o que será aberto, e a
      // tela de detalhes não precisa repetir a decisão (§11).
      partnerUrl: normalizeExternalUrl(values.partnerUrl) ?? undefined,
      rating: values.rating,
      priceLevel: values.priceLevel,
      amenities: values.amenities?.length ? values.amenities : undefined,
    };

    try {
      await save.mutateAsync({
        record: place,
        pendingImage,
        currentImageUrl: existing?.imageUrl,
      });
      toast.success('Local salvo.');
      router.back();
    } catch {
      toast.error('Não foi possível salvar o local. Tente novamente.');
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    try {
      await remove.mutateAsync({ id: existing.id, imageUrl: existing.imageUrl });
      toast.success('Local excluído.');
      router.back();
    } catch {
      toast.error('Não foi possível excluir o local.');
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Restaurantes e Hotéis" title={isNew ? 'Novo local' : 'Editar local'} showBack />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: insets.bottom + theme.spacing['3xl'],
            gap: theme.spacing.lg,
          }}
        >
          {/* Atração não tem preenchimento assistido: o prompt e o schema do
              modelo cobrem hotel e restaurante, e forçar uma terceira categoria
              neles produziria texto genérico. */}
          {type === 'attraction' ? null : (
            <Button
              label="✨ Preencher com IA"
              variant="secondary"
              icon={Sparkles}
              fullWidth
              onPress={() => setAiOpen(true)}
            />
          )}

          {adminContentService.kind === 'unavailable' ? (
            <InlineNotice tone="warning">
              O serviço de IA ainda não está configurado neste ambiente. O cadastro manual funciona
              normalmente.
            </InlineNotice>
          ) : null}

          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <SelectField
                label="Tipo"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'restaurant', label: 'Restaurante' },
                  { value: 'hotel', label: 'Hotel' },
                  { value: 'attraction', label: 'Atração' },
                ]}
                required
              />
            )}
          />

          <Field control={control} name="name" label="Nome" required aiFields={aiFields} />
          <Field control={control} name="city" label="Cidade" required aiFields={aiFields} />
          <Field control={control} name="country" label="País" required aiFields={aiFields} />
          <Field
            control={control}
            name="description"
            label="Descrição"
            multiline
            aiFields={aiFields}
          />
          <Field control={control} name="address" label="Endereço" aiFields={aiFields} />
          <Field
            control={control}
            name="phone"
            label="Telefone"
            keyboardType="phone-pad"
            aiFields={aiFields}
          />

          <Controller
            control={control}
            name="partnerUrl"
            render={({ field, fieldState }) => (
              <View>
                <TextField
                  label="Link externo / Site"
                  placeholder="https://…"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  autoCapitalize="none"
                  keyboardType="url"
                  helper="Site oficial, Google Maps ou página de reserva. Sem link, o botão não aparece para o usuário."
                />
                <AIMark visible={aiFields.has('partnerUrl')} />
              </View>
            )}
          />

          <EditorialImageField
            label="Foto do local"
            value={existing?.imageUrl}
            pending={pendingImage}
            onChange={setPendingImage}
            disabled={save.isPending}
            fallbackLabel="Sem foto"
            helper="JPG, PNG ou WEBP, até 5 MB. A foto sobe para o armazenamento do Easy Trip quando você salvar."
          />

          {/*
            §39/§40: um estabelecimento real não recebe foto gerada por IA. Uma
            imagem sintética de um hotel que existe seria apresentada ao usuário
            como se fosse o lugar — e não é.
          */}
          <InlineNotice>
            Use sempre uma foto real do estabelecimento, fornecida pelo próprio local ou por fonte
            autorizada. O Easy Trip não gera imagens de lugares reais.
          </InlineNotice>

          <Button
            label="Salvar"
            size="lg"
            fullWidth
            loading={formState.isSubmitting || save.isPending}
            onPress={handleSubmit(onSubmit)}
          />

          {existing ? (
            <Button
              label="Excluir local"
              variant="danger"
              icon={Trash2}
              fullWidth
              onPress={() => setConfirmDelete(true)}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <AIFillSheet<GeneratedPlaceDraft>
        visible={aiOpen}
        onClose={() => setAiOpen(false)}
        subtitle="Descreva o local. Endereço, telefone e site só entram se você informar."
        placeholder="Ex.: Hotel Lumière Rivoli, em Paris, França. Hotel boutique próximo ao Louvre. Endereço: 12 Rue de Rivoli. Site: https://exemplo.com"
        generate={async (briefing) => {
          const draft = await adminContentService.generatePlace({
            briefing,
            type: type === 'hotel' ? 'hotel' : 'restaurant',
            accessToken: session?.accessToken,
          });
          // A verificação roda no cliente, depois do modelo: mesmo que o prompt
          // seja ignorado, o dado sem procedência não chega ao formulário (§22).
          const grounded = groundPlaceDraft(draft, briefing);
          return { value: grounded.draft, dropped: grounded.dropped };
        }}
        summarize={(value) => [
          ...(value.name ? [{ label: 'Nome', value: value.name }] : []),
          ...(value.description ? [{ label: 'Descrição', value: value.description }] : []),
          ...(value.city ? [{ label: 'Cidade', value: value.city }] : []),
          ...(value.address ? [{ label: 'Endereço', value: value.address }] : []),
          ...(value.amenities?.length
            ? [{ label: 'Comodidades', value: value.amenities.join(', ') }]
            : []),
          ...(value.imageSearchQuery
            ? [{ label: 'Busque uma foto real por', value: value.imageSearchQuery }]
            : []),
        ]}
        onApply={applyGenerated}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title="Excluir este local?"
        message="Ele sairá do diretório e não poderá ser recuperado."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

type TextFieldName = 'name' | 'city' | 'country' | 'description' | 'address' | 'phone';

function Field({
  control,
  name,
  label,
  required,
  multiline,
  keyboardType,
  aiFields,
}: {
  control: ReturnType<typeof useForm<PlaceFormInput>>['control'];
  name: TextFieldName;
  label: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: 'phone-pad' | 'url';
  aiFields: Set<string>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View>
          <TextField
            label={label}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            required={required}
            multiline={multiline}
            keyboardType={keyboardType}
          />
          <AIMark visible={aiFields.has(name)} />
        </View>
      )}
    />
  );
}

function AIMark({ visible }: { visible: boolean }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <AppText variant="caption" color="brand" style={{ marginTop: theme.spacing.xs }}>
      ✨ Gerado pela IA — revise
    </AppText>
  );
}

/** Campo vazio vira `undefined`, para não gravar string vazia no banco. */
function blank(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
