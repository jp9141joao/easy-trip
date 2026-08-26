import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, GlassCard, InlineNotice, SectionHeader, TextField } from '@/components/ui';
import type { Trip } from '@/domain/types';
import {
  currencyForCountry,
  fractionDigitsFor,
  formatRate,
  symbolFor,
} from '@/lib/countryCurrency';
import { parseMoneyInput } from '@/lib/currency';
import {
  EXCHANGE_RATE_ATTRIBUTION,
  convertWithRate,
  getReferenceRate,
} from '@/services/exchangeRates';
import { useTheme } from '@/theme';

/**
 * Conversão de moeda na Carteira (§23–§28 do handoff).
 *
 * O QUE ELE É
 *
 * Uma ferramenta rápida de viagem: quanto é R$ 1.000 na moeda daqui. Não é
 * casa de câmbio — não tem par arbitrário, não tem histórico, não tem gráfico.
 * A pergunta que ele responde é a que se faz na fila do caixa.
 *
 * A MOEDA DE DESTINO NÃO SE ESCOLHE
 *
 * Ela vem do país da viagem (`currencyForCountry`). Um seletor de moedas seria
 * um campo a mais para responder algo que o sistema já sabe — e a viagem para
 * Moscovo tem uma resposta certa, que é RUB.
 *
 * A COTAÇÃO É REAL, OU NÃO EXISTE
 *
 * Nenhum câmbio embutido no código. A taxa vem do provedor, é buscada UMA vez
 * por abertura (e de novo só quando a moeda muda — nunca a cada tecla), e a
 * tela diz de quando ela é. Sem provedor e sem cache, o card diz que não tem
 * cotação em vez de mostrar uma conta inventada.
 */

const BASE_CURRENCY = 'BRL';

/**
 * Qual campo a pessoa está editando.
 *
 * É o que impede o laço (§30): o campo ativo é a FONTE e guarda o texto que
 * foi digitado; o outro é DERIVADO e é sempre recalculado. Nenhum dos dois
 * escreve no outro por efeito colateral — não há `useEffect` aqui, e é de
 * propósito: dois efeitos se atualizando em cadeia é exatamente a construção
 * que o handoff proíbe, e que trava a digitação no aparelho.
 */
type ActiveInput = 'base' | 'destination';

