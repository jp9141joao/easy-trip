/**
 * Coordenada → endereço legível (§22 do handoff).
 *
 * POR QUE `expo-location` E NÃO UM SERVIÇO NOVO
 *
 * O pacote já é dependência do projeto e já está declarado em `app.json`, com
 * as permissões e a frase de justificativa. `reverseGeocodeAsync` usa o
 * geocoder do próprio sistema operacional: sem chave, sem custo, sem mais um
 * fornecedor para manter. Acrescentar um serviço pago para nomear um pino
 * seria trocar um problema resolvido por uma conta mensal.
 *
 * O QUE ACONTECE QUANDO NÃO DÁ
 *
 * Nada de grave, e é essa a regra (§24): sem permissão, sem rede ou sem
 * resultado, a função devolve `null` e o ponto continua salvável. O endereço é
 * um rótulo de conveniência; quem faz o mapa, a distância e o "Como chegar"
 * funcionarem é a coordenada, e ela a pessoa já marcou.
 *
 * O QUE NUNCA ACONTECE
 *
 * Um endereço de uma coordenada não é reaproveitado por outra. O cache é
 * endereçado pelo ponto arredondado, então mover o marcador para outro lugar
 * ou não acha nada, ou acha o endereço DAQUELE lugar — nunca o do anterior.
 */

import * as Location from 'expo-location';

export interface ResolvedPlace {
  /** Linha legível: rua, bairro, cidade, país — o que existir. */
  address: string;
  /** Nome próprio do lugar, quando o sistema conhece um. */
  placeName?: string;
}

/**
 * Cinco casas decimais ≈ 1 metro. É a granularidade do cache: mais fino não
 * muda a resposta do geocoder e só faria o cache nunca acertar.
 */
function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

const cache = new Map<string, ResolvedPlace | null>();

/** Só para os testes: o cache é de processo e sobreviveria entre cenários. */
export function resetReverseGeocodeCache(): void {
  cache.clear();
}

/**
 * Monta a linha do endereço a partir do que o sistema devolveu.
 *
 * Campos vazios são descartados em vez de virarem vírgulas soltas, e o
 * resultado é limitado ao que cabe numa linha de interface — este texto é
 * rótulo, não endereço postal.
 */
function composeAddress(place: Location.LocationGeocodedAddress): string | null {
  const rua = [place.street, place.streetNumber].filter(Boolean).join(', ');
  const partes = [rua || null, place.district, place.city ?? place.subregion, place.country]
    .map((parte) => parte?.trim())
    .filter((parte): parte is string => Boolean(parte));

  // Sem duplicar "Tóquio, Tóquio" quando cidade e região têm o mesmo nome.
  const unicas = partes.filter((parte, index) => partes.indexOf(parte) === index);
  const texto = unicas.join(', ').slice(0, 200);
  return texto.length > 0 ? texto : null;
}

/**
 * Resolve o endereço de um ponto. `null` quando não dá — e não dar é normal.
 *
 * A permissão é pedida aqui, e uma recusa não é erro: é o caminho em que o
 * ponto fica sem rótulo. Nunca lança.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<ResolvedPlace | null> {
  const chave = cacheKey(latitude, longitude);
  if (cache.has(chave)) return cache.get(chave) ?? null;

  try {
    const permissao = await Location.requestForegroundPermissionsAsync();
    if (!permissao.granted) {
      // Sem permissão não há como resolver, e insistir a cada toque no mapa
      // transformaria a marcação de um ponto num interrogatório.
      cache.set(chave, null);
      return null;
    }

    const resultados = await Location.reverseGeocodeAsync({ latitude, longitude });
    const primeiro = resultados?.[0];
    if (!primeiro) {
      cache.set(chave, null);
      return null;
    }

    const address = composeAddress(primeiro);
    if (!address) {
      cache.set(chave, null);
      return null;
    }

    const resolvido: ResolvedPlace = {
      address,
      placeName: primeiro.name?.trim() || undefined,
    };
    cache.set(chave, resolvido);
    return resolvido;
  } catch {
    // Geocoder indisponível, offline, aparelho sem Play Services. Nenhum
    // desses impede a pessoa de salvar o ponto que ela marcou.
    return null;
  }
}
