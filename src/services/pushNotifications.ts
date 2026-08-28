/**
 * Notificações do sistema operacional (§33).
 *
 * A camada que fala com `expo-notifications`. Isolada aqui — e não espalhada
 * pelos hooks — porque quase tudo neste arquivo só existe em aparelho de
 * verdade: emulador sem serviços do Google, navegador e ambiente de teste não
 * têm token nenhum a oferecer, e o código de tela não pode ter de saber disso.
 *
 * A REGRA QUE ORGANIZA O ARQUIVO: NADA AQUI PODE DERRUBAR O APLICATIVO.
 *
 * Notificação é conveniência. Uma permissão recusada, um serviço indisponível,
 * um projeto Expo sem credencial configurada — nenhum desses é motivo para a
 * pessoa não conseguir ver o próprio roteiro. Por isso toda função devolve
 * `null` ou `false` em vez de levantar, e o chamador segue em frente.
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/**
 * Como uma notificação se comporta com o aplicativo ABERTO.
 *
 * Sem isto, o Android e o iOS engolem em silêncio o aviso que chega enquanto a
 * pessoa está usando o aplicativo — e o caso mais comum de todos é justamente
 * esse: a pessoa está no Easy Trip quando o convite de viagem chega.
 */
export function configureForegroundBehavior(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * O canal do Android.
 *
 * Obrigatório a partir do Android 8: sem canal declarado, a notificação chega
 * mas o sistema a classifica no nível mais baixo — sem som, sem aparecer na
 * tela de bloqueio. O sintoma é "o push não funciona no Android", e a causa não
 * se parece com isso.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Avisos da viagem',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch {
    // Um canal que não pôde ser criado não impede o aplicativo de funcionar.
  }
}

/**
 * Pede a permissão, uma vez.
 *
 * NÃO pede de novo depois de recusada. O sistema operacional deixa de mostrar o
 * diálogo depois da primeira recusa, então insistir só produz uma resposta
 * negativa silenciosa — e, do lado de cá, a impressão de que o pedido está
 * pendente quando ele já foi respondido. Quem mudou de ideia muda nos ajustes
 * do aparelho, e a tela diz isso.
 */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';

  try {
    const atual = await Notifications.getPermissionsAsync();
    if (atual.granted) return 'granted';
    if (!atual.canAskAgain) return 'denied';

    const pedido = await Notifications.requestPermissionsAsync();
    if (pedido.granted) return 'granted';
    return pedido.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function currentPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';
  try {
    const atual = await Notifications.getPermissionsAsync();
    if (atual.granted) return 'granted';
    return atual.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export interface DeviceToken {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceName?: string;
}

/**
 * O endereço de entrega deste aparelho.
 *
 * `projectId` é obrigatório em builds do EAS e é lido da configuração — sem
 * ele, `getExpoPushTokenAsync` levanta com uma mensagem que fala de
 * infraestrutura e não de produto. Devolver `null` é a resposta honesta: não há
 * token, e a tela diz que os avisos ficam dentro do aplicativo.
 */
export async function getDeviceToken(projectId?: string): Promise<DeviceToken | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'web') return null;

  try {
    const resposta = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!resposta?.data) return null;
    return {
      token: resposta.data,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: Device.deviceName ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * O que fazer quando a pessoa toca a notificação.
 *
 * Só devolve os identificadores — `tripId`, `notificationId` —, que é tudo o
 * que o `data` carrega (ver `buildMessages` na Function). O conteúdo é lido
 * pelo aplicativo já autenticado, e não vem pelo push.
 */
export interface PushDestination {
  tripId?: string;
  notificationId?: string;
}

export function readDestination(response: {
  notification?: { request?: { content?: { data?: unknown } } };
}): PushDestination {
  const data = response?.notification?.request?.content?.data;
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  return {
    tripId: typeof d.tripId === 'string' ? d.tripId : undefined,
    notificationId: typeof d.notificationId === 'string' ? d.notificationId : undefined,
  };
}

/** Para onde navegar. `null` quando o aviso não aponta para lugar nenhum. */
export function destinationRoute(destination: PushDestination): string | null {
  if (destination.tripId) return `/trip/${destination.tripId}`;
  if (destination.notificationId) return '/alerts';
  return null;
}
