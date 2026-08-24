import { Send } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

import { useTheme } from '@/theme';

/**
 * Campo de pergunta da IA.
 *
 * Vive separado da tela por um motivo de contrato, não de organização: é aqui
 * que a regra "sem viagem selecionada não sai pergunta" é aplicada, e ela
 * precisa ser verificável sem montar a aba inteira. `onSubmit` só é chamado com
 * texto de verdade e com o composer habilitado — o botão desabilitado também
 * anuncia isso ao leitor de tela, em vez de só ficar mais claro.
 */
export function AIComposer({
  value,
  onChangeText,
  onSubmit,
  disabled = false,
  pending = false,
  placeholder = 'Pergunte sobre sua viagem',
  disabledHint,
  paddingBottom,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  pending?: boolean;
  placeholder?: string;
  /** Explica por que o campo está inativo — lido pelo leitor de tela. */
  disabledHint?: string;
  paddingBottom: number;
}) {
  const theme = useTheme();
  const blocked = disabled || pending;
  const canSend = !blocked && value.trim().length > 0;

  return (
    <View
      testID="ai-composer"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.screen,
        paddingBottom,
      }}
    >
      <View
        style={{
          flex: 1,
          // Campo é superfície recuada, não o mesmo branco do card (§4).
          backgroundColor: disabled ? theme.colors.surfaceMuted : theme.colors.input,
          borderRadius: theme.radius.input,
          // O mesmo recorte do `FieldShell`: o realce que o Android pinta sobre
          // um `TextInput` é retangular e, sem isto, vaza pelos cantos.
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.inputBorder,
          paddingHorizontal: theme.spacing.lg,
          maxHeight: 120,
          justifyContent: 'center',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={!blocked}
          placeholder={disabled && disabledHint ? disabledHint : placeholder}
          placeholderTextColor={theme.colors.textTertiary}
          accessibilityLabel="Mensagem para a Easy Trip IA"
          accessibilityHint={disabled ? disabledHint : undefined}
          accessibilityState={{ disabled }}
          multiline
          style={{
            fontFamily: theme.fontFamily.body,
            fontSize: theme.typography.body.size,
            color: theme.colors.textPrimary,
            paddingVertical: theme.spacing.md,
            minHeight: 48,
          }}
        />
      </View>

      <Pressable
        onPress={() => {
          if (!canSend) return;
          onSubmit(value.trim());
        }}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Enviar mensagem"
        accessibilityHint={disabled ? disabledHint : undefined}
        accessibilityState={{ disabled: !canSend }}
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: canSend ? theme.colors.primary : theme.colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canSend ? (pressed ? 0.8 : 1) : 0.9,
        })}
      >
        <Send
          size={20}
          color={canSend ? theme.colors.textOnPrimary : theme.colors.textTertiary}
        />
      </Pressable>
    </View>
  );
}
