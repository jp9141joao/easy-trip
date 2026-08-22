import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/BrandMark';
import {
  AppHeader,
  AppText,
  Button,
  InlineNotice,
  PasswordField,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { registerSchema, type RegisterInput } from '@/domain/schemas';
import { CURRENCIES, TRAVEL_STYLES, type CurrencyCode, type TravelStyle } from '@/domain/types';
import { TRAVEL_STYLE_LABEL } from '@/lib/labels';
import { useAuth } from '@/providers/AuthProvider';
import { AuthError } from '@/repositories';
import { useTheme } from '@/theme';

export default function RegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { signUp } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      defaultCurrency: 'BRL',
    },
  });

  const onSubmit = async (values: RegisterInput) => {
    setFormError(null);
    try {
      const outcome = await signUp({
        name: values.name,
        email: values.email,
        password: values.password,
        defaultCurrency: values.defaultCurrency as CurrencyCode,
        travelStyle: values.travelStyle as TravelStyle | undefined,
      });

      // Cadastrar tem dois finais, e qual deles acontece depende de o projeto
      // exigir ou não confirmação de e-mail. Os dois deram certo — o que muda é
      // o que a pessoa precisa fazer agora.
      if (outcome.status === 'confirmation-required') {
        setPendingEmail(outcome.email);
        return;
      }

      toast.success('Conta criada. Bem-vindo ao Easy Trip!');
      // A entrada no aplicativo é consequência de haver sessão: a proteção do
      // stack troca as rotas sozinha, sem navegação manual competindo com ela.
    } catch (error) {
      setFormError(
        error instanceof AuthError
          ? error.message
          : 'Não foi possível criar a conta. Verifique os dados e sua conexão.',
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
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <BrandMark size="md" showWordmark={false} />
            <AppText variant="h1" align="center">
              {pendingEmail ? 'Confirme seu e-mail' : 'Criar conta'}
            </AppText>
            <AppText variant="bodySmall" color="secondary" align="center">
              {pendingEmail
                ? `A conta foi criada. Enviamos um link de confirmação para ${pendingEmail} — abra-o para concluir o acesso.`
                : 'Leva menos de um minuto. As preferências podem ser ajustadas depois.'}
            </AppText>
          </View>

          {pendingEmail ? (
            <InlineNotice icon={MailCheck} tone="success">
              Não recebeu? Verifique a caixa de spam. O link vale por tempo limitado; depois
              disso, use &quot;Esqueci minha senha&quot; para receber outro.
            </InlineNotice>
          ) : (
          <>
          <View style={{ gap: theme.spacing.lg }}>
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <TextField
                  label="Nome"
                  placeholder="Como podemos te chamar?"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  autoCapitalize="words"
                  autoComplete="name"
                  required
                />
              )}
            />

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
                  placeholder="Mínimo de 8 caracteres"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  helper="Use letras e números."
                  autoComplete="new-password"
                  required
                />
              )}
            />

            <Controller
              control={control}
              name="confirmPassword"
              render={({ field, fieldState }) => (
                <PasswordField
                  label="Confirmar senha"
                  placeholder="Repita a senha"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  autoComplete="new-password"
                  required
                />
              )}
            />

            <AppText variant="label" color="tertiary" uppercase>
              Opcional
            </AppText>

            <Controller
              control={control}
              name="defaultCurrency"
              render={({ field, fieldState }) => (
                <SelectField
                  label="Moeda padrão"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
                />
              )}
            />

            <Controller
              control={control}
              name="travelStyle"
              render={({ field, fieldState }) => (
                <SelectField
                  label="Estilo de viagem"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  placeholder="Escolher depois"
                  options={TRAVEL_STYLES.map((style) => ({
                    value: style,
                    label: TRAVEL_STYLE_LABEL[style],
                  }))}
                />
              )}
            />
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

          <Button
            label="Criar conta"
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
