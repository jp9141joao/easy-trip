import { Languages } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import { AppText, GlassCard } from '@/components/ui';
import type { Trip } from '@/domain/types';
import {
  countryMetadata,
  destinationLanguagesToShow,
  formatLanguageList,
} from '@/lib/countryMetadata';
import { getUserLanguage } from '@/lib/locale';
import { useTheme } from '@/theme';

/**
 * O idioma falado no destino (§10, §11, §14 do handoff).
 *
 * QUANDO ELE APARECE — E QUANDO NÃO
 *
 * Só quando acrescenta. Um brasileiro indo ao Rio não precisa ser informado de
 * que lá se fala português, e um cartão dizendo isso seria ruído ocupando a
 * altura de tela que a Jornada usa para mostrar o roteiro. A decisão é de
 * `destinationLanguagesToShow`, que compara FAMÍLIAS linguísticas: `pt-BR` e
 * `pt-PT` são a mesma resposta.
 *
 * Num país multilíngue a coincidência parcial não apaga o resto: quem fala
 * francês e vai ao Luxemburgo continua vendo alemão e luxemburguês, porque a
 * parte útil da informação é justamente a que ele não sabia.
 *
 * ONDE ELE FICA
 *
 * Na Jornada, junto das demais informações rápidas da viagem — e não no hero
 * (§14). O hero identifica a viagem: destino, período, status. Um dado de
 * consulta empilhado sobre a foto disputaria com aquilo que já está lá.
 *
 * DESTINO SEM METADADOS
 *
 * Não renderiza nada. `countryMetadata` devolve `undefined` para um país que a
 * base não reconhece, e um cartão "Idioma —" seria pior que a ausência (§43).
 */
export function TripLanguageCard({ trip }: { trip: Trip }) {
  const theme = useTheme();

  const label = useMemo(() => {
    const metadata = countryMetadata(trip.countryCode, trip.destinationCountry);
    return formatLanguageList(destinationLanguagesToShow(metadata, getUserLanguage()));
  }, [trip.countryCode, trip.destinationCountry]);

  if (!label) return null;

  const plural = label.includes(' e ');

  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: theme.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Languages size={18} color={theme.colors.primary} />
        </View>

        {/* `flex: 1` + `minWidth: 0` para "Neerlandês, Francês e Alemão" quebrar
            dentro do cartão em vez de empurrar a borda (§46). */}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="caption" color="tertiary">
            {plural ? 'Idiomas do destino' : 'Idioma do destino'}
          </AppText>
          <AppText variant="body" weight="semibold">
            {label}
          </AppText>
        </View>
      </View>
    </GlassCard>
  );
}
