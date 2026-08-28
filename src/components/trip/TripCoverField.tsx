import { ImagePlus, RotateCcw, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppImage,
  AppText,
  Button,
  ButtonRow,
  ConfirmDialog,
  GlassCard,
  InlineNotice,
  SectionHeader,
  useToast,
} from '@/components/ui';
import { tripCoverUri } from '@/domain/tripCover';
import type { Trip } from '@/domain/types';
import { useTripCover } from '@/hooks/useTrips';
import { pickTripCoverImage } from '@/lib/imagePicker';
import type { UploadableFile } from '@/repositories/types';
import { useTheme } from '@/theme';

/**
 * Trocar a capa da viagem (§3–§6 do handoff).
 *
 * O FLUXO, E POR QUE ELE TEM DOIS PASSOS
 *
 * Escolher NÃO envia. A imagem escolhida vira uma prévia local e fica em
 * memória até a pessoa confirmar; quem abre, escolhe e desiste não deixa nada no
 * Storage. É a mesma decisão do seletor editorial, pelo mesmo motivo — e é o
 * que dá sentido a "Cancelar" (§57.3): cancelar tem de deixar a viagem
 * exatamente como estava.
 *
 * A ORDEM DA TROCA (§5)
 *
 * Sobe → aponta → só então apaga a anterior. Isso não acontece aqui: acontece
 * dentro do repositório, que é onde dá para desfazer o upload se a gravação
 * falhar no meio. Esta tela só sabe de sucesso e de erro.
 *
 * REMOVER NÃO É FICAR SEM IMAGEM
 *
 * Remover a capa enviada devolve a viagem à imagem sugerida na criação, que
 * nunca foi apagada — estava embaixo o tempo todo. Por isso o botão diz
 * "Restaurar padrão" e não "Excluir imagem": é o que de fato acontece.
 */
export function TripCoverField({ trip }: { trip: Trip }) {
  const theme = useTheme();
  const toast = useToast();
  const cover = useTripCover(trip.id);

  const [preview, setPreview] = useState<UploadableFile | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const enviando = cover.replace.isPending;
  const removendo = cover.remove.isPending;
  const ocupado = enviando || removendo;

  const escolher = async () => {
    const picked = await pickTripCoverImage();

    // Cada recusa tem uma frase própria. "Não foi possível" para tudo obrigaria
    // a pessoa a adivinhar se o problema foi a permissão, o formato ou o
    // tamanho — e a tentar de novo com a mesma foto (§6).
    if (picked.status === 'denied') {
      toast.warning('Permita o acesso às fotos para alterar a capa da viagem.');
      return;
    }
    // Cancelar no seletor não é erro, e não merece aviso nenhum.
    if (picked.status === 'cancelled') return;
    if (picked.status === 'rejected') {
      toast.warning(picked.message);
      return;
    }

    setPreview(picked.file);
  };

  const confirmar = async () => {
    if (!preview) return;
    try {
      await cover.replace.mutateAsync(preview);
      setPreview(null);
      toast.success('Capa atualizada');
    } catch (error) {
      // A viagem continua com a capa anterior — o repositório desfaz o upload
      // quando a gravação falha. Dizer isso evita que a pessoa fique achando
      // que ficou num estado intermediário.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível enviar a imagem. A capa anterior foi mantida.',
      );
    }
  };

  const restaurar = async () => {
    try {
      await cover.remove.mutateAsync();
      setConfirmRestore(false);
      toast.success('Capa restaurada');
    } catch {
      toast.error('Não foi possível remover a capa. Tente novamente.');
    }
  };

  const atual = tripCoverUri(trip);
  const exibida = preview?.uri ?? atual;

  return (
    <GlassCard>
      <SectionHeader title="Imagem da viagem" />

      <View style={{ gap: theme.spacing.md }}>
        <AppImage
          uri={exibida}
          style={{ height: 160, width: '100%' }}
          radius={theme.radius.card}
          fallbackLabel={trip.destinationCity}
          accessibilityLabel={
            preview ? 'Prévia da nova capa da viagem' : 'Capa atual da viagem'
          }
        />

        {preview ? (
          <>
            <InlineNotice icon={ImagePlus} tone="info">
              Esta é uma prévia. A imagem só é enviada quando você confirmar.
            </InlineNotice>
            <ButtonRow>
              <Button
                label="Cancelar"
                variant="secondary"
                disabled={ocupado}
                onPress={() => setPreview(null)}
              />
              <Button
                label="Confirmar"
                loading={enviando}
                onPress={() => void confirmar()}
                haptic
              />
            </ButtonRow>
          </>
        ) : (
          <>
            <AppText variant="caption" color="tertiary">
              {trip.coverImagePath
                ? 'Imagem enviada por você. Restaurar devolve a capa sugerida para o destino.'
                : 'Capa sugerida a partir do destino. Envie uma foto sua para substituí-la.'}
            </AppText>

            <Button
              label="Alterar imagem da viagem"
              variant="secondary"
              icon={ImagePlus}
              fullWidth
              disabled={ocupado}
              onPress={() => void escolher()}
            />

            {/* Só há o que restaurar quando existe capa enviada. */}
            {trip.coverImagePath ? (
              <Button
                label="Restaurar imagem padrão"
                variant="ghost"
                icon={RotateCcw}
                fullWidth
                loading={removendo}
                onPress={() => setConfirmRestore(true)}
              />
            ) : null}
          </>
        )}

        {/*
          Upload exige rede (§51). Não há fila offline para imagem, e inventar
          uma criaria a promessa de um envio que nada garante — melhor dizer que
          precisa de conexão do que aceitar e esquecer.
        */}
        {cover.replace.isError && !enviando ? (
          <InlineNotice icon={TriangleAlert} tone="error">
            O envio não foi concluído. Verifique sua conexão e tente novamente.
          </InlineNotice>
        ) : null}
      </View>

      <ConfirmDialog
        visible={confirmRestore}
        title="Restaurar a imagem padrão?"
        message="A foto que você enviou será removida e a viagem voltará a usar a imagem sugerida para o destino."
        confirmLabel="Restaurar"
        destructive
        loading={removendo}
        onConfirm={() => void restaurar()}
        onCancel={() => setConfirmRestore(false)}
      />
    </GlassCard>
  );
}
