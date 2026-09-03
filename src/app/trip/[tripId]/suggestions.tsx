import { useRouter } from 'expo-router';
import { Clock3, MapPin, Plus, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { VisibilityField } from '@/components/collaboration';
import {
  AdaptiveButtonRow,
  AppText,
  Badge,
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  FadeIn,
  ErrorState,
  GlassCard,
  InlineNotice,
  SkeletonList,
  TextField,
  DateField,
  TimeField,
  useToast,
} from '@/components/ui';
import {
  MINIMUM_SUGGESTIONS,
  SUGGESTION_CATEGORY_EMOJI,
  SUGGESTION_CATEGORY_LABEL,
  SuggestionGenerationError,
  formatDuration,
  formatSuggestionDiagnostics,
  suggestionRefreshWindow,
  suggestionScreenState,
  type SuggestionCategory,
  type SuggestionScreenState,
  type TripSuggestion,
} from '@/domain/suggestions';
import { DEFAULT_VISIBILITY, type Visibility } from '@/domain/visibility';
import { TripHero, TripScreenShell } from '@/features/trip/TripScaffold';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useTripPermissions } from '@/hooks/useCollaboration';
import {
  useRefreshSuggestions,
  useSuggestionDuplicate,
  useSuggestions,
  useSuggestionsByCategory,
} from '@/hooks/useSuggestions';
import { useItinerary, useItineraryMutations } from '@/hooks/useTripData';
import { useTripRealtime } from '@/hooks/useTripRealtime';
import { todayISO } from '@/lib/date';
import { dataSource } from '@/repositories';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { useTheme } from '@/theme';

/**
 * Sugestões da viagem (§39–§48).
 *
 * A tela nunca gera nada ao abrir por conta própria: `useSuggestions` chama
 * `ensure`, que completa a lista só quando ela está abaixo do mínimo. Abrir a
 * tela dez vezes não custa dez gerações (§43).
 *
 * Sugestões são da VIAGEM, não da pessoa (§48): todos os membros veem a mesma
 * lista. Quem pode editar adiciona ao roteiro e atualiza; `viewer` só olha.
 */
