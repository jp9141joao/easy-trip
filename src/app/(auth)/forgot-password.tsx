import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, AppText, Button, InlineNotice, TextField } from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/domain/schemas';
import { useAuth } from '@/providers/AuthProvider';
import { AuthError } from '@/repositories';
import { useTheme } from '@/theme';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { requestPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordInput) => {
    setFormError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (error) {
      // In local mode there is no mail server, and the adapter says so rather
      // than claiming an e-mail went out (§8).
      setFormError(
        error instanceof AuthError
          ? error.message
          : 'Não foi possível enviar agora. Verifique sua conexão e tente novamente.',
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
        <View style={{ paddingHorizontal: theme.spacing.screen }}>
          <AppHeader showBack />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: insets.bottom + theme.spacing['3xl'],
            gap: theme.spacing.xl,
          }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="h1">Recuperar senha</AppText>
            <AppText variant="bodySmall" color="secondary">
              Informe o e-mail da sua conta e enviaremos as instruções para redefinir a senha.
            </AppText>
          </View>

          {sent ? (
            <InlineNotice icon={MailCheck} tone="success">
              Se existir uma conta com esse e-mail, as instruções de redefinição foram enviadas.
              Verifique também a caixa de spam.
            </InlineNotice>
          ) : (
            <>
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
                    required
                  />
                )}
              />

              {formError ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={{
                    backgroundColor: theme.colors.warningSoft,
                    borderRadius: theme.radius.smallCard,
                    padding: theme.spacing.lg,
                  }}
                >
                  <AppText variant="bodySmall" color="secondary">
                    {formError}
                  </AppText>
                </View>
              ) : null}

              <Button
                label="Enviar instruções"
                size="lg"
                fullWidth
                loading={formState.isSubmitting}
                onPress={handleSubmit(onSubmit)}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
