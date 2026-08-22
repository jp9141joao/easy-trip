import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Avatar,
  Badge,
  Button,
  EmptyState,
  GlassCard,
  SearchInput,
  SegmentedTabs,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { normalizeKey } from '@/data/images';
import { useAdminAdvisors } from '@/hooks/useAdminContent';
import { ADVISOR_STATUS_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

type ActiveFilter = 'all' | 'active' | 'inactive';

/**
 * Lista de especialistas do painel (F9 — o outro lado da D-06).
 *
 * Inclui os inativos, que é justamente o que o diretório público esconde. A
 * diferença entre `active` e `status` aparece nos dois selos: quem está
 * `inativo` saiu do time e não aparece para ninguém; quem está `offline`
 * continua no diretório, apenas não atende agora.
 */
export default function AdminAdvisorsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: advisors, isLoading } = useAdminAdvisors();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');

  const visible = useMemo(() => {
    const term = normalizeKey(search);
    return (advisors ?? []).filter((advisor) => {
      if (active === 'active' && !advisor.active) return false;
      if (active === 'inactive' && advisor.active) return false;
      if (!term) return true;
      return (
        normalizeKey(advisor.name).includes(term) || normalizeKey(advisor.specialty).includes(term)
      );
    });
  }, [advisors, search, active]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Painel de Conteúdo" title="Especialistas" showBack />
      </View>

      <View style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.md }}>
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nome ou especialidade"
        />
        <SegmentedTabs
          value={active}
          onChange={setActive}
          items={[
            { value: 'all', label: 'Todos' },
            { value: 'active', label: 'No time' },
            { value: 'inactive', label: 'Inativos' },
          ]}
        />
        <Button
          label="Novo especialista"
          icon={Plus}
          fullWidth
          onPress={() => router.push('/admin/advisors/new')}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.md,
        }}
      >
        {isLoading ? (
          <SkeletonList count={4} />
        ) : visible.length === 0 ? (
          <GlassCard>
            <EmptyState
              title={search || active !== 'all' ? 'Nada encontrado' : 'Nenhum especialista ainda'}
              message={
                search || active !== 'all'
                  ? 'Ajuste a busca ou o filtro para ver outros cadastros.'
                  : 'Cadastre o primeiro especialista da Assessoria.'
              }
            />
          </GlassCard>
        ) : (
          visible.map((advisor) => (
            <GlassCard
              key={advisor.id}
              onPress={() => router.push(`/admin/advisors/${advisor.id}`)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={advisor.name} uri={advisor.avatarUrl} size={44} />

                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodySmall" weight="semibold" numberOfLines={1}>
                    {advisor.name}
                  </AppText>
                  <AppText variant="caption" color="secondary" numberOfLines={1}>
                    {advisor.specialty} · {ADVISOR_STATUS_LABEL[advisor.status]}
                  </AppText>
                </View>

                <Badge
                  label={advisor.active ? 'No time' : 'Inativo'}
                  tone={advisor.active ? 'success' : 'neutral'}
                />
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
