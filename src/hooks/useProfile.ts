import { useMutation } from '@tanstack/react-query';

import type { ProfilePatch } from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource, type UploadableFile } from '@/repositories';

/**
 * Profile edits are written through and reflected in the auth context, so
 * "Salvar" actually persists and survives a restart (§59, CA-05).
 */
export function useUpdateProfile() {
  const { user, setProfile } = useAuth();

  return useMutation({
    mutationFn: async (patch: ProfilePatch) => {
      // O patch vai como veio da tela. Antes esta função remontava o perfil
      // inteiro a partir do que estava em memória — e era assim que a URL
      // assinada do avatar acabava gravada na coluna do caminho, apagando a
      // foto na leitura seguinte. Agora `ProfilePatch` sequer tem esse campo.
      //
      // O id vem da sessão. Não é ele que protege — quem protege é a RLS e o
      // privilégio por coluna da `0006` —, mas formulário nenhum o alcança.
      return dataSource.profile.update(user!.id, patch);
    },
    onSuccess: (saved) => setProfile(saved),
  });
}

export function useUploadAvatar() {
  const { user, setProfile } = useAuth();

  return useMutation({
    // Uma operação só: validar, subir, apontar o perfil e limpar a foto
    // anterior acontecem juntos, dentro do repositório, porque é lá que dá para
    // desfazer o upload se o meio do caminho falhar (§10).
    mutationFn: async (file: UploadableFile) => dataSource.profile.replaceAvatar(user!.id, file),
    onSuccess: (saved) => setProfile(saved),
  });
}