export function CurrencyConverterCard({ trip }: { trip: Trip }) {
  const theme = useTheme();
  const [texto, setTexto] = useState('1.000,00');
  const [active, setActive] = useState<ActiveInput>('base');

  const destino = useMemo(
    () => currencyForCountry(trip.countryCode, trip.destinationCountry),
    [trip.countryCode, trip.destinationCountry],
  );

  /*
   * A chave é o par, e o `staleTime` é longo de propósito.
   *
   * O provedor publica uma vez por dia; buscar mais do que isso gastaria rede
   * para receber o mesmo número. Digitar não dispara nada — a conversão é
   * aritmética local sobre a taxa que já está em mãos (§26, §31).
   */
  const cotacao = useQuery({
    queryKey: ['fx-reference', BASE_CURRENCY, destino ?? 'none'],
    queryFn: () => getReferenceRate(BASE_CURRENCY, destino!),
    enabled: Boolean(destino),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  // Uma moeda que não conhecemos não vira um card quebrado: ele não aparece.
  if (!destino) return null;

  const rate = cotacao.data?.rate ?? null;
  const falha = cotacao.data?.failure;
  const digitosDestino = fractionDigitsFor(destino);
  const digitosBase = fractionDigitsFor(BASE_CURRENCY);

  const digitado = parseMoneyInput(texto);
  const valido = digitado !== null && digitado >= 0;

  /*
   * UMA taxa serve aos dois sentidos (§31).
   *
   * `1 BRL = X JPY`, então BRL→JPY multiplica e JPY→BRL divide. Não há segunda
   * chamada HTTP para o inverso: pedir a tabela do iene para descobrir o que
   * já está em mãos seria gastar rede para receber o recíproco de um número
   * que o aplicativo já tem.
   */
  const convertido =
    rate && valido
      ? active === 'base'
        ? convertWithRate(digitado, rate, digitosDestino)
        : arredondar(digitado / rate.rate, digitosBase)
      : null;

  const valorBase = active === 'base' ? texto : formatNumber(convertido, digitosBase);
  const valorDestino = active === 'base' ? formatNumber(convertido, digitosDestino) : texto;

  /** Troca qual lado está sendo editado, levando junto o valor já convertido. */
  const inverter = () => {
    const proximo: ActiveInput = active === 'base' ? 'destination' : 'base';
    setTexto(formatNumber(convertido, fractionDigitsFor(proximo === 'base' ? BASE_CURRENCY : destino)));
    setActive(proximo);
  };

  const erro =
    texto.trim().length > 0 && digitado === null
      ? 'Digite um valor numérico.'
      : digitado !== null && digitado < 0
        ? 'Use um valor positivo.'
        : undefined;

  const campo = (lado: ActiveInput) => {
    const moeda = lado === 'base' ? BASE_CURRENCY : destino;
    const ativo = active === lado;
    return (
      <TextField
        testID={`fx-input-${lado}`}
        label={`Valor em ${moeda}`}
        value={lado === 'base' ? valorBase : valorDestino}
        onChangeText={(next) => {
          // Digitar num campo o torna a fonte. Sem isto, o texto novo seria
          // sobrescrito pelo cálculo do outro lado na renderização seguinte.
          setActive(lado);
          setTexto(next);
        }}
        keyboardType="decimal-pad"
        placeholder={lado === 'base' ? '1.000,00' : '0'}
        accessibilityLabel={`Valor em ${moeda}`}
        error={ativo ? erro : undefined}
        helper={`${symbolFor(moeda)} · ${ativo ? 'você digita aqui' : 'convertido'}`}
        editable={Boolean(rate)}
      />
    );
  };

  return (
    <GlassCard>
      <SectionHeader title="Conversão de moeda" />

      <View style={{ gap: theme.spacing.md }}>
        {campo('base')}

        {/*
          O botão de inverter só troca QUAL LADO se digita (§33). O destino
          continua sendo a moeda do país da viagem — inverter aqui não muda
          para onde a pessoa está viajando.
        */}
        <View style={{ alignItems: 'center' }}>
          <Pressable
            testID="fx-swap"
            onPress={inverter}
            accessibilityRole="button"
            accessibilityLabel={
              active === 'base'
                ? `Digitar em ${destino} em vez de ${BASE_CURRENCY}`
                : `Digitar em ${BASE_CURRENCY} em vez de ${destino}`
            }
            hitSlop={theme.hitSlop}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surfaceMuted,
              borderWidth: 1,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ArrowDownUp size={16} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        {campo('destination')}

        {cotacao.isLoading ? (
          <AppText variant="caption" color="tertiary" testID="fx-loading">
            Buscando cotação…
          </AppText>
        ) : null}

        {rate ? (
          <View style={{ gap: 2 }}>
            <AppText variant="bodySmall" weight="semibold" testID="fx-rate">
              {formatRate(rate.rate, BASE_CURRENCY, destino)}
            </AppText>
            {/*
              "Cotação de referência", e não "cotação em tempo real": o provedor
              publica uma vez por dia, e chamar isso de tempo real seria vender
              precisão que a fonte não tem (§26).
            */}
            <AppText variant="caption" color="tertiary">
              {`Cotação de referência · atualizada em ${formatStamp(rate.fetchedAt)}`}
            </AppText>
            <AppText variant="caption" color="tertiary">
              {EXCHANGE_RATE_ATTRIBUTION}
            </AppText>
          </View>
        ) : null}

        {rate?.stale ? (
          <InlineNotice tone="warning" icon={RefreshCw}>
            Sem conexão agora — esta é a última cotação que guardamos, de{' '}
            {formatStamp(rate.fetchedAt)}.
          </InlineNotice>
        ) : null}

        {falha ? (
          <InlineNotice tone="warning" icon={TriangleAlert}>
            {FAILURE_TEXT[falha](destino)}
          </InlineNotice>
        ) : null}
      </View>
    </GlassCard>
  );
}

function arredondar(valor: number, digitos: number): number {
  const fator = 10 ** digitos;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

/**
 * O lado derivado, escrito na convenção do usuário.
 *
 * Sem símbolo: ele já está no rótulo e no auxiliar do campo, e um "R$" dentro
 * de um campo editável viraria parte do texto assim que a pessoa digitasse.
 */
function formatNumber(valor: number | null, digitos: number): string {
  if (valor === null) return '';
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: digitos,
    maximumFractionDigits: digitos,
  });
}

/**
 * Cada falha tem a sua frase (§28).
 *
 * "Sem conexão" e "o provedor não cobre esta moeda" pedem coisas diferentes da
 * pessoa: uma se resolve saindo do metrô, a outra não se resolve. Um texto só
 * para as duas manda conferir o wi-fi por um problema que não é de wi-fi.
 */
const FAILURE_TEXT: Record<string, (currency: string) => string> = {
  offline: () =>
    'Não foi possível buscar a cotação e não há nenhuma guardada. Conecte-se e abra esta tela de novo.',
  provider_unavailable: () =>
    'O serviço de cotação não respondeu agora. Tente novamente mais tarde.',
  unsupported: (currency) =>
    `Não temos cotação de referência para ${currency}. O conversor volta assim que a moeda for publicada pela fonte.`,
};

/** "26/08 14:32" — data e hora curtas, no fuso do aparelho. */
function formatStamp(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
