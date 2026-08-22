import { ImageOff, ImagePlus, RefreshCcw, Trash2, Undo2 } from 'lucide-react-native';
import { View } from 'react-native';

import { AppImage, AppText, Badge, Button, useToast } from '@/components/ui';
import { editorialImageOrigin } from '@/domain/upload';
import { pickEditorialImage } from '@/lib/imagePicker';
import type { UploadableFile } from '@/repositories/types';
import { useTheme } from '@/theme';

/**
 * O campo que substitui "Imagem (URL)" (F9, §8 — a metade do P-04 que a F7 não
 * podia fazer).
 *
 * O fluxo inteiro em um componente: escolher → validar → **pré-visualizar** →
 * e só no "Salvar" do formulário subir. O upload não mora aqui de propósito;
 * quem abre o cadastro, escolhe uma foto e desiste não pode deixar arquivo no
 * bucket. O que este campo produz é um `UploadableFile` em memória.
 *
 * Três estados possíveis, e a tela precisa distinguir os três:
 *
 *   - **imagem escolhida** (`pending` é um arquivo) — ainda não subiu;
 *   - **remoção pedida** (`pending` é `null`) — o registro vai ficar sem capa;
 *   - **sem mexer** (`pending` é `undefined`) — vale o que já estava gravado.
 *
 * E o que já estava gravado tem duas procedências, mostradas ao administrador
 * porque mudam o que acontece na troca: `gerenciada` é arquivo do próprio Easy
 * Trip (sai do bucket quando substituída) e `externa` é URL de terceiro — o
 * Unsplash do catálogo antigo —, que é apenas esquecida, nunca apagada (§17).
 */
export interface EditorialImageFieldProps {
  label?: string;
  helper?: string;
  /** O valor gravado no registro. */
  value?: string;
  pending: UploadableFile | null | undefined;
  onChange(next: UploadableFile | null | undefined): void;
  /** Mensagem de erro do formulário — imagem obrigatória, por exemplo. */
  error?: string;
  /** Desliga a interação durante o "Salvar". */
  disabled?: boolean;
  /** Texto do fallback quando não há imagem nenhuma. */
  fallbackLabel?: string;
}

export function EditorialImageField({
  label = 'Imagem',
  helper,
  value,
  pending,
  onChange,
  error,
  disabled = false,
  fallbackLabel = 'Sem imagem',
}: EditorialImageFieldProps) {
  const theme = useTheme();
  const toast = useToast();

  const origin = editorialImageOrigin(value);
  const removing = pending === null;
  const preview = pending ? pending.uri : removing ? undefined : value;

  const choose = async () => {
    const result = await pickEditorialImage();
    switch (result.status) {
      case 'denied':
        toast.warning('Permita o acesso às fotos para escolher a imagem.');
        return;
      case 'cancelled':
        // Silêncio é a resposta certa: quem cancelou sabe que cancelou.
        return;
      case 'rejected':
        toast.error(result.message);
        return;
      case 'picked':
        onChange(result.file);
        toast.success('Imagem selecionada. Ela sobe quando você salvar.');
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="bodySmall" weight="semibold">
        {label}
      </AppText>

      <AppImage
        uri={preview}
        style={{ width: '100%', aspectRatio: 16 / 9 }}
        radius={theme.radius.card}
        fallbackLabel={removing ? 'A imagem será removida' : fallbackLabel}
        accessibilityLabel={label}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {pending ? (
          <Badge label="Nova imagem — sobe ao salvar" tone="brand" />
        ) : removing ? (
          <Badge label="Será removida ao salvar" tone="error" />
        ) : origin === 'managed' ? (
          <Badge label="Hospedada pelo Easy Trip" tone="success" />
        ) : origin === 'external' ? (
          <Badge label="Imagem externa (legado)" tone="warning" />
        ) : (
          <Badge label="Sem imagem" tone="neutral" />
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button
          label={preview ? 'Trocar imagem' : 'Escolher imagem'}
          variant="secondary"
          size="sm"
          icon={preview ? RefreshCcw : ImagePlus}
          disabled={disabled}
          onPress={() => void choose()}
          style={{ flex: 1 }}
        />

        {pending !== undefined ? (
          <Button
            label="Desfazer"
            variant="ghost"
            size="sm"
            icon={Undo2}
            disabled={disabled}
            onPress={() => onChange(undefined)}
          />
        ) : value ? (
          <Button
            label="Remover"
            variant="ghost"
            size="sm"
            icon={Trash2}
            disabled={disabled}
            onPress={() => onChange(null)}
          />
        ) : null}
      </View>

      {origin === 'external' && pending === undefined ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
          <ImageOff size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="tertiary" style={{ flex: 1 }}>
            Esta imagem está hospedada fora do Easy Trip. Ao trocar, a nova passa a ficar no nosso
            armazenamento — a antiga apenas deixa de ser usada.
          </AppText>
        </View>
      ) : null}

      {helper ? (
        <AppText variant="caption" color="tertiary">
          {helper}
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" color="error">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
