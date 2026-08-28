import { AlertTriangle, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Button,
  Divider,
  EmptyState,
  GlassCard,
  InlineNotice,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import type { QueuedMutation } from '@/domain/offlineQueue';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useTheme } from '@/theme';

/**
 * As alterações que ainda não subiram (§33).
 *
 * A tela existe para uma pergunta só: *o que eu escrevi que ainda não chegou, e
 * o que eu faço a respeito?* Por isso ela lista os itens com nome de gente —
 * "Despesa", "Item do roteiro" — e não com a chave interna, e por isso as duas
 * ações são as duas únicas decisões possíveis: **tentar de novo** ou
 * **descartar**.
 *
 * Descartar é destrutivo e está dito assim: o que foi escrito sem rede e
 * descartado aqui não existe em lugar nenhum depois.
 */

const NOME: Record<string, string> = {
  itinerary: 'Item do roteiro',
  checklist: 'Item da lista',
  expense: 'Despesa',
  journal: 'Anotação do diário',
  goal: 'Meta',
};

const VERBO: Record<string, string> = {
  create: 'Criação',
  update: 'Alteração',
  remove: 'Exclusão',
};

export default function SyncScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { queue, summary, retry, retryAll, discard } = useOfflineQueue();

  const bloqueados = queue.filter((item) => item.status === 'needs_resolution');
  const esperando = queue.filter((item) => item.status !== 'needs_resolution');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Perfil"
          title="Sincronização"
          subtitle={
            summary.total === 0
              ? 'Tudo enviado'
              : `${summary.total} ${summary.total === 1 ? 'alteração pendente' : 'alterações pendentes'}`
          }
          showBack
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.lg,
        }}
      >
        {queue.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={CheckCircle2}
              title="Nada pendente"
              message="Tudo o que você escreveu já está salvo no Easy Trip."
              compact
            />
          </GlassCard>
        ) : null}

        {bloqueados.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" color="secondary">
              Precisam da sua atenção
            </AppText>
            <InlineNotice icon={AlertTriangle} tone="error">
              Estas alterações não puderam ser enviadas, e tentar de novo sozinho não
              resolveria — a viagem pode ter sido excluída, ou sua permissão nela pode ter
              mudado.
            </InlineNotice>
            <GlassCard>
              {bloqueados.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <ItemRow
                    item={item}
                    onRetry={() => void retry(item.id)}
                    onDiscard={async () => {
                      await discard(item.id);
                      toast.success('Alteração descartada');
                    }}
                  />
                </View>
              ))}
            </GlassCard>
          </View>
        ) : null}

        {esperando.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" color="secondary">
              Aguardando conexão
            </AppText>
            <GlassCard>
              {esperando.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <ItemRow item={item} />
                </View>
              ))}
            </GlassCard>
          </View>
        ) : null}

        {queue.length > 0 ? (
          <Button
            label="Tentar enviar tudo agora"
            icon={RefreshCw}
            variant="secondary"
            fullWidth
            onPress={() => void retryAll()}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ItemRow({
  item,
  onRetry,
  onDiscard,
}: {
  item: QueuedMutation;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const theme = useTheme();
  const titulo = `${VERBO[item.operation] ?? item.operation} · ${NOME[item.entity] ?? item.entity}`;

  return (
    <View style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}>
      <View style={{ gap: 2 }}>
        <AppText variant="body" weight="semibold">
          {titulo}
        </AppText>
        <AppText variant="caption" color="secondary">
          {item.status === 'syncing'
            ? 'Enviando…'
            : item.status === 'needs_resolution'
              ? // A mensagem do servidor é escrita para o usuário final nas
                // funções da 0008/0014. Quando não há, o texto genérico não
                // finge saber o motivo.
                item.lastError ?? 'Não foi possível enviar esta alteração.'
              : item.attempts === 0
                ? 'Aguardando conexão'
                : `Aguardando conexão · ${item.attempts} ${item.attempts === 1 ? 'tentativa' : 'tentativas'}`}
        </AppText>
      </View>

      {onRetry || onDiscard ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {onRetry ? (
            <Button label="Tentar de novo" size="sm" variant="secondary" onPress={onRetry} />
          ) : null}
          {onDiscard ? (
            <Button label="Descartar" size="sm" variant="ghost" icon={Trash2} onPress={onDiscard} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
