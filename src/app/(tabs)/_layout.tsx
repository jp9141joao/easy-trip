import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import * as Haptics from 'expo-haptics';
import { Compass, Home, Target, UserRoundCheck, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

/**
 * Four primary destinations only (§21). Clima, SOS, mapa, comunidade, lugares
 * and tickets are contextual and reached from where they make sense — putting
 * them here would be exactly the cognitive overload the product fights.
 */
const TABS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: 'index', label: 'Início', icon: Home },
  { name: 'trips', label: 'Viagens', icon: Compass },
  { name: 'goals', label: 'Objetivos', icon: Target },
  { name: 'advisor', label: 'Assessoria', icon: UserRoundCheck },
];

export default function TabsLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingDock {...props} />}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}

// Expo Router re-exports the React Navigation bottom tabs but not their prop
// types, so we read the tab bar signature off the component itself.
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** The floating dock that gives Easy Trip its signature bottom navigation. */
function FloatingDock({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

  // Enquanto o usuário digita, o dock e o teclado disputam a mesma faixa
  // inferior — e trocar de aba não é o que se quer fazer no meio de uma frase.
  // Sair de cena devolve o espaço ao composer e volta assim que o teclado
  // fecha. Como o dock é `position: absolute`, remover não mexe no layout de
  // ninguém: não há salto ao abrir nem ao fechar.
  if (keyboardVisible) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: theme.spacing.screen,
        right: theme.spacing.screen,
        bottom: Math.max(insets.bottom, theme.spacing.md),
      }}
    >
      <View
        style={[
          {
            flexDirection: 'row',
            backgroundColor: theme.colors.surfaceElevated,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
          },
          theme.shadows.lg,
        ]}
      >
        {state.routes.map((route, index) => {
          const tab = TABS.find((item) => item.name === route.name);
          if (!tab) return null;

          const focused = state.index === index;
          const Icon = tab.icon;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (focused || event.defaultPrevented) return;
                void Haptics.selectionAsync().catch(() => undefined);
                navigation.navigate(route.name);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: focused ? theme.colors.primarySoft : 'transparent',
                minHeight: theme.hitTarget,
              }}
            >
              <Icon
                size={20}
                color={focused ? theme.colors.primary : theme.colors.textTertiary}
              />
              <AppText
                variant="label"
                style={{
                  color: focused ? theme.colors.primary : theme.colors.textTertiary,
                  fontSize: 10,
                }}
                numberOfLines={1}
              >
                {tab.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
