import { Sparkles, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  BottomSheet,
  Button,
  GlassCard,
  InlineNotice,
  TextField,
} from '@/components/ui';
import { ServiceError } from '@/services/http';
import { useTheme } from '@/theme';

/**
 * Preenchimento assistido de um formulário administrativo (§42, §43, §44, §46, §47).
 *
 * Uma folha, e não um formulário-chat: o cadastro continua sendo um formulário
 * normal, e a IA é uma ferramenta que se abre, entrega e some. Transformar a
 * tela inteira em conversa tornaria a revisão — que é o passo obrigatório do
 * §19 — mais difícil, não mais fácil.
 *
 * A decisão de projeto mais importante está no final: o resultado **não é
 * aplicado sozinho**. O administrador escolhe entre completar o que está vazio
 * e substituir tudo. Aplicar automaticamente apagaria trabalho manual em
 * silêncio (§43), e sem a escolha explícita não haveria como oferecer as duas
 * coisas sem adivinhar qual delas ele queria.
 */

export interface AIFillResult<T> {
  value: T;
  /** Campos removidos por não constarem do briefing — explicado ao admin. */
  dropped?: string[];
}

export function AIFillSheet<T>({
  visible,
  onClose,
  subtitle,
  placeholder,
  generate,
  summarize,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  subtitle: string;
  placeholder: string;
  generate: (briefing: string) => Promise<AIFillResult<T>>;
  summarize: (value: T) => { label: string; value: string }[];
  onApply: (value: T, mode: 'empty' | 'all') => void;
}) {
  const theme = useTheme();

  const [briefing, setBriefing] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AIFillResult<T> | null>(null);

  const run = async () => {
    // Trava de reentrada: sem ela, tocar três vezes no botão dispara três
    // gerações, e o TCC roda em cota gratuita (§46).
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      setResult(await generate(briefing.trim()));
    } catch (caught) {
      // A mensagem do `ServiceError` já distingue offline, timeout, 429, 503 e
      // resposta inválida — não há motivo para reescrevê-la aqui (§47).
      setError(
        caught instanceof ServiceError
          ? caught.message
          : 'Não foi possível gerar o conteúdo agora. Tente novamente.',
      );
      // O briefing e o resultado anterior ficam onde estavam: um erro não pode
      // custar o texto que o administrador acabou de escrever (§47).
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  const apply = (mode: 'empty' | 'all') => {
    if (!result) return;
    onApply(result.value, mode);
    setBriefing('');
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title="Preencher com IA" subtitle={subtitle}>
      <View style={{ gap: theme.spacing.lg }}>
        <TextField
          label="Briefing"
          placeholder={placeholder}
          value={briefing}
          onChangeText={setBriefing}
          multiline
          editable={!pending}
          helper="A IA nunca publica sozinha: você revisa tudo antes de salvar."
        />

        {error ? (
          <InlineNotice icon={TriangleAlert} tone="error">
            {error}
          </InlineNotice>
        ) : null}

        {result ? (
          <View style={{ gap: theme.spacing.md }}>
            {result.dropped?.length ? (
              /*
                Dizer o que ficou de fora é tão importante quanto o que veio.
                Sem este aviso o admin só descobriria o campo vazio ao salvar, e
                poderia concluir que a IA falhou — quando na verdade ela se
                recusou, corretamente, a inventar (§22, §59).
              */
              <InlineNotice icon={TriangleAlert} tone="warning">
                A IA não preencheu {result.dropped.join(', ')} porque esses dados não estavam no
                briefing. Complete manualmente — o Easy Trip não inventa informação sobre
                estabelecimentos reais.
              </InlineNotice>
            ) : null}

            <GlassCard>
              <View style={{ gap: theme.spacing.sm }}>
                <AppText variant="label" color="brand" weight="semibold">
                  ✨ Gerado pela IA
                </AppText>
                {summarize(result.value).map((field) => (
                  <View key={field.label} style={{ gap: 2 }}>
                    <AppText variant="caption" color="tertiary">
                      {field.label}
                    </AppText>
                    <AppText variant="bodySmall" numberOfLines={3}>
                      {field.value}
                    </AppText>
                  </View>
                ))}
              </View>
            </GlassCard>

            <Button label="Preencher campos vazios" fullWidth onPress={() => apply('empty')} />
            <Button
              label="Substituir tudo"
              variant="secondary"
              fullWidth
              onPress={() => apply('all')}
            />
          </View>
        ) : null}

        <Button
          label={result ? 'Gerar novamente' : 'Gerar preenchimento'}
          icon={Sparkles}
          variant={result ? 'secondary' : 'primary'}
          fullWidth
          size={result ? 'md' : 'lg'}
          loading={pending}
          disabled={pending || briefing.trim().length < 10}
          onPress={() => void run()}
        />
      </View>
    </BottomSheet>
  );
}
