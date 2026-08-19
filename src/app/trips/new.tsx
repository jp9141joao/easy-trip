import { useRouter } from 'expo-router';
import { Check, MapPin, Search, TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppImage,
  AppText,
  Button,
  DateField,
  GlassCard,
  InlineNotice,
  MoneyField,
  ProgressBar,
  SearchInput,
  SelectField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { suggestCoverImage } from '@/data/images';
import { CURRENCIES, type CurrencyCode } from '@/domain/types';
import { useCreateTrip } from '@/hooks/useTrips';
import { formatDateRange, parseISODate, todayISO } from '@/lib/date';
import { formatMoney } from '@/lib/currency';
import { useAuth } from '@/providers/AuthProvider';
import { searchDestinations, type DestinationSuggestion } from '@/services/geocoding';
import { useTheme } from '@/theme';

/**
 * Trip creation in three short steps (§30) rather than one giant form.
 *
 * The destination is resolved through geocoding, which is what gives the trip
 * its country, ISO code, coordinates and IANA timezone up front — the data that
 * Clima, Fuso and SOS all depend on (§12).
 */
export default function NewTripScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useAuth();
  const createTrip = useCreateTrip();

  const [step, setStep] = useState(0);
  const [destination, setDestination] = useState<DestinationSuggestion | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [budget, setBudget] = useState<number | undefined>();
  const [currency, setCurrency] = useState<CurrencyCode>(profile?.defaultCurrency ?? 'BRL');
  const [coverImageUrl, setCoverImageUrl] = useState<string | undefined>();

  const stepValid = useMemo(() => {
    if (step === 0) return Boolean(destination && startDate && endDate && endDate >= startDate);
    if (step === 1) return budget !== undefined && budget >= 0;
    return true;
  }, [step, destination, startDate, endDate, budget]);

  const handleCreate = async () => {
    if (!destination || budget === undefined) return;
    try {
      const trip = await createTrip.mutateAsync({
        destinationCity: destination.city,
        destinationCountry: destination.country,
        countryCode: destination.countryCode,
        latitude: destination.latitude,
        longitude: destination.longitude,
        timezone: destination.timezone,
        startDate,
        endDate,
        budgetTotal: budget,
        budgetCurrency: currency,
        coverImageUrl: coverImageUrl ?? suggestCoverImage(destination.city),
      });
      toast.success('Viagem criada');
      router.replace(`/trip/${trip.id}`);
    } catch {
      toast.error('Não foi possível criar a viagem. Tente novamente.');
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
            label={`Etapa ${step + 1} de 3`}
            title="Nova viagem"
            showBack
            onBack={() => (step === 0 ? router.back() : setStep((value) => value - 1))}
          />
          <ProgressBar percent={((step + 1) / 3) * 100} label="Progresso da criação" />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.screen,
            paddingTop: theme.spacing.xl,
            paddingBottom: insets.bottom + 120,
            gap: theme.spacing.xl,
          }}
        >
          {step === 0 ? (
            <StepDestination
              destination={destination}
              onSelect={(value) => {
                setDestination(value);
                setCoverImageUrl(suggestCoverImage(value.city));
              }}
              startDate={startDate}
              endDate={endDate}
              onStartDate={setStartDate}
              onEndDate={setEndDate}
            />
          ) : null}

          {step === 1 ? (
            <View style={{ gap: theme.spacing.xl }}>
              <View>
                <AppText variant="h3">Orçamento</AppText>
                <AppText variant="bodySmall" color="secondary">
                  Quanto você pretende gastar nesta viagem? Dá para ajustar depois.
                </AppText>
              </View>

              <SelectField<CurrencyCode>
                label="Moeda do orçamento"
                value={currency}
                onChange={setCurrency}
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                helper="As despesas em outras moedas serão convertidas para esta."
              />

              <MoneyField
                label="Orçamento total"
                value={budget}
                onChange={setBudget}
                currency={currency}
                required
              />

              {coverImageUrl ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <AppText variant="label" color="secondary">
                    Imagem de capa
                  </AppText>
                  <AppImage
                    uri={coverImageUrl}
                    style={{ height: 150, width: '100%' }}
                    radius={theme.radius.card}
                    fallbackLabel={destination?.city}
                    accessibilityLabel="Prévia da capa da viagem"
                  />
                  <AppText variant="caption" color="tertiary">
                    Sugerida a partir do destino.
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}

          {step === 2 && destination ? (
            <View style={{ gap: theme.spacing.lg }}>
              <View>
                <AppText variant="h3">Tudo certo?</AppText>
                <AppText variant="bodySmall" color="secondary">
                  Confira antes de criar a viagem.
                </AppText>
              </View>

              <GlassCard padded={false}>
                <AppImage
                  uri={coverImageUrl}
                  style={{ height: 160, width: '100%' }}
                  fallbackLabel={destination.city}
                  overlay
                />
                <View style={{ padding: theme.spacing.xl, gap: theme.spacing.md }}>
                  <View>
                    <AppText variant="h3">{destination.city}</AppText>
                    <AppText variant="bodySmall" color="secondary">
                      {destination.country}
                    </AppText>
                  </View>

                  <SummaryRow label="Período" value={formatDateRange(startDate, endDate)} />
                  <SummaryRow
                    label="Orçamento"
                    value={formatMoney(budget ?? 0, currency)}
                  />
                  <SummaryRow label="Fuso horário" value={destination.timezone} />
                  <SummaryRow label="País (código)" value={destination.countryCode} />
                </View>
              </GlassCard>

              <InlineNotice icon={Check} tone="success">
                Clima, fuso horário e contatos de emergência desta viagem já usarão{' '}
                {destination.country}.
              </InlineNotice>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={{
            position: 'absolute',
            left: theme.spacing.screen,
            right: theme.spacing.screen,
            bottom: insets.bottom + theme.spacing.lg,
          }}
        >
          <Button
            label={step === 2 ? 'Criar viagem' : 'Continuar'}
            size="lg"
            fullWidth
            disabled={!stepValid}
            loading={createTrip.isPending}
            haptic
            onPress={() => {
              if (step < 2) setStep((value) => value + 1);
              else void handleCreate();
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing.md,
      }}
    >
      <AppText variant="caption" color="tertiary">
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="semibold" numberOfLines={1} style={{ flex: 1 }} align="right">
        {value}
      </AppText>
    </View>
  );
}

/* ------------------------------ step: destino ----------------------------- */

function StepDestination({
  destination,
  onSelect,
  startDate,
  endDate,
  onStartDate,
  onEndDate,
}: {
  destination: DestinationSuggestion | null;
  onSelect: (value: DestinationSuggestion) => void;
  startDate: string;
  endDate: string;
  onStartDate: (value: string) => void;
  onEndDate: (value: string) => void;
}) {
  const theme = useTheme();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<DestinationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  const tooShort = term.trim().length < 2;

  // Debounced lookup so we do not hit the geocoder on every keystroke.
  // All state updates happen inside the timer callback rather than in the
  // effect body, which avoids the cascading re-render the React Compiler warns
  // about — the "term is too short" case is derived, not stored.
  useEffect(() => {
    if (tooShort) return;

    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      setSearching(true);
      try {
        const found = await searchDestinations(term);
        if (active) {
          setResults(found);
          setFailed(false);
        }
      } catch {
        if (active) {
          setResults([]);
          setFailed(true);
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term, tooShort]);

  // Anything below the minimum length shows no results at all.
  const visibleResults = tooShort ? [] : results;
  const showFailure = failed && !tooShort;

  return (
    <View style={{ gap: theme.spacing.xl }}>
      <View>
        <AppText variant="h3">Para onde você vai?</AppText>
        <AppText variant="bodySmall" color="secondary">
          Busque a cidade para preencher país, fuso horário e coordenadas automaticamente.
        </AppText>
      </View>

      <SearchInput
        value={term}
        onChangeText={setTerm}
        placeholder="Ex.: Paris, Kyoto, Roma"
        accessibilityLabel="Buscar destino"
      />

      {searching && !tooShort ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <AppText variant="caption" color="secondary">
            Buscando destinos…
          </AppText>
        </View>
      ) : null}

      {showFailure ? (
        <InlineNotice icon={TriangleAlert} tone="warning">
          Não foi possível buscar destinos agora. Verifique sua conexão e tente novamente.
        </InlineNotice>
      ) : null}

      {visibleResults.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          {visibleResults.map((result) => {
            const selected = destination?.id === result.id;
            return (
              <Pressable
                key={result.id}
                onPress={() => {
                  onSelect(result);
                  setTerm('');
                  setResults([]);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${result.city}, ${result.country}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  padding: theme.spacing.lg,
                  borderRadius: theme.radius.smallCard,
                  backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                })}
              >
                <MapPin size={18} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <AppText variant="body" weight="semibold" numberOfLines={1}>
                    {result.city}
                  </AppText>
                  <AppText variant="caption" color="secondary" numberOfLines={1}>
                    {result.admin ? `${result.admin} · ` : ''}
                    {result.country} · {result.timezone}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {destination ? (
        <GlassCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: theme.colors.successSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={20} color={theme.colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="body" weight="semibold">
                {destination.city}, {destination.country}
              </AppText>
              <AppText variant="caption" color="secondary">
                {destination.timezone} · {destination.countryCode}
              </AppText>
            </View>
          </View>
        </GlassCard>
      ) : (
        <InlineNotice icon={Search}>
          Escolha um destino da lista para continuar.
        </InlineNotice>
      )}

      <DateField
        label="Ida"
        value={startDate}
        onChange={(value) => {
          onStartDate(value);
          // Keep the range coherent instead of letting the user save an
          // impossible trip and only complaining afterwards.
          if (endDate && endDate < value) onEndDate(value);
        }}
        required
      />

      <DateField
        label="Volta"
        value={endDate}
        onChange={onEndDate}
        minimumDate={startDate ? parseISODate(startDate) : parseISODate(todayISO())}
        error={
          startDate && endDate && endDate < startDate
            ? 'A data de volta deve ser igual ou posterior à de ida'
            : undefined
        }
        required
      />
    </View>
  );
}
