import {
  deleteMirror,
  getMirrorViewer,
  purgeMirrorForUser,
  purgeTripMirrors,
  readMirror,
  setMirrorViewer,
  writeMirrorFromBytes,
  writeMirrorFromFile,
} from '@/lib/fileMirror';

/**
 * O espelho local pertence a quem BAIXOU — §11 a §14 do handoff.
 *
 * O defeito que estes cenários existem para não deixar voltar: o caminho local
 * era derivado só de `{bucket}/{storagePath}`, e `storagePath` começa com o UID
 * de quem ENVIOU o arquivo. Numa viagem compartilhada isso significava que a
 * cópia que B baixou do bilhete de A morava debaixo do UID de A. Duas
 * consequências, as duas ruins:
 *
 *  - sair da conta de B não removia a cópia de B (o expurgo procurava a pasta
 *    de B, e o arquivo estava na de A);
 *  - sair da conta de A removia um arquivo que era de B.
 *
 * Agora cada conta tem a sua própria cópia, e as sessões não se alcançam.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PARIS = '33333333-3333-4333-8333-333333333333';
const TOQUIO = '44444444-4444-4444-8444-444444444444';

/** O bilhete que A anexou na viagem compartilhada: o caminho remoto é de A. */
const bilhete = `${A}/${PARIS}/bilhete.pdf`;

/* eslint-disable @typescript-eslint/no-require-imports */
const resetFs = () => (require('expo-file-system') as { __reset: () => void }).__reset();

beforeEach(() => {
  resetFs();
  setMirrorViewer(null);
});

afterEach(() => setMirrorViewer(null));

describe('cada conta é dona da própria cópia', () => {
  it('A anexa e B baixa o mesmo objeto: são duas cópias, uma de cada', async () => {
    setMirrorViewer(A);
    const deA = await writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');

    setMirrorViewer(B);
    expect(readMirror('attachments', bilhete)).toBeUndefined(); // B ainda não baixou
    const deB = await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));

    expect(deA).toBeDefined();
    expect(deB).toBeDefined();
    expect(deB).not.toBe(deA);

    setMirrorViewer(A);
    expect(readMirror('attachments', bilhete)).toBe(deA);
    setMirrorViewer(B);
    expect(readMirror('attachments', bilhete)).toBe(deB);
  });

  it('sair da conta de B remove a cópia de B e conserva a de A', async () => {
    setMirrorViewer(A);
    await writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');
    setMirrorViewer(B);
    await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));

    // A saída de B: o provider zera o espectador e expurga a pasta dele.
    setMirrorViewer(null);
    purgeMirrorForUser(B);

    setMirrorViewer(B);
    expect(readMirror('attachments', bilhete)).toBeUndefined();
    setMirrorViewer(A);
    expect(readMirror('attachments', bilhete)).toBeDefined();
  });

  it('sair da conta de A não remove a cópia que B continua podendo abrir', async () => {
    setMirrorViewer(A);
    await writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');
    setMirrorViewer(B);
    await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));

    setMirrorViewer(null);
    purgeMirrorForUser(A);

    setMirrorViewer(A);
    expect(readMirror('attachments', bilhete)).toBeUndefined();
    setMirrorViewer(B);
    expect(readMirror('attachments', bilhete)).toBeDefined();
  });

  it('apagar o registro remove só a cópia de quem está na sessão', async () => {
    setMirrorViewer(A);
    await writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');
    setMirrorViewer(B);
    await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));

    deleteMirror('attachments', bilhete);

    expect(readMirror('attachments', bilhete)).toBeUndefined();
    setMirrorViewer(A);
    expect(readMirror('attachments', bilhete)).toBeDefined();
  });
});

describe('sem sessão não há espelho', () => {
  it('não lê', async () => {
    setMirrorViewer(A);
    await writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');
    setMirrorViewer(null);
    expect(readMirror('attachments', bilhete)).toBeUndefined();
  });

  it('não grava — uma cópia local sem dono não teria quem a apagasse depois', async () => {
    setMirrorViewer(null);
    expect(await writeMirrorFromFile('attachments', bilhete, 'file:///cache/x.pdf')).toBeUndefined();
    expect(await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8))).toBeUndefined();
  });
});

