import {
  AVATAR_MAX_BYTES,
  avatarStoragePath,
  validateAvatar,
} from '@/domain/avatar';
import { PROFILE_PATCH_FIELDS } from '@/domain/types';
import { localDataSource } from '@/repositories/local/LocalDataSource';

/**
 * F5 — regras do avatar e da allowlist do perfil.
 *
 * A parte pura roda sem rede; o final exercita o repositório local de verdade,
 * porque o que interessa em "trocar a foto" não é uma função devolver um
 * caminho — é o estado depois: o perfil apontando para a foto nova e a antiga
 * fora do caminho.
 */

const file = (overrides: Partial<Parameters<typeof validateAvatar>[0]> = {}) => ({
  name: 'foto.jpg',
  mimeType: 'image/jpeg',
  size: 200 * 1024,
  ...overrides,
});

describe('validação do avatar', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('aceita %s', (mimeType) => {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType]!;
    expect(validateAvatar(file({ name: `foto.${extension}`, mimeType }))).toMatchObject({
      ok: true,
      mimeType,
    });
  });

  it('recusa um PDF renomeado para .jpg', () => {
    const result = validateAvatar(file({ name: 'documento.jpg', mimeType: 'application/pdf' }));
    expect(result).toMatchObject({ ok: false, reason: 'mime' });
  });

  it('recusa quando nome e tipo discordam', () => {
    // Um `.mov` da galeria que veio anunciado como imagem: subiria com
    // `contentType` de imagem e nunca renderizaria.
    const result = validateAvatar(file({ name: 'video.mov', mimeType: 'image/jpeg' }));
    expect(result).toMatchObject({ ok: false, reason: 'extension' });
  });

  it('recusa HEIC, que o Android não exibe', () => {
    // Aceitar produziria avatares invisíveis para metade dos usuários.
    expect(validateAvatar(file({ name: 'foto.heic', mimeType: 'image/heic' }))).toMatchObject({
      ok: false,
      reason: 'mime',
    });
  });

  it('recusa arquivo acima do limite e diz o limite', () => {
    const result = validateAvatar(file({ size: AVATAR_MAX_BYTES + 1 }));
    expect(result).toMatchObject({ ok: false, reason: 'size' });
    expect((result as { message: string }).message).toMatch(/5 MB/);
  });

  it('aceita exatamente no limite', () => {
    expect(validateAvatar(file({ size: AVATAR_MAX_BYTES }))).toMatchObject({ ok: true });
  });

  it('não recusa por tamanho quando o aparelho não informa o tamanho', () => {
    // Alguns aparelhos não devolvem `fileSize`. Tratar ausência como zero
    // passaria; tratá-la como excesso bloquearia o upload sem motivo.
    expect(validateAvatar(file({ size: undefined }))).toMatchObject({ ok: true });
  });

  it('normaliza tipo com maiúsculas e parâmetro', () => {
    expect(validateAvatar(file({ mimeType: 'IMAGE/JPEG; charset=binary' }))).toMatchObject({
      ok: true,
      mimeType: 'image/jpeg',
    });
  });

  it('aceita .jpeg além de .jpg', () => {
    expect(validateAvatar(file({ name: 'foto.jpeg' }))).toMatchObject({ ok: true });
  });

  it('deriva a extensão do tipo quando o nome não tem uma', () => {
    expect(validateAvatar(file({ name: 'sem-extensao', mimeType: 'image/png' }))).toMatchObject({
      ok: true,
      extension: 'png',
    });
  });
});

