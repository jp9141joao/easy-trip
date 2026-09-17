import * as Linking from 'expo-linking';
import { MapPin, Navigation, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type MapPressEvent, type Region } from 'react-native-maps';

import { AppText, Button, useToast } from '@/components/ui';
import { directionsUrl, type Coordinates } from '@/domain/route';
import { reverseGeocode } from '@/services/reverseGeocode';
import { useTheme } from '@/theme';

/**
 * Escolher o local de uma atividade tocando no mapa (§16–§21 do handoff).
 *
 * O QUE SAIU DA TELA, E O QUE NÃO SAIU DO BANCO
 *
 * O formulário pedia "Latitude" e "Longitude" em dois campos de texto, com
 * `48.8606` e `2.3376` de placeholder. Ninguém sabe a latitude de um
 * restaurante — e quem soubesse não estaria digitando num aplicativo de
 * viagem. Os dois campos saíram da INTERFACE.
 *
 * As coordenadas continuam existindo e continuam sendo gravadas, porque são
 * elas que fazem o item entrar na rota do dia, no cálculo de distância, no
 * "Como chegar" e na previsão por horário (§18). O que mudou é quem as
 * escreve: o toque no mapa, e não o teclado.
 *
 * O NÚMERO NUNCA APARECE
 *
 * Nem como rótulo, nem como "confirmação", nem em cinza pequeno embaixo. Se a
 * pessoa precisa ver `48.8606` para confiar no que marcou, o marcador no mapa
 * não está fazendo o trabalho dele.
 *
 * SEM LOCAL É UM ESTADO VÁLIDO
 *
 * Atividade sem coordenada continua valendo — "jantar em algum lugar" é um
 * plano legítimo. Nesse caso não há marcador nenhum: um pino no centro do mapa
 * "para não ficar vazio" seria o aplicativo afirmando um lugar que a pessoa
 * não escolheu (§20).
 */

const DELTA_PONTO = 0.01;
const DELTA_CIDADE = 0.2;

/** Quanto se espera o dedo parar antes de perguntar o endereço ao sistema. */
const DEBOUNCE_MS = 600;

/** O que o mapa devolve: o ponto e o que se conseguiu saber sobre ele. */
export interface PickedLocation extends Coordinates {
  /** Resolvido pelo geocoder do sistema. `undefined` quando não deu (§24). */
  address?: string;
  placeName?: string;
}

