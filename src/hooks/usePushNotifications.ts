import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { prefsStorage } from '@/lib/storage';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import {
  addNotificationResponseListener,
  configureForegroundBehavior,
  currentPushPermission,
  destinationRoute,
  ensureAndroidChannel,
  getDeviceToken,
  isRemotePushSupported,
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
 *
 * O EXPO GO NÃO ENTREGA PUSH REMOTO
 *
 * Desde o SDK 53 o Expo Go não embarca a entrega remota do `expo-notifications`
 * no Android. O hook continua podendo ser chamado igual — o que ele faz nesse
 * ambiente é terminar em `permission: 'unavailable'` e `supported: false`, sem
 * pedir permissão, sem pedir token e sem tocar no servidor. Nada disso vale
 * para development build, APK/AAB ou build do EAS, onde o fluxo é o de sempre.
 *
 * Isto é limitação do AMBIENTE de desenvolvimento, não do produto — e não afeta
 * os avisos internos, que vivem na Central e não passam por aqui.
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
  /** Decidido num lugar só (`services/notificationsModule`), lido em vários. */
  const supported = isRemotePushSupported();
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const [enabled, setEnabled] = useState(false);
  const registeredToken = useRef<string | null>(null);
  const previousUser = useRef<string | null>(null);

  useEffect(() => {
    if (!supported) {
      // Sem push remoto neste ambiente: não há handler, canal nem permissão a
      // preparar. O estado fica explícito, e nenhuma exceção é levantada.
      setPermission('unavailable');
      return;
    }
    configureForegroundBehavior();
    void ensureAndroidChannel();
    void currentPushPermission().then(setPermission);
  }, [supported]);

  /** Registra o aparelho nesta conta. Silencioso: avisar é conveniência. */
  const register = useCallback(async () => {
    if (!supported || !user?.id) return false;
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
  }, [supported, user?.id]);

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
    // No Expo Go a tela nem oferece o controle; se algo o chamar assim mesmo, a
    // resposta é "não deu", e não um diálogo de permissão que não leva a nada.
    if (!supported) return false;
    const resultado = await requestPushPermission();
    setPermission(resultado);
    await prefsStorage.set(ASKED_KEY, true);
    if (resultado !== 'granted') return false;
    return register();
  }, [register, supported]);

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

    // A saída acima roda em qualquer ambiente — desregistrar é limpeza, e no
    // Expo Go simplesmente não há token guardado para desregistrar. O que para
    // aqui é só o registro automático.
    if (!atual || !supported) return;
    void currentPushPermission().then((p) => {
      setPermission(p);
      if (p === 'granted') void register();
    });
  }, [register, supported, unregister, user?.id]);

  /**
   * Tocar a notificação leva à viagem.
   *
   * O `data` carrega só identificadores (ver `buildMessages` na Function): o
   * conteúdo é lido pelo aplicativo já autenticado. Um push que carregasse o
   * texto faria o dado viajar por fora da sessão.
   */
  useEffect(() => {
    // `null` onde não há push remoto: não há evento para ouvir, e assinar um
    // que nunca chega não é diferente de não assinar.
    const subscription = addNotificationResponseListener((response) => {
      const rota = destinationRoute(readDestination(response));
      // A proteção de rotas continua sendo a autoridade: navegar para uma
      // viagem sem sessão cai no guarda da raiz, como qualquer link profundo.
      if (rota) router.push(rota as never);
    });
    return () => subscription?.remove();
  }, [router]);

  return {
    permission,
    enabled,
    /** `true` quando não há como pedir de novo — a pessoa muda nos ajustes. */
    blocked: permission === 'denied',
    unavailable: permission === 'unavailable',
    /** `false` no Expo Go: o ambiente não entrega push remoto. */
    supported,
    enable,
    disable,
  };
}