export default function SuggestionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();

  const { tripId, trip, isLoading, isError, notFound, errorMessage, refetch } = useTripRoute();
  useTripRealtime(tripId);

  const permissions = useTripPermissions(tripId);
  const suggestionsQuery = useSuggestions(tripId, {
    resolved: permissions.isResolved,
    canEdit: permissions.canEdit,
  });
  const refresh = useRefreshSuggestions(tripId);
  const findDuplicate = useSuggestionDuplicate(tripId);

  const [category, setCategory] = useState<SuggestionCategory | null>(null);
  const [adding, setAdding] = useState<TripSuggestion | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<TripSuggestion | null>(null);
  const [detail, setDetail] = useState<TripSuggestion | null>(null);

  const suggestions = useMemo(
    () =>
      suggestionsQuery.data ??
      (suggestionsQuery.error instanceof SuggestionGenerationError
        ? suggestionsQuery.error.partialSuggestions
        : []),
    [suggestionsQuery.data, suggestionsQuery.error],
  );
  const grouped = useSuggestionsByCategory(suggestions);
  const generationError = refresh.error ?? suggestionsQuery.error;
  /*
   * A incompatibilidade de backend continua tendo a palavra final.
   *
   * `describeBackendCapability` sabe dizer "este servidor não tem a 0012", que
   * é mais específico do que qualquer código de geração — e repetir agora não
   * resolve, então não há botão.
   */
  const failureState = backendState(suggestionsQuery.error) ?? suggestionScreenState(suggestionsQuery.error);
  const noticeState: SuggestionScreenState =
    backendState(generationError) ?? suggestionScreenState(generationError);

  const visible = category ? (grouped.get(category) ?? []) : suggestions;

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

  /*
   * O botão explica QUAL espera, e não apenas que há uma (0017).
   *
   * "Atualizado recentemente" só é verdade quando a última geração entregou
   * alguma coisa. Depois de uma tentativa que falhou, a mesma frase diria à
   * pessoa que ela recebeu algo que nunca chegou — e ainda a faria supor seis
   * horas de espera onde há minutos.
   */
  const janela = suggestionRefreshWindow(trip);
  const refreshAllowed = janela.open;
  const refreshLabel = refreshAllowed
    ? 'Atualizar sugestões'
    : janela.blockedBy === 'window'
      ? 'Atualizado recentemente'
      : janela.blockedBy === 'in_progress'
        ? 'Gerando agora…'
        : 'Tente de novo em alguns minutos';

  const openAdd = (suggestion: TripSuggestion) => {
    const duplicate = findDuplicate(suggestion);
    // Duplicar de propósito é legítimo — dois dias no mesmo museu acontece.
    // Duplicar sem perceber não é. Por isso avisa e oferece seguir (§46).
    if (duplicate) {
      setDuplicateWarning(suggestion);
      return;
    }
    setAdding(suggestion);
  };

  return (
    <TripScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/*
          Sem `TripTabs`: Sugestões deixou de ser seção de primeiro nível e
          passou a ser um degrau abaixo da Jornada (§15, §16). Desenhar a barra
          primária aqui obrigaria a marcar uma das três como ativa — e nenhuma
          está. O caminho de volta é o da própria sub-tela: a seta do hero, que
          devolve a pessoa à Jornada de onde ela veio (§17).
        */}
        <TripHero trip={trip} />

        <FadeIn style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.lg }}>
          <View style={{ gap: 4 }}>
            <AppText variant="h3" weight="bold">
              {`Sugestões para ${trip.destinationCity}`}
            </AppText>
            <AppText variant="bodySmall" color="secondary">
              Lugares e experiências para completar o roteiro. Toque para adicionar ao seu dia.
            </AppText>
          </View>

          {grouped.size > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <CategoryChip
                label="Tudo"
                emoji="🧭"
                selected={category === null}
                onPress={() => setCategory(null)}
              />
              {[...grouped.keys()].map((key) => (
                <CategoryChip
                  key={key}
                  label={SUGGESTION_CATEGORY_LABEL[key]}
                  emoji={SUGGESTION_CATEGORY_EMOJI[key]}
                  selected={category === key}
                  onPress={() => setCategory(category === key ? null : key)}
                />
              ))}
            </View>
          ) : null}

          {permissions.isLoading ? (
            <SkeletonList count={3} lines={3} />
          ) : permissions.isError ? (
            /*
             * Não dá para saber o que oferecer sem saber o papel — e "não sei"
             * não é "somente leitura". Antes esta tela devolvia `null` aqui e
             * na linha abaixo: a pessoa via o cabeçalho, nada embaixo, e
             * nenhuma explicação (§25 do handoff).
             */
            <GlassCard>
              <ErrorState
                title={
                  describeBackendCapability(permissions.error)
                    ? 'Recurso indisponível neste servidor'
                    : 'Não foi possível confirmar seu acesso'
                }
                message={
                  describeBackendCapability(permissions.error) ??
                  'Não conseguimos verificar o seu papel nesta viagem. Verifique sua conexão e tente novamente.'
                }
                onRetry={() => void permissions.refetch()}
              />
            </GlassCard>
          ) : permissions.status === 'unavailable' ? (
            // A lista de viajantes chegou e a sessão não está nela. Pode ser
            // remoção, saída, ou um convite ainda não aceito — em nenhum dos
            // casos há sugestões a mostrar, e insistir com "tentar de novo"
            // prometeria algo que o servidor vai recusar.
            <GlassCard>
              <EmptyState
                icon={TriangleAlert}
                title="Você não participa desta viagem"
                message="Seu acesso a esta viagem não está mais ativo. Peça um novo convite a quem organiza."
              />
            </GlassCard>
          ) : suggestionsQuery.isLoading ? (
            <SkeletonList count={3} lines={3} />
          ) : suggestionsQuery.isError && suggestions.length === 0 ? (
            /*
             * Oito situações, oito textos (§15 do handoff).
             *
             * Antes tudo isto era "Sugestões indisponíveis" com um "Tentar
             * novamente" ao lado — inclusive a janela de seis horas, que não é
             * falha, e a falta de permissão, que repetir nunca resolve. Um
             * botão que não pode funcionar ensina que o aplicativo quebrou.
             * Agora o código da falha escolhe título, tom e se há retentativa.
             */
            <GlassCard>
              {/*
                NEM TODA LISTA VAZIA É UMA FALHA — E ERA ASSIM QUE MOSCOVO
                APARECIA.

                `ErrorState` era usado para os sete estados, tom nenhum
                incluído. A janela de seis horas caía nele: um cartão de erro,
                sem botão (porque `retryable` é falso), dizendo "Atualizado
                recentemente" numa viagem que não tinha nenhuma sugestão. Lido
                da tela, aquilo é um aplicativo quebrado — quando o que houve
                foi o sistema respeitando o próprio limite de custo.

                O tom já era calculado e já dizia a diferença; só não estava
                sendo usado. `info` é informação, e informação se apresenta como
                estado vazio: mesmo ícone e mesma voz do "Ainda sem sugestões"
                logo abaixo. `warning` e `error` continuam sendo falha, com o
                botão quando repetir tem como funcionar.
              */}
              {failureState.tone === 'info' ? (
                <EmptyState
                  icon={failureState.kind === 'refresh_limited' ? RefreshCw : Sparkles}
                  title={failureState.title}
                  message={failureState.message}
                />
              ) : (
                <ErrorState
                  title={failureState.title}
                  message={failureState.message}
                  onRetry={
                    failureState.retryable ? () => void suggestionsQuery.refetch() : undefined
                  }
                />
              )}
              <DiagnosticsLine error={suggestionsQuery.error} />
            </GlassCard>
          ) : suggestions.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={Sparkles}
                title="Ainda sem sugestões"
                message={
                  dataSource.kind === 'local'
                    ? 'O modo demonstração sugere lugares do catálogo embarcado. Este destino ainda não está nele.'
                    : permissions.role === 'viewer'
                      ? 'Ainda não há sugestões compartilhadas nesta viagem.'
                      : 'O catálogo ainda não tem sugestões para este destino.'
                }
                actionLabel={permissions.canEdit ? 'Tentar de novo' : undefined}
                onAction={permissions.canEdit ? () => refresh.mutate() : undefined}
              />
            </GlassCard>
          ) : (
            visible.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                canAdd={permissions.canEdit}
                onDetails={() => setDetail(suggestion)}
                onAdd={() => openAdd(suggestion)}
              />
            ))
          )}

          {generationError && suggestions.length > 0 ? (
            /*
             * Já existe sugestão persistida: ela FICA na tela, e a falha vira
             * um aviso ao lado — nunca uma tela vazia por cima de conteúdo bom
             * (§15 do handoff).
             *
             * "Atualizado recentemente" não é falha: é a janela de seis horas
             * fazendo o que foi desenhada para fazer. Pintá-la de vermelho
             * ensinaria a pessoa a ignorar o aviso vermelho de verdade.
             */
            <View style={{ gap: theme.spacing.xs }}>
              <InlineNotice
                tone={noticeState.tone}
                icon={noticeState.tone === 'info' ? RefreshCw : TriangleAlert}
              >
                {noticeState.message}
                {noticeState.tone === 'info'
                  ? ''
                  : ' As sugestões já carregadas continuam disponíveis.'}
              </InlineNotice>
              <DiagnosticsLine error={generationError} />
            </View>
          ) : null}

          {!generationError && suggestions.length > 0 && suggestions.length < MINIMUM_SUGGESTIONS ? (
            <InlineNotice tone="warning" icon={Sparkles}>
              {`Encontramos ${suggestions.length} ${suggestions.length === 1 ? 'sugestão' : 'sugestões'} para este destino. Ainda estamos construindo o catálogo dele.`}
            </InlineNotice>
          ) : null}

          {permissions.canEdit && suggestions.length > 0 ? (
            <>
              <Button
                label={refreshLabel}
                icon={RefreshCw}
                variant="secondary"
                fullWidth
                disabled={!refreshAllowed}
                loading={refresh.isPending}
                onPress={() => refresh.mutate()}
              />
              {!refreshAllowed && !generationError ? (
                // Botão desabilitado sem motivo escrito vira "está quebrado".
                <AppText variant="caption" color="secondary">
                  {janela.blockedBy === 'window'
                    ? 'Gerar sugestões tem custo, então a atualização acontece no máximo uma vez a cada 6 horas por viagem.'
                    : janela.blockedBy === 'in_progress'
                      ? 'Alguém desta viagem está gerando sugestões agora. Isso leva menos de um minuto.'
                      : 'A última tentativa não trouxe nenhuma sugestão. Você poderá tentar de novo em alguns minutos.'}
                </AppText>
              ) : null}
            </>
          ) : null}

          {permissions.role === 'viewer' ? (
            <InlineNotice>
              Você tem acesso somente de visualização nesta viagem. As sugestões aparecem aqui, mas
              adicionar ao roteiro é de quem pode editar.
            </InlineNotice>
          ) : null}
        </FadeIn>
      </ScrollView>

      <SuggestionDetailSheet
        suggestion={detail}
        onClose={() => setDetail(null)}
        onAdd={(suggestion) => {
          setDetail(null);
          openAdd(suggestion);
        }}
        canAdd={permissions.canEdit}
      />

      <AddToItinerarySheet
        suggestion={adding}
        tripId={tripId}
        tripStart={trip.startDate}
        tripEnd={trip.endDate}
        isShared={permissions.isShared}
        onClose={() => setAdding(null)}
        onAdded={() => {
          setAdding(null);
          toast.success('Adicionado ao roteiro');
        }}
      />

      <ConfirmDialog
        visible={Boolean(duplicateWarning)}
        title="Já existe algo parecido"
        message="Encontramos um item parecido no seu roteiro. Quer adicionar mesmo assim?"
        confirmLabel="Adicionar mesmo assim"
        cancelLabel="Cancelar"
        onConfirm={() => {
          const target = duplicateWarning;
          setDuplicateWarning(null);
          setAdding(target);
        }}
        onCancel={() => setDuplicateWarning(null)}
      />
    </TripScreenShell>
  );
}

