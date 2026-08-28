import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  Check,
  ChevronRight,
  Database,
  FileText,
  Info,
  LayoutDashboard,
  Bell,
  LogOut,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  Button,
  ConfirmDialog,
  GlassCard,
  InfoRow,
  InlineNotice,
  SectionHeader,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { traceAuth } from '@/lib/authTrace';
import { config, configIssues } from '@/lib/config';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { AccountDeletionBlockedError } from '@/repositories/auth';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { dataSource } from '@/repositories';
import { EMERGENCY_COVERAGE } from '@/services/emergency';
import { aiService } from '@/services/ai';
import { useTheme, useThemePreference, type ThemeMode } from '@/theme';

/**
 * Settings, including the LGPD obligations (§94): account deletion, data
 * deletion and transparency about what the app stores and where.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user, isAdmin, signOut, deleteAccount } = useAuth();
  const { status } = useConnectivity();
  const { mode, setMode } = useThemePreference();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A recusa por propriedade vira uma tela própria, não um toast. Um toast
  // some em segundos, e esta é uma condição que a pessoa precisa LER para
  // saber o que fazer — quais viagens travam, e que o caminho é transferir.
  const [blocked, setBlocked] = useState<AccountDeletionBlockedError | null>(null);

  // A proteção de rotas continua sendo a autoridade. O logout explícito usa
  // também um `replace` depois da invalidação comprovada, apenas como rede de
  // segurança para a reconciliação do Expo Router no Android. Uma sessão que
  // cai sozinha continua saindo exclusivamente pelo guarda da raiz.
  const handleSignOut = async () => {
    // Sair encosta na rede. Sem estado de espera, o toque parecia não ter feito
    // nada — e um segundo toque disparava uma segunda saída por cima da
    // primeira. O `disabled` do botão vem do `loading` do próprio diálogo.
    if (signingOut) return;
    traceAuth('SIGNOUT_CLICK');
    setSigningOut(true);
    try {
      await signOut();
      // A sessão já foi comprovadamente removida e o provider já publicou
      // `session=null`. O replace é uma rede de segurança para a reconciliação
      // do Expo Router em Android; ele nunca é usado para fingir um logout.
      try {
        router.replace('/(auth)/login');
      } catch {
        // O guarda do stack continua sendo a autoridade. Se a rota ainda
        // estiver reconciliando, uma falha do fallback não transforma um
        // logout já concluído em falso erro.
      }
      // Só fecha o diálogo depois do sucesso: fechá-lo antes anunciaria uma
      // saída que ainda podia falhar.
      setConfirmSignOut(false);
    } catch {
      // Nada foi limpo e a sessão continua de pé — a mensagem tem de dizer
      // isso, não um "saiu" que não aconteceu (§8).
      toast.error('Não foi possível sair da conta. Tente novamente.');
    } finally {
      setSigningOut(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // A exclusão de verdade é a Edge Function `delete-account`: ela apaga os
      // arquivos, confere que sobrou zero e só então remove a conta (P-02).
      // Daqui só sai o pedido, autenticado pelo próprio JWT — o identificador
      // não é enviado e não poderia ser trocado.
      await deleteAccount();
      toast.success('Conta e dados excluídos');
    } catch (error) {
      // Recusa por propriedade NÃO é falha (§50). Dizer "tente novamente" aqui
      // seria mentira: tentar de novo dá o mesmo resultado até a pessoa
      // transferir a viagem ou encerrar a colaboração.
      if (error instanceof AccountDeletionBlockedError) {
        setBlocked(error);
      } else {
        toast.error('Não foi possível excluir a conta. Tente novamente.');
      }
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Perfil" title="Configurações" showBack />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.xl,
        }}
      >
        {/* ---------------------------- App status --------------------------- */}
        <View>
          <SectionHeader title="Estado do aplicativo" />
          <GlassCard>
            <View style={{ gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  {status === 'offline' ? (
                    <WifiOff size={16} color={theme.colors.warning} />
                  ) : (
                    <Wifi size={16} color={theme.colors.success} />
                  )}
                  <AppText variant="bodySmall">Conexão</AppText>
                </View>
                <Badge
                  label={
                    status === 'online'
                      ? 'Online'
                      : status === 'offline'
                        ? 'Offline'
                        : 'Reconectando'
                  }
                  tone={status === 'online' ? 'success' : status === 'offline' ? 'warning' : 'brand'}
                />
              </View>

              <InfoRow
                icon={Database}
                label="Armazenamento"
                value={
                  dataSource.kind === 'supabase'
                    ? 'Supabase (nuvem, com RLS)'
                    : 'Local no dispositivo'
                }
              />
              <InfoRow
                icon={ShieldCheck}
                label="Assistente de IA"
                value={aiService.kind === 'gemini' ? 'Gemini via BFF' : 'Geração local (demonstração)'}
              />
              <InfoRow
                icon={Info}
                label="Contatos de emergência"
                value={`${EMERGENCY_COVERAGE} países cobertos`}
              />
            </View>
          </GlassCard>
        </View>

        {/* ---------------------------- Appearance --------------------------- */}
        <View>
          <SectionHeader title="Aparência" />
          <GlassCard>
            <View style={{ gap: theme.spacing.xs }}>
              {APPEARANCE_OPTIONS.map((option) => (
                <AppearanceRow
                  key={option.mode}
                  option={option}
                  selected={mode === option.mode}
                  onSelect={() => setMode(option.mode)}
                />
              ))}
            </View>
          </GlassCard>
        </View>

        {/* ---------------------------- Notificações ------------------------- */}
        {/*
          O pedido de permissão mora AQUI, e não na abertura do aplicativo.

          Um diálogo do sistema na primeira tela, antes de a pessoa saber o que
          o Easy Trip faz, é recusado por reflexo — e o sistema operacional não
          pergunta de novo. Perguntar no lugar errado gasta a única chance.
        */}
        <View>
          <SectionHeader title="Avisos" />
          <GlassCard>
            <PushRow />
          </GlassCard>
        </View>

        {/* --------------------------- Administration ------------------------ */}
        {/*
          Só existe para quem é admin (§17, §18). Para conta comum a seção não é
          renderizada — nada de item desabilitado ou "Bloqueado", que só
          anunciaria a existência de algo inalcançável.
        */}
        {isAdmin ? (
          <View>
            <SectionHeader title="Administração" />
            <GlassCard padded={false}>
              <AdminEntryRow onPress={() => router.push('/admin')} />
            </GlassCard>
          </View>
        ) : null}

        {config.mode === 'demo' ? (
          <InlineNotice icon={Info} tone="warning">
            O aplicativo está em modo demonstração: sua conta e seus dados ficam somente neste
            dispositivo, e nenhuma sincronização remota acontece. Configure
            EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY para usar o backend.
          </InlineNotice>
        ) : null}

        {/*
          Configuração pela metade tem sintoma idêntico ao de configuração
          ausente — o aplicativo simplesmente fica local. Sem esta linha, quem
          colou a chave errada descobriria o problema só ao notar que nada
          sincroniza (§18 da F10).
        */}
        {configIssues.map((issue) => (
          <InlineNotice key={issue} icon={Info} tone="error">
            {issue}
          </InlineNotice>
        ))}

        {/* ------------------------------ Privacy ---------------------------- */}
        <View>
          <SectionHeader title="Privacidade e dados" />
          <GlassCard>
            <View style={{ gap: theme.spacing.md }}>
              <AppText variant="bodySmall" color="secondary">
                O Easy Trip guarda apenas o necessário para organizar suas viagens: perfil, viagens,
                roteiro, checklist, despesas, documentos e diário. Não vendemos nem compartilhamos
                seus dados.
              </AppText>

              <Button
                label="Política de privacidade"
                icon={FileText}
                variant="secondary"
                fullWidth
                onPress={() =>
                  void WebBrowser.openBrowserAsync(
                    'https://www.gov.br/anpd/pt-br/assuntos/protecao-de-dados-pessoais',
                  )
                }
              />
            </View>
          </GlassCard>
        </View>

        {/* ------------------------------ Account ---------------------------- */}
        <View>
          <SectionHeader title="Conta" />
          <GlassCard>
            <View style={{ gap: theme.spacing.md }}>
              <InfoRow label="E-mail" value={user?.email ?? '—'} />

              <Button
                label="Sair da conta"
                icon={LogOut}
                variant="secondary"
                fullWidth
                onPress={() => setConfirmSignOut(true)}
              />

              <Button
                label="Excluir conta"
                icon={Trash2}
                variant="danger"
                fullWidth
                onPress={() => setConfirmDelete(true)}
              />
            </View>
          </GlassCard>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmSignOut}
        title="Sair da conta?"
        message="Seus dados continuam salvos. Você precisará entrar novamente para acessá-los."
        confirmLabel="Sair"
        loading={signingOut}
        onConfirm={() => void handleSignOut()}
        onCancel={() => (signingOut ? undefined : setConfirmSignOut(false))}
      />

      {/*
        O que impede a exclusão, e o que fazer a respeito.

        Um único botão, e ele NÃO é "excluir mesmo assim": essa opção não
        existe, porque o que ela apagaria é conteúdo de outras pessoas. O que a
        tela oferece é o caminho real — abrir a viagem e transferi-la.
      */}
      <ConfirmDialog
        visible={Boolean(blocked)}
        title="Sua conta ainda não pode ser excluída"
        message={
          blocked
            ? `${blocked.message}\n\nSuas viagens e seus dados continuam intactos — nada foi apagado.`
            : ''
        }
        confirmLabel="Ver viagens"
        cancelLabel="Agora não"
        onConfirm={() => {
          setBlocked(null);
          router.push('/(tabs)/trips');
        }}
        onCancel={() => setBlocked(null)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title="Excluir sua conta?"
        message="Todas as suas viagens, roteiros, despesas, documentos, diário e metas serão apagados permanentemente. Essa ação não poderá ser desfeita."
        confirmLabel="Excluir tudo"
        destructive
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

/* ----------------------------- Notificações ------------------------------- */

/**
 * Ligar ou desligar os avisos fora do aplicativo (§33).
 *
 * Quatro estados, e cada um diz uma coisa diferente:
 *
 *   indisponível  não há como receber neste ambiente (emulador, navegador).
 *                 A linha explica em vez de oferecer um controle inerte.
 *   bloqueado     a pessoa recusou, e o sistema não pergunta de novo. O texto
 *                 aponta os ajustes do aparelho — que é onde a decisão vive.
 *   ligado        recebendo. O botão desliga.
 *   desligado     o botão pede a permissão e registra o aparelho.
 *
 * O que a linha NÃO faz é prometer: enquanto o aparelho não estiver registrado,
 * ela não diz que os avisos chegam.
 */
function PushRow() {
  const theme = useTheme();
  const toast = useToast();
  const { permission, enabled, blocked, unavailable, enable, disable } = usePushNotifications();
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    try {
      if (enabled) {
        await disable();
        toast.success('Avisos desligados neste aparelho');
      } else {
        const ok = await enable();
        if (ok) toast.success('Avisos ligados neste aparelho');
        else if (permission === 'denied') {
          toast.error('Permissão recusada. Ative nos ajustes do aparelho.');
        } else {
          // Falha silenciosa do registro: backend sem a 0016, ou sem rede. Os
          // avisos continuam existindo na Central — a mensagem diz isso.
          toast.error('Não foi possível ligar os avisos agora. Eles continuam na Central.');
        }
      }
    } finally {
      setPending(false);
    }
  };

  if (unavailable) {
    return (
      <View style={{ gap: theme.spacing.xs, paddingVertical: theme.spacing.sm }}>
        <AppText variant="body" weight="semibold">
          Avisos fora do aplicativo
        </AppText>
        <AppText variant="caption" color="secondary">
          Este ambiente não recebe notificações do sistema. Os avisos da viagem continuam
          na Central, dentro do aplicativo.
        </AppText>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="body" weight="semibold">
          Avisos fora do aplicativo
        </AppText>
        <AppText variant="caption" color="secondary">
          {blocked
            ? 'Você recusou as notificações. Para receber, ative o Easy Trip nos ajustes de notificação do aparelho.'
            : enabled
              ? 'Este aparelho recebe avisos de convites, lembretes e do resumo diário da viagem.'
              : 'Receba convites, lembretes e o resumo diário sem precisar abrir o aplicativo. Nenhum valor em dinheiro nem trecho de diário aparece na tela de bloqueio.'}
        </AppText>
      </View>

      {blocked ? null : (
        <Button
          label={enabled ? 'Desligar avisos' : 'Ligar avisos'}
          icon={Bell}
          variant={enabled ? 'ghost' : 'secondary'}
          size="sm"
          loading={pending}
          onPress={() => void handle()}
        />
      )}
    </View>
  );
}

/* ----------------------------- Administration ----------------------------- */

/**
 * Entrada para o Painel de Conteúdo.
 *
 * Discreta de propósito: mesma linha, mesmo alvo de toque e mesma tipografia do
 * restante das Configurações. Ser administrador é uma atribuição da conta, não
 * um recurso a ser promovido dentro do aplicativo (§17, §25).
 */
function AdminEntryRow({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Painel de Conteúdo"
      accessibilityHint="Gerencie os conteúdos do Easy Trip"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.xl,
        minHeight: theme.hitTarget,
        borderRadius: theme.radius.card,
        backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
      })}
    >
      <LayoutDashboard size={18} color={theme.colors.primary} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodySmall" weight="semibold">
          Painel de Conteúdo
        </AppText>
        <AppText variant="caption" color="secondary">
          Gerencie os conteúdos do Easy Trip
        </AppText>
      </View>
      <ChevronRight size={18} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

/* ------------------------------- Appearance ------------------------------- */

interface AppearanceOption {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: LucideIcon;
}

const APPEARANCE_OPTIONS: AppearanceOption[] = [
  { mode: 'light', label: 'Claro', description: 'Sempre no tema claro', icon: Sun },
  { mode: 'dark', label: 'Escuro', description: 'Sempre no tema escuro', icon: Moon },
  {
    mode: 'system',
    label: 'Sistema',
    description: 'Acompanha o ajuste do aparelho',
    icon: Smartphone,
  },
];

/**
 * Linhas de rádio em vez de um segmented control: cada opção precisa caber uma
 * descrição curta ("Acompanha o ajuste do aparelho"), que é o que torna
 * `Sistema` compreensível sem o usuário ter de testar.
 */
function AppearanceRow({
  option,
  selected,
  onSelect,
}: {
  option: AppearanceOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const Icon = option.icon;

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={option.label}
      accessibilityHint={option.description}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        borderRadius: theme.radius.smallCard,
        minHeight: theme.hitTarget,
        backgroundColor: selected
          ? theme.colors.primarySoft
          : pressed
            ? theme.colors.surfaceMuted
            : 'transparent',
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : 'transparent',
      })}
    >
      <Icon size={18} color={selected ? theme.colors.primary : theme.colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodySmall" weight={selected ? 'semibold' : 'regular'}>
          {option.label}
        </AppText>
        <AppText variant="caption" color="secondary">
          {option.description}
        </AppText>
      </View>
      {selected ? <Check size={18} color={theme.colors.primary} /> : null}
    </Pressable>
  );
}
