import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  Button,
  EmptyState,
  GlassCard,
  SearchInput,
  SegmentedTabs,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { useAdminArticles } from '@/hooks/useAdminContent';
import { normalizeKey } from '@/data/images';
import { formatShortDate } from '@/lib/date';
import { useTheme } from '@/theme';

type StatusFilter = 'all' | 'published' | 'draft';

/**
 * Lista de artigos do painel.
 *
 * Mostra rascunhos, ao contrário da aba Comunidade — é o único lugar do
 * aplicativo onde eles aparecem, e é o que permite ao administrador escrever
 * hoje e publicar depois.
 */
export default function AdminCommunityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: articles, isLoading } = useAdminArticles();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const visible = useMemo(() => {
    const term = normalizeKey(search);
    return (articles ?? []).filter((article) => {
      if (status !== 'all' && article.status !== status) return false;
      if (!term) return true;
      return (
        normalizeKey(article.title).includes(term) ||
        normalizeKey(article.category).includes(term)
      );
    });
  }, [articles, search, status]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Painel de Conteúdo" title="Comunidade" showBack />
      </View>

      <View style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.md }}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar artigo" />
        <SegmentedTabs
          value={status}
          onChange={setStatus}
          items={[
            { value: 'all', label: 'Todos' },
            { value: 'published', label: 'Publicados' },
            { value: 'draft', label: 'Rascunhos' },
          ]}
        />
        <Button
          label="Novo artigo"
          icon={Plus}
          fullWidth
          onPress={() => router.push('/admin/community/new')}
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
              title={search || status !== 'all' ? 'Nada encontrado' : 'Nenhum artigo ainda'}
              message={
                search || status !== 'all'
                  ? 'Ajuste a busca ou o filtro para ver outros artigos.'
                  : 'Crie o primeiro artigo da Comunidade.'
              }
            />
          </GlassCard>
        ) : (
          visible.map((article) => (
            <GlassCard
              key={article.id}
              onPress={() => router.push(`/admin/community/${article.id}`)}
            >
              <View style={{ gap: theme.spacing.sm }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: theme.spacing.sm,
                  }}
                >
                  <AppText variant="bodySmall" weight="semibold" style={{ flex: 1 }} numberOfLines={2}>
                    {article.title}
                  </AppText>
                  <Badge
                    label={article.status === 'published' ? 'Publicado' : 'Rascunho'}
                    tone={article.status === 'published' ? 'success' : 'neutral'}
                  />
                </View>
                <AppText variant="caption" color="secondary">
                  {article.category} · {formatShortDate(article.publishedAt.slice(0, 10))} ·{' '}
                  {article.estimatedReadMinutes} min
                </AppText>
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
