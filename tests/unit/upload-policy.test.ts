import {
  ATTACHMENT_POLICY,
  CONTENT_IMAGE_POLICY,
  JOURNAL_POLICY,
  attachmentStoragePath,
  contentImagePath,
  journalStoragePath,
  validateUpload,
} from '@/domain/upload';

/**
 * F7 — P-09 do lado do cliente.
 *
 * Nada aqui é o controle de segurança: o controle é a `0007`, medida contra o
 * Storage de verdade em `supabase/tests/storage_e2e.mjs`. O que se mede neste
 * arquivo é a primeira barreira — a que dá uma resposta útil antes de o arquivo
 * sair do aparelho — e, principalmente, que o caminho no Storage seja
 * **construído** e nunca montado com texto vindo do seletor de arquivos.
 */

const arquivo = (over: Partial<{ name: string; mimeType: string; size: number }> = {}) => ({
  name: 'passagem.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  ...over,
});

describe('política de anexo (bilhetes e apólices)', () => {
  it('aceita PDF — é o formato em que a companhia aérea entrega o bilhete', () => {
    expect(validateUpload(arquivo(), ATTACHMENT_POLICY).ok).toBe(true);
  });

  it('aceita as três imagens que o aplicativo consegue renderizar', () => {
    for (const [mimeType, name] of [
      ['image/jpeg', 'cartao.jpg'],
      ['image/png', 'cartao.png'],
      ['image/webp', 'cartao.webp'],
    ]) {
      expect(validateUpload(arquivo({ mimeType, name }), ATTACHMENT_POLICY).ok).toBe(true);
    }
  });

  it.each([
    ['application/octet-stream', 'qualquer.bin'],
    ['application/x-msdownload', 'instalador.exe'],
    ['application/zip', 'tudo.zip'],
    ['video/mp4', 'video.mp4'],
    ['text/html', 'pagina.html'],
    ['application/msword', 'carta.doc'],
  ])('recusa %s', (mimeType, name) => {
    const resultado = validateUpload(arquivo({ mimeType, name }), ATTACHMENT_POLICY);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.reason).toBe('mime');
  });

  it('recusa acima de 10 MB e aceita exatamente 10 MB', () => {
    const teto = 10 * 1024 * 1024;
    expect(validateUpload(arquivo({ size: teto }), ATTACHMENT_POLICY).ok).toBe(true);
    expect(validateUpload(arquivo({ size: teto + 1 }), ATTACHMENT_POLICY).ok).toBe(false);
  });

  it('deixa passar quando o aparelho não informa o tamanho — quem barra é o bucket', () => {
    expect(validateUpload(arquivo({ size: undefined }), ATTACHMENT_POLICY).ok).toBe(true);
  });
});

describe('política do diário', () => {
  it('aceita foto', () => {
    expect(validateUpload(arquivo({ mimeType: 'image/jpeg', name: 'praia.jpg' }), JOURNAL_POLICY).ok).toBe(
      true,
    );
  });

  it('recusa PDF — a galeria renderiza com `expo-image` e um PDF viraria quadro quebrado', () => {
    // Esta é a diferença deliberada entre as duas políticas. Se um dia alguém
    // igualar as duas listas "para simplificar", este teste cai.
    expect(validateUpload(arquivo(), JOURNAL_POLICY).ok).toBe(false);
    expect(validateUpload(arquivo(), ATTACHMENT_POLICY).ok).toBe(true);
  });
});

describe('política da imagem editorial', () => {
  it('aceita imagem até 5 MB e recusa acima', () => {
    const cinco = 5 * 1024 * 1024;
    const img = { mimeType: 'image/png', name: 'capa.png' };
    expect(validateUpload(arquivo({ ...img, size: cinco }), CONTENT_IMAGE_POLICY).ok).toBe(true);
    expect(validateUpload(arquivo({ ...img, size: cinco + 1 }), CONTENT_IMAGE_POLICY).ok).toBe(false);
  });

  it('recusa PDF — é o único bucket público do projeto', () => {
    expect(validateUpload(arquivo(), CONTENT_IMAGE_POLICY).ok).toBe(false);
  });
});

