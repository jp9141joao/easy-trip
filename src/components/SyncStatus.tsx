import { useRouter } from 'expo-router';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui';
import { queueLabel } from '@/domain/offlineQueue';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useTheme } from '@/theme';

/**
 * O indicador de sincronização pendente (§33).
 *
 * SÓ APARECE QUANDO HÁ ALGO. Um selo permanente dizendo "tudo sincronizado"
 * treinaria a pessoa a ignorá-lo — e no dia em que ele mudasse para "3 pendentes"
 * ela não olharia. O silêncio é o estado normal, e é o que dá peso ao aviso.
 *
 * Dois tons, para duas situações que exigem coisas diferentes:
 *
 *   aviso (âmbar)   há algo esperando conexão. Não há o que fazer, e o texto
 *                   não pede nada — só informa que a alteração não se perdeu.
 *   erro (vermelho) há algo que não vai subir sozinho. Aí SIM há uma decisão a
 *                   tomar, e tocar leva à tela onde ela é tomada.
 *
 * O toque só existe no segundo caso: um alvo que não leva a lugar nenhum é
 * pior do que texto.
 */
export function SyncStatus() {
  const theme = useTheme();
  const router = useRouter();
  const { summary } = useOfflineQueue();

  const label = queueLabel(summary);
  if (!label) return null;

  const bloqueado = summary.blocked;
  const Icon = bloqueado ? AlertTriangle : summary.syncing > 0 ? RefreshCw : CloudOff;
  const fg = bloqueado ? theme.colors.error : theme.colors.warning;
  const bg = bloqueado ? theme.colors.errorSoft : theme.colors.warningSoft;

  const conteudo = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: bg,
        borderRadius: theme.radius.smallCard,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <Icon size={14} color={fg} />
      <AppText variant="caption" style={{ color: fg, flex: 1 }} numberOfLines={2}>
        {label}
      </AppText>
      {bloqueado ? (
        <AppText variant="caption" weight="semibold" style={{ color: fg }}>
          Resolver
        </AppText>
      ) : null}
    </View>
  );

  if (!bloqueado) {
    return (
      <View accessible accessibilityLabel={label}>
        {conteudo}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/profile/sync')}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Abre a lista de alterações que não puderam ser enviadas"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {conteudo}
    </Pressable>
  );
}
