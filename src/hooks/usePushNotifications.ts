import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { prefsStorage } from '@/lib/storage';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import {
  configureForegroundBehavior,
  currentPushPermission,
  destinationRoute,
  ensureAndroidChannel,
  getDeviceToken,
  readDestination,
  requestPushPermission,
  type PushPermission,
} from '@/services/pushNotifications';

/**
 * Avisos fora do aplicativo, ligados à sessão (§33).
 *
 * O QUE O CICLO DE VIDA EXIGE, E POR QUE ELE É A PARTE DIFÍCIL
 *
 * Um token de push é um endereço de entrega gravado no servidor. Ele precisa
 * acompanhar QUEM está usando o aparelho — não o aparelho:
 *
 *   entrar    registra o token nesta conta. Se ele pertencia a outra (o mesmo
 *             telefone, outra pessoa), a 0016 o move.
 *   sair      desregistra. Um token vivo depois da saída faria o aparelho
 *             mostrar, na tela de bloqueio, o aviso de quem já não está nele —
 *             e quem entrasse depois leria.
 *   trocar    é sair e entrar. Cai nos dois casos acima, nesta ordem.
 *
 * O `useRef` guarda o token registrado NESTA sessão, porque na hora de sair a
 * sessão já acabou e não haveria como perguntá-lo ao servidor.
 *
 * A PERMISSÃO NÃO É PEDIDA AO ABRIR
 *
 * Um diálogo de permissão na primeira tela, antes de a pessoa saber o que o
 * aplicativo faz, é recusado por reflexo — e o sistema operacional não pergunta
 * duas vezes. O pedido mora em Configurações, num controle que a pessoa liga
 * quando quer. O que roda sozinho é só o registro de quem JÁ concedeu.
 */

const ASKED_KEY = 'push-permission-asked';

function projectId(): string | undefined {
  // Em build do EAS vem de `easConfig`; em desenvolvimento, de `extra`. Sem
  // ele o Expo não emite token — e a resposta certa é não ter token, não
  // quebrar.
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const [enabled, setEnabled] = useState(false);
  const registeredToken = useRef<string | null>(null);
  const previousUser = useRef<string | null>(null);

  useEffect(() => {
    configureForegroundBehavior();
    void ensureAndroidChannel();
    void currentPushPermission().then(setPermission);
  }, []);

  /** Registra o aparelho nesta conta. Silencioso: avisar é conveniência. */
  const register = useCallback(async () => {
    if (!user?.id) return false;
    const device = await getDeviceToken(projectId());
    if (!device) return false;
    try {
      await dataSource.pushTokens.register(device.token, device.platform, device.deviceName);
      registeredToken.current = device.token;
      setEnabled(true);
      return true;
    } catch {
      // Backend sem a 0016, ou sem rede. Os avisos continuam na Central.
      return false;
    }
  }, [user?.id]);

  const unregister = useCallback(async () => {
    const token = registeredToken.current;
    registeredToken.current = null;
    setEnabled(false);
    if (!token) return;
    try {
      await dataSource.pushTokens.unregister(token);
    } catch {
      // Falhar aqui deixa um token órfão no servidor. É por isso que a Function
      // de envio desativa o que o serviço recusar: a limpeza tem dois caminhos.
    }
  }, []);

  /**
   * Ligar os avisos — o que o controle em Configurações chama.
   *
   * Pede a permissão só aqui, e marca que pediu: `canAskAgain` do sistema já
   * cobre a recusa, mas a marca local é o que permite a tela dizer "você
   * recusou antes; para mudar, vá aos ajustes do aparelho" em vez de oferecer
   * um botão que abre um diálogo que não vai aparecer.
   */
  const enable = useCallback(async () => {
    const resultado = await requestPushPermission();
    setPermission(resultado);
    await prefsStorage.set(ASKED_KEY, true);
    if (resultado !== 'granted') return false;
    return register();
  }, [register]);

  const disable = useCallback(async () => {
    await unregister();
  }, [unregister]);

  /**
   * Registro automático de quem já concedeu.
   *
   * Roda a cada entrada, e não só na primeira: o token do Expo pode ser
   * reemitido a qualquer momento, e um registro que só acontecesse uma vez
   * deixaria o aparelho com um endereço morto sem ninguém perceber.
   */
  useEffect(() => {
    const anterior = previousUser.current;
    const atual = user?.id ?? null;

    if (anterior && anterior !== atual) {
      // Saiu, ou trocou de conta. Desregistrar ANTES de qualquer registro novo.
      void unregister();
    }
    previousUser.current = atual;

    if (!atual) return;
    void currentPushPermission().then((p) => {
      setPermission(p);
      if (p === 'granted') void register();
    });
  }, [register, unregister, user?.id]);

  /**
   * Tocar a notificação leva à viagem.
   *
   * O `data` carrega só identificadores (ver `buildMessages` na Function): o
   * conteúdo é lido pelo aplicativo já autenticado. Um push que carregasse o
   * texto faria o dado viajar por fora da sessão.
   */
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const rota = destinationRoute(readDestination(response));
      // A proteção de rotas continua sendo a autoridade: navegar para uma
      // viagem sem sessão cai no guarda da raiz, como qualquer link profundo.
      if (rota) router.push(rota as never);
    });
    return () => subscription.remove();
  }, [router]);

  return {
    permission,
    enabled,
    /** `true` quando não há como pedir de novo — a pessoa muda nos ajustes. */
    blocked: permission === 'denied',
    unavailable: permission === 'unavailable',
    enable,
    disable,
  };
}
