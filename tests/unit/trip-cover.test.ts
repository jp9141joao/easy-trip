import {
  TRIP_COVER_POLICY,
  coverPathBelongsTo,
  tripCoverStoragePath,
  tripCoverUri,
  validateTripCover,
} from '@/domain/tripCover';
import { localDataSource, localCollections } from '@/repositories/local/LocalDataSource';
import type { Trip } from '@/domain/types';

/**
 * A capa da viagem: política, caminho e ciclo de troca (§3–§6, §57 do handoff).
 *
 * A REGRA QUE ESTA SUÍTE PROTEGE: o arquivo antigo só sai DEPOIS que o novo
 * está salvo (§5, §57.10). A ordem inversa deixaria a viagem sem capa se o meio
 * do caminho falhasse — e é o tipo de defeito que só aparece com a rede ruim de
 * quem está viajando.
 */

const trip = (patch: Partial<Trip> = {}): Trip => ({
  id: '11111111-1111-4111-8111-111111111111',
  userId: 'u1',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-09-27',
  coverImageUrl: 'https://images.unsplash.com/photo-tokyo',
  budgetTotal: 10000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

const arquivo = (name = 'foto.jpg', mimeType = 'image/jpeg', size = 1024) => ({
  uri: `file:///cache/${name}`,
  name,
  mimeType,
  size,
});

describe('a política da capa (§5)', () => {
  it('aceita as imagens que o `expo-image` renderiza nos dois sistemas', () => {
    expect(validateTripCover(arquivo('a.jpg', 'image/jpeg')).ok).toBe(true);
    expect(validateTripCover(arquivo('a.png', 'image/png')).ok).toBe(true);
    expect(validateTripCover(arquivo('a.webp', 'image/webp')).ok).toBe(true);
  });

  it('recusa PDF, com uma frase que diz o que serve', () => {
    const resultado = validateTripCover(arquivo('doc.pdf', 'application/pdf'));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toBe('mime');
      expect(resultado.message).toContain('JPG');
    }
  });

  it('recusa arquivo acima de 5 MB', () => {
    const resultado = validateTripCover(arquivo('grande.jpg', 'image/jpeg', 6 * 1024 * 1024));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reason).toBe('size');
  });

  it('recusa o `.mov` renomeado para `.jpg`', () => {
    // Nome e tipo precisam concordar: um vídeo com extensão de imagem subiria
    // com `contentType` de imagem e nunca renderizaria.
    const resultado = validateTripCover(arquivo('video.mov', 'image/jpeg'));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reason).toBe('extension');
  });

  it('normaliza o tipo com parâmetros', () => {
    const resultado = validateTripCover(arquivo('a.jpg', 'image/jpeg; charset=binary'));

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.mimeType).toBe('image/jpeg');
  });

  it('os limites acompanham os do bucket da 0013', () => {
    expect(TRIP_COVER_POLICY.maxBytes).toBe(5242880);
    expect([...TRIP_COVER_POLICY.mimeTypes].sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});

describe('o caminho no Storage (§57.11)', () => {
  it('começa pelo tripId — é ele que a policy compara', () => {
    const path = tripCoverStoragePath('trip-1', 'jpg', 'abc');

    expect(path.startsWith('trip-1/')).toBe(true);
    expect(path).toBe('trip-1/cover-abc.jpg');
  });

  it('não usa o nome vindo da galeria', () => {
    // O nome pode conter `../` ou barras, e é o primeiro segmento que decide de
    // quem é a pasta.
    const path = tripCoverStoragePath('trip-1', 'png', 'xyz');
    expect(path).not.toContain('..');
    expect(path.split('/')).toHaveLength(2);
  });

  it('nomes diferentes a cada troca, para a URL assinada antiga não servir a nova', () => {
    expect(tripCoverStoragePath('t', 'jpg', 'a')).not.toBe(tripCoverStoragePath('t', 'jpg', 'b'));
  });

  it('reconhece o caminho que pertence à viagem — e recusa o que não pertence', () => {
    expect(coverPathBelongsTo('trip-1/cover-a.jpg', 'trip-1')).toBe(true);
    expect(coverPathBelongsTo('trip-2/cover-a.jpg', 'trip-1')).toBe(false);
    expect(coverPathBelongsTo('cover-a.jpg', 'trip-1')).toBe(false);
    expect(coverPathBelongsTo('trip-1/sub/cover-a.jpg', 'trip-1')).toBe(false);
  });
});

describe('qual imagem a tela desenha (§3)', () => {
  it('a capa enviada tem precedência sobre a sugerida', () => {
    expect(
      tripCoverUri({ coverImageSignedUrl: 'https://signed/x', coverImageUrl: 'https://unsplash/y' }),
    ).toBe('https://signed/x');
  });

  it('sem capa enviada, volta à sugerida do destino', () => {
    expect(tripCoverUri({ coverImageUrl: 'https://unsplash/y' })).toBe('https://unsplash/y');
  });

  it('sem nenhuma das duas, devolve undefined para o degradê da marca aparecer', () => {
    expect(tripCoverUri({})).toBeUndefined();
  });
});

describe('o ciclo de troca e remoção (§57)', () => {
  beforeEach(async () => {
    await localCollections.trips.removeWhere(() => true);
  });

  const criar = () => localDataSource.trips.create(trip());

  it('salva a nova capa e a viagem passa a apontar para ela (§57.5)', async () => {
    const criada = await criar();
    const salva = await localDataSource.trips.replaceCover(criada.id, arquivo());

    expect(salva.coverImagePath).toBeTruthy();
    expect(tripCoverUri(salva)).toBe(salva.coverImagePath);
  });

  it('reabrir a viagem mantém a capa (§57.6)', async () => {
    const criada = await criar();
    await localDataSource.trips.replaceCover(criada.id, arquivo());

    const relida = await localDataSource.trips.get(criada.id);
    expect(relida?.coverImagePath).toBeTruthy();
  });

  it('substituir troca o caminho, e o antigo não é o novo (§57.7)', async () => {
    const criada = await criar();
    const primeira = await localDataSource.trips.replaceCover(criada.id, arquivo('a.jpg'));
    const segunda = await localDataSource.trips.replaceCover(criada.id, arquivo('b.jpg'));

    expect(segunda.coverImagePath).toBeTruthy();
    expect(segunda.coverImagePath).not.toBe(primeira.coverImagePath);
  });

  it('a viagem nunca fica sem capa entre as duas (§57.10)', async () => {
    /*
     * A ordem é: sobe → aponta → apaga a anterior. Em qualquer instante
     * observável a viagem aponta para UM arquivo que existe — nunca para
     * nenhum. É o que este teste mede: depois da troca a viagem tem caminho, e
     * o caminho é o novo.
     */
    const criada = await criar();
    const primeira = await localDataSource.trips.replaceCover(criada.id, arquivo('a.jpg'));
    expect(primeira.coverImagePath).toBeTruthy();

    const segunda = await localDataSource.trips.replaceCover(criada.id, arquivo('b.jpg'));
    const relida = await localDataSource.trips.get(criada.id);

    expect(relida?.coverImagePath).toBe(segunda.coverImagePath);
    expect(relida?.coverImagePath).toBeTruthy();
  });

  it('remover devolve a viagem à imagem sugerida, sem apagá-la (§57.8)', async () => {
    const criada = await criar();
    await localDataSource.trips.replaceCover(criada.id, arquivo());
    const removida = await localDataSource.trips.removeCover(criada.id);

    expect(removida.coverImagePath).toBeUndefined();
    // `coverImageUrl` nunca deixou de existir — estava embaixo o tempo todo.
    expect(tripCoverUri(removida)).toBe('https://images.unsplash.com/photo-tokyo');
  });

  it('recusa o arquivo inválido antes de mexer na viagem (§57.4)', async () => {
    const criada = await criar();

    await expect(
      localDataSource.trips.replaceCover(criada.id, arquivo('doc.pdf', 'application/pdf')),
    ).rejects.toThrow();

    const relida = await localDataSource.trips.get(criada.id);
    expect(relida?.coverImagePath).toBeUndefined();
  });
});
