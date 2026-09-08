import { Info, Lock } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Badge, DateField, InlineNotice, TextField } from '@/components/ui';
import type { ReviewGroup, ReviewItem } from '@/domain/aiActionReview';
import { formatWeekdayDate } from '@/lib/date';
import { VISIBILITY_LABEL } from '@/domain/visibility';
import { useTheme } from '@/theme';
import { ActionRow } from './ActionRow';

/**
 * A entrada de diário proposta.
 *
 * TRÊS COISAS QUE ESTA TELA NÃO PODE ERRAR
 *
 * **Plano não vira lembrança.** Uma entrada montada a partir do roteiro do dia
 * 18 descreve o que está previsto — o dia ainda não aconteceu. A etiqueta
 * "Registro planejado" diz isso na linha, e o texto será gravado com o prefixo
 * `Planejado — `, porque `journal_entries` não tem coluna para essa distinção e
 * inventar uma exigiria migration. Quem reler em dezembro precisa saber que
 * aquilo foi escrito antes.
 *
 * **O texto inteiro fica à vista.** Não há resumo nem reticências: é o diário
 * da pessoa, e confirmar sem ter lido o que vai ser escrito no lugar dela seria
 * o pior tipo de confirmação às cegas. O campo abre em `multiline` para que
 * reescrever seja a coisa mais fácil de fazer aqui.
 *
 * **A visibilidade é fixa, e é dita.** Diferente de roteiro, checklist e
 * despesa, o diário não ganha seletor: ele nasce privado (§11, §63) e assim é
 * gravado. O que a tela faz é declarar isso, não perguntar.
 */
export function JournalActionPreview({
  group,
  expandedKey,
  onToggleItem,
  onToggleExpanded,
  onEdit,
}: {
  group: ReviewGroup;
  expandedKey: string | null;
  onToggleItem: (key: string) => void;
  onToggleExpanded: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
}) {
  const theme = useTheme();

  const item = group.items.find(
    (candidate): candidate is Extract<ReviewItem, { kind: 'journal' }> =>
      candidate.kind === 'journal',
  );
  if (!item) return null;

  const { value } = item;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <ActionRow
        title={formatWeekdayDate(value.entryDate)}
        subtitle={value.placeName}
        included={item.included}
        warnings={item.warnings}
        editable
        expanded={expandedKey === item.key}
        onToggleIncluded={() => onToggleItem(item.key)}
        onToggleExpanded={() => onToggleExpanded(item.key)}
      >
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Badge
            label={value.planned ? 'Registro planejado' : 'Registro do dia'}
            tone={value.planned ? 'warning' : 'success'}
          />
        </View>

        <DateField
          label="Data"
          value={value.entryDate}
          onChange={(entryDate) => onEdit(item.key, { entryDate })}
        />
        <TextField
          label="O que fica registrado"
          value={value.content}
          multiline
          onChangeText={(content) => onEdit(item.key, { content })}
        />
        <TextField
          label="Lugar (opcional)"
          value={value.placeName ?? ''}
          onChangeText={(placeName) => onEdit(item.key, { placeName: placeName || undefined })}
        />
      </ActionRow>

      {/*
        O texto também aparece FORA da edição.

        A linha da `ActionRow` mostra só a data — e confirmar uma entrada de
        diário sem ver o que ela diz seria confirmar às cegas justamente no
        conteúdo mais pessoal que a IA pode propor. Quem quiser mudar abre a
        edição; quem só quer conferir lê aqui.
      */}
      <View
        style={{
          gap: theme.spacing.xs,
          padding: theme.spacing.md,
          borderRadius: theme.radius.smallCard,
          backgroundColor: theme.colors.surfaceMuted,
        }}
      >
        <AppText variant="bodySmall" color="secondary">
          {value.content}
        </AppText>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        <Lock size={12} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="tertiary">
          Visibilidade: {VISIBILITY_LABEL.private}. A IA não lê o seu diário — ela só propõe esta
          entrada nova.
        </AppText>
      </View>

      {value.planned ? (
        <InlineNotice icon={Info} tone="warning">
          Este dia ainda não aconteceu: o texto descreve o que está previsto no roteiro, e será
          gravado marcado como planejado. Reescreva o que quiser antes de adicionar.
        </InlineNotice>
      ) : null}
    </View>
  );
}
