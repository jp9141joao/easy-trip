import { isUuid, likeContains, quoteFilterValue } from '@/lib/postgrest';

/**
 * F7 — P-08.
 *
 * O defeito é de gramática: num filtro `or=(a.eq.X,b.eq.X)` a vírgula e os
 * parênteses **são** a sintaxe, e emendar o valor cru entrega essa sintaxe a
 * quem controla o valor. Aqui se mede a peça isolada; o efeito contra o
 * PostgREST de verdade é medido em `supabase/tests/storage_e2e.mjs`, que é onde
 * a afirmação "o filtro não muda mais de forma" pode ser provada.
 */

/** Remove os pares escapados, deixando só o que a gramática ainda enxerga. */
const semEscapes = (valor: string) => valor.replace(/\\./g, '');

describe('reconhecimento de UUID', () => {
  it('aceita a forma canônica', () => {
    expect(isUuid('0e000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('0E000000-0000-4000-8000-000000000001')).toBe(true);
  });

  it.each([
    ['slug comum', 'como-fazer-as-malas'],
    ['uuid com sobra à direita', '0e000000-0000-4000-8000-000000000001,status.eq.draft'],
    ['uuid com sobra à esquerda', 'x0e000000-0000-4000-8000-000000000001'],
    ['uuid sem hífens', '0e000000000040008000000000000001'],
    ['vazio', ''],
    ['só espaços', '   '],
  ])('recusa %s', (_rotulo, valor) => {
    expect(isUuid(valor)).toBe(false);
  });

  it('a carga do P-08 não passa por UUID — vai para a coluna `slug`, que é texto', () => {
    // É isto que impede a injeção de existir: se o valor não tem forma de
    // uuid, ele nunca chega perto da coluna `id`; e se tem, não sobra espaço
    // para carga nenhuma. O `.eq()` viaja como parâmetro próprio.
    const carga = '0e000000-0000-4000-8000-000000000000,status.eq.draft';
    expect(isUuid(carga)).toBe(false);
  });
});

describe('valor entre aspas em filtro composto', () => {
  it('a vírgula deixa de separar ramos', () => {
    expect(quoteFilterValue('a,b')).toBe('"a,b"');
  });

  it('escapa aspa e contrabarra — os dois que a gramática ainda enxerga', () => {
    expect(quoteFilterValue('diz "oi"')).toBe('"diz \\"oi\\""');
    expect(quoteFilterValue('c:\\pasta')).toBe('"c:\\\\pasta"');
  });

  it('uma aspa solta não consegue fechar o valor e abrir um ramo novo', () => {
    // A tentativa é sair das aspas: `",status.eq.draft,name.ilike."`.
    const saida = quoteFilterValue('",status.eq.draft,name.ilike."');
    expect(saida.startsWith('"')).toBe(true);
    expect(saida.endsWith('"')).toBe(true);
    // Toda aspa do miolo está escapada — nenhuma consegue fechar o valor.
    expect(semEscapes(saida.slice(1, -1))).not.toContain('"');
  });
});

describe('termo de busca para ilike', () => {
  it('envolve o termo em % dos dois lados', () => {
    expect(likeContains('lisboa')).toBe('"%lisboa%"');
  });

  it('escapa os curingas do LIKE — `%` digitado significa `%`, não "tudo"', () => {
    // Não é falha de segurança, é resultado errado: hoje quem digita `%` recebe
    // o diretório inteiro e não tem como saber por quê.
    //
    // São **duas** contrabarras no que vai para a rede, e não uma: o PostgREST
    // desescapa o miolo das aspas antes de a string chegar ao `LIKE`, então a
    // contrabarra que o `LIKE` precisa ver tem de sobreviver a esse passo.
    // Medido contra o PostgREST local, com a linha "Hotel 50% Off" no banco e o
    // termo `50%Off`: sem escape a busca casa (o `%` virou curinga), com escape
    // não casa (o `%` virou literal). Ver `supabase/tests/storage_e2e.mjs`.
    expect(likeContains('50%')).toBe('"%50\\\\%%"');
    expect(likeContains('a_b')).toBe('"%a\\\\_b%"');
  });

  it('neutraliza a tentativa de acrescentar um ramo pela busca', () => {
    const saida = likeContains('x%,status.eq.draft,name.ilike.%y');
    expect(saida.startsWith('"')).toBe(true);
    expect(saida.endsWith('"')).toBe(true);
    // Tudo o que parecia sintaxe está dentro das aspas, e nenhuma aspa do miolo
    // consegue fechá-las.
    expect(semEscapes(saida.slice(1, -1))).not.toContain('"');
  });
});
