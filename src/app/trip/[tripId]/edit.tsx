import { useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Button,
  ConfirmDialog,
  DateField,
  ErrorState,
  GlassCard,
  MoneyField,
  SelectField,
  SkeletonList,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { CURRENCIES, type CurrencyCode, type Trip } from '@/domain/types';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useDeleteTrip, useUpdateTrip } from '@/hooks/useTrips';
import { parseISODate } from '@/lib/date';
import { useTheme } from '@/theme';

export default function EditTripScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { trip, isLoading, notFound } = useTripRoute();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          padding: theme.spacing.screen,
          paddingTop: 100,
        }}
      >
        <SkeletonList count={3} lines={2} />
      </View>
    );
  }

  if (notFound || !trip) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          padding: theme.spacing.screen,
          paddingTop: 100,
        }}
      >
        <GlassCard>
          <ErrorState
            title="Viagem não encontrada"
            message="Esta viagem pode ter sido excluída."
            onRetry={() => router.replace('/(tabs)/trips')}
            retryLabel="Voltar para viagens"
          />
        </GlassCard>
      </View>
    );
  }

  // Keying on the trip id means the form's initial state comes from props on
  // first render — no effect syncing state, and switching trips remounts clean.
  return <EditTripForm key={trip.id} trip={trip} />;
}

function EditTripForm({ trip }: { trip: Trip }) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const updateTrip = useUpdateTrip();
  const deleteTrip = useDeleteTrip();

  const [city, setCity] = useState(trip.destinationCity);
  const [country, setCountry] = useState(trip.destinationCountry);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [budget, setBudget] = useState<number | undefined>(trip.budgetTotal);
  const [currency, setCurrency] = useState<CurrencyCode>(trip.budgetCurrency);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidRange = Boolean(startDate && endDate && endDate < startDate);
  const canSave =
    city.trim().length >= 2 && country.trim().length >= 2 && !invalidRange && budget !== undefined;

  const save = async () => {
    try {
      await updateTrip.mutateAsync({
        tripId: trip.id,
        patch: {
          destinationCity: city.trim(),
          destinationCountry: country.trim(),
          startDate,
          endDate,
          budgetTotal: budget ?? 0,
          budgetCurrency: currency,
        },
      });
      toast.success('Viagem atualizada');
      router.back();
    } catch {
      toast.error('Não foi possível salvar as alterações.');
    }
  };

  const remove = async () => {
    try {
      await deleteTrip.mutateAsync(trip.id);
      toast.success('Viagem excluída');
      router.replace('/(tabs)/trips');
    } catch {
      toast.error('Não foi possível excluir a viagem.');
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
          <AppHeader label="Editar" title={trip.destinationCity} showBack />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.screen,
            paddingBottom: insets.bottom + theme.spacing['3xl'],
            gap: theme.spacing.lg,
          }}
        >
          <TextField label="Cidade" value={city} onChangeText={setCity} required />
          <TextField label="País" value={country} onChangeText={setCountry} required />

          <DateField
            label="Ida"
            value={startDate}
            onChange={(value) => {
              setStartDate(value);
              // Keep the range coherent rather than saving an impossible trip.
              if (endDate && endDate < value) setEndDate(value);
            }}
            required
          />
          <DateField
            label="Volta"
            value={endDate}
            onChange={setEndDate}
            minimumDate={startDate ? parseISODate(startDate) : undefined}
            error={invalidRange ? 'A data de volta deve ser igual ou posterior à de ida' : undefined}
            required
          />

          <SelectField<CurrencyCode>
            label="Moeda do orçamento"
            value={currency}
            onChange={setCurrency}
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
          />

          <MoneyField
            label="Orçamento total"
            value={budget}
            onChange={setBudget}
            currency={currency}
            required
          />

          <AppText variant="caption" color="tertiary">
            Fuso horário: {trip.timezone} · País (código): {trip.countryCode}
          </AppText>

          <Button
            label="Salvar alterações"
            size="lg"
            fullWidth
            disabled={!canSave}
            loading={updateTrip.isPending}
            onPress={() => void save()}
            haptic
          />

          <Button
            label="Excluir viagem"
            variant="danger"
            icon={Trash2}
            fullWidth
            onPress={() => setConfirmDelete(true)}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmDelete}
        title={`Excluir "${trip.destinationCity}"?`}
        message="Roteiro, despesas, checklist, documentos e diário vinculados também serão removidos. Essa ação não poderá ser desfeita."
        confirmLabel="Excluir"
        destructive
        loading={deleteTrip.isPending}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}