/**
 * O status real da tentativa, visível SÓ em desenvolvimento (§12 do handoff).
 *
 * No Android físico não havia como saber se "Sugestões indisponíveis" era 401,
 * 403, 422, 429, rede ou catálogo vazio — e corrigir por hipótese, nesse
 * estado, é chutar. Esta linha responde isso no próprio aparelho.
 *
 * O que ela mostra é só o que `SuggestionAttemptDiagnostics` permite existir:
 * códigos fechados e contagens. Não há JWT, não há `service_role`, não há
 * chave do Gemini e não há corpo de resposta — nem em desenvolvimento, porque
 * o dado sanitizado é construído na origem, e não filtrado aqui.
 */
function backendState(error: unknown): SuggestionScreenState | null {
  const capability = describeBackendCapability(error);
  return capability
    ? {
        kind: 'unavailable',
        title: 'Recurso indisponível neste servidor',
        message: capability,
        tone: 'warning',
        retryable: false,
      }
    : null;
}

function DiagnosticsLine({ error }: { error: unknown }) {
  const theme = useTheme();
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;

  const detalhe = formatSuggestionDiagnostics(error);
  if (!detalhe) return null;

  return (
    <AppText
      variant="caption"
      color="tertiary"
      mono
      style={{ marginTop: theme.spacing.sm }}
      accessibilityLabel={`Diagnóstico de desenvolvimento: ${detalhe}`}
    >
      {`DEV · ${detalhe}`}
    </AppText>
  );
}

