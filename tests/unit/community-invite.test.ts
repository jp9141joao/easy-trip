import { isCommunityInviteConfigured } from '@/constants/community';

/**
 * O convite precisa abrir para quem tem e para quem não tem o WhatsApp
 * instalado (§10) — por isso só endereços HTTPS servem.
 */
describe('community invite url', () => {
  it('accepts the https invites that open with and without the app', () => {
    expect(isCommunityInviteConfigured('https://chat.whatsapp.com/AbCdEf123456')).toBe(true);
    expect(isCommunityInviteConfigured('https://wa.me/5511999999999')).toBe(true);
  });

  it('rejects a deep link, which strands anyone without the app', () => {
    expect(isCommunityInviteConfigured('whatsapp://chat?code=AbCdEf')).toBe(false);
  });

  it('rejects addresses that are not a real invite', () => {
    expect(isCommunityInviteConfigured('http://chat.whatsapp.com/AbCdEf')).toBe(false);
    expect(isCommunityInviteConfigured('https://chat.whatsapp.com/')).toBe(false);
    expect(isCommunityInviteConfigured('https://example.com/AbCdEf')).toBe(false);
    expect(isCommunityInviteConfigured('')).toBe(false);
    expect(isCommunityInviteConfigured('   ')).toBe(false);
  });
});
