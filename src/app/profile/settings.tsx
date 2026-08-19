import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  Database,
  FileText,
  Info,
  LogOut,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
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
import { config } from '@/lib/config';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { dataSource } from '@/repositories';
import { EMERGENCY_COVERAGE } from '@/services/emergency';
import { aiService } from '@/services/ai';
import { useTheme } from '@/theme';

/**
 * Settings, including the LGPD obligations (§94): account deletion, data
 * deletion and transparency about what the app stores and where.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user, signOut, deleteAccount } = useAuth();
  const { status } = useConnectivity();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/(auth)/login');
    } catch {
      toast.error('Não foi possível sair agora.');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success('Conta e dados excluídos');
      router.replace('/(auth)/login');
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

        {config.mode === 'demo' ? (
          <InlineNotice icon={Info} tone="warning">
            O aplicativo está em modo demonstração: sua conta e seus dados ficam somente neste
            dispositivo, e nenhuma sincronização remota acontece. Configure
            EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY para usar o backend.
          </InlineNotice>
        ) : null}

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