describe('extensão e tipo precisam concordar', () => {
  it('recusa o executável renomeado para .jpg', () => {
    // O caso do §6: renomear não converte. O tipo declarado é o que o Storage
    // vai gravar como `contentType`, então tipo e sufixo discordando é sinal de
    // que um dos dois está mentindo.
    const resultado = validateUpload(
      arquivo({ name: 'foto.jpg', mimeType: 'application/x-msdownload' }),
      ATTACHMENT_POLICY,
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.reason).toBe('mime');
  });

  it('recusa `.exe` declarado como imagem', () => {
    const resultado = validateUpload(
      arquivo({ name: 'foto.exe', mimeType: 'image/jpeg' }),
      ATTACHMENT_POLICY,
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.reason).toBe('extension');
  });

  it('aceita `.jpeg` e `.jpg` para o mesmo tipo', () => {
    for (const name of ['foto.jpg', 'foto.jpeg', 'FOTO.JPG']) {
      expect(validateUpload(arquivo({ name, mimeType: 'image/jpeg' }), ATTACHMENT_POLICY).ok).toBe(true);
    }
  });

  it('ignora parâmetros do tipo (`image/jpeg; charset=binary`)', () => {
    const resultado = validateUpload(
      arquivo({ name: 'foto.jpg', mimeType: 'image/jpeg; charset=binary' }),
      ATTACHMENT_POLICY,
    );
    expect(resultado.ok).toBe(true);
    expect(resultado.ok === true && resultado.mimeType).toBe('image/jpeg');
  });

  it('sem sufixo no nome, usa o do tipo declarado', () => {
    const resultado = validateUpload(
      arquivo({ name: 'sem-extensao', mimeType: 'image/png' }),
      ATTACHMENT_POLICY,
    );
    expect(resultado.ok === true && resultado.extension).toBe('png');
  });
});

describe('o caminho no Storage é construído, nunca recebido', () => {
  const UID_A = '11111111-1111-4111-8111-111111111111';
  const UID_B = '22222222-2222-4222-8222-222222222222';
  const TRIP = '33333333-3333-4333-8333-333333333333';

  const nomesHostis = [
    '../../../etc/passwd',
    `../${UID_B}/roubado.jpg`,
    '/absoluto.jpg',
    'pasta/subpasta/arquivo.jpg',
    '..%2F..%2Fescapou.jpg',
    'nome\\com\\contrabarra.jpg',
    `${UID_B}/arquivo.jpg`,
  ];

  it.each(nomesHostis)('o nome hostil %s não aparece no caminho', (name) => {
    // O nome nem é passado para a função de caminho — este teste existe para
    // travar a assinatura. Se alguém voltar a montar o caminho com o nome do
    // arquivo, a chamada deixa de compilar antes de o teste rodar.
    const validacao = validateUpload({ name, mimeType: 'image/jpeg' }, ATTACHMENT_POLICY);
    const extensao = validacao.ok ? validacao.extension : 'jpg';
    const caminho = attachmentStoragePath(UID_A, TRIP, extensao, 'unico');

    expect(caminho).not.toContain('..');
    expect(caminho).not.toContain(UID_B);
    expect(caminho).not.toContain('%2F');
    expect(caminho).not.toContain('\\');
    expect(caminho.split('/')[0]).toBe(UID_A);
  });

  it('o primeiro segmento é sempre o dono — é ele que a policy compara com auth.uid()', () => {
    expect(attachmentStoragePath(UID_A, TRIP, 'pdf', 'x').split('/')[0]).toBe(UID_A);
    expect(journalStoragePath(UID_A, 'entrada', 'jpg', 'x').split('/')[0]).toBe(UID_A);
  });

  it('o caminho tem exatamente três segmentos', () => {
    expect(attachmentStoragePath(UID_A, TRIP, 'pdf', 'x').split('/')).toHaveLength(3);
    expect(journalStoragePath(UID_A, 'entrada', 'jpg', 'x').split('/')).toHaveLength(3);
  });

  it('dois envios do mesmo arquivo não colidem', () => {
    // `upsert: true` sobrescreveria o objeto, e a URL assinada anterior passaria
    // a servir o conteúdo novo até expirar.
    const a = attachmentStoragePath(UID_A, TRIP, 'pdf', 'primeiro');
    const b = attachmentStoragePath(UID_A, TRIP, 'pdf', 'segundo');
    expect(a).not.toBe(b);
  });

  it('a imagem editorial é organizada por família, sem UID', () => {
    // `content` não é namespaced por usuário: quem escreve é a administração, e
    // a policy confere `is_admin()` em vez de prefixo.
    expect(contentImagePath('articles', 'artigo-1', 'jpg', 'x')).toBe('articles/artigo-1/x.jpg');
    expect(contentImagePath('offers', 'oferta-1', 'png', 'y')).toBe('offers/oferta-1/y.png');
  });
});
