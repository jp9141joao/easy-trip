import { Bell, BellOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Button, InlineNotice } from '@/components/ui';
import {
  MAX_REMINDER_MINUTES,
  REMINDER_OFFSETS,
  offsetMinutesBetween,
  reminderOffsetLabel,
  type Reminder,
  type ReminderAnchor,
} from '@/domain/reminders';
import { useTheme } from '@/theme';

/**
 * "🔔 Me lembrar" para um instante de uma reserva (§30).
 *
 * O QUE ESTE CONTROLE PROMETE
 *
 * Um aviso na Central de notificações do Easy Trip — e é isso que o texto de
 * apoio diz, com todas as letras. Não há push do sistema operacional nesta
 * fase (§33), e um sino desenhado sem essa ressalva prometeria uma notificação
 * na tela de bloqueio que não vai chegar. A pessoa contaria com ela e perderia
 * o check-in.
 *
 * Quando estiver ligado o push de verdade, esta frase muda — e só ela.
 */
export function ReminderField({
  label,
  anchorAt,
  reminder,
  onSet,
  onClear,
  pending,
}: {
  label: string;
  /** O instante da reserva. Sem ele não há do que lembrar. */
  anchorAt?: string;
  reminder?: Reminder;
  onSet: (minutesBefore: number) => void;
  onClear: () => void;
  pending?: boolean;
  anchor?: ReminderAnchor;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  // Sem data não há âncora, e um seletor de "quanto tempo antes" sem "antes de
  // quê" é um controle que não pode funcionar. Ele some em vez de dar erro.
  if (!anchorAt) return null;

  const isPast = new Date(anchorAt).getTime() <= Date.now();
  const active = Boolean(reminder);
  const currentOffset = reminder ? offsetMinutesBetween(reminder.remindAt, anchorAt) : undefined;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        disabled={isPast && !active}
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: isPast && !active }}
        accessibilityLabel={
          active
            ? `Lembrete de ${label} ativo, ${reminderOffsetLabel(currentOffset ?? 0)}. Toque para alterar.`
            : `Ativar lembrete de ${label}.`
        }
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          opacity: pressed ? 0.7 : isPast && !active ? 0.45 : 1,
        })}
      >
        {active ? (
          <Bell size={16} color={theme.colors.primary} />
        ) : (
          <BellOff size={16} color={theme.colors.textTertiary} />
        )}
        <AppText variant="bodySmall" color={active ? 'brand' : 'secondary'} style={{ flex: 1 }}>
          {active
            ? `Me lembrar · ${reminderOffsetLabel(currentOffset ?? 0)}`
            : isPast
              ? `${label} já passou`
              : `Me lembrar do ${label.toLowerCase()}`}
        </AppText>
      </Pressable>

      {expanded ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {REMINDER_OFFSETS.filter(
              // Uma opção que cairia no passado não é oferecida: escolhê-la
              // produziria um erro que a pessoa não tem como prever olhando.
              (option) => new Date(anchorAt).getTime() - option.minutes * 60_000 > Date.now(),
            ).map((option) => {
              const selected = currentOffset === option.minutes;
              return (
                <Pressable
                  key={option.minutes}
                  onPress={() => onSet(option.minutes)}
                  disabled={pending}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  style={({ pressed }) => ({
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <AppText variant="caption" color={selected ? 'brand' : 'secondary'}>
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {active ? (
            <Button
              label="Desativar lembrete"
              variant="ghost"
              size="sm"
              icon={BellOff}
              onPress={onClear}
            />
          ) : null}

          <InlineNotice icon={Bell}>
            O aviso aparece na Central de notificações do Easy Trip quando você abrir o aplicativo
            depois do horário. O Easy Trip ainda não envia notificações do sistema.
          </InlineNotice>
        </View>
      ) : null}
    </View>
  );
}

export { MAX_REMINDER_MINUTES };
