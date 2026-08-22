import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Advisor, Article, Offer, Place } from '@/domain/types';
import { dataSource } from '@/repositories';
import {
  deleteWithEditorialImage,
  saveWithEditorialImage,
  type PendingEditorialImage,
} from '@/repositories/editorialImage';
import { queryKeys } from './queryKeys';

/**
 * Leitura e escrita de conteúdo pelo painel.
 *
 * O ponto delicado aqui é a invalidação. Salvar um artigo precisa atualizar
 * *duas* visões: a lista do painel (com rascunhos) e a lista pública (só
 * publicados). Esquecer a segunda produziria o pior sintoma possível — o admin
 * publica, vê o item na lista dele, abre a Comunidade e não encontra nada.
 *
 * Desde a F9 cada mutação de conteúdo carrega também a imagem: o formulário
 * entrega o arquivo escolhido (`pendingImage`) e o valor que estava gravado
 * (`currentImageUrl`), e a ordem entre upload, gravação e remoção da anterior
 * fica em `repositories/editorialImage` — um lugar só, igual para as quatro
 * entidades (P-04, §15–§18).
 *
 * Nada disto é cache privado: conteúdo editorial é público e não entra na
 * persistência da D-04, cuja allowlist continua sendo só de dados do usuário.
 */

/** O que todo formulário administrativo entrega ao salvar. */
export interface EditorialSave<T> {
  record: T;
  pendingImage: PendingEditorialImage;
  /** O que estava gravado antes — para a troca saber o que remover depois. */
  currentImageUrl?: string;
}

/** O que todo formulário administrativo entrega ao excluir. */
export interface EditorialDelete {
  id: string;
  imageUrl?: string;
}

/* -------------------------------- articles -------------------------------- */

export function useAdminArticles() {
  return useQuery({
    queryKey: queryKeys.adminArticles(),
    queryFn: () => dataSource.content.listAllArticles(),
  });
}

export function useSaveArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ record, pendingImage, currentImageUrl }: EditorialSave<Article>) =>
      saveWithEditorialImage({
        kind: 'articles',
        entityId: record.id,
        currentImageUrl,
        pendingImage,
        persist: (imageUrl) => dataSource.content.upsertArticle({ ...record, imageUrl }),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminArticles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.articles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.article(saved.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.article(saved.slug) });
    },
  });
}

export function useDeleteArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, imageUrl }: EditorialDelete) =>
      deleteWithEditorialImage({
        kind: 'articles',
        entityId: id,
        imageUrl,
        removeRecord: () => dataSource.content.removeArticle(id),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminArticles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.articles() });
    },
  });
}

/* --------------------------------- places --------------------------------- */

export function useAdminPlaces() {
  return useQuery({
    queryKey: queryKeys.adminPlaces(),
    queryFn: () => dataSource.places.list(),
  });
}

export function useSavePlace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ record, pendingImage, currentImageUrl }: EditorialSave<Place>) =>
      saveWithEditorialImage({
        kind: 'places',
        entityId: record.id,
        currentImageUrl,
        pendingImage,
        persist: (imageUrl) => dataSource.places.upsert({ ...record, imageUrl }),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminPlaces() });
      // As listagens públicas de lugares são cacheadas por combinação de
      // filtros, então a chave exata é desconhecida daqui — invalidar o prefixo
      // é o que garante que nenhuma variação continue mostrando o dado antigo.
      void queryClient.invalidateQueries({ queryKey: ['places'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.place(saved.id) });
    },
  });
}

export function useDeletePlace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, imageUrl }: EditorialDelete) =>
      deleteWithEditorialImage({
        kind: 'places',
        entityId: id,
        imageUrl,
        removeRecord: () => dataSource.places.remove(id),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminPlaces() });
      void queryClient.invalidateQueries({ queryKey: ['places'] });
    },
  });
}

/* --------------------------------- offers --------------------------------- */

export function useAdminOffers() {
  return useQuery({
    queryKey: queryKeys.adminOffers(),
    queryFn: () => dataSource.content.listAllOffers(),
  });
}

export function useSaveOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ record, pendingImage, currentImageUrl }: EditorialSave<Offer>) =>
      saveWithEditorialImage({
        kind: 'offers',
        entityId: record.id,
        currentImageUrl,
        pendingImage,
        // `image_url` é NOT NULL em `offers` (0001), e o formulário exige a
        // imagem antes de deixar salvar. O `?? ''` existe só para o tipo
        // fechar — a coluna nunca recebe vazio por este caminho.
        persist: (imageUrl) =>
          dataSource.content.upsertOffer({ ...record, imageUrl: imageUrl ?? '' }),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminOffers() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.offers() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.offer(saved.id) });
    },
  });
}

export function useDeleteOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, imageUrl }: EditorialDelete) =>
      deleteWithEditorialImage({
        kind: 'offers',
        entityId: id,
        imageUrl,
        removeRecord: () => dataSource.content.removeOffer(id),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminOffers() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.offers() });
    },
  });
}

/* -------------------------------- advisors -------------------------------- */

export function useAdminAdvisors() {
  return useQuery({
    queryKey: queryKeys.adminAdvisors(),
    queryFn: () => dataSource.advisors.listAll(),
  });
}

export function useSaveAdvisor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ record, pendingImage, currentImageUrl }: EditorialSave<Advisor>) =>
      saveWithEditorialImage({
        kind: 'advisors',
        entityId: record.id,
        currentImageUrl,
        pendingImage,
        // A foto do especialista é conteúdo editorial e mora em `content`. O
        // bucket `avatars` continua sendo só de foto de conta — privado e
        // preso a `auth.uid()`, que um especialista não tem.
        persist: (imageUrl) => dataSource.advisors.upsert({ ...record, avatarUrl: imageUrl }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminAdvisors() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.advisors() });
    },
  });
}

export function useDeleteAdvisor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, imageUrl }: EditorialDelete) =>
      deleteWithEditorialImage({
        kind: 'advisors',
        entityId: id,
        imageUrl,
        removeRecord: () => dataSource.advisors.remove(id),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminAdvisors() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.advisors() });
    },
  });
}