describe('download que termina depois da saída (§13)', () => {
  it('a gravação atrasada não recria a cópia da conta que saiu', async () => {
    setMirrorViewer(B);

    // O download começou dentro da sessão de B e os bytes chegaram depois. Na
    // prática quem chama é `ensureOfflineCopy`, cujo `await` da rede cruza o
    // logout — aqui o logout acontece entre o começo e a gravação.
    const bytes = new ArrayBuffer(8);
    setMirrorViewer(null);
    purgeMirrorForUser(B);

    const gravado = await writeMirrorFromBytes('attachments', bilhete, bytes);

    expect(gravado).toBeUndefined();
    setMirrorViewer(B);
    expect(readMirror('attachments', bilhete)).toBeUndefined();
  });

  it('nem quando a mesma conta volta a entrar antes de o download terminar', async () => {
    setMirrorViewer(B);
    const emVoo = writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');

    // Saída e nova entrada da MESMA conta: a época avançou duas vezes, e o
    // trabalho pendente pertence à sessão anterior.
    setMirrorViewer(null);
    setMirrorViewer(B);

    expect(await emVoo).toBeUndefined();
    expect(readMirror('attachments', bilhete)).toBeUndefined();
  });

  it('renovar o token não cancela um espelhamento em curso', async () => {
    setMirrorViewer(B);
    const emVoo = writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');

    // TOKEN_REFRESHED reaplica a mesma identidade. Não é troca de sessão.
    setMirrorViewer(B);

    expect(await emVoo).toBeDefined();
    expect(readMirror('attachments', bilhete)).toBeDefined();
  });
});

describe('perder acesso à viagem apaga a cópia local dela (§14)', () => {
  it('remove os arquivos daquela viagem e conserva os das outras', async () => {
    setMirrorViewer(B);
    await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));
    await writeMirrorFromBytes('attachments', `${A}/${TOQUIO}/reserva.pdf`, new ArrayBuffer(8));

    purgeTripMirrors(B, PARIS);

    expect(readMirror('attachments', bilhete)).toBeUndefined();
    expect(readMirror('attachments', `${A}/${TOQUIO}/reserva.pdf`)).toBeDefined();
  });

  it('a cópia de quem continua na viagem fica onde está', async () => {
    setMirrorViewer(A);
    await writeMirrorFromFile('attachments', bilhete, 'file:///cache/bilhete.pdf');
    setMirrorViewer(B);
    await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));

    // B foi removido de Paris; A continua sendo dono dela.
    purgeTripMirrors(B, PARIS);

    expect(readMirror('attachments', bilhete)).toBeUndefined();
    setMirrorViewer(A);
    expect(readMirror('attachments', bilhete)).toBeDefined();
  });

  it('a mídia de diário sai pelos caminhos que o chamador conhece', async () => {
    // `journal` é `{uid}/{entryId}/{arquivo}`: a viagem não aparece no caminho,
    // então a varredura por pasta não a encontra e quem chama passa a lista.
    const foto = `${A}/entrada-1/foto.jpg`;
    setMirrorViewer(B);
    await writeMirrorFromBytes('journal', foto, new ArrayBuffer(8));

    purgeTripMirrors(B, PARIS);
    expect(readMirror('journal', foto)).toBeDefined();

    purgeTripMirrors(B, PARIS, [{ bucket: 'journal', storagePath: foto }]);
    expect(readMirror('journal', foto)).toBeUndefined();
  });

  it('reconvite: o que a conta baixa depois de voltar continua valendo', async () => {
    setMirrorViewer(B);
    await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));
    purgeTripMirrors(B, PARIS);

    // B foi reconvidado e abriu o bilhete de novo.
    const depois = await writeMirrorFromBytes('attachments', bilhete, new ArrayBuffer(8));
    expect(depois).toBeDefined();
    expect(readMirror('attachments', bilhete)).toBe(depois);
  });
});

describe('quem está olhando é observável', () => {
  it('acompanha a sessão aplicada', () => {
    expect(getMirrorViewer()).toBeNull();
    setMirrorViewer(A);
    expect(getMirrorViewer()).toBe(A);
    setMirrorViewer(null);
    expect(getMirrorViewer()).toBeNull();
  });
});
