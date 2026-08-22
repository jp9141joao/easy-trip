import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { hydrateQueries, persistQueries } from '@/lib/queryPersistence';
import { useAuth } from './AuthProvider';

/**
 * Liga o cache do React Query ao disco, com escopo de conta (D-04).
 *
 * Fica fora do `AuthProvider` de propósito: o provedor já é responsável por
 * sessão, perfil e recuperação de senha, e persistência de cache não é nenhuma
 * das três. Aqui é só isto — repõe ao entrar, grava enquanto usa.
 */

/**
 * Um respiro entre a última mudança e a gravação.
 *
 * O cache muda várias vezes por segundo enquanto uma tela carrega. Sem o
 * atraso, cada uma viraria uma escrita no AsyncStorage — que é assíncrono,
 * serializado e roda na mesma ponte que a interface.
 */
const DEBOUNCE_MS = 1_500;

export function QueryPersistence() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    let ativo = true;
    let hidratado = false;

    // Repor primeiro, assinar depois: sem isso a própria reidratação dispararia
    // a gravação, regravando o que acabou de ser lido.
    void hydrateQueries(queryClient, userId).finally(() => {
      if (ativo) hidratado = true;
    });

    const gravar = () => {
      if (!ativo || !hidratado) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void persistQueries(queryClient, userId);
      }, DEBOUNCE_MS);
    };

    const cancelarAssinatura = queryClient.getQueryCache().subscribe(gravar);

    return () => {
      ativo = false;
      cancelarAssinatura();
      if (timer.current) clearTimeout(timer.current);
      // Uma última gravação na saída da tela/desmontagem perderia a corrida com
      // a limpeza do `signOut`, que roda logo antes. Melhor não gravar: o que
      // se perde é o intervalo do debounce, e o que se evita é ressuscitar o
      // cache de uma conta que acabou de sair.
    };
  }, [queryClient, userId]);

  return null;
}
