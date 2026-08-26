import { Redirect, Tabs } from 'expo-router';
import { useRef, type ComponentProps } from 'react';
import * as Haptics from 'expo-haptics';
import { Compass, Home, Target, UserRoundCheck, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DockMetricsProvider,
  dockBottomOffset,
  useReportDockTop,
} from '@/components/navigation/DockMetrics';
import { AppText } from '@/components/ui';
import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

/**
 * Four primary destinations only (§21). Clima, SOS, mapa, comunidade, lugares
 * and reservations are contextual and reached from where they make sense — putting
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

  /*
    O provider envolve as abas para que uma tela consiga perguntar quanto
    espaço o dock ocupa DE VERDADE — altura medida mais o deslocamento da área
    segura —, em vez de reservar um número fixo que só acerta num aparelho. É o
    que corrige o vão entre o composer da IA e a navbar (§7, §8 do handoff).
  */
  return (
    <DockMetricsProvider>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <FloatingDock {...props} />}
      >
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
        ))}
      </Tabs>
    </DockMetricsProvider>
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
  const reportDockTop = useReportDockTop();
  const barRef = useRef<View>(null);

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
        // A mesma expressão que `dockBottomOffset` devolve a quem precisa
        // calcular a folga. Importada, e não repetida: duas cópias divergem na
        // primeira vez que uma delas mudar.
        bottom: dockBottomOffset(insets, theme),
      }}
    >
      <View
        ref={barRef}
        testID="floating-dock-bar"
        collapsable={false}
        /*
          Publica o TOPO da barra em coordenadas da janela — não a altura dela.

          A diferença é a correção do vão: com a altura, quem consome precisa
          supor onde a tela termina para saber se há sobreposição, e foi essa
          suposição que errou duas vezes. Com a posição, a sobreposição é uma
          subtração entre dois números medidos.
        */
        onLayout={(event) => {
          const localY = event.nativeEvent.layout.y;
          const node = barRef.current;
          if (!node?.measureInWindow) {
            reportDockTop(localY);
            return;
          }
          // Vale desde já; `measureInWindow` refina quando responder.
          reportDockTop(localY);
          node.measureInWindow((_x, y, _w, height) => {
            // 0×0 é "ainda não posicionado", não "está no topo da janela".
            if (!Number.isFinite(y) || (y === 0 && height === 0)) return;
            reportDockTop(y);
          });
        }}
        style={[
          {
            flexDirection: 'row',
            // Papel próprio: no claro a navbar era branca sobre quase branco
            // e lia como um retângulo solto. Agora a superfície e a borda da
            // navegação são tokens dedicados (§4). No escuro os dois valores
            // são exatamente `surfaceElevated` e `border`, então nada muda.
            backgroundColor: theme.colors.navigation,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.navigationBorder,
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
                backgroundColor: focused ? theme.colors.navigationActive : 'transparent',
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
