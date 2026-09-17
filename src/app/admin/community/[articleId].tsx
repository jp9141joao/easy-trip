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
  GlassCard,
  InlineNotice,
  SectionHeader,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { articleFormSchema, type ArticleFormInput, type GeneratedArticle } from '@/domain/schemas';
import type { Article } from '@/domain/types';
import { useAdminArticles, useDeleteArticle, useSaveArticle } from '@/hooks/useAdminContent';
import type { PendingEditorialImage } from '@/repositories/editorialImage';
import { useAuth } from '@/providers/AuthProvider';
import { nowISO } from '@/lib/date';
import { createId } from '@/lib/id';
import { adminContentService } from '@/services/adminContent';
import { useTheme } from '@/theme';

/**
 * Cadastro de artigo da Comunidade, com preenchimento assistido (§15–§19, §25).
 *
 * O fluxo obrigatório do §19 está codificado na própria estrutura da tela: a IA
 * escreve nos campos do formulário e para por aí. Publicar continua sendo um
 * `status` que o administrador escolhe e um botão que ele toca — não existe
 * caminho no código que vá de "gerar" a "publicado" sem passar por aqui.
 */

const CATEGORY_HINT = 'Ex.: Inspiração, Destinos, Finanças, Segurança';

export default function AdminArticleFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { articleId } = useLocalSearchParams<{ articleId: string }>();
  const { session } = useAuth();

  const isNew = articleId === 'new';
  const { data: articles } = useAdminArticles();
  const existing = isNew ? undefined : articles?.find((a) => a.id === articleId);

  const save = useSaveArticle();
  const remove = useDeleteArticle();

  const [aiOpen, setAiOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * A imagem escolhida vive fora do `react-hook-form` de propósito: o que o
   * formulário guarda é a URL **já gravada**, e o que está aqui é um arquivo
   * local que ainda pode ser descartado sem consequência. Enquanto o "Salvar"
   * não for tocado, nada subiu para o bucket (§8).
   */
  const [pendingImage, setPendingImage] = useState<PendingEditorialImage>(undefined);
  /** Apenas para destacar na revisão — nada disto é persistido (§54, §59). */
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());

  const { control, handleSubmit, reset, getValues, setValue, formState } =
    useForm<ArticleFormInput>({
      resolver: zodResolver(articleFormSchema),
      defaultValues: {
        title: '',
        category: '',
        authorName: 'Equipe Easy Trip',
        content: '',
        estimatedReadMinutes: 5,
        status: 'draft',
      },
    });

  // A imagem pendente pertence ao registro que estava na tela: quando outro
  // registro chega (ou a query devolve uma versão nova), ela é descartada no
  // próprio render. Só semear o formulário — que vive no `react-hook-form`,
  // fora do estado do React — fica para o efeito.
  const [seededFrom, setSeededFrom] = useState(existing);
  if (existing && existing !== seededFrom) {
    setSeededFrom(existing);
    setPendingImage(undefined);
  }

  // O artigo chega depois da primeira renderização (vem da query), então o
  // formulário é semeado quando ele aparece — e só então.
  useEffect(() => {
    if (!existing) return;
    reset({
      title: existing.title,
      category: existing.category,
      authorName: existing.authorName,
      content: existing.content,
      estimatedReadMinutes: existing.estimatedReadMinutes,
      status: existing.status,
    });
  }, [existing, reset]);

  const applyGenerated = (generated: GeneratedArticle, mode: 'empty' | 'all') => {
    const current = getValues();
    const filled = new Set<string>();

    // `empty` completa o que falta; `all` substitui. Em nenhum dos dois o
    // administrador perde texto sem ter escolhido isso (§43).
    const put = (field: keyof ArticleFormInput, write: () => void) => {
      const isEmpty = current[field] === '' || current[field] === undefined;
      if (mode !== 'all' && !isEmpty) return;
      write();
      filled.add(field);
    };

    const options = { shouldDirty: true, shouldValidate: true } as const;
    put('title', () => setValue('title', generated.title, options));
    put('category', () => setValue('category', generated.category, options));
    put('content', () => setValue('content', generated.content, options));
    put('estimatedReadMinutes', () =>
      setValue('estimatedReadMinutes', generated.estimatedReadMinutes, options),
    );

    setAiFields(filled);
    toast.success('Campos preenchidos. Revise antes de publicar.');
  };

  const onSubmit = async (values: ArticleFormInput) => {
    // O id é gerado aqui, antes de qualquer upload: é ele que compõe o caminho
    // `content/articles/{id}/…`. Esperar o banco devolver o id obrigaria a
    // subir a imagem num caminho provisório e movê-la depois (§15).
    const article: Article = {
      id: existing?.id ?? createId(),
      slug: existing?.slug ?? slugify(values.title),
      title: values.title,
      category: values.category,
      imageUrl: existing?.imageUrl,
      authorName: values.authorName,
      content: values.content,
      publishedAt: existing?.publishedAt ?? nowISO(),
      estimatedReadMinutes: values.estimatedReadMinutes,
      status: values.status,
    };

    try {
      await save.mutateAsync({
        record: article,
        pendingImage,
        currentImageUrl: existing?.imageUrl,
      });
      toast.success(
        values.status === 'published' ? 'Artigo publicado na Comunidade.' : 'Rascunho salvo.',
      );
      router.back();
    } catch {
      // A mensagem é a mesma para falha de upload e falha de gravação porque
      // para quem está na tela o resultado é o mesmo: nada foi salvo, e tentar
      // de novo é seguro — a compensação já removeu o arquivo que subiu.
      toast.error('Não foi possível salvar o artigo. Tente novamente.');
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    try {
      await remove.mutateAsync({ id: existing.id, imageUrl: existing.imageUrl });
      toast.success('Artigo excluído.');
      router.back();
    } catch {
      toast.error('Não foi possível excluir o artigo.');
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Comunidade"
          title={isNew ? 'Novo artigo' : 'Editar artigo'}
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
          <Button
            label="✨ Preencher com IA"
            variant="secondary"
            fullWidth
            icon={Sparkles}
            onPress={() => setAiOpen(true)}
          />

          {adminContentService.kind === 'unavailable' ? (
            <InlineNotice tone="warning">
              O serviço de IA ainda não está configurado neste ambiente. O cadastro manual funciona
              normalmente.
            </InlineNotice>
          ) : null}

          <Controller
            control={control}
            name="title"
            render={({ field, fieldState }) => (
              <View>
                <TextField
                  label="Título"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  required
                />
                <AIMark visible={aiFields.has('title')} />
              </View>
            )}
          />

          <Controller
            control={control}
            name="category"
            render={({ field, fieldState }) => (
              <View>
                <TextField
                  label="Categoria"
                  placeholder={CATEGORY_HINT}
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  helper="Aparece como selo sobre a imagem do artigo."
                  required
                />
                <AIMark visible={aiFields.has('category')} />
              </View>
            )}
          />

          <Controller
            control={control}
            name="authorName"
            render={({ field, fieldState }) => (
              <TextField
                label="Autor"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                required
              />
            )}
          />

          <Controller
            control={control}
            name="content"
            render={({ field, fieldState }) => (
              <View>
                <TextField
                  label="Conteúdo"
                  placeholder="Markdown é suportado: ## para subtítulos, - para listas."
                  value={field.value}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  multiline
                  required
                />
                <AIMark visible={aiFields.has('content')} />
              </View>
            )}
          />

          <Controller
            control={control}
            name="estimatedReadMinutes"
            render={({ field, fieldState }) => (
              <View>
                <TextField
                  label="Tempo de leitura (min)"
                  value={field.value ? String(field.value) : ''}
                  onChangeText={(text) => field.onChange(Number(text.replace(/\D/g, '')) || 0)}
                  error={fieldState.error?.message}
                  keyboardType="number-pad"
                  required
                />
                <AIMark visible={aiFields.has('estimatedReadMinutes')} />
              </View>
            )}
          />

          <EditorialImageField
            label="Imagem de capa"
            value={existing?.imageUrl}
            pending={pendingImage}
            onChange={setPendingImage}
            disabled={save.isPending}
            fallbackLabel="Sem capa"
            helper="JPG, PNG ou WEBP, até 5 MB. A imagem sobe para o armazenamento do Easy Trip quando você salvar."
          />

          <View>
            <SectionHeader title="Publicação" />
            <GlassCard>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <SelectField
                    label="Situação"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      {
                        value: 'draft',
                        label: 'Rascunho',
                        description: 'Visível apenas no painel',
                      },
                      {
                        value: 'published',
                        label: 'Publicado',
                        description: 'Aparece na aba Comunidade',
                      },
                    ]}
                  />
                )}
              />
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
              label="Excluir artigo"
              variant="danger"
              icon={Trash2}
              fullWidth
              onPress={() => setConfirmDelete(true)}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <AIFillSheet<GeneratedArticle>
        visible={aiOpen}
        onClose={() => setAiOpen(false)}
        subtitle="Descreva o artigo que você quer publicar"
        placeholder="Ex.: um artigo leve sobre como viajar faz bem, falando de conhecer novas culturas, sair da rotina e criar memórias."
        generate={async (briefing) => ({
          value: await adminContentService.generateArticle({
            briefing,
            accessToken: session?.accessToken,
          }),
        })}
        summarize={(value) => [
          { label: 'Título', value: value.title },
          { label: 'Categoria', value: value.category },
          { label: 'Tempo de leitura', value: `${value.estimatedReadMinutes} min` },
          { label: 'Conteúdo', value: value.content },
          ...(value.imagePrompt
            ? [{ label: 'Sugestão de imagem', value: value.imagePrompt }]
            : []),
        ]}
        onApply={applyGenerated}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title="Excluir este artigo?"
        message="Ele sairá da Comunidade e não poderá ser recuperado."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

/** Marca discreta de revisão. Some assim que a tela é recarregada (§59). */
function AIMark({ visible }: { visible: boolean }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <AppText variant="caption" color="brand" style={{ marginTop: theme.spacing.xs }}>
      ✨ Gerado pela IA — revise
    </AppText>
  );
}

/** `Por que viajar faz bem?` → `por-que-viajar-faz-bem`. */
function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}
