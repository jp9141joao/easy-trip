import {
  deleteMirror,
  purgeMirrorForUser,
  readMirror,
  setMirrorViewer,
  writeMirrorFromBytes,
  writeMirrorFromFile,
} from '@/lib/fileMirror';

/**
 * F8 — D-04, a metade do arquivo.
 *
 * A decisão: "o Supabase Storage é a origem oficial do arquivo, nunca a única
 * forma de acesso. Uma cópia local é gravada ao anexar e ao baixar; a leitura
 * prefere a cópia local e só recorre à URL assinada quando não houver uma. A
 * exclusão precisa remover as duas."
 *
 * O dublê de sistema de arquivos em `tests/setup.ts` guarda os arquivos de
 * verdade — sem isso, "o arquivo está no aparelho" passaria sempre.
 *
 * Aqui o espectador é sempre A: o que se mede é a mecânica de gravar, ler e
 * apagar uma cópia. O isolamento ENTRE contas — que é outra coisa, e é onde
 * estava o defeito — mora em `file-mirror-accounts.test.ts`.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';

const caminhoA = `${A}/${TRIP}/bilhete.pdf`;
const caminhoB = `${B}/${TRIP}/bilhete.pdf`;

/* eslint-disable @typescript-eslint/no-require-imports */
const resetFs = () => (require('expo-file-system') as { __reset: () => void }).__reset();

beforeEach(() => {
  resetFs();
  // Sem espectador não há espelho: uma cópia local sem dono é exatamente o que
  // este módulo passou a recusar. Todo cenário abaixo roda dentro da sessão A.
  setMirrorViewer(null);
  setMirrorViewer(A);
});

afterEach(() => setMirrorViewer(null));

describe('gravar e ler a cópia local', () => {
  it('antes de espelhar, não há cópia', () => {
    expect(readMirror('attachments', caminhoA)).toBeUndefined();
  });

  it('espelhar ao anexar deixa o arquivo disponível', async () => {
    const uri = await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/escolhido.pdf');
    expect(uri).toBeDefined();
    expect(readMirror('attachments', caminhoA)).toBe(uri);
  });

  it('espelhar ao baixar deixa o arquivo disponível', async () => {
    const uri = await writeMirrorFromBytes('journal', caminhoA, new ArrayBuffer(8));
    expect(uri).toBeDefined();
    expect(readMirror('journal', caminhoA)).toBe(uri);
  });

  it('o caminho local é derivado do caminho remoto — não há registro para dessincronizar', async () => {
    const primeira = await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/x.pdf');
    deleteMirror('attachments', caminhoA);
    const segunda = await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/y.pdf');
    expect(segunda).toBe(primeira);
  });

  it('o mesmo caminho em buckets diferentes não colide', async () => {
    await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/a.pdf');
    expect(readMirror('journal', caminhoA)).toBeUndefined();
  });

  it('regravar substitui em vez de duplicar', async () => {
    const um = await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/a.pdf');
    const dois = await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/b.pdf');
    expect(dois).toBe(um);
    expect(readMirror('attachments', caminhoA)).toBe(um);
  });
});

describe('a exclusão remove as duas pontas', () => {
  it('apagar o espelho tira o arquivo do aparelho', async () => {
    await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/a.pdf');
    deleteMirror('attachments', caminhoA);
    expect(readMirror('attachments', caminhoA)).toBeUndefined();
  });

  it('apagar um espelho que não existe não é erro', () => {
    expect(() => deleteMirror('attachments', caminhoA)).not.toThrow();
  });

  it('apagar um espelho não toca nos outros arquivos da mesma conta', async () => {
    await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/a.pdf');
    await writeMirrorFromFile('attachments', caminhoB, 'file:///cache/b.pdf');

    deleteMirror('attachments', caminhoA);

    expect(readMirror('attachments', caminhoA)).toBeUndefined();
    expect(readMirror('attachments', caminhoB)).toBeDefined();
  });
});

describe('o expurgo da conta', () => {
  it('leva tudo o que a conta baixou, inclusive o que outra pessoa enviou', async () => {
    await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/a.pdf');
    await writeMirrorFromFile('journal', `${A}/entrada/foto.jpg`, 'file:///cache/foto.jpg');
    // Caminho remoto sob o UID de B, cópia local baixada por A: é de A.
    await writeMirrorFromFile('attachments', caminhoB, 'file:///cache/b.pdf');

    purgeMirrorForUser(A);

    expect(readMirror('attachments', caminhoA)).toBeUndefined();
    expect(readMirror('journal', `${A}/entrada/foto.jpg`)).toBeUndefined();
    expect(readMirror('attachments', caminhoB)).toBeUndefined();
  });

  it('o expurgo varre os três buckets privados da conta', async () => {
    await writeMirrorFromFile('avatars', `${A}/avatar.jpg`, 'file:///cache/av.jpg');
    await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/a.pdf');

    purgeMirrorForUser(A);

    expect(readMirror('avatars', `${A}/avatar.jpg`)).toBeUndefined();
    expect(readMirror('attachments', caminhoA)).toBeUndefined();
  });
});

describe('caminho remoto adulterado não vira escrita fora da pasta', () => {
  // O valor vem de uma coluna do banco. Uma linha adulterada não pode fazer o
  // aplicativo escrever onde quiser (§47).
  it.each([
    ['travessia', '../../../etc/passwd'],
    ['absoluto', '/etc/passwd'],
    ['ponto-ponto no meio', `${A}/../${B}/roubado.pdf`],
    ['contrabarra', `${A}\\${TRIP}\\x.pdf`],
    ['segmento vazio', `${A}//x.pdf`],
    ['sem pasta', 'solto.pdf'],
    ['vazio', ''],
  ])('%s é recusado', async (_rotulo, caminho) => {
    expect(await writeMirrorFromFile('attachments', caminho, 'file:///cache/x.pdf')).toBeUndefined();
    expect(readMirror('attachments', caminho)).toBeUndefined();
  });
});
