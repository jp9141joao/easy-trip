import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  Check,
  ChevronRight,
  Database,
  FileText,
  Info,
  LayoutDashboard,
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
import { config, configIssues } from '@/lib/config';
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Nenhum dos dois navega à mão. Ao cair a sessão, as rotas privadas saem do
  // navegador (`app/_layout.tsx`) e a volta ao login é consequência disso —
  // inclusive quando a sessão cai sozinha, por token revogado, caso em que não
  // existiria nenhum `handle*` para chamar `replace`.
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      toast.error('Não foi possível sair agora.');
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
    } catch {
      toast.error('Não foi possível excluir a conta. Tente novamente.');
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
        onConfirm={() => void handleSignOut()}
        onCancel={() => setConfirmSignOut(false)}
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
