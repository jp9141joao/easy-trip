import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Compass, PiggyBank, Sparkles } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { FlatList, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { prefsStorage } from '@/lib/storage';
import { useTheme } from '@/theme';
import { ONBOARDING_KEY } from './index';

/** Three short screens, no more (§24). */
const SLIDES = [
  {
    icon: Compass,
    title: 'Tudo da sua viagem em um só lugar',
    description:
      'Roteiro, checklist, documentos e diário deixam de ficar espalhados entre notas, e-mails e planilhas.',
  },
  {
    icon: PiggyBank,
    title: 'Acompanhe roteiro e orçamento',
    description:
      'Cada gasto entra na viagem certa e o saldo se atualiza sozinho. Sem planilha paralela.',
  },
  {
    icon: Sparkles,
    title: 'Receba ajuda no contexto',
    description:
      'Clima do destino, fuso horário, contatos de emergência e um assistente que conhece a sua viagem.',
  },
] as const;

export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.index;
    if (typeof first === 'number') setIndex(first);
  }, []);

  const finish = async () => {
    await prefsStorage.set(ONBOARDING_KEY, true);
    router.replace('/(auth)/login');
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ flex: 1, paddingTop: insets.top }}>
        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(item) => item.title}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item }) => (
            <View
              style={{
                width,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: theme.spacing['3xl'],
                gap: theme.spacing.xl,
              }}
            >
              <LinearGradient
                colors={[theme.colors.primary, theme.colors.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: theme.radius.heroCard,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <item.icon size={40} color="#FFFFFF" />
              </LinearGradient>

              <AppText variant="h1" align="center">
                {item.title}
              </AppText>
              <AppText variant="body" color="secondary" align="center">
                {item.description}
              </AppText>
            </View>
          )}
        />

        <View
          style={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: insets.bottom + theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.sm }}>
            {SLIDES.map((slide, slideIndex) => (
              <View
                key={slide.title}
                style={{
                  width: slideIndex === index ? 22 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    slideIndex === index ? theme.colors.primary : theme.colors.borderStrong,
                }}
              />
            ))}
          </View>

          <Button
            label={isLast ? 'Começar' : 'Continuar'}
            fullWidth
            size="lg"
            onPress={() => {
              if (isLast) return void finish();
              listRef.current?.scrollToIndex({ index: index + 1, animated: true });
            }}
          />

          {!isLast ? (
            <Button label="Pular" variant="ghost" fullWidth onPress={() => void finish()} />
          ) : null}
        </View>
      </View>
    </View>
  );
}