export function LocationPicker({
  value,
  onChange,
  /** Onde centralizar quando ainda não há ponto — as coordenadas da viagem. */
  fallbackCenter,
  editable = true,
}: {
  value: PickedLocation | null;
  onChange: (value: PickedLocation | null) => void;
  fallbackCenter?: Coordinates;
  editable?: boolean;
}) {
  const theme = useTheme();
  const toast = useToast();

  /*
   * Uma resolução por ponto, e só depois que o dedo para.
   *
   * Arrastar o marcador dispara uma mudança por quadro; perguntar o endereço a
   * cada uma delas martelaria o geocoder do sistema para jogar fora 59 de cada
   * 60 respostas. O `id` invalida a resposta de um ponto que já não é o atual
   * — sem isso, uma resolução lenta do ponto anterior poderia chegar depois e
   * carimbar o endereço errado no ponto novo, que é exatamente o que o §24
   * proíbe.
   */
  const pedido = useRef(0);
  const latitude = value?.latitude;
  const longitude = value?.longitude;
  const jaResolvido = value?.address !== undefined;
  /*
   * "Procurando endereço…" é derivado, e não estado: há um ponto e ele ainda
   * não passou pelo geocoder. A resposta (mesmo vazia, `''`) preenche
   * `address`, e o aviso some no mesmo render — sem um `setState` síncrono no
   * efeito para ligar e outro para desligar.
   */
  const resolving = latitude !== undefined && longitude !== undefined && !jaResolvido;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined || jaResolvido) return;

    const id = pedido.current + 1;
    pedido.current = id;

    const timer = setTimeout(() => {
      void reverseGeocode(latitude, longitude).then((resolvido) => {
        if (pedido.current !== id) return;
        // `address` vira string vazia quando não deu: é o registro de que a
        // tentativa aconteceu e não achou nada — diferente de "ainda não
        // tentei" —, e impede que a próxima renderização peça de novo.
        onChange({
          latitude,
          longitude,
          address: resolvido?.address ?? '',
          placeName: resolvido?.placeName,
        });
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `onChange` fora das dependências de propósito: ele costuma ser recriado a
    // cada render do formulário, e incluí-lo reiniciaria o debounce sem fim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, jaResolvido]);

  /*
   * A região inicial é calculada UMA vez.
   *
   * Recalculá-la a cada toque devolveria o mapa ao enquadramento inicial
   * sempre que a pessoa marcasse um ponto — arrastar para ver a rua ao lado e
   * tocar faria a tela pular de volta. Depois da montagem, quem manda no
   * enquadramento é o gesto.
   */
  const [regiaoInicial] = useState<Region>(() => {
    const centro = value ?? fallbackCenter;
    return {
      latitude: centro?.latitude ?? 0,
      longitude: centro?.longitude ?? 0,
      // Perto quando já existe um ponto (§19: a edição abre no marcador), e
      // aberto quando é a primeira marcação — dá para reconhecer o bairro.
      latitudeDelta: value ? DELTA_PONTO : DELTA_CIDADE,
      longitudeDelta: value ? DELTA_PONTO : DELTA_CIDADE,
    };
  });

  const semCentro = !value && !fallbackCenter;

  const marcar = (event: MapPressEvent) => {
    if (!editable) return;
    const ponto = event.nativeEvent.coordinate;
    // Sem `address`: o endereço do ponto ANTERIOR não vale para este, e o
    // efeito acima resolve o novo. Reaproveitá-lo seria afirmar um lugar que
    // ninguém verificou (§24).
    onChange({ latitude: ponto.latitude, longitude: ponto.longitude });
  };

  // O rótulo é o que o geocoder resolveu. Nunca a coordenada (§18, §25).
  const placeLabel = value?.placeName?.trim() || value?.address?.trim() || undefined;

  const abrirRota = async () => {
    if (!value) return;
    try {
      // O destino continua sendo a COORDENADA; o nome vai só como rótulo do
      // pino de chegada (§27).
      await Linking.openURL(directionsUrl(value, placeLabel));
    } catch {
      toast.error('Não foi possível abrir o aplicativo de mapas.');
    }
  };

  const acessibilidade = useMemo(() => {
    if (!value) return 'Mapa para marcar o local. Nenhum ponto marcado ainda.';
    return placeLabel
      ? `Mapa com o local marcado: ${placeLabel}.`
      : 'Mapa com o local marcado.';
  }, [placeLabel, value]);

  return (
    <View style={{ gap: theme.spacing.sm }} testID="location-picker">
      <AppText variant="label" color="secondary">
        Localização
      </AppText>

      <View
        style={{
          height: 200,
          borderRadius: theme.radius.smallCard,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.inputBorder,
        }}
        accessible
        accessibilityLabel={acessibilidade}
      >
        <MapView
          testID="location-map"
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={regiaoInicial}
          onPress={marcar}
          scrollEnabled={editable}
          zoomEnabled
          // Só leitura de verdade: sem isto, um item de outra pessoa poderia
          // ser "reposicionado" por quem não pode editá-lo.
          pointerEvents={editable ? 'auto' : 'none'}
        >
          {value ? (
            <Marker
              testID="location-marker"
              coordinate={value}
              draggable={editable}
              // Arrastar é o gesto de quem quer ajustar o ponto em vez de
              // recomeçar; tocar em outro lugar continua funcionando.
              onDragEnd={(event) => {
                if (!editable) return;
                const ponto = event.nativeEvent.coordinate;
                onChange({ latitude: ponto.latitude, longitude: ponto.longitude });
              }}
              title={placeLabel ?? 'Local da atividade'}
            />
          ) : null}
        </MapView>
      </View>

      {!value ? (
        <AppText variant="caption" color="tertiary" testID="location-empty-hint">
          {editable
            ? semCentro
              ? 'Arraste o mapa até o lugar e toque para marcar o local.'
              : 'Toque no mapa para marcar o local.'
            : 'Esta atividade não tem um local marcado.'}
        </AppText>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {/*
            UMA linha, só de leitura (§25).

            O que confirma o ponto é o endereço que o geocoder do sistema
            resolveu — nunca o par de coordenadas, que é o que a pessoa não
            deveria precisar ver. Não há campo de texto aqui: o mapa é a fonte
            da verdade, e digitar um endereço que discorde do pino criaria dois
            lugares para a mesma atividade.
          */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MapPin size={14} color={theme.colors.primary} />
            {resolving ? (
              <>
                <ActivityIndicator size="small" color={theme.colors.textTertiary} />
                <AppText variant="caption" color="tertiary" testID="location-resolving">
                  Buscando o endereço…
                </AppText>
              </>
            ) : (
              <AppText
                variant="caption"
                color={placeLabel ? 'secondary' : 'tertiary'}
                numberOfLines={2}
                style={{ flex: 1 }}
                testID="location-label"
              >
                {/*
                  Sem endereço resolvido a linha diz isso, em vez de ficar em
                  branco ou repetir o endereço de outro ponto (§24).
                */}
                {placeLabel ?? 'Local marcado'}
              </AppText>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button
              label="Como chegar"
              variant="secondary"
              size="sm"
              icon={Navigation}
              onPress={() => void abrirRota()}
              style={{ flex: 1 }}
            />
            {editable ? (
              <Button
                label="Remover"
                variant="ghost"
                size="sm"
                icon={Trash2}
                onPress={() => onChange(null)}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}
