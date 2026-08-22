import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditorialImageField } from '@/components/admin/EditorialImageField';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  DateField,
  GlassCard,
  InlineNotice,
  MoneyField,
  SectionHeader,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { offerFormSchema, type OfferFormInput } from '@/domain/schemas';
import type { CurrencyCode, Offer } from '@/domain/types';
import { useAdminOffers, useDeleteOffer, useSaveOffer } from '@/hooks/useAdminContent';
import { createId } from '@/lib/id';
import { normalizeExternalUrl } from '@/lib/url';
import type { PendingEditorialImage } from '@/repositories/editorialImage';
import { useTheme } from '@/theme';

/**
 * Cadastro de oferta (F9 — fecha a D-06 pelo lado da interface).
 *
 * Sem "Preencher com IA", e isso é decisão registrada, não esquecimento (§48):
 * preço, desconto e vigência são compromisso comercial. Um modelo que "sugere"
 * 15% de desconto em um pacote real produz uma promessa que ninguém assumiu.
 *
 * A imagem é obrigatória porque `offers.image_url` é `NOT NULL` desde a `0001`
 * — e porque a faixa Em Alta é feita de fotos: uma oferta sem imagem apareceria
 * como um bloco de gradiente no meio das outras.
 */
export default function AdminOfferFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { offerId } = useLocalSearchParams<{ offerId: string }>();

  const isNew = offerId === 'new';
  const { data: offers } = useAdminOffers();
  const existing = isNew ? undefined : offers?.find((o) => o.id === offerId);

  const save = useSaveOffer();
  const remove = useDeleteOffer();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingEditorialImage>(undefined);
  const [imageError, setImageError] = useState<string | undefined>();

  const { control, handleSubmit, reset, watch, formState } = useForm<OfferFormInput>({
    resolver: zodResolver(offerFormSchema),
    defaultValues: {
      destination: '',
      description: '',
      costLevel: 'moderate',
      priceCurrency: 'BRL',
      status: 'draft',
      sortOrder: 0,
      thingsToDo: [],
    },
  });

  useEffect(() => {
    if (!existing) return;
    setPendingImage(undefined);
    reset({
      destination: existing.destination,
      description: existing.description,
      price: existing.price,
      priceCurrency: existing.priceCurrency ?? 'BRL',
      discountType: existing.discountType,
      discountValue:
        existing.discountValue === undefined ? undefined : String(existing.discountValue),
      costLevel: existing.costLevel,
      weatherSummary: existing.weatherSummary ?? '',
      bestTime: existing.bestTime ?? '',
      thingsToDo: existing.thingsToDo,
      activeFrom: existing.activeFrom,
      activeUntil: existing.activeUntil,
      partnerUrl: existing.partnerUrl ?? '',
      status: existing.status,
      sortOrder: existing.sortOrder,
    });
  }, [existing, reset]);

  const currency = (watch('priceCurrency') ?? 'BRL') as CurrencyCode;
  const currentImageUrl = existing?.imageUrl;

  const onSubmit = async (values: OfferFormInput) => {
    // A coluna é NOT NULL: sem imagem nova e sem imagem gravada, a gravação
    // seria recusada pelo banco com uma mensagem que ninguém entenderia.
    const willHaveImage = Boolean(pendingImage) || (pendingImage !== null && currentImageUrl);
    if (!willHaveImage) {
      setImageError('Escolha uma imagem para a oferta.');
      return;
    }
    setImageError(undefined);

    const offer: Offer = {
      id: existing?.id ?? createId(),
      destination: values.destination,
      description: values.description,
      price: values.price,
      priceCurrency: values.priceCurrency as CurrencyCode | undefined,
      discountType: values.discountType,
      discountValue: blank(values.discountValue),
      costLevel: values.costLevel,
      imageUrl: currentImageUrl ?? '',
      weatherSummary: blank(values.weatherSummary),
      bestTime: blank(values.bestTime),
      thingsToDo: values.thingsToDo ?? [],
      activeFrom: blank(values.activeFrom),
      activeUntil: blank(values.activeUntil),
      partnerUrl: normalizeExternalUrl(values.partnerUrl) ?? undefined,
      status: values.status,
      sortOrder: values.sortOrder,
    };

    try {
      await save.mutateAsync({ record: offer, pendingImage, currentImageUrl });
      toast.success(
        values.status === 'published' ? 'Oferta publicada na Home.' : 'Rascunho salvo.',
      );
      router.back();
    } catch {
      toast.error('Não foi possível salvar a oferta. Tente novamente.');
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    try {
      await remove.mutateAsync({ id: existing.id, imageUrl: existing.imageUrl });
      toast.success('Oferta excluída.');
      router.back();
    } catch {
      toast.error('Não foi possível excluir a oferta.');
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Em Alta" title={isNew ? 'Nova oferta' : 'Editar oferta'} showBack />
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
            Preço, desconto e vigência são compromisso comercial. Este cadastro não tem
            preenchimento por IA — os valores são digitados por quem os assume.
          </InlineNotice>

          <Controller
            control={control}
            name="destination"
            render={({ field, fieldState }) => (
              <TextField
                label="Destino"
                placeholder="Ex.: Lisboa, Portugal"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                required
              />
            )}
          />

          <Controller
            control={control}
            name="description"
            render={({ field, fieldState }) => (
              <TextField
                label="Descrição"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                multiline
                required
              />
            )}
          />

          <EditorialImageField
            label="Imagem da oferta"
            value={currentImageUrl}
            pending={pendingImage}
            onChange={(next) => {
              setPendingImage(next);
              setImageError(undefined);
            }}
            disabled={save.isPending}
            error={imageError}
            fallbackLabel="Sem imagem"
            helper="Obrigatória. JPG, PNG ou WEBP, até 5 MB."
          />

          <View>
            <SectionHeader title="Preço e desconto" />
            <GlassCard>
              <View style={{ gap: theme.spacing.lg }}>
                <Controller
                  control={control}
                  name="priceCurrency"
                  render={({ field }) => (
                    <SelectField
                      label="Moeda"
                      value={field.value}
                      onChange={field.onChange}
                      options={[
                        { value: 'BRL', label: 'Real (BRL)' },
                        { value: 'USD', label: 'Dólar (USD)' },
                        { value: 'EUR', label: 'Euro (EUR)' },
                      ]}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="price"
                  render={({ field, fieldState }) => (
                    <MoneyField
                      label="Preço"
                      value={field.value}
                      onChange={field.onChange}
                      currency={currency}
                      error={fieldState.error?.message}
                      helper="Deixe em branco para a oferta aparecer sem valor."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="discountType"
                  render={({ field }) => (
                    <SelectField
                      label="Tipo de destaque"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Sem destaque"
                      options={[
                        { value: 'percentage', label: 'Percentual', description: 'Ex.: 15 → 15%' },
                        { value: 'fixed', label: 'Valor fixo', description: 'Ex.: 800' },
                        {
                          value: 'label',
                          label: 'Rótulo',
                          description: 'Ex.: Últimas vagas',
                        },
                      ]}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="discountValue"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Valor do destaque"
                      value={field.value ?? ''}
                      onChangeText={field.onChange}
                      error={fieldState.error?.message}
                      helper="Número para percentual/valor fixo, texto para rótulo."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="costLevel"
                  render={({ field }) => (
                    <SelectField
                      label="Faixa de custo"
                      value={field.value}
                      onChange={field.onChange}
                      options={[
                        { value: 'economy', label: 'Econômico' },
                        { value: 'moderate', label: 'Intermediário' },
                        { value: 'luxury', label: 'Luxo' },
                      ]}
                      required
                    />
                  )}
                />
              </View>
            </GlassCard>
          </View>

          <View>
            <SectionHeader title="Conteúdo do destino" />
            <GlassCard>
              <View style={{ gap: theme.spacing.lg }}>
                <Controller
                  control={control}
                  name="weatherSummary"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Resumo do clima"
                      placeholder="Ex.: Primavera amena, 12°C a 19°C"
                      value={field.value ?? ''}
                      onChangeText={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="bestTime"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Melhor época"
                      placeholder="Ex.: Abril a junho"
                      value={field.value ?? ''}
                      onChangeText={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="thingsToDo"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="O que fazer"
                      placeholder={'Um item por linha'}
                      value={(field.value ?? []).join('\n')}
                      onChangeText={(text) =>
                        field.onChange(
                          text
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean),
                        )
                      }
                      error={fieldState.error?.message}
                      multiline
                      helper="Um item por linha. Aparecem como lista na tela da oferta."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="partnerUrl"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Link do parceiro"
                      placeholder="https://…"
                      value={field.value ?? ''}
                      onChangeText={field.onChange}
                      error={fieldState.error?.message}
                      autoCapitalize="none"
                      keyboardType="url"
                      helper="Sem link, o botão de contato não aparece para o usuário."
                    />
                  )}
                />
              </View>
            </GlassCard>
          </View>

          <View>
            <SectionHeader title="Publicação e vigência" />
            <GlassCard>
              <View style={{ gap: theme.spacing.lg }}>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <SelectField
                      label="Situação"
                      value={field.value}
                      onChange={field.onChange}
                      options={[
                        { value: 'draft', label: 'Rascunho', description: 'Visível apenas aqui' },
                        {
                          value: 'published',
                          label: 'Publicada',
                          description: 'Aparece na Home, dentro da vigência',
                        },
                      ]}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="activeFrom"
                  render={({ field, fieldState }) => (
                    <DateRow
                      label="Início da vigência"
                      value={field.value}
                      onChange={field.onChange}
                      error={fieldState.error?.message}
                      helper="Em branco: vale desde já."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="activeUntil"
                  render={({ field, fieldState }) => (
                    <DateRow
                      label="Fim da vigência"
                      value={field.value}
                      onChange={field.onChange}
                      error={fieldState.error?.message}
                      helper="Em branco: sem data de término."
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="sortOrder"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Ordem na Home"
                      value={String(field.value ?? 0)}
                      onChangeText={(text) => field.onChange(Number(text.replace(/\D/g, '')) || 0)}
                      error={fieldState.error?.message}
                      keyboardType="number-pad"
                      helper="Menor aparece primeiro."
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
              label="Excluir oferta"
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
        title="Excluir esta oferta?"
        message="Ela sairá da Home e não poderá ser recuperada."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

/**
 * Data com botão de limpar.
 *
 * `DateField` sozinho não tem como voltar ao vazio, e "sem data" é um valor
 * legítimo aqui: é ele que significa "sem limite deste lado da vigência".
 */
function DateRow({
  label,
  value,
  onChange,
  error,
  helper,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  error?: string;
  helper?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <DateField
        label={label}
        value={value}
        onChange={onChange}
        error={error}
        helper={helper}
        placeholder="Sem data"
      />
      {value ? (
        <Button
          label="Limpar data"
          variant="ghost"
          size="sm"
          icon={X}
          onPress={() => onChange(undefined)}
        />
      ) : null}
    </View>
  );
}

function blank(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
