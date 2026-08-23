import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { summarizeReport, type AIActionReport } from '@/services/aiActionExecutor';
import { useTheme } from '@/theme';

/**
 * O que realmente entrou na viagem.
 *
 * "Sucesso!" é proibido aqui (§24). O resultado é linha a linha, com o número
 * do que entrou, e quando algo falha a falha aparece com o mesmo destaque do
 * que deu certo — porque uma execução parcial anunciada como completa é pior do
 * que uma que falhou inteira: a pessoa fecha a tela achando que está tudo lá.
 *
 * "Desfazer" só aparece quando o executor sabe exatamente quais registros criou
 * e todos podem ser removidos. Uma atualização de orçamento não vem com undo —
 * ela altera um registro que já existia, e reescrevê-lo depois seria apagar o
 * que a pessoa possa ter mudado no meio.
 */
export function AIActionResult({
  report,
  undoing,
  onUndo,
  onDismiss,
}: {
  report: AIActionReport;
  undoing: boolean;
  onUndo?: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const lines = summarizeReport(report);

  const tones = {
    success: { color: theme.colors.success, Icon: CheckCircle2 },
    warning: { color: theme.colors.warning, Icon: AlertTriangle },
    error: { color: theme.colors.error, Icon: XCircle },
  } as const;

  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      style={{
        alignSelf: 'flex-start',
        width: '96%',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.smallCard,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ gap: theme.spacing.sm }}>
        {lines.map((entry, index) => {
          const { color, Icon } = tones[entry.tone];
          return (
            <View
              key={index}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}
            >
              <Icon size={16} color={color} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                {entry.lines.map((line, lineIndex) => (
                  <AppText
                    key={lineIndex}
                    variant={lineIndex === 0 ? 'bodySmall' : 'caption'}
                    color={lineIndex === 0 ? 'primary' : 'secondary'}
                    weight={lineIndex === 0 ? 'semibold' : 'regular'}
                  >
                    {line}
                  </AppText>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {report.undoable && onUndo ? (
          <Button label="Desfazer" variant="secondary" size="sm" loading={undoing} onPress={onUndo} />
        ) : null}
        <Button label="Fechar" variant="ghost" size="sm" onPress={onDismiss} disabled={undoing} />
      </View>
    </View>
  );
}
