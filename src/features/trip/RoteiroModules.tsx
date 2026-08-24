import { useRouter } from 'expo-router';
import { BookOpen, CalendarClock, ListChecks, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui';
import { getChecklistProgress } from '@/domain/selectors';
import { useChecklist, useItinerary, useJournal } from '@/hooks/useTripData';
import { useTheme } from '@/theme';
import type { RoteiroSection } from './TripScaffold';

/**
 * Jornada, Checklist e Diário como módulos do Roteiro (§12–§17).
 *
 * As três tentativas anteriores falharam pelo mesmo motivo de fundo: todas eram
 * uma *fileira horizontal de rótulos com um selecionado*, que é exatamente a
 * forma de `Roteiro · Carteira · Reservas` logo acima. Trocar o preenchimento por
 * sublinhado, e depois por chips, mudou a decoração e não a forma — por isso a
 * tela continuava lendo como duas barras empilhadas.
 *
 * Aqui a forma muda de verdade: deixam de ser rótulos numa linha e passam a ser
 * três cards com ícone e o estado atual de cada área. Um card ocupa área, tem
 * superfície, borda e conteúdo próprio; uma aba é só texto. É essa diferença de
 * *natureza*, e não de cor, que faz o nível primário continuar sendo a única
 * coisa na tela com aparência de barra — e faz estes três lerem como
 * ferramentas que pertencem ao Roteiro.
 *
 * O número em cada card também é conteúdo, não enfeite: mostra quanta coisa
 * existe em cada área antes de o usuário entrar nela.
 */
interface Module {
  value: RoteiroSection;
  label: string;
  icon: LucideIcon;
  detail: string;
}

export function RoteiroModules({ tripId, active }: { tripId: string; active: RoteiroSection }) {
  const theme = useTheme();
  const router = useRouter();

  // Já estão no cache do React Query — as próprias telas do Roteiro as
  // consomem —, então isto não acrescenta rede nenhuma.
  const { data: itinerary } = useItinerary(tripId);
  const { data: checklist } = useChecklist(tripId);
  const { data: journal } = useJournal(tripId);

  const progress = getChecklistProgress(checklist ?? []);

  const modules: Module[] = [
    {
      value: 'itinerary',
      label: 'Jornada',
      icon: CalendarClock,
      detail: countLabel(itinerary?.length, 'atividade', 'atividades'),
    },
    {
      value: 'checklist',
      label: 'Checklist',
      icon: ListChecks,
      // "4 de 8" diz mais que "8 itens": o que importa é quanto já saiu da frente.
      detail: progress.total === 0 ? 'Vazio' : `${progress.completed} de ${progress.total}`,
    },
    {
      value: 'journal',
      label: 'Diário',
      icon: BookOpen,
      detail: countLabel(journal?.length, 'entrada', 'entradas'),
    },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.screen,
        paddingBottom: theme.spacing.lg,
      }}
    >
      {modules.map((module) => (
        <ModuleCard
          key={module.value}
          module={module}
          active={module.value === active}
          onPress={() => {
            if (module.value === active) return;
            router.replace(`/trip/${tripId}/${module.value}`);
          }}
        />
      ))}
    </View>
  );
}

/** `undefined` enquanto carrega — um traço é mais honesto que um zero inventado. */
function countLabel(count: number | undefined, singular: string, plural: string): string {
  if (count === undefined) return '—';
  if (count === 0) return `Nenhuma ${singular}`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function ModuleCard({
  module,
  active,
  onPress,
}: {
  module: Module;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Icon = module.icon;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${module.label}. ${module.detail}.`}
      style={({ pressed }) => ({
        // Os três dividem a largura em partes iguais, então a fileira se ajusta
        // de 320 a 430 sem largura fixa (§25).
        flex: 1,
        minWidth: 0,
        gap: 6,
        padding: theme.spacing.md,
        borderRadius: theme.radius.smallCard,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Icon size={18} color={active ? theme.colors.primary : theme.colors.textTertiary} />

      <AppText
        variant="bodySmall"
        weight="semibold"
        color={active ? 'brand' : 'primary'}
        numberOfLines={1}
      >
        {module.label}
      </AppText>

      {/* Duas linhas: "Nenhuma atividade" não cabe em uma só a 320pt, e quebrar
          em duas é melhor do que reticências que escondem a informação (§25). */}
      <AppText variant="caption" color={active ? 'brand' : 'tertiary'} numberOfLines={2}>
        {module.detail}
      </AppText>
    </Pressable>
  );
}
