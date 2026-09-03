import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/repositories/supabase/client';

/**
 * Um canal Realtime por assunto, compartilhado por quem estiver na tela (§8).
 *
 * O DEFEITO QUE ISTO CORRIGE
 *
 * `supabase.channel(topico)` não cria um canal novo. Se já existe um canal com
 * aquele tópico registrado no cliente, ele DEVOLVE O MESMO OBJETO — e
 * `channel.on('postgres_changes', ...)` joga uma exceção quando o canal já
 * entrou:
 *
 *   cannot add `postgres_changes` callbacks for realtime:trip:<id>
 *   after `subscribe()`.
 *
 * Na viagem isso era determinístico, não uma corrida rara. `router.push`
 * empilha Sugestões SOBRE a Jornada e a tela de baixo continua montada: as
 * duas chamavam `useTripRealtime(tripId)`, as duas pediam o tópico
 * `trip:<id>`, e a segunda recebia o canal que a primeira já tinha inscrito. O
 * `.on()` seguinte estourava dentro do render de Sugestões — daí o Render
 * Error ao abrir a tela.
 *
 * A ARQUITETURA, E NÃO UM NOME DIFERENTE POR TELA
 *
 * Dar a cada tela o seu próprio tópico calaria o erro e abriria seis
 * assinaturas para a mesma viagem, cada uma com o mesmo filtro e o mesmo
 * trabalho. A correção é o contrário: UM canal por assunto, com contagem de
 * referências. A primeira tela cria e inscreve; as seguintes só entram na
 * lista de ouvintes; a última a sair é quem remove.
 *
 * POR QUE A SAÍDA É ADIADA
 *
 * `removeChannel` espera o servidor confirmar a saída antes de tirar o canal
 * da lista do cliente — o que pode levar centenas de milissegundos. Sem uma
 * folga, o remonte imediato (Strict Mode em desenvolvimento, ou voltar e
 * reabrir a tela) pediria o tópico enquanto o canal antigo ainda está lá, e
 * receberia justamente o objeto moribundo. A folga também evita derrubar e
 * reabrir a conexão ao alternar entre as telas da mesma viagem.
 *
 * POR QUE O TÓPICO LEVA UM NÚMERO DE INSTÂNCIA
 *
 * O sufixo não é para diferenciar telas — é para garantir OBJETO NOVO. Um
 * canal que já entrou uma vez não pode ser reaproveitado: o `.on()` joga se
 * ele ainda está inscrito, e o `subscribe()` do Phoenix joga "tried to join
 * multiple times" depois que ele saiu. Como a remoção do canal anterior é
 * assíncrona, pedir o mesmo tópico logo depois poderia devolvê-lo; com o
 * sufixo, cada criação é sempre um canal limpo. O assunto continua legível no
 * nome (`trip:<id>#3`).
 */

export interface RealtimeBinding {
  table: string;
  /** Filtro PostgREST do Realtime, ex.: `trip_id=eq.<id>`. */
  filter: string;
}

/** Recebe o nome da tabela que mudou — nunca o payload (§63). */
type TableListener = (table: string) => void;

interface SharedChannel {
  client: SupabaseClient;
  channel: RealtimeChannel;
  listeners: Set<TableListener>;
  linger: ReturnType<typeof setTimeout> | null;
}

/**
 * Quanto o canal sobrevive sem ouvinte antes de ser removido. Curto o
 * bastante para não deixar assinatura órfã, longo o bastante para cobrir o
 * remonte do Strict Mode e o vaivém entre as telas da viagem.
 */
export const CHANNEL_LINGER_MS = 5_000;

const channels = new Map<string, SharedChannel>();
let instanceCount = 0;

/**
 * Entra no canal do assunto e devolve a função de saída.
 *
 * A ordem é a única que o Supabase aceita: canal novo → todos os `.on()` →
 * um `subscribe()`. Depois disso o canal nunca mais recebe binding: quem
 * chegar depois entra pela lista de ouvintes.
 */
export function joinSharedRealtimeChannel(
  key: string,
  bindings: RealtimeBinding[],
  listener: TableListener,
): () => void {
  let shared = channels.get(key);

  if (shared) {
    // Alguém voltou antes da remoção acontecer: cancela a saída e reaproveita
    // o canal que já está inscrito, sem tocar nos bindings.
    if (shared.linger) {
      clearTimeout(shared.linger);
      shared.linger = null;
    }
  } else {
    const client = getSupabaseClient();
    const listeners = new Set<TableListener>();
    instanceCount += 1;
    const channel = client.channel(`${key}#${instanceCount}`);

    for (const { table, filter } of bindings) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        () => {
          // Cópia: um ouvinte pode sair de dentro do próprio aviso.
          for (const notify of [...listeners]) notify(table);
        },
      );
    }

    shared = { client, channel, listeners, linger: null };
    channels.set(key, shared);
    void channel.subscribe();
  }

  shared.listeners.add(listener);

  let released = false;
  return () => {
    // O cleanup do React pode rodar mais de uma vez; a saída dupla não pode
    // zerar a contagem de quem ainda está na tela.
    if (released) return;
    released = true;
    release(key, listener);
  };
}

function release(key: string, listener: TableListener) {
  const shared = channels.get(key);
  if (!shared) return;

  shared.listeners.delete(listener);
  if (shared.listeners.size > 0 || shared.linger) return;

  shared.linger = setTimeout(() => {
    const current = channels.get(key);
    if (!current || current.listeners.size > 0) return;
    channels.delete(key);
    // `removeChannel` e não `unsubscribe`: o segundo fecha a inscrição mas
    // deixa o canal registrado no cliente, e trocar de viagem várias vezes
    // acumularia canais mortos que continuam contando para o limite de
    // conexões do projeto.
    void current.client.removeChannel(current.channel);
  }, CHANNEL_LINGER_MS);
}

/**
 * Derruba tudo agora, sem folga. Existe para o teste e para um corte de raiz
 * (troca de usuário), não para o ciclo normal das telas.
 */
export function closeSharedRealtimeChannels() {
  for (const [key, shared] of [...channels]) {
    if (shared.linger) clearTimeout(shared.linger);
    channels.delete(key);
    void shared.client.removeChannel(shared.channel);
  }
}
