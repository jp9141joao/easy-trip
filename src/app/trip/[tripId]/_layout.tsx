import { Stack } from 'expo-router';

import { useTheme } from '@/theme';

/**
 * Roteiro, Carteira, Reservas e Sugestões são irmãs dentro da mesma viagem (§33).
 *
 * Duas correções de fluidez moram aqui (§15, §16):
 *
 * 1. `contentStyle` — o container de cada tela não tinha cor de fundo. Com uma
 *    animação de cross-fade, as duas telas ficam parcialmente transparentes ao
 *    mesmo tempo e o que aparece atrás é o container do navegador; sem
 *    background explícito ele revela a janela nativa, que é preta. Era essa a
 *    origem do frame preto ao alternar entre as abas.
 *
 * 2. `animation: 'none'` — as telas de seção desenham exatamente o mesmo
 *    `TripHero`. Qualquer transição cruzada faz a mesma foto piscar contra ela
 *    própria, o que lê como falha de renderização em vez de navegação. Troca de
 *    aba é instantânea por definição, então não há frame intermediário nenhum
 *    para dar errado — e nada de loading artificial para mascarar.
 */
export default function TripLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
