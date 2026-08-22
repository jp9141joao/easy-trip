import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

/**
 * Porta de entrada da área administrativa (§20, §23, §24).
 *
 * O guarda vive no layout, e não em cada tela: qualquer rota que venha a
 * existir dentro de `/admin` nos próximos blocos nasce protegida, sem depender
 * de alguém lembrar de repetir a verificação. Uma tela administrativa
 * desprotegida deixa de ser possível por construção.
 *
 * A decisão é tomada *antes* de renderizar qualquer coisa — `Redirect` no lugar
 * de um `useEffect` que navega depois. Essa diferença é o §23 inteiro: um efeito
 * só roda após a primeira pintura, então o painel apareceria por alguns frames
 * para quem não deveria vê-lo. Aqui ele nunca chega a montar.
 *
 * E este guarda é conveniência de navegação, não segurança (§24). Quem impede
 * de fato um usuário comum de alterar conteúdo são as policies de RLS da
 * migration 0003 — elas valem mesmo para quem chamar a API por fora do
 * aplicativo, onde não existe rota nenhuma para guardar.
 */
export default function AdminLayout() {
  const theme = useTheme();
  const { initializing, isAuthenticated, isAdmin } = useAuth();

  // O layout raiz já segura a árvore inteira enquanto a sessão é restaurada, de
  // modo que na prática isto nunca é verdadeiro. Fica como rede: se um dia a
  // ordem de montagem mudar, o pior caso é uma tela de fundo — não o painel
  // aberto para quem não é admin (§14, §23).
  if (initializing) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  // Sem tela de "acesso negado": ela confirmaria a existência do painel para
  // quem não tem acesso e não daria ao usuário nada que ele possa fazer.
  if (!isAdmin) return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
