import { useQuery } from '@tanstack/react-query';
import { CloudRain, Umbrella } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { queryKeys } from '@/hooks/queryKeys';
import { todayISO } from '@/lib/date';
import {
  getActivityForecast,
  isWithinForecastHorizon,
  RAIN_ADVICE_THRESHOLD,
} from '@/services/activityWeather';
import { useTheme } from '@/theme';

/**
 * A previsão do tempo de uma atividade, no horário dela (§20, §21).
 *
 * De onde vem o número: Open-Meteo, o mesmo serviço da tela de clima. Nunca do
 * Gemini — um modelo de linguagem escreve uma frase que soa como previsão sem
 * ter previsão nenhuma.
 *
 * Fora do horizonte de 16 dias, a linha muda para "Previsão disponível mais
 * perto da data" em vez de sumir. A ausência silenciosa pareceria defeito; a
 * frase explica que o dado não existe ainda, o que é diferente de não termos ido
 * buscá-lo.
 */
export function ActivityWeather({
  latitude,
  longitude,
  date,
  startTime,
}: {
  latitude?: number;
  longitude?: number;
  date: string;
  startTime?: string;
}) {
  const theme = useTheme();
  const today = todayISO();

  const enabled =
    typeof latitude === 'number' && typeof longitude === 'number' && Boolean(startTime);
  const withinHorizon = isWithinForecastHorizon(date, today);

  const { data } = useQuery({
    queryKey: queryKeys.activityWeather(latitude ?? 0, longitude ?? 0, date),
    queryFn: () =>
      getActivityForecast({ latitude: latitude!, longitude: longitude!, date, today, startTime }),
    enabled: enabled && withinHorizon,
    staleTime: 30 * 60 * 1000,
  });

  if (!enabled) return null;

  if (!withinHorizon) {
    return (
      <AppText variant="caption" color="tertiary">
        Previsão disponível mais perto da data.
      </AppText>
    );
  }

  const hour = data?.at;
  if (!hour) return null;

  const rainy = hour.precipitationProbability >= RAIN_ADVICE_THRESHOLD;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {rainy ? <CloudRain size={12} color={theme.colors.warning} /> : null}
      <AppText variant="caption" color={rainy ? 'primary' : 'tertiary'}>
        {`${hour.temperature}° · ${hour.precipitationProbability}% de chuva`}
      </AppText>
      {rainy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Umbrella size={12} color={theme.colors.warning} />
          <AppText variant="caption" color="secondary">
            Leve guarda-chuva
          </AppText>
        </View>
      ) : null}
      {/*
        §21: uma previsão servida do cache sem rede não pode ser apresentada
        como se tivesse acabado de chegar.
      */}
      {data?.stale ? (
        <AppText variant="caption" color="tertiary">
          · previsão salva
        </AppText>
      ) : null}
    </View>
  );
}
