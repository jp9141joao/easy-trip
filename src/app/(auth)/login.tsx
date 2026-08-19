import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useRouter } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/BrandMark';
import {
  AppText,
  Button,
  InlineNotice,
  OfflineBanner,
  PasswordField,
  TextField,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { loginSchema, type LoginInput } from '@/domain/schemas';
import { config } from '@/lib/config';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { AuthError } from '@/repositories';
import { useTheme } from '@/theme';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { isOffline } = useConnectivity();
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      router.replace('/(tabs)');
    } catch (error) {
      // Never a bare "Erro" — say what to check (§25).
      setFormError(
        error instanceof AuthError
          ? error.message
          : 'Não foi possível entrar. Verifique seu e-mail, senha e conexão.',
      );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.screen,
            paddingTop: insets.top + theme.spacing['3xl'],
            paddingBottom: insets.bottom + theme.spacing['3xl'],
            gap: theme.spacing.xl,
          }}
        >
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <BrandMark size="lg" />
            <AppText variant="body" color="secondary" align="center">
              Sua viagem inteira organizada em um só lugar.
            </AppText>
          </View>

          {isOffline ? (
            <OfflineBanner message="Você está offline. Conecte-se para entrar na sua conta." />
          ) : null}

          {config.mode === 'demo' ? (
            <InlineNotice icon={Info}>
              Modo demonstração: sua conta e seus dados ficam salvos apenas neste dispositivo.
              Configure o Supabase para habilitar contas na nuvem.
            </InlineNotice>
          ) : null}

          <View style={{ gap: theme.spacing.lg }}>
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <TextField
                  label="E-mail"
                  placeholder="voce@email.com"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  required
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <PasswordField
                  label="Senha"
                  placeholder="Sua senha"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  autoComplete="current-password"
                  textContentType="password"
                  onSubmitEditing={handleSubmit(onSubmit)}
                  returnKeyType="go"
                  required
                />
              )}
            />

            <Link href="/(auth)/forgot-password" asChild>
              <AppText
                variant="bodySmall"
                color="brand"
                align="right"
                accessibilityRole="link"
                accessibilityHint="Abre a recuperação de senha"
              >
                Esqueci minha senha
              </AppText>
            </Link>
          </View>

          {formError ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                backgroundColor: theme.colors.errorSoft,
                borderRadius: theme.radius.smallCard,
                padding: theme.spacing.lg,
              }}
            >
              <AppText variant="bodySmall" color="error">
                {formError}
              </AppText>
            </View>
          ) : null}

          <View style={{ gap: theme.spacing.md }}>
            <Button
              label="Entrar"
              size="lg"
              fullWidth
              loading={formState.isSubmitting}
              onPress={handleSubmit(onSubmit)}
            />
            <Button
              label="Criar conta"
              variant="secondary"
              size="lg"
              fullWidth
              disabled={formState.isSubmitting}
              onPress={() => router.push('/(auth)/register')}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
