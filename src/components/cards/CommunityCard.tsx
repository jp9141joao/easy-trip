import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { MessageCircle } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Button, GlassCard, useToast } from '@/components/ui';
import { WHATSAPP_COMMUNITY_URL, isCommunityInviteConfigured } from '@/constants/community';
import { useTheme } from '@/theme';

/**
 * Convite para a comunidade do Easy Trip no WhatsApp (§2, §3).
 *
 * O verde da marca aparece só no ícone; o CTA continua no Ocean Blue do
 * aplicativo, para a seção ler como parte do Easy Trip e não como um banner
 * externo colado no fim da página (§4).
 *
 * O `lucide` não publica ícones de marca, então `MessageCircle` é o mais
 * próximo sem trazer uma biblioteca nova só por causa deste cartão (§17).
 */
export function CommunityCard() {
  const theme = useTheme();
  const toast = useToast();

  const open = async () => {
    if (!isCommunityInviteConfigured()) {
      // Falhar em silêncio seria pior: o usuário toca, nada acontece e ele não
      // sabe se o problema é dele ou do aplicativo (§9).
      toast.error('O convite da comunidade ainda não foi configurado.');
      return;
    }

    try {
      // Um convite HTTPS é entregue ao WhatsApp quando ele está instalado; o
      // sistema resolve isso sozinho pelo domínio.
      await Linking.openURL(WHATSAPP_COMMUNITY_URL);
    } catch {
      try {
        // Sem o aplicativo instalado, o mesmo endereço abre no navegador (§10).
        await WebBrowser.openBrowserAsync(WHATSAPP_COMMUNITY_URL);
      } catch {
        toast.error('Não foi possível abrir a comunidade agora. Tente novamente.');
      }
    }
  };

  return (
    <View style={{ paddingHorizontal: theme.spacing.screen }}>
      <GlassCard>
        <View style={{ gap: theme.spacing.md }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: theme.radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.whatsapp.background,
              borderWidth: 1,
              borderColor: theme.colors.whatsapp.border,
            }}
          >
            <MessageCircle size={24} color={theme.colors.whatsapp.foreground} />
          </View>

          <View style={{ gap: 4 }}>
            <AppText variant="h3">Comunidade Easy Trip</AppText>
            <AppText variant="bodySmall" color="secondary">
              Viajar fica ainda melhor quando a gente compartilha. Entre no nosso grupo do
              WhatsApp para trocar dicas, contar experiências e descobrir destinos com outros
              viajantes.
            </AppText>
          </View>

          <Button
            label="Entrar na comunidade"
            onPress={() => void open()}
            fullWidth
            accessibilityLabel="Entrar na comunidade do Easy Trip no WhatsApp"
          />
        </View>
      </GlassCard>
    </View>
  );
}
