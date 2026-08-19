import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
  Award,
  Camera,
  Globe2,
  MapPinned,
  Plane,
  Settings,
  Target,
  Trophy,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Avatar,
  Badge,
  Button,
  GlassCard,
  IconButton,
  SectionHeader,
  SelectField,
  StatCard,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { getTravelStats } from '@/domain/selectors';
import { profileSchema, type ProfileInput } from '@/domain/schemas';
import {
  CURRENCIES,
  TRAVEL_STYLES,
  type CurrencyCode,
  type TravelStyle,
} from '@/domain/types';
import { useGoals } from '@/hooks/useGoals';
import { useUpdateProfile, useUploadAvatar } from '@/hooks/useProfile';
import { useTrips } from '@/hooks/useTrips';
import { guessMimeType } from '@/lib/files';
import { TRAVEL_STYLE_LABEL } from '@/lib/labels';
import { useAuth } from '@/providers/AuthProvider';
import { getDeviceTimezone } from '@/services/timezone';
import { useTheme } from '@/theme';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const { user, profile } = useAuth();
  const { data: trips = [] } = useTrips();
  const { data: goals = [] } = useGoals();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();

  // Every figure is derived from real records — never hardcoded (§60).
  const stats = useMemo(() => getTravelStats(trips, goals), [trips, goals]);
  const badges = useMemo(() => earnedBadges(stats), [stats]);

  const { control, handleSubmit, formState } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    values: {
      name: profile?.name ?? '',
      phone: profile?.phone,
      homeCity: profile?.homeCity,
      homeCountry: profile?.homeCountry,
      homeTimezone: profile?.homeTimezone ?? getDeviceTimezone(),
      travelStyle: profile?.travelStyle,
      defaultCurrency: profile?.defaultCurrency ?? 'BRL',
    },
  });

  const onSubmit = async (values: ProfileInput) => {
    try {
      await updateProfile.mutateAsync({
        name: values.name,
        phone: values.phone,
        homeCity: values.homeCity,
        homeCountry: values.homeCountry,
        homeTimezone: values.homeTimezone,
        travelStyle: values.travelStyle as TravelStyle | undefined,
        defaultCurrency: values.defaultCurrency as CurrencyCode,
      });
      toast.success('Perfil salvo');
    } catch {
      toast.error('Não foi possível salvar o perfil. Tente novamente.');
    }
  };

  const changeAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.warning('Permita o acesso às fotos para alterar seu avatar.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.fileName ?? `avatar-${Date.now()}.jpg`;
      await uploadAvatar.mutateAsync({
        uri: asset.uri,
        name,
        mimeType: asset.mimeType ?? guessMimeType(name, 'image/jpeg'),
        size: asset.fileSize,
      });
      toast.success('Foto atualizada');
    } catch {
      toast.error('Não foi possível atualizar a foto.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingHorizontal: theme.spacing.screen }}>
          <AppHeader
            label="Perfil"
            title="Seu perfil"
            showBack
            right={
              <IconButton
                icon={Settings}
                accessibilityLabel="Configurações"
                onPress={() => router.push('/profile/settings')}
                background="surface"
                style={theme.shadows.sm}
              />
            }
          />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: insets.bottom + theme.spacing['3xl'],
            gap: theme.spacing.xl,
          }}
        >
          {/* ------------------------------ Hero ------------------------------ */}
          <GlassCard elevation="md">
            <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <View>
                <Avatar uri={profile?.avatarUrl} name={profile?.name} size={92} />
                <View style={{ position: 'absolute', bottom: -4, right: -4 }}>
                  <IconButton
                    icon={Camera}
                    accessibilityLabel="Alterar foto do perfil"
                    onPress={() => void changeAvatar()}
                    background="primary"
                    size={16}
                    style={{ width: 34, height: 34 }}
                    disabled={uploadAvatar.isPending}
                  />
                </View>
              </View>

              <View style={{ alignItems: 'center', gap: 2 }}>
                <AppText variant="h2">{profile?.name || 'Viajante'}</AppText>
                <AppText variant="bodySmall" color="secondary">
                  {user?.email}
                </AppText>
                {profile?.homeCity ? (
                  <AppText variant="caption" color="tertiary">
                    {profile.homeCity}
                    {profile.homeCountry ? `, ${profile.homeCountry}` : ''}
                  </AppText>
                ) : null}
              </View>

              {profile?.travelStyle ? (
                <Badge label={TRAVEL_STYLE_LABEL[profile.travelStyle]} tone="brand" />
              ) : null}
            </View>
          </GlassCard>

          {/* ---------------------------- Statistics -------------------------- */}
          <View>
            <SectionHeader title="Suas estatísticas" subtitle="Calculadas a partir das suas viagens" />
            <View style={{ gap: theme.spacing.md }}>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <StatCard
                  label="Viagens"
                  value={String(stats.totalTrips)}
                  icon={Plane}
                  tone="brand"
                />
                <StatCard
                  label="Concluídas"
                  value={String(stats.completedTrips)}
                  icon={Trophy}
                  tone="success"
                />
              </View>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <StatCard
                  label="Países visitados"
                  value={String(stats.visitedCountries)}
                  icon={Globe2}
                  tone="accent"
                />
                <StatCard
                  label="Metas concluídas"
                  value={`${stats.completedGoals}/${stats.totalGoals}`}
                  icon={Target}
                  tone="warning"
                />
              </View>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <StatCard
                  label="Dias viajados"
                  value={String(stats.daysTravelled)}
                  icon={MapPinned}
                  tone="neutral"
                />
                <StatCard
                  label="Planejadas"
                  value={String(stats.upcomingTrips)}
                  tone="brand"
                />
              </View>
            </View>

            {stats.countriesList.length > 0 ? (
              <AppText variant="caption" color="tertiary" style={{ marginTop: theme.spacing.sm }}>
                {stats.countriesList.join(' · ')}
              </AppText>
            ) : null}
          </View>

          {/* ------------------------------ Badges ---------------------------- */}
          <View>
            <SectionHeader
              title="Conquistas"
              subtitle="Cada medalha tem uma condição objetiva"
            />
            <View style={{ gap: theme.spacing.md }}>
              {badges.map((badge) => (
                <GlassCard key={badge.title} elevation={badge.earned ? 'sm' : 'flat'}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      opacity: badge.earned ? 1 : 0.55,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: badge.earned
                          ? theme.colors.warningSoft
                          : theme.colors.surfaceMuted,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Award
                        size={20}
                        color={badge.earned ? theme.colors.warning : theme.colors.textTertiary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText variant="body" weight="semibold">
                        {badge.title}
                      </AppText>
                      <AppText variant="caption" color="secondary">
                        {badge.condition}
                      </AppText>
                    </View>
                    {badge.earned ? <Badge label="Conquistada" tone="success" /> : null}
                  </View>
                </GlassCard>
              ))}
            </View>
          </View>

          {/* ------------------------------- Form ----------------------------- */}
          <View>
            <SectionHeader title="Dados pessoais" />
            <View style={{ gap: theme.spacing.lg }}>
              <Controller
                control={control}
                name="name"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Nome"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                    autoCapitalize="words"
                    required
                  />
                )}
              />

              <TextField
                label="E-mail"
                value={user?.email ?? ''}
                editable={false}
                helper="O e-mail da conta não pode ser alterado aqui."
              />

              <Controller
                control={control}
                name="phone"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Telefone"
                    placeholder="(11) 90000-0000"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                    keyboardType="phone-pad"
                  />
                )}
              />

              <Controller
                control={control}
                name="homeCity"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Cidade base"
                    placeholder="Onde você mora"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="homeCountry"
                render={({ field, fieldState }) => (
                  <TextField
                    label="País"
                    placeholder="Brasil"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="homeTimezone"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Fuso horário de origem"
                    placeholder="America/Sao_Paulo"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                    helper="Usado na comparação de fuso com o destino."
                    autoCapitalize="none"
                  />
                )}
              />

              <Controller
                control={control}
                name="travelStyle"
                render={({ field, fieldState }) => (
                  <SelectField
                    label="Estilo de viagem"
                    value={field.value}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                    placeholder="Não definido"
                    options={TRAVEL_STYLES.map((style) => ({
                      value: style,
                      label: TRAVEL_STYLE_LABEL[style],
                    }))}
                  />
                )}
              />

              <Controller
                control={control}
                name="defaultCurrency"
                render={({ field, fieldState }) => (
                  <SelectField
                    label="Moeda padrão"
                    value={field.value}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                    helper="Sugerida ao criar novas viagens e despesas."
                    options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                  />
                )}
              />

              <Button
                label="Salvar perfil"
                size="lg"
                fullWidth
                loading={formState.isSubmitting || updateProfile.isPending}
                onPress={handleSubmit(onSubmit)}
                haptic
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Badge conditions are objective and checked against real stats (§61). */
function earnedBadges(stats: ReturnType<typeof getTravelStats>) {
  return [
    {
      title: 'Primeira Jornada',
      condition: 'Concluir a primeira viagem',
      earned: stats.completedTrips >= 1,
    },
    {
      title: 'Planejador',
      condition: 'Planejar 3 viagens',
      earned: stats.totalTrips >= 3,
    },
    {
      title: 'Explorador',
      condition: 'Visitar 5 países',
      earned: stats.visitedCountries >= 5,
    },
    {
      title: 'Meta Batida',
      condition: 'Concluir a primeira meta',
      earned: stats.completedGoals >= 1,
    },
  ];
}
