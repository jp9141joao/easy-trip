import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Heart, Share2 } from 'lucide-react-native';
import { Share, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/Markdown';
import {
  AppImage,
  AppText,
  Badge,
  Button,
  ErrorState,
  GlassCard,
  IconButton,
  SkeletonCard,
  useToast,
} from '@/components/ui';
import { useArticle, useArticleLikes } from '@/hooks/useContent';
import { formatLongDate, toISODate } from '@/lib/date';
import { useTheme } from '@/theme';

export default function ArticleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { articleId } = useLocalSearchParams<{ articleId: string }>();

  const { data: article, isLoading, isError, refetch } = useArticle(articleId);
  const { isLiked, toggle } = useArticleLikes();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        <SkeletonCard lines={6} height={320} />
      </View>
    );
  }

  if (isError || !article) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        <GlassCard>
          <ErrorState
            title="Artigo não encontrado"
            message="Este artigo pode ter sido removido."
            onRetry={() => (isError ? void refetch() : router.replace('/community'))}
            retryLabel={isError ? 'Tentar novamente' : 'Ver comunidade'}
          />
        </GlassCard>
      </View>
    );
  }

  const liked = isLiked(article.id);

  /** Native share sheet (§58). */
  const share = async () => {
    try {
      await Share.share({
        title: article.title,
        message: `${article.title} — via Easy Trip\n\n${article.content.slice(0, 180)}…`,
      });
    } catch {
      toast.error('Não foi possível compartilhar agora.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing['4xl'] }}
      >
        <View>
          <AppImage
            uri={article.imageUrl}
            style={{ height: 260 + insets.top, width: '100%' }}
            fallbackLabel={article.title}
            overlay
          />

          <View
            style={{
              position: 'absolute',
              top: insets.top + theme.spacing.sm,
              left: theme.spacing.screen,
              right: theme.spacing.screen,
              flexDirection: 'row',
              justifyContent: 'space-between',
            }}
          >
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel="Voltar"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/community'))}
              background="glass"
              color={theme.colors.textOnImage}
            />
            <IconButton
              icon={Share2}
              accessibilityLabel="Compartilhar artigo"
              onPress={() => void share()}
              background="glass"
              color={theme.colors.textOnImage}
            />
          </View>

          <View
            style={{
              position: 'absolute',
              left: theme.spacing.screen,
              right: theme.spacing.screen,
              bottom: theme.spacing.xl,
              gap: theme.spacing.sm,
            }}
          >
            <Badge label={article.category} tone="accent" />
            <AppText variant="h1" color="onImage" weight="bold">
              {article.title}
            </AppText>
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: theme.spacing.screen,
            paddingTop: theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodySmall" weight="semibold">
                {article.authorName}
              </AppText>
              <AppText variant="caption" color="tertiary">
                {formatLongDate(toISODate(new Date(article.publishedAt)))} ·{' '}
                {article.estimatedReadMinutes} min de leitura
              </AppText>
            </View>

            <IconButton
              icon={Heart}
              accessibilityLabel={liked ? 'Remover curtida' : 'Curtir artigo'}
              onPress={() => toggle.mutate({ articleId: article.id, liked: !liked })}
              background="surface"
              color={liked ? theme.colors.accent : theme.colors.textSecondary}
              style={theme.shadows.sm}
            />
          </View>

          <Markdown content={article.content} />

          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Button
              label={liked ? 'Curtido' : 'Curtir'}
              icon={Heart}
              variant={liked ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
              onPress={() => toggle.mutate({ articleId: article.id, liked: !liked })}
              haptic
            />
            <Button
              label="Compartilhar"
              icon={Share2}
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => void share()}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
