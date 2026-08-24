import DateTimePicker from '@react-native-community/datetimepicker';
import { Check, ChevronDown, Eye, EyeOff, Search, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { formatLongDate, parseISODate, toISODate } from '@/lib/date';
import { formatMoney, parseMoneyInput } from '@/lib/currency';
import { useTheme } from '@/theme';
import type { CurrencyCode } from '@/domain/types';
import { AppText } from './AppText';
import { BottomSheet } from './Overlay';

/* ------------------------------ shared shell ------------------------------ */

interface FieldShellProps {
  label: string;
  error?: string;
  helper?: string;
  required?: boolean;
  focused?: boolean;
  disabled?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Every field is wrapped by this shell so a label is always present —
 * placeholder-as-label is explicitly forbidden (§78).
 */
function FieldShell({
  label,
  error,
  helper,
  required,
  focused,
  disabled,
  children,
  style,
}: FieldShellProps) {
  const theme = useTheme();
  const borderColor = error
    ? theme.colors.error
    : focused
      ? theme.colors.primary
      : theme.colors.inputBorder;

  return (
    <View style={[{ gap: theme.spacing.sm }, style]}>
      <AppText variant="label" color="secondary">
        {label}
        {required ? ' *' : ''}
      </AppText>

      <View
        style={{
          borderWidth: focused || error ? 1.5 : 1,
          borderColor,
          borderRadius: theme.radius.input,
          /*
           * `overflow: 'hidden'` é o que corrige o autofill quadrado no Android.
           *
           * O gerenciador de senhas pinta o `TextInput` de amarelo desenhando
           * **o retângulo inteiro** do campo nativo. O arredondamento vive
           * aqui, na borda desta `View`, e sem recorte o retângulo amarelo do
           * filho simplesmente ultrapassava os cantos — o campo ficava
           * arredondado por fora e quadrado por dentro.
           *
           * Recortar resolve sem desligar nada: o autofill continua ligado, o
           * gerenciador de senhas continua preenchendo, e a mancha amarela
           * passa a respeitar o raio. Desabilitar o autofill "resolveria" o
           * sintoma tirando um recurso de acessibilidade e de segurança de
           * quem usa senha gerenciada — não é conserto, é remoção.
           */
          overflow: 'hidden',
          // Campo é uma superfície recuada, não o mesmo branco do card (§4).
          backgroundColor: disabled ? theme.colors.surfaceMuted : theme.colors.input,
          opacity: disabled ? 0.6 : 1,
          minHeight: 52,
          justifyContent: 'center',
        }}
      >
        {children}
      </View>

      {error ? (
        <AppText variant="caption" color="error" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="caption" color="tertiary">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

/* -------------------------------- TextField ------------------------------- */

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  helper?: string;
  required?: boolean;
  multiline?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextField({
  label,
  error,
  helper,
  required,
  multiline,
  containerStyle,
  editable = true,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <FieldShell
      label={label}
      error={error}
      helper={helper}
      required={required}
      focused={focused}
      disabled={!editable}
      style={containerStyle}
    >
      <TextInput
        {...rest}
        editable={editable}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        placeholderTextColor={theme.colors.textTertiary}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: multiline ? theme.spacing.md : theme.spacing.md,
          minHeight: multiline ? 120 : 50,
          textAlignVertical: multiline ? 'top' : 'center',
          fontFamily: theme.fontFamily.body,
          fontSize: theme.typography.body.size,
          color: theme.colors.textPrimary,
        }}
      />
    </FieldShell>
  );
}

/* ------------------------------ PasswordField ----------------------------- */

export function PasswordField({ label, error, helper, required, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);

  return (
    <FieldShell
      label={label}
      error={error}
      helper={helper}
      required={required}
      focused={focused}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextInput
          {...rest}
          secureTextEntry={hidden}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={theme.colors.textTertiary}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          style={{
            flex: 1,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            minHeight: 50,
            fontFamily: theme.fontFamily.body,
            fontSize: theme.typography.body.size,
            color: theme.colors.textPrimary,
          }}
        />
        <Pressable
          onPress={() => setHidden((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Mostrar senha' : 'Ocultar senha'}
          hitSlop={theme.hitSlop}
          style={{ paddingHorizontal: theme.spacing.lg }}
        >
          {hidden ? (
            <Eye size={20} color={theme.colors.textSecondary} />
          ) : (
            <EyeOff size={20} color={theme.colors.textSecondary} />
          )}
        </Pressable>
      </View>
    </FieldShell>
  );
}

/* ------------------------------- SearchInput ------------------------------ */

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Buscar',
  accessibilityLabel = 'Buscar',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.input,
        borderRadius: theme.radius.pill,
        // Mesmo motivo do `FieldShell`: o realce do teclado/autofill do Android
        // é um retângulo, e sem recorte ele escapa do raio.
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.inputBorder,
        paddingHorizontal: theme.spacing.lg,
        height: 48,
        gap: theme.spacing.sm,
      }}
    >
      <Search size={18} color={theme.colors.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="search"
        style={{
          flex: 1,
          fontFamily: theme.fontFamily.body,
          fontSize: theme.typography.bodySmall.size,
          color: theme.colors.textPrimary,
          paddingVertical: 0,
        }}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Limpar busca"
          hitSlop={theme.hitSlop}
        >
          <X size={16} color={theme.colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------- SelectField ------------------------------ */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  helper,
  required,
  placeholder = 'Selecione',
  sheetTitle,
}: {
  label: string;
  value?: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  helper?: string;
  required?: boolean;
  placeholder?: string;
  sheetTitle?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <FieldShell label={label} error={error} helper={helper} required={required}>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${selected ? `Selecionado: ${selected.label}` : placeholder}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: theme.spacing.lg,
            minHeight: 50,
            gap: theme.spacing.md,
          }}
        >
          <AppText variant="body" color={selected ? 'primary' : 'tertiary'} numberOfLines={1} style={{ flex: 1 }}>
            {selected?.label ?? placeholder}
          </AppText>
          <ChevronDown size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </FieldShell>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label}>
        <View style={{ gap: theme.spacing.xs }}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.label}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: theme.spacing.lg,
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radius.smallCard,
                  backgroundColor: isSelected
                    ? theme.colors.primarySoft
                    : pressed
                      ? theme.colors.surfaceMuted
                      : 'transparent',
                  gap: theme.spacing.md,
                })}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="body" weight={isSelected ? 'semibold' : 'regular'}>
                    {option.label}
                  </AppText>
                  {option.description ? (
                    <AppText variant="caption" color="secondary">
                      {option.description}
                    </AppText>
                  ) : null}
                </View>
                {isSelected ? <Check size={18} color={theme.colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

/* -------------------------------- DateField ------------------------------- */

export function DateField({
  label,
  value,
  onChange,
  error,
  helper,
  required,
  minimumDate,
  maximumDate,
  placeholder = 'Selecione a data',
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
  required?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  placeholder?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = value ? parseISODate(value) : new Date();

  return (
    <>
      <FieldShell label={label} error={error} helper={helper} required={required}>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${value ? formatLongDate(value) : placeholder}`}
          style={{
            paddingHorizontal: theme.spacing.lg,
            minHeight: 50,
            justifyContent: 'center',
          }}
        >
          <AppText variant="body" color={value ? 'primary' : 'tertiary'}>
            {value ? formatLongDate(value) : placeholder}
          </AppText>
        </Pressable>
      </FieldShell>

      {open ? (
        Platform.OS === 'ios' ? (
          <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
            <DateTimePicker
              value={current}
              mode="date"
              display="inline"
              locale="pt-BR"
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onChange={(_event, date) => {
                if (date) onChange(toISODate(date));
              }}
            />
          </BottomSheet>
        ) : (
          <DateTimePicker
            value={current}
            mode="date"
            display="default"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(event, date) => {
              setOpen(false);
              if (event.type === 'set' && date) onChange(toISODate(date));
            }}
          />
        )
      ) : null}
    </>
  );
}

/* -------------------------------- TimeField ------------------------------- */

export function TimeField({
  label,
  value,
  onChange,
  error,
  helper,
  placeholder = '--:--',
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
  placeholder?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const asDate = () => {
    const date = new Date();
    if (value) {
      const [h, m] = value.split(':').map(Number);
      date.setHours(h, m, 0, 0);
    }
    return date;
  };

  const handle = (date?: Date) => {
    if (!date) return;
    onChange(
      `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    );
  };

  return (
    <>
      <FieldShell label={label} error={error} helper={helper}>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${value ?? 'não definido'}`}
          style={{ paddingHorizontal: theme.spacing.lg, minHeight: 50, justifyContent: 'center' }}
        >
          <AppText variant="body" color={value ? 'primary' : 'tertiary'}>
            {value ?? placeholder}
          </AppText>
        </Pressable>
      </FieldShell>

      {open ? (
        Platform.OS === 'ios' ? (
          <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
            <DateTimePicker
              value={asDate()}
              mode="time"
              display="spinner"
              locale="pt-BR"
              is24Hour
              onChange={(_e, date) => handle(date)}
            />
          </BottomSheet>
        ) : (
          <DateTimePicker
            value={asDate()}
            mode="time"
            display="default"
            is24Hour
            onChange={(event, date) => {
              setOpen(false);
              if (event.type === 'set') handle(date);
            }}
          />
        )
      ) : null}
    </>
  );
}

/* ------------------------------- MoneyField ------------------------------- */

export function MoneyField({
  label,
  value,
  onChange,
  currency,
  error,
  helper,
  required,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  currency: CurrencyCode;
  error?: string;
  helper?: string;
  required?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() =>
    value === undefined ? '' : formatMoney(value, currency, { showSymbol: false }),
  );

  const keyboard: KeyboardTypeOptions = Platform.select({
    ios: 'decimal-pad',
    android: 'numeric',
    default: 'numeric',
  });

  return (
    <FieldShell label={label} error={error} helper={helper} required={required} focused={focused}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ paddingLeft: theme.spacing.lg }}>
          <AppText variant="body" color="secondary" mono>
            {currency}
          </AppText>
        </View>
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            const parsed = parseMoneyInput(next);
            onChange(parsed === null ? undefined : parsed);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            const parsed = parseMoneyInput(text);
            if (parsed !== null) setText(formatMoney(parsed, currency, { showSymbol: false }));
          }}
          keyboardType={keyboard}
          placeholder="0,00"
          placeholderTextColor={theme.colors.textTertiary}
          accessibilityLabel={label}
          style={{
            flex: 1,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            minHeight: 50,
            fontFamily: theme.fontFamily.mono,
            fontSize: theme.typography.body.size,
            color: theme.colors.textPrimary,
          }}
        />
      </View>
    </FieldShell>
  );
}
