import * as ImagePicker from 'expo-image-picker';

import { pickEditorialImage } from '@/lib/imagePicker';

/**
 * A escolha da imagem editorial, antes de qualquer upload (F9, §8 e §13).
 *
 * O ponto que estes testes fixam: **abrir o seletor não envia nada**. Nenhum
 * caminho desta função fala com o Storage — quem envia é o "Salvar" do
 * formulário. Um cancelamento, uma permissão negada ou um arquivo recusado
 * param aqui, sem lixo no bucket.
 *
 * A recusa por tipo e tamanho é a mesma do bucket (`0007`), repetida na tela
 * para o motivo chegar antes do upload — não no lugar dele.
 */

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const permission = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;

const MB = 1024 * 1024;

const asset = (overrides: Record<string, unknown> = {}) => ({
  canceled: false,
  assets: [
    {
      uri: 'file:///cache/escolhida.jpg',
      fileName: 'escolhida.jpg',
      mimeType: 'image/jpeg',
      fileSize: 2 * MB,
      ...overrides,
    },
  ],
});

beforeEach(() => {
  permission.mockReset();
  launch.mockReset();
  permission.mockResolvedValue({ granted: true });
});

describe('escolha de imagem editorial', () => {
  it('devolve `denied` sem abrir a galeria quando a permissão é negada', async () => {
    permission.mockResolvedValue({ granted: false });

    expect(await pickEditorialImage()).toEqual({ status: 'denied' });
    expect(launch).not.toHaveBeenCalled();
  });

  it('devolve `cancelled` quando o administrador desiste', async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickEditorialImage()).toEqual({ status: 'cancelled' });
  });

  it('devolve `cancelled` quando o seletor volta sem arquivo', async () => {
    launch.mockResolvedValue({ canceled: false, assets: [] });
    expect(await pickEditorialImage()).toEqual({ status: 'cancelled' });
  });

  it('aceita JPG, PNG e WEBP', async () => {
    for (const [name, mimeType] of [
      ['foto.jpg', 'image/jpeg'],
      ['foto.png', 'image/png'],
      ['foto.webp', 'image/webp'],
    ]) {
      launch.mockResolvedValue(asset({ fileName: name, mimeType }));
      const resultado = await pickEditorialImage();
      expect(resultado.status).toBe('picked');
    }
  });

  it('recusa PDF — o bucket `content` só aceita imagem', async () => {
    launch.mockResolvedValue(asset({ fileName: 'apolice.pdf', mimeType: 'application/pdf' }));

    const resultado = await pickEditorialImage();
    expect(resultado.status).toBe('rejected');
    expect(resultado).toHaveProperty('message', 'Escolha uma imagem JPG, PNG ou WEBP.');
  });

  it('recusa SVG e octet-stream', async () => {
    for (const mimeType of ['image/svg+xml', 'application/octet-stream']) {
      launch.mockResolvedValue(asset({ fileName: 'arquivo.bin', mimeType }));
      expect((await pickEditorialImage()).status).toBe('rejected');
    }
  });

  it('aceita exatamente 5 MB e recusa 5 MB + 1 byte', async () => {
    launch.mockResolvedValue(asset({ fileSize: 5 * MB }));
    expect((await pickEditorialImage()).status).toBe('picked');

    launch.mockResolvedValue(asset({ fileSize: 5 * MB + 1 }));
    const grande = await pickEditorialImage();
    expect(grande.status).toBe('rejected');
    expect(grande).toHaveProperty('message', 'O arquivo precisa ter no máximo 5 MB.');
  });

  it('recusa arquivo cujo nome não combina com o conteúdo', async () => {
    launch.mockResolvedValue(asset({ fileName: 'video.mov', mimeType: 'image/jpeg' }));
    expect((await pickEditorialImage()).status).toBe('rejected');
  });

  it('normaliza o tipo e sobrevive ao aparelho que não informa nome nem tamanho', async () => {
    launch.mockResolvedValue(
      asset({ fileName: undefined, fileSize: undefined, mimeType: 'image/jpeg; charset=binary' }),
    );

    const resultado = await pickEditorialImage();
    expect(resultado.status).toBe('picked');
    if (resultado.status !== 'picked') return;
    expect(resultado.file.mimeType).toBe('image/jpeg');
    expect(resultado.file.uri).toBe('file:///cache/escolhida.jpg');
  });
});