/* --------------------------------- pedaços -------------------------------- */

function CategoryChip({
  label,
  emoji,
  selected,
  onPress,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
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
      <AppText variant="caption">{emoji}</AppText>
      <AppText variant="caption" color={selected ? 'brand' : 'secondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * O card de uma sugestão (§44).
 *
 * A etiqueta "✨ Sugestão da IA" vem do campo `source`, não de heurística sobre
 * o texto. É a diferença entre "isto saiu do nosso catálogo de lugares, com
 * endereço e coordenada verificados" e "isto foi escrito por um modelo" — e a
 * pessoa tem o direito de saber qual das duas está lendo (§41).
 */
function SuggestionCard({
  suggestion,
  canAdd,
  onDetails,
  onAdd,
}: {
  suggestion: TripSuggestion;
  canAdd: boolean;
  onDetails: () => void;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const duration = formatDuration(suggestion.estimatedDurationMinutes);

  return (
    <GlassCard testID="suggestion-card" style={{ gap: theme.spacing.lg }}>
      {/*
        CINCO BLOCOS, E O ESPAÇO ENTRE ELES É O QUE OS SEPARA.

        Antes o cartão era uma pilha de `gap: md` uniforme: título, metadados,
        descrição, etiqueta e botões ficavam todos à mesma distância uns dos
        outros, e um leitor não tinha como saber, pelo espaçamento, o que
        pertencia a quê. Metadado colava na descrição, a etiqueta colava no
        botão, e o cartão inteiro parecia comprimido.

        Agora a distância carrega significado: `lg` entre blocos, `sm` dentro
        de um bloco. Título e metadados são um bloco só — o nome do lugar e as
        três coisas que o qualificam. Descrição, procedência e ações são cada
        um o seu.
      */}
      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="body" weight="bold" style={{ lineHeight: 22 }}>
          {suggestion.title}
        </AppText>

        {/*
          `rowGap` maior que `columnGap` de propósito: quando categoria,
          duração e área não cabem numa linha, a segunda linha precisa de ar
          vertical para não encostar na primeira — enquanto lado a lado 12dp
          já separam bem.
        */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            rowGap: theme.spacing.xs,
            columnGap: theme.spacing.md,
          }}
        >
          <AppText variant="caption" color="secondary">
            {`${SUGGESTION_CATEGORY_EMOJI[suggestion.category]} ${SUGGESTION_CATEGORY_LABEL[suggestion.category]}`}
          </AppText>
          {duration ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Clock3 size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="tertiary">
                {duration}
              </AppText>
            </View>
          ) : null}
          {suggestion.area ? (
            // `flexShrink` com `minWidth: 0`: um endereço longo encolhe e corta
            // em si mesmo em vez de empurrar categoria e duração para fora do
            // cartão.
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              <MapPin size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="tertiary" numberOfLines={1} style={{ flexShrink: 1 }}>
                {suggestion.area}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      {/*
        20dp de entrelinha em texto de 14dp é o mínimo do tema, e num parágrafo
        de três linhas dentro de um cartão ele lê apertado. 21 dá o respiro sem
        desalinhar do resto da tela.
      */}
      <AppText
        variant="bodySmall"
        color="secondary"
        numberOfLines={3}
        style={{ lineHeight: 21 }}
      >
        {suggestion.description}
      </AppText>

      {suggestion.source === 'ai' ? (
        <Badge label="✨ Sugestão da IA" tone="accent" />
      ) : (
        <Badge label="Do catálogo Easy Trip" tone="neutral" />
      )}

      {/*
        A linha antes das ações.

        A etiqueta de procedência é a última coisa a se LER; os botões são a
        primeira a se TOCAR. Sem nada entre as duas, a etiqueta parecia legenda
        do botão. O filete não é decoração: é o que diz onde o conteúdo termina.
      */}
      <View
        style={{
          height: 1,
          backgroundColor: theme.colors.border,
          marginTop: theme.spacing.xs,
        }}
      />

      {/*
        Empilha quando "Adicionar ao roteiro" não cabe ao lado de "Ver
        detalhes" (§14). Num aparelho de 360dp a fileira dava cerca de 120dp
        por botão e o rótulo principal virava "Adicionar ao r..." — um botão
        que não diz o que faz.

        200 é o que o rótulo mais largo precisa com o ícone e o respiro
        interno, no tamanho de fonte padrão; abaixo disso a coluna é o layout
        honesto. `AdaptiveButtonRow` reescala esse número pela preferência de
        texto do sistema — ver o comentário lá.
      */}
      <AdaptiveButtonRow minItemWidth={200}>
        <Button label="Ver detalhes" variant="secondary" size="sm" fullWidth onPress={onDetails} />
        {canAdd ? (
          <Button label="Adicionar ao roteiro" icon={Plus} size="sm" fullWidth onPress={onAdd} />
        ) : null}
      </AdaptiveButtonRow>
    </GlassCard>
  );
}

function SuggestionDetailSheet({
  suggestion,
  onClose,
  onAdd,
  canAdd,
}: {
  suggestion: TripSuggestion | null;
  onClose: () => void;
  onAdd: (suggestion: TripSuggestion) => void;
  canAdd: boolean;
}) {
  const theme = useTheme();
  if (!suggestion) return null;

  return (
    <BottomSheet
      visible={Boolean(suggestion)}
      onClose={onClose}
      title={suggestion.title}
      subtitle={SUGGESTION_CATEGORY_LABEL[suggestion.category]}
    >
      <View style={{ gap: theme.spacing.lg }}>
        <AppText variant="body" color="secondary">
          {suggestion.description}
        </AppText>

        {suggestion.reason ? (
          <GlassCard elevation="flat">
            <AppText variant="label" color="secondary">
              Por que sugerimos
            </AppText>
            <AppText variant="bodySmall">{suggestion.reason}</AppText>
          </GlassCard>
        ) : null}

        {/*
          §41: nada de preço, horário de funcionamento, avaliação ou
          disponibilidade — nem vindos do modelo, nem copiados do catálogo para
          cá. Esses dados envelhecem, e um preço errado numa sugestão custa mais
          do que a ausência dele.
        */}
        {suggestion.source === 'ai' ? (
          <InlineNotice icon={Sparkles}>
            Esta sugestão foi escrita pela IA a partir do seu destino. Confirme horários, preços e
            disponibilidade antes de contar com ela.
          </InlineNotice>
        ) : null}

        {canAdd ? (
          <Button
            label="Adicionar ao roteiro"
            icon={Plus}
            size="lg"
            fullWidth
            onPress={() => onAdd(suggestion)}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

/* --------------------------- adicionar ao roteiro -------------------------- */

/**
 * A folha de revisão do §45.
 *
 * Nada é adicionado sem passar por aqui: data, horário, duração e visibilidade
 * são escolhas de quem está montando o dia, e um "adicionar" que decidisse tudo
 * sozinho colocaria o Louvre às 00:00 do primeiro dia da viagem.
 *
 * A coordenada da sugestão viaja junto (§47). É o que faz o item aparecer no
 * mini mapa do dia, entrar no cálculo de distância e receber previsão do
 * tempo por horário — sem que a pessoa precise procurar o endereço de novo.
 */
function AddToItinerarySheet({
  suggestion,
  tripId,
  tripStart,
  tripEnd,
  isShared,
  onClose,
  onAdded,
}: {
  suggestion: TripSuggestion | null;
  tripId: string;
  tripStart: string;
  tripEnd: string;
  isShared: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const mutations = useItineraryMutations(tripId);
  const { data: itinerary = [] } = useItinerary(tripId);

  // O primeiro dia da viagem que ainda não passou. Melhor ponto de partida do
  // que "hoje": numa viagem futura, hoje não é um dia do roteiro.
  const defaultDate = useMemo(() => {
    const today = todayISO();
    return today > tripStart && today <= tripEnd ? today : tripStart;
  }, [tripStart, tripEnd]);

  const [date, setDate] = useState<string>(defaultDate);
  const [time, setTime] = useState<string | undefined>('10:00');
  const [durationHours, setDurationHours] = useState<string>('2');
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY.itinerary);
  const [notes, setNotes] = useState('');

  if (!suggestion) return null;

  const submit = async () => {
    try {
      const hours = Number(durationHours.replace(',', '.'));
      const endTime =
        time && Number.isFinite(hours) && hours > 0 ? addHours(time, hours) : undefined;

      const sortOrder =
        itinerary.filter((item) => item.date === date).length > 0
          ? Math.max(...itinerary.filter((item) => item.date === date).map((i) => i.sortOrder)) + 1
          : 0;

      await mutations.create.mutateAsync({
        date,
        startTime: time,
        endTime,
        type: 'atracao',
        title: suggestion.title,
        description: notes.trim() || suggestion.description,
        placeName: suggestion.placeName ?? suggestion.title,
        address: suggestion.area,
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        // A origem da coordenada viaja junto: é ela que diz, mais tarde, se dá
        // para confiar no ponto o bastante para desenhar uma rota.
        placeSource: 'suggestion',
        completed: false,
        sortOrder,
        visibility,
      });

      onAdded();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Não foi possível adicionar ao roteiro.',
      );
    }
  };

  return (
    <BottomSheet
      visible={Boolean(suggestion)}
      onClose={onClose}
      title={`Adicionar ${suggestion.title}`}
      subtitle="Escolha quando entra no seu roteiro"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <DateField
          label="Data"
          value={date}
          onChange={setDate}
          minimumDate={new Date(`${tripStart}T00:00:00`)}
          maximumDate={new Date(`${tripEnd}T23:59:59`)}
          required
        />

        <TimeField label="Horário" value={time} onChange={setTime} />

        <TextField
          label="Duração (horas)"
          value={durationHours}
          onChangeText={setDurationHours}
          keyboardType="decimal-pad"
          helper="Usada para calcular o horário de término."
        />

        {suggestion.placeName || suggestion.area ? (
          <GlassCard elevation="flat">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <MapPin size={16} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodySmall" weight="semibold" numberOfLines={1}>
                  {suggestion.placeName ?? suggestion.title}
                </AppText>
                {suggestion.area ? (
                  <AppText variant="caption" color="secondary" numberOfLines={1}>
                    {suggestion.area}
                  </AppText>
                ) : null}
              </View>
            </View>
            {suggestion.latitude === undefined ? (
              <AppText variant="caption" color="tertiary">
                Sem coordenadas — este item não entra no mapa do dia.
              </AppText>
            ) : null}
          </GlassCard>
        ) : null}

        <VisibilityField
          value={visibility}
          onChange={setVisibility}
          visible={isShared}
          scope="Itens compartilhados aparecem no roteiro de todos os viajantes."
        />

        <TextField
          label="Observações"
          placeholder="Ingressos, ponto de encontro, o que levar..."
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <Button
          label="Adicionar"
          size="lg"
          fullWidth
          loading={mutations.create.isPending}
          onPress={() => void submit()}
          haptic
        />
      </View>
    </BottomSheet>
  );
}

/** "10:00" + 2,5h → "12:30". Fica em 23:59 em vez de virar o dia. */
function addHours(time: string, hours: number): string | undefined {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  const total = Math.min(h * 60 + m + Math.round(hours * 60), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
