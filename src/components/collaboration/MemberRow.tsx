import { ChevronRight, Crown, Eye, MoreHorizontal, Pencil, Users } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText, Avatar, Badge } from '@/components/ui';
import {
  ROLE_LABEL,
  memberDisplayName,
  roleAccessibilityLabel,
  type TripMember,
  type TripRole,
} from '@/domain/collaboration';
import { useTheme } from '@/theme';

const ROLE_ICON = {
  owner: Crown,
  editor: Pencil,
  viewer: Eye,
} as const;

/**
 * Uma pessoa na lista de viajantes (§49).
 *
 * O papel aparece como texto e como ícone. Os dois, e não um: cor sozinha não
 * distingue editor de visualizador para quem não enxerga cor, e o ícone sozinho
 * não passa por leitor de tela (§70). `roleAccessibilityLabel` costura os dois
 * numa frase.
 *
 * `onManage` só é passado quando quem está lendo é o proprietário. A linha
 * inteira deixa de ser tocável quando não há o que gerenciar — um `Pressable`
 * que não faz nada é pior do que texto: ele promete uma tela que não existe.
 */
export function MemberRow({
  member,
  selfId,
  onManage,
}: {
  member: TripMember;
  selfId?: string;
  onManage?: (member: TripMember) => void;
}) {
  const theme = useTheme();
  const RoleIcon = ROLE_ICON[member.role];
  const name = memberDisplayName(member, selfId);
  const manageable = Boolean(onManage) && member.role !== 'owner';

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
      }}
    >
      <Avatar name={name} size={40} />

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="body" weight="semibold" numberOfLines={1}>
          {name}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RoleIcon size={12} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="secondary">
            {ROLE_LABEL[member.role]}
          </AppText>
        </View>
      </View>

      {manageable ? <MoreHorizontal size={18} color={theme.colors.textTertiary} /> : null}
    </View>
  );

  if (!manageable) {
    return (
      <View accessible accessibilityLabel={roleAccessibilityLabel(name, member.role)}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onManage?.(member)}
      accessibilityRole="button"
      accessibilityLabel={roleAccessibilityLabel(name, member.role)}
      accessibilityHint="Abre as opções de permissão e remoção"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

/**
 * A entrada para a lista de viajantes no Trip Hub (§49, §55).
 *
 * Ela continua visível quando só existe o proprietário. Escondê-la nesse caso
 * criava um ciclo impossível: o acesso para convidar a segunda pessoa só
 * aparecia depois de a segunda pessoa já existir.
 */
export function MembersSummary({
  count,
  pendingInvites = 0,
  onPress,
}: {
  count: number;
  pendingInvites?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  if (count < 1) return null;

  const label = count === 1 ? 'Viajantes' : `${count} viajantes`;
  const detail = count === 1 ? 'Só você nesta viagem' : undefined;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        pendingInvites > 0
          ? `${label}. ${detail ? `${detail}. ` : ''}${pendingInvites} convite pendente. Abre a lista de viajantes.`
          : `${label}. ${detail ? `${detail}. ` : ''}Abre a lista de viajantes.`
      }
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        width: '100%',
        paddingVertical: theme.spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Users size={14} color={theme.colors.textSecondary} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="bodySmall" weight="semibold">
          {label}
        </AppText>
        {detail ? (
          <AppText variant="caption" color="secondary">
            {detail}
          </AppText>
        ) : null}
      </View>
      {pendingInvites > 0 ? (
        <Badge label={`${pendingInvites} pendente${pendingInvites > 1 ? 's' : ''}`} tone="warning" />
      ) : null}
      <ChevronRight size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

export function roleIconFor(role: TripRole) {
  return ROLE_ICON[role];
}
