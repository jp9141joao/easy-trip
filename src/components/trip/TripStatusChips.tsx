import { CalendarClock, CircleCheck, Plane, PlayCircle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui';
import {
  getDaysUntilTrip,
  getTripStatus,
  getTripTimingLabel,
  TRIP_STATUS_LABEL,
} from '@/domain/selectors';
import type { Trip, TripStatus } from '@/domain/types';
import { useTheme } from '@/theme';
import type { CountdownRole, TonalRole, TripStatusRole } from '@/theme/theme';

/**
 * Status e tempo restante da viagem (§23–§34).
 *
 * O problema que estes componentes resolvem não é de cor, e sim de hierarquia:
 * antes eram dois `Badge` translúcidos (16% de opacidade) desenhados direto
 * sobre a fotografia do hero, então sumiam em qualquer foto clara ou detalhada.
 * A legibilidade agora vem de uma superfície própria — scrim opaco o bastante,
 * borda sutil, texto claro — e o significado é carregado por um ícone colorido
 * em vez de tingir o texto. Assim a informação sobrevive a qualquer imagem
 * (§30) sem transformar o hero num painel de indicadores (§31).
 */

const STATUS_ROLE: Record<TripStatus, TripStatusRole> = {
  upcoming: 'planned',
  active: 'active',
  completed: 'completed',
};

const STATUS_ICON: Record<TripStatus, LucideIcon> = {
  upcoming: Plane,
  active: PlayCircle,
  completed: CircleCheck,
};

/** Chip base: superfície tonal + borda + ícone que carrega o significado. */
function Chip({
  label,
  role,
  icon: Icon,
  style,
}: {
  label: string;
  role: TonalRole;
  icon: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          // `flex-start` para o chip acompanhar o texto: rótulos vão de
          // "Falta 1 dia" a "Faltam 127 dias" sem largura fixa (§35).
          alignSelf: 'flex-start',
          backgroundColor: role.background,
          borderWidth: 1,
          borderColor: role.border,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 6,
        },
        style,
      ]}
    >
      <Icon size={13} color={role.accent} />
      <AppText variant="label" weight="semibold" style={{ color: role.foreground }}>
        {label}
      </AppText>
    </View>
  );
}

export function TripStatusChip({ trip, style }: { trip: Trip; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const status = getTripStatus(trip);

  return (
    <Chip
      label={TRIP_STATUS_LABEL[status]}
      role={theme.colors.status[STATUS_ROLE[status]]}
      icon={STATUS_ICON[status]}
      style={style}
    />
  );
}

/**
 * Proximidade da viagem (§28).
 *
 * Uma viagem daqui a 90 dias não é um erro nem uma emergência, então nada aqui
 * usa a semântica de perigo. A presença cresce conforme a data se aproxima e
 * para em atenção moderada — âmbar, nunca vermelho.
 */
function countdownRole(trip: Trip): CountdownRole {
  if (getTripStatus(trip) !== 'upcoming') return 'near';

  const days = getDaysUntilTrip(trip);
  if (days <= 7) return 'imminent';
  if (days <= 30) return 'near';
  return 'calm';
}

/** Renderiza `null` quando o rótulo apenas repetiria o status. */
export function TripTimingChip({ trip, style }: { trip: Trip; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const label = getTripTimingLabel(trip);

  if (!label) return null;

  return (
    <Chip
      label={label}
      role={theme.colors.countdown[countdownRole(trip)]}
      icon={CalendarClock}
      style={style}
    />
  );
}
