import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  Ambulance,
  ExternalLink,
  Flame,
  LifeBuoy,
  Phone,
  Shield,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Button,
  EmptyState,
  GlassCard,
  InlineNotice,
  SectionHeader,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { useInsurance } from '@/hooks/useContent';
import { useCurrentTrip } from '@/hooks/useTrips';
import { consulateSearchUrl, emergencyService } from '@/services/emergency';
import { useTheme } from '@/theme';

/**
 * Emergency screen (§65).
 *
 * Numbers are resolved from `trip.countryCode`, never hardcoded. If the country
 * is not in our validated dataset we say so plainly rather than showing a number
 * that could be wrong when it matters most.
 */
export default function SosScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { trip } = useCurrentTrip();
  const { policies } = useInsurance();

  const contacts = useMemo(
    () => (trip ? emergencyService.getContacts(trip.countryCode) : null),
    [trip],
  );

  const call = async (number: string) => {
    try {
      const url = `tel:${number.replace(/\s/g, '')}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        toast.warning('Este dispositivo não pode iniciar chamadas.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      toast.error('Não foi possível iniciar a chamada.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Emergência"
          title="SOS"
          subtitle={trip ? `${trip.destinationCountry}` : undefined}
          showBack
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.lg,
        }}
      >
        {!trip ? (
          <GlassCard>
            <EmptyState
              icon={LifeBuoy}
              title="Nenhuma viagem ativa"
              message="Selecione uma viagem para ver os contatos de emergência do destino."
              actionLabel="Ver viagens"
              onAction={() => router.replace('/(tabs)/trips')}
            />
          </GlassCard>
        ) : (
          <>
            <InlineNotice icon={ShieldAlert} tone="error">
              Em uma emergência real, ligue imediatamente para o número local. Estes contatos são de{' '}
              {trip.destinationCountry}.
            </InlineNotice>

            {!contacts ? (
              // The honest failure path demanded by §65.
              <GlassCard>
                <EmptyState
                  icon={TriangleAlert}
                  title="Não foi possível validar o número local"
                  message={`Ainda não temos dados verificados de emergência para ${trip.destinationCountry}. Consulte as autoridades oficiais do destino ou o seu seguro viagem.`}
                />
              </GlassCard>
            ) : (
              <>
                <View style={{ gap: theme.spacing.md }}>
                  {contacts.general ? (
                    <EmergencyButton
                      icon={ShieldAlert}
                      label="Emergência geral"
                      number={contacts.general}
                      tone="error"
                      onPress={() => void call(contacts.general!)}
                    />
                  ) : null}
                  {contacts.police ? (
                    <EmergencyButton
                      icon={Shield}
                      label="Polícia"
                      number={contacts.police}
                      onPress={() => void call(contacts.police!)}
                    />
                  ) : null}
                  {contacts.ambulance ? (
                    <EmergencyButton
                      icon={Ambulance}
                      label="Ambulância"
                      number={contacts.ambulance}
                      onPress={() => void call(contacts.ambulance!)}
                    />
                  ) : null}
                  {contacts.fire ? (
                    <EmergencyButton
                      icon={Flame}
                      label="Bombeiros"
                      number={contacts.fire}
                      onPress={() => void call(contacts.fire!)}
                    />
                  ) : null}
                </View>

                {contacts.notes ? (
                  <InlineNotice icon={Phone}>{contacts.notes}</InlineNotice>
                ) : null}

                <AppText variant="caption" color="tertiary">
                  Fonte: {contacts.source} · Verificado em {contacts.verifiedAt}. Confirme sempre com
                  as autoridades locais.
                </AppText>
              </>
            )}

            {/* Travel insurance (§66) */}
            <View>
              <SectionHeader title="Seguro viagem" />
              {policies.length === 0 ? (
                <GlassCard>
                  {/*
                    O cadastro de apólice não existe nesta versão: `insurance_policies`
                    é lida aqui e preenchida por fora do aplicativo. O texto anterior
                    dizia "Adicionar documento" e levava para Documentos, o que sugeria
                    que anexar um PDF encheria esta seção — e não enche. A ação continua
                    útil (é lá que a apólice fica guardada e abre offline), mas agora
                    diz exatamente o que faz.
                  */}
                  <EmptyState
                    icon={LifeBuoy}
                    title="Nenhuma apólice cadastrada"
                    message="Guarde o PDF da sua apólice nos documentos da viagem: ele fica disponível mesmo sem internet."
                    actionLabel="Abrir documentos da viagem"
                    onAction={() => router.push(`/trip/${trip.id}/tickets`)}
                    compact
                  />
                </GlassCard>
              ) : (
                <View style={{ gap: theme.spacing.md }}>
                  {policies.map((policy) => (
                    <GlassCard key={policy.id}>
                      <View style={{ gap: theme.spacing.sm }}>
                        <AppText variant="body" weight="semibold">
                          {policy.provider}
                        </AppText>
                        <AppText variant="caption" color="secondary" mono>
                          Apólice {policy.policyNumber}
                        </AppText>
                        {policy.emergencyPhone ? (
                          <Button
                            label={`Ligar ${policy.emergencyPhone}`}
                            icon={Phone}
                            variant="secondary"
                            onPress={() => void call(policy.emergencyPhone!)}
                          />
                        ) : null}
                      </View>
                    </GlassCard>
                  ))}
                </View>
              )}
            </View>

            {/* Consulate — a search, because we have no validated phone source */}
            <Button
              label="Buscar consulado brasileiro"
              icon={ExternalLink}
              variant="secondary"
              fullWidth
              onPress={() =>
                void WebBrowser.openBrowserAsync(consulateSearchUrl(trip.destinationCountry))
              }
            />
            <AppText variant="caption" color="tertiary">
              Não exibimos telefones de consulado porque não temos uma fonte verificada para eles —
              a busca leva você às informações oficiais.
            </AppText>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function EmergencyButton({
  icon: Icon,
  label,
  number,
  tone = 'brand',
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  number: string;
  tone?: 'brand' | 'error';
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = tone === 'error' ? theme.colors.error : theme.colors.primary;
  const background = tone === 'error' ? theme.colors.errorSoft : theme.colors.primarySoft;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ligar para ${label}, número ${number.split('').join(' ')}`}
      accessibilityHint="Abre o discador com o número preenchido"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.lg,
          padding: theme.spacing.xl,
          borderRadius: theme.radius.card,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderWidth: 1,
          borderColor: tone === 'error' ? theme.colors.error : theme.colors.border,
          minHeight: 72,
        },
        theme.shadows.sm,
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={22} color={color} />
      </View>

      <View style={{ flex: 1 }}>
        <AppText variant="body" weight="semibold">
          {label}
        </AppText>
        <AppText variant="h3" mono weight="bold" style={{ color }}>
          {number}
        </AppText>
      </View>

      <Phone size={20} color={color} />
    </Pressable>
  );
}
