import { Eye, Pencil, Send } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  AppText,
  BottomSheet,
  Button,
  InlineNotice,
  TextField,
  useToast,
} from '@/components/ui';
import { INVITABLE_ROLES, ROLE_LABEL, type InvitableRole } from '@/domain/collaboration';
import { emailSchema } from '@/domain/schemas';
import { useTheme } from '@/theme';

const ROLE_ICON = { editor: Pencil, viewer: Eye } as const;

const ROLE_HELP: Record<InvitableRole, string> = {
  editor: 'Pode criar e editar o roteiro, o checklist e as reservas compartilhadas.',
  viewer: 'Vê o conteúdo compartilhado, mas não altera nada da viagem.',
};

/**
 * Convidar alguém para a viagem (§5).
 *
 * O convite vai por e-mail de uma conta que já existe, e não por link: um link
 * de convite é um segredo que circula por WhatsApp, sobrevive ao print e não
 * sabe para quem foi. Exigir conta significa que o convite tem destinatário
 * verificado desde o primeiro instante.
 *
 * O e-mail é resolvido inteiramente no servidor (`create_trip_invite`, 0008).
 * Esta tela nunca pesquisa usuários, nunca recebe lista e não sabe dizer se um
 * e-mail existe até tentar convidá-lo — que é o único momento em que essa
 * resposta é útil e é dada a quem tem legitimidade para recebê-la.
 */
export function InviteSheet({
  visible,
  onClose,
  onInvite,
  pending,
}: {
  visible: boolean;
  onClose: () => void;
  onInvite: (email: string, role: InvitableRole) => Promise<void>;
  pending: boolean;
}) {
  const theme = useTheme();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('editor');
  const [error, setError] = useState<string | undefined>();

  const close = () => {
    setEmail('');
    setRole('editor');
    setError(undefined);
    onClose();
  };

  const submit = async () => {
    // O mesmo schema do login: teclado de celular acrescenta espaço no fim, e
    // recusar isso como "E-mail inválido" seria culpar a pessoa pelo teclado.
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'E-mail inválido');
      return;
    }

    setError(undefined);
    try {
      await onInvite(parsed.data, role);
      toast.success('Convite enviado');
      close();
    } catch (cause) {
      // A mensagem vem do Postgres e é escrita para o usuário final ("Nenhuma
      // conta Easy Trip com este e-mail", "Esta pessoa já é membro"). Trocá-la
      // por um genérico apagaria a única informação acionável.
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o convite.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Convidar viajante"
      subtitle="A pessoa precisa ter uma conta Easy Trip"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <TextField
          label="E-mail da pessoa"
          placeholder="nome@exemplo.com"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (error) setError(undefined);
          }}
          error={error}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          required
        />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" color="secondary">
            Permissão
          </AppText>

          {INVITABLE_ROLES.map((option) => {
            const Icon = ROLE_ICON[option];
            const selected = role === option;
            return (
              <Pressable
                key={option}
                onPress={() => setRole(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${ROLE_LABEL[option]}. ${ROLE_HELP[option]}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.smallCard,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Icon
                  size={18}
                  color={selected ? theme.colors.primary : theme.colors.textTertiary}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText
                    variant="bodySmall"
                    weight={selected ? 'semibold' : 'regular'}
                    color={selected ? 'brand' : 'primary'}
                  >
                    {ROLE_LABEL[option]}
                  </AppText>
                  <AppText variant="caption" color="secondary">
                    {ROLE_HELP[option]}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>

        <InlineNotice>
          Conteúdo marcado como “Somente eu” continua invisível para quem você convidar —
          inclusive o seu diário e as despesas privadas.
        </InlineNotice>

        <Button
          label="Enviar convite"
          icon={Send}
          size="lg"
          fullWidth
          loading={pending}
          onPress={() => void submit()}
          haptic
        />
      </View>
    </BottomSheet>
  );
}
