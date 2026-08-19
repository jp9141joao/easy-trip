import { useRouter } from 'expo-router';
import { Newspaper } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/cards';
import {
  AppHeader,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  GlassCard,
  SearchInput,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { normalizeKey } from '@/data/images';
import { useArticleLikes, useArticles } from '@/hooks/useContent';
import { useTheme } from '@/theme';

export default function CommunityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: articles = [], isLoading, isError, refetch } = useArticles();
  const { isLiked } = useArticleLikes();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(articles.map((article) => article.category)))],
    [articles],
  );

  const visible = useMemo(() => {
    const term = normalizeKey(search);
    return articles.filter((article) => {
      if (category !== 'all' && article.category !== category) return false;
      if (!term) return true;
      return (
        normalizeKey(article.title).includes(term) ||
        normalizeKey(article.authorName).includes(term) ||
        normalizeKey(article.category).includes(term)
      );
    });
  }, [articles, category, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Comunidade"
          title="Guias e histórias"
          subtitle="Conteúdo editorial do time Easy Trip"
          showBack
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(article) => article.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
        }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.lg, marginBottom: theme.spacing.lg }}>
            <SearchInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar artigo"
              accessibilityLabel="Buscar artigo"
            />
            <View
              style={{ marginHorizontal: -theme.spacing.screen, paddingLeft: theme.spacing.screen }}
            >
              <ChipRow>
                {categories.map((item) => (
                  <Chip
                    key={item}
                    label={item === 'all' ? 'Todos' : item}
                    selected={category === item}
                    onPress={() => setCategory(item)}
                  />
                ))}
              </ChipRow>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ArticleCard
            article={item}
            liked={isLiked(item.id)}
            onPress={() => router.push(`/community/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : isError ? (
            <GlassCard>
              <ErrorState
                message="Não foi possível carregar os artigos. Verifique sua conexão."
                onRetry={() => void refetch()}
              />
            </GlassCard>
          ) : (
            <GlassCard>
              <EmptyState
                icon={Newspaper}
                title="Nenhum artigo encontrado"
                message="Ajuste a busca ou escolha outra categoria."
                compact
              />
            </GlassCard>
          )
        }
      />
    </View>
  );
}
