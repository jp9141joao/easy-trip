import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, InlineNotice, PasswordField } from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { resetPasswordSchema, type ResetPasswordInput } from '@/domain/schemas';
import { useAuth } from '@/providers/AuthProvider';
import { AuthError } from '@/repositories';
import { useTheme } from '@/theme';

/**
 * Fim do caminho da recuperação (§9).
 *
 * Só existe enquanto `recoveryPending` for verdadeiro — o layout de `(auth)`
 * a retira do navegador nos outros casos. Chegar aqui significa que o link do
 * e-mail foi aberto e trocado por uma sessão que serve para uma coisa só.
 */
export default function ResetPasswordScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { completePasswordReset, cancelPasswordReset, recoveryError } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  /**
   * Cancelar precisa comprovar a saída.
   *
   * `cancelPasswordReset` só resolve quando a sessão de recuperação saiu do
   * disco. Se ela lançar, o token continua no aparelho — e apagar o formulário
   * como se tivesse saído seria mentir sobre o estado. A tela permanece onde
   * está e diz o que houve.
   */
  const onCancel = async () => {
    setCancelError(null);
    setCancelling(true);
    try {
      await cancelPasswordReset();
    } catch (error) {
      setCancelError(
        error instanceof AuthError
          ? error.message
          : 'Não foi possível encerrar esta sessão de recuperação. Tente novamente.',
      );
    } finally {
      setCancelling(false);
    }
  };

  const { control, handleSubmit, formState } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: ResetPasswordInput) => {
    setFormError(null);
    try {
      await completePasswordReset(values.password);
      // Nada de navegar à mão: com a senha trocada, `recoveryPending` cai e a
      // proteção do stack leva ao aplicativo sozinha.
    } catch (error) {
      setFormError(
        error instanceof AuthError
          ? error.message
          : 'Não foi possível salvar a nova senha. Tente novamente.',
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
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="h1">Criar nova senha</AppText>
            <AppText variant="bodySmall" color="secondary">
              Escolha uma senha nova para a sua conta. Ela passa a valer no próximo acesso, em
              todos os aparelhos.
            </AppText>
          </View>

          {cancelError ? (
            <InlineNotice icon={TriangleAlert} tone="error">
              {cancelError}
            </InlineNotice>
          ) : null}

          {recoveryError ? (
            // Link vencido ou já usado. Sem campo de senha: não há sessão para
            // gravar nada, e oferecer o formulário só levaria a um erro depois.
            <>
              <InlineNotice icon={TriangleAlert} tone="warning">
                {recoveryError}
              </InlineNotice>
              <Button
                label="Voltar para o início"
                size="lg"
                fullWidth
                loading={cancelling}
                onPress={() => void onCancel()}
              />
            </>
          ) : (
            <>
              <InlineNotice icon={KeyRound} tone="info">
                Este link é de uso único e vale por tempo limitado.
              </InlineNotice>

              <Controller
                control={control}
                name="password"
                render={({ field, fieldState }) => (
                  <PasswordField
                    label="Nova senha"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                  />
                )}
              />

              <Controller
                control={control}
                name="confirmPassword"
                render={({ field, fieldState }) => (
                  <PasswordField
                    label="Confirmar nova senha"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                  />
                )}
              />

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

              <Button
                label="Salvar nova senha"
                size="lg"
                fullWidth
                loading={formState.isSubmitting}
                onPress={handleSubmit(onSubmit)}
              />

              <Button
                label="Cancelar"
                variant="ghost"
                fullWidth
                loading={cancelling}
                onPress={() => void onCancel()}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