describe('caminho no Storage', () => {
  const UID = 'aaaaaaaa-0000-4000-8000-000000000001';

  it('põe o UID como primeiro segmento', () => {
    // É esse primeiro segmento que a policy compara com `auth.uid()`.
    expect(avatarStoragePath(UID, 'jpg', 'abc')).toBe(`${UID}/avatar-abc.jpg`);
  });

  it('não usa o nome vindo da galeria', () => {
    // O nome pode conter `../` ou barras; se ele participasse do caminho,
    // participaria também do prefixo que decide de quem é a pasta.
    const path = avatarStoragePath(UID, 'png', 'xyz');
    expect(path.startsWith(`${UID}/`)).toBe(true);
    expect(path).not.toMatch(/\.\./);
    expect(path.split('/')).toHaveLength(2);
  });

  it('gera caminho diferente a cada troca', () => {
    // Caminho fixo faria a URL assinada anterior continuar apontando para o
    // mesmo objeto, e a foto trocada poderia continuar aparecendo.
    expect(avatarStoragePath(UID, 'jpg', 'um')).not.toBe(avatarStoragePath(UID, 'jpg', 'dois'));
  });
});

describe('allowlist do perfil', () => {
  it('não expõe identidade nem autorização como editáveis', () => {
    for (const proibido of ['role', 'userId', 'avatarPath', 'avatarUrl', 'createdAt']) {
      expect(PROFILE_PATCH_FIELDS).not.toContain(proibido);
    }
  });

  it('cobre exatamente os campos que a tela de perfil edita', () => {
    expect([...PROFILE_PATCH_FIELDS].sort()).toEqual([
      'defaultCurrency',
      'homeCity',
      'homeCountry',
      'homeTimezone',
      'name',
      'phone',
      'travelStyle',
    ]);
  });
});

describe('repositório de perfil (fonte local)', () => {
  const UID = 'perfil-f5';

  it('grava o que a tela edita e devolve o perfil completo', async () => {
    const saved = await localDataSource.profile.update(UID, {
      name: 'Joana',
      phone: '+55 11 90000-0000',
      travelStyle: 'aventura',
      defaultCurrency: 'EUR',
    });

    expect(saved).toMatchObject({ name: 'Joana', defaultCurrency: 'EUR', role: 'user' });
    expect((await localDataSource.profile.get(UID))?.phone).toBe('+55 11 90000-0000');
  });

  it('uma edição parcial não apaga o que ela não menciona', async () => {
    await localDataSource.profile.update(UID, { name: 'Joana', phone: '+55 11 90000-0000' });
    await localDataSource.profile.update(UID, { name: 'Joana Silva' });

    const stored = await localDataSource.profile.get(UID);
    expect(stored?.name).toBe('Joana Silva');
    expect(stored?.phone).toBe('+55 11 90000-0000');
  });

  it('troca a foto, aponta o perfil para a nova e descarta a anterior', async () => {
    const primeira = await localDataSource.profile.replaceAvatar(UID, {
      uri: 'file:///tmp/primeira.jpg',
      name: 'primeira.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    });
    expect(primeira.avatarPath).toBeTruthy();

    const segunda = await localDataSource.profile.replaceAvatar(UID, {
      uri: 'file:///tmp/segunda.png',
      name: 'segunda.png',
      mimeType: 'image/png',
      size: 2048,
    });

    expect(segunda.avatarPath).not.toBe(primeira.avatarPath);
    expect((await localDataSource.profile.get(UID))?.avatarPath).toBe(segunda.avatarPath);
  });

  it('recusa a troca antes de tocar no perfil quando o arquivo é inválido', async () => {
    const antes = await localDataSource.profile.get(UID);

    await expect(
      localDataSource.profile.replaceAvatar(UID, {
        uri: 'file:///tmp/doc.pdf',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      }),
    ).rejects.toThrow();

    // O ponto: uma troca recusada não pode deixar o usuário sem foto.
    expect((await localDataSource.profile.get(UID))?.avatarPath).toBe(antes?.avatarPath);
  });

  it('editar o perfil não mexe na foto', async () => {
    // Era exatamente aqui que a URL assinada voltava para a coluna do caminho.
    const antes = await localDataSource.profile.get(UID);
    const depois = await localDataSource.profile.update(UID, { name: 'Outro nome' });

    expect(depois.avatarPath).toBe(antes?.avatarPath);
  });
});
