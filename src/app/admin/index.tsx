import { useRouter, type Href } from 'expo-router';
import {
  BookOpen,
  Building2,
  ChevronRight,
  Tag,
  UserCog,
  type LucideIcon,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, AppText, Badge, GlassCard, SectionHeader } from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

/**
 * Painel de Conteúdo (§21, §22, §50).
 *
 * Os quatro módulos existem desde a F9: `Em Alta` e `Especialistas` eram
 * cartões "Em breve" — a decisão D-06 já dizia que teriam CRUD administrativo,
 * e a `0004` já tinha posto `status`/`sort_order` e `active` no banco; faltava
 * só a interface. O suporte a "Em breve" continua no componente, para o caso
 * de um módulo novo nascer antes da tela: um cartão que abre uma tela vazia é
 * o botão placebo que o §22 proíbe.
 *
 * `Em Alta` e `Especialistas` continuam **sem** preenchimento por IA (§48,
 * §49): são preço, desconto, disponibilidade e dados de pessoas reais —
 * exatamente o que não se pede a um modelo para adivinhar.
 */
interface Module {
  label: string;
  description: string;
  icon: LucideIcon;
  href?: Href;
  note?: string;
}

const MODULES: Module[] = [
  {
    label: 'Comunidade',
    description: 'Artigos e guias publicados na aba Comunidade.',
    icon: BookOpen,
    href: '/admin/community',
    note: 'Preenchimento com IA disponível',
  },
  {
    label: 'Restaurantes e Hotéis',
    description: 'Locais recomendados, cadastrados manualmente.',
    icon: Building2,
    href: '/admin/places',
    note: 'Preenchimento com IA disponível',
  },
  {
    label: 'Em Alta',
    description: 'Ofertas e destaques exibidos na Home.',
    icon: Tag,
    href: '/admin/offers',
    note: 'Cadastro manual, sem IA',
  },
  {
    label: 'Especialistas',
    description: 'Consultores disponíveis na Assessoria.',
    icon: UserCog,
    href: '/admin/advisors',
    note: 'Cadastro manual, sem IA',
  },
];

export default function AdminPanelScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Administração" title="Painel de Conteúdo" showBack />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.xl,
        }}
      >
        <GlassCard>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="bodySmall" color="secondary">
              Você está autenticado como administrador
              {profile?.name ? ` (${profile.name})` : ''}. Daqui você gerencia o conteúdo exibido
              para todos os usuários do Easy Trip.
            </AppText>
          </View>
        </GlassCard>

        <View>
          <SectionHeader title="Módulos" />
          <View style={{ gap: theme.spacing.md }}>
            {MODULES.map((module) => (
              <ModuleCard key={module.label} module={module} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Um módulo em construção é um `View`, não um `Pressable`.
 *
 * A diferença também chega a quem usa leitor de tela: sem `accessibilityRole`
 * de botão, o cartão não é anunciado como acionável. "Não dá para tocar" é a
 * mesma informação pelos dois caminhos.
 */
function ModuleCard({ module }: { module: Module }) {
  const theme = useTheme();
  const router = useRouter();
  const Icon = module.icon;
  const available = Boolean(module.href);

  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.smallCard,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: available ? theme.colors.primarySoft : theme.colors.surfaceMuted,
          borderWidth: 1,
          borderColor: available ? theme.colors.primary : theme.colors.border,
        }}
      >
        <Icon size={18} color={available ? theme.colors.primary : theme.colors.textSecondary} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodySmall" weight="semibold">
          {module.label}
        </AppText>
        <AppText variant="caption" color="secondary">
          {module.description}
        </AppText>
        {module.note ? (
          <AppText variant="caption" color="tertiary">
            {module.note}
          </AppText>
        ) : null}
      </View>

      {available ? (
        <ChevronRight size={18} color={theme.colors.textTertiary} />
      ) : (
        <Badge label="Em breve" tone="neutral" />
      )}
    </View>
  );

  if (!available) return <GlassCard>{content}</GlassCard>;

  return (
    <GlassCard
      onPress={() => router.push(module.href!)}
      accessibilityLabel={module.label}
      accessibilityHint={module.description}
    >
      {content}
    </GlassCard>
  );
}
