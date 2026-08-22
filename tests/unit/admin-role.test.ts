import { isAdminProfile, parseUserRole } from '@/domain/roles';
import type { ProfilePatch } from '@/domain/types';
import { jsonStorage } from '@/lib/storage';
import { dataSource } from '@/repositories';

/**
 * O núcleo da autorização: como um papel é lido e como ele é gravado.
 *
 * Os dois riscos reais desta fase estão aqui. O primeiro é o aplicativo tratar
 * "não sei" como "pode" — valor ausente, banco não migrado, leitura que falhou.
 * O segundo é o próprio usuário conseguir gravar o papel dele.
 */

const draft = (overrides: ProfilePatch = {}): ProfilePatch => ({
  name: 'Joao',
  defaultCurrency: 'BRL',
  ...overrides,
});

/**
 * Uma conta já promovida, gravada direto no armazenamento.
 *
 * É assim que a promoção acontece de verdade: um UPDATE no Supabase, fora do
 * aplicativo. Não existe caminho de dentro do app para chegar a este estado — e
 * é justamente isso que o teste seguinte verifica. Precisa rodar antes de
 * qualquer leitura, porque a coleção local hidrata do disco uma vez só.
 */
beforeAll(async () => {
  await jsonStorage.set('profiles', [
    { id: 'chefe', userId: 'chefe', name: 'Chefe', defaultCurrency: 'BRL', role: 'admin' },
  ]);
});

describe('parseUserRole', () => {
  it('accepts only the two roles the schema allows', () => {
    expect(parseUserRole('user')).toBe('user');
    expect(parseUserRole('admin')).toBe('admin');
  });

  it('falls back to user for anything it does not recognise', () => {
    // Cada entrada é um cenário real: coluna ainda não criada (undefined),
    // linha antiga (null), papel inventado, e o caso clássico de um valor
    // "quase certo" vindo de digitação manual no banco.
    for (const value of [undefined, null, '', 'ADMIN', 'Admin', 'superadmin', 0, 1, true, {}]) {
      expect(parseUserRole(value)).toBe('user');
    }
  });
});

describe('isAdminProfile', () => {
  it('treats a missing profile as unprivileged', () => {
    // Perfil carregando, perfil inexistente e perfil que falhou ao carregar
    // chegam aqui como null. Nenhum deles pode virar permissão (§28, §29).
    expect(isAdminProfile(null)).toBe(false);
    expect(isAdminProfile(undefined)).toBe(false);
  });

  it('reads the role and nothing else', () => {
    expect(isAdminProfile({ role: 'admin' })).toBe(true);
    expect(isAdminProfile({ role: 'user' })).toBe(false);
  });
});

describe('profile persistence', () => {
  it('creates every new account as a plain user', async () => {
    const saved = await dataSource.profile.update('novo', draft());
    expect(saved.role).toBe('user');
    expect((await dataSource.profile.get('novo'))?.role).toBe('user');
  });

  it('refuses to let a profile edit change the role', async () => {
    await dataSource.profile.update('escalada', draft());

    // Um cliente adulterado não obedece a tipos, então o teste também não:
    // manda `role: 'admin'` no mesmo update que a tela de perfil usaria.
    const forged = { ...draft({ name: 'Novo nome' }), role: 'admin' };
    const saved = await dataSource.profile.update('escalada', forged as ProfilePatch);

    // O nome muda — editar o perfil continua funcionando normalmente.
    expect(saved.name).toBe('Novo nome');
    // O papel, não.
    expect(saved.role).toBe('user');
    expect((await dataSource.profile.get('escalada'))?.role).toBe('user');
  });

  it('reads a promoted account as admin and keeps it that way', async () => {
    expect((await dataSource.profile.get('chefe'))?.role).toBe('admin');

    // A recíproca do teste anterior: assim como uma edição não promove, ela
    // também não pode rebaixar quem foi promovido fora do aplicativo.
    const saved = await dataSource.profile.update('chefe', draft({ name: 'Chefe' }));
    expect(saved.role).toBe('admin');
    expect((await dataSource.profile.get('chefe'))?.role).toBe('admin');
  });
});
