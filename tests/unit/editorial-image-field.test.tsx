import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { EditorialImageField } from '@/components/admin/EditorialImageField';
import { ToastProvider } from '@/components/ui';
import { articleFormSchema, placeFormSchema } from '@/domain/schemas';
import { pickEditorialImage } from '@/lib/imagePicker';
import { ThemeProvider } from '@/theme';

/**
 * O campo que fechou a metade aberta do P-04 (F9, §8).
 *
 * O que estes testes fixam é o contrário do que existia até a F8: **não há
 * campo de texto para colar URL**. A imagem entra por seleção de arquivo, o
 * envio acontece no "Salvar" do formulário, e a tela diz ao administrador se a
 * imagem gravada é do Easy Trip ou de um host de terceiro — porque a diferença
 * muda o que acontece na troca.
 */

jest.mock('@/lib/imagePicker', () => ({ pickEditorialImage: jest.fn() }));

const picker = pickEditorialImage as jest.Mock;

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const MANAGED =
  'https://projeto.supabase.co/storage/v1/object/public/content/articles/art-1/foto.jpg';
const LEGACY = 'https://images.unsplash.com/photo-1517840901100?auto=format&w=1200';

const arquivo = {
  uri: 'file:///cache/nova.jpg',
  name: 'nova.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
};

async function renderField(props: Partial<React.ComponentProps<typeof EditorialImageField>> = {}) {
  const onChange = jest.fn();
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <EditorialImageField pending={undefined} onChange={onChange} {...props} />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
  return { onChange };
}

beforeEach(() => picker.mockReset());

describe('campo de imagem editorial', () => {
  it('não oferece campo de URL — a imagem entra por arquivo', async () => {
    await renderField({ value: LEGACY });

    expect(screen.queryByText('Imagem (URL)')).toBeNull();
    expect(screen.queryByPlaceholderText('https://…')).toBeNull();
    expect(screen.getByText('Trocar imagem')).toBeTruthy();
  });

  it('convida a escolher quando não há imagem nenhuma', async () => {
    await renderField();
    expect(screen.getByText('Escolher imagem')).toBeTruthy();
    expect(screen.getByText('Sem imagem')).toBeTruthy();
  });

  it('distingue imagem hospedada pelo Easy Trip de imagem externa legada', async () => {
    await renderField({ value: MANAGED });
    expect(screen.getByText('Hospedada pelo Easy Trip')).toBeTruthy();

    screen.unmount();
    await renderField({ value: LEGACY });
    expect(screen.getByText('Imagem externa (legado)')).toBeTruthy();
  });

  it('entrega o arquivo escolhido ao formulário, sem enviar nada', async () => {
    picker.mockResolvedValue({ status: 'picked', file: arquivo });
    const { onChange } = await renderField({ value: MANAGED });

    await act(async () => {
      fireEvent.press(screen.getByText('Trocar imagem'));
    });

    expect(onChange).toHaveBeenCalledWith(arquivo);
  });

  it('não muda nada quando o administrador cancela o seletor', async () => {
    picker.mockResolvedValue({ status: 'cancelled' });
    const { onChange } = await renderField({ value: MANAGED });

    await act(async () => {
      fireEvent.press(screen.getByText('Trocar imagem'));
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('não muda nada quando o arquivo é recusado pela política do bucket', async () => {
    picker.mockResolvedValue({ status: 'rejected', message: 'Escolha uma imagem JPG, PNG ou WEBP.' });
    const { onChange } = await renderField({ value: MANAGED });

    await act(async () => {
      fireEvent.press(screen.getByText('Trocar imagem'));
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('anuncia que a imagem escolhida ainda não subiu', async () => {
    await renderField({ value: MANAGED, pending: arquivo });
    expect(screen.getByText('Nova imagem — sobe ao salvar')).toBeTruthy();
    // E dá como desfazer, porque o formulário inteiro pode ser abandonado.
    expect(screen.getByText('Desfazer')).toBeTruthy();
  });

  it('marca a remoção pedida sem apagar nada ainda', async () => {
    const { onChange } = await renderField({ value: MANAGED });

    await act(async () => {
      fireEvent.press(screen.getByText('Remover'));
    });
    expect(onChange).toHaveBeenCalledWith(null);

    screen.unmount();
    await renderField({ value: MANAGED, pending: null });
    expect(screen.getByText('Será removida ao salvar')).toBeTruthy();
  });
});

describe('schemas administrativos', () => {
  it('não têm mais campo de URL de imagem para validar', () => {
    // A ausência é a correção: enquanto o campo existisse, colar um endereço do
    // Unsplash continuaria sendo o caminho principal (P-04).
    expect(Object.keys(articleFormSchema.shape)).not.toContain('imageUrl');
    expect(Object.keys(placeFormSchema.shape)).not.toContain('imageUrl');
  });

  it('um artigo válido não precisa de imagem digitada', () => {
    const resultado = articleFormSchema.safeParse({
      title: 'Um título qualquer',
      category: 'Preparação',
      authorName: 'Equipe Easy Trip',
      content: 'x'.repeat(100),
      estimatedReadMinutes: 5,
      status: 'draft',
    });
    expect(resultado.success).toBe(true);
  });
});
