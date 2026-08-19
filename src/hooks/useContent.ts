import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Place } from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource, type UploadableFile } from '@/repositories';
import { queryKeys } from './queryKeys';

/* --------------------------------- offers --------------------------------- */

export function useOffers() {
  return useQuery({ queryKey: queryKeys.offers(), queryFn: () => dataSource.content.listOffers() });
}

export function useOffer(id?: string) {
  return useQuery({
    queryKey: queryKeys.offer(id ?? 'none'),
    queryFn: () => dataSource.content.getOffer(id!),
    enabled: Boolean(id),
  });
}

/* -------------------------------- articles -------------------------------- */

export function useArticles() {
  return useQuery({
    queryKey: queryKeys.articles(),
    queryFn: () => dataSource.content.listArticles(),
  });
}

export function useArticle(id?: string) {
  return useQuery({
    queryKey: queryKeys.article(id ?? 'none'),
    queryFn: () => dataSource.content.getArticle(id!),
    enabled: Boolean(id),
  });
}

/** Likes persist per user — never a temporary in-memory flag (§100). */
export function useArticleLikes() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = queryKeys.articleLikes(user?.id ?? 'anonymous');

  const query = useQuery({
    queryKey: key,
    queryFn: () => dataSource.content.listLikedArticleIds(user!.id),
    enabled: Boolean(user),
  });

  const toggle = useMutation({
    mutationFn: ({ articleId, liked }: { articleId: string; liked: boolean }) =>
      dataSource.content.setArticleLike(user!.id, articleId, liked),
    onMutate: async ({ articleId, liked }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key) ?? [];
      queryClient.setQueryData<string[]>(
        key,
        liked ? [...previous, articleId] : previous.filter((id) => id !== articleId),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    likedIds: query.data ?? [],
    isLiked: (articleId: string) => (query.data ?? []).includes(articleId),
    toggle,
  };
}

/* --------------------------------- places --------------------------------- */

export function usePlaces(params?: { city?: string; type?: Place['type']; search?: string }) {
  return useQuery({
    queryKey: queryKeys.places(JSON.stringify(params ?? {})),
    queryFn: () => dataSource.places.list(params),
  });
}

export function usePlace(id?: string) {
  return useQuery({
    queryKey: queryKeys.place(id ?? 'none'),
    queryFn: () => dataSource.places.get(id!),
    enabled: Boolean(id),
  });
}

export function usePlaceFavorites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = queryKeys.placeFavorites(user?.id ?? 'anonymous');

  const query = useQuery({
    queryKey: key,
    queryFn: () => dataSource.places.listFavoriteIds(user!.id),
    enabled: Boolean(user),
  });

  const toggle = useMutation({
    mutationFn: ({ placeId, favorite }: { placeId: string; favorite: boolean }) =>
      dataSource.places.setFavorite(user!.id, placeId, favorite),
    onMutate: async ({ placeId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key) ?? [];
      queryClient.setQueryData<string[]>(
        key,
        favorite ? [...previous, placeId] : previous.filter((id) => id !== placeId),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    favoriteIds: query.data ?? [],
    isFavorite: (placeId: string) => (query.data ?? []).includes(placeId),
    toggle,
  };
}

/* -------------------------------- advisors -------------------------------- */

export function useAdvisors() {
  return useQuery({ queryKey: queryKeys.advisors(), queryFn: () => dataSource.advisors.list() });
}

export function useConsultations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.consultations(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.advisors.listConsultations(user!.id),
    enabled: Boolean(user),
  });

  const request = useMutation({
    mutationFn: ({
      advisorId,
      scheduledAt,
      notes,
    }: {
      advisorId: string;
      scheduledAt: string;
      notes?: string;
    }) =>
      dataSource.advisors.requestConsultation({
        userId: user!.id,
        advisorId,
        scheduledAt,
        notes,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.consultations(user!.id) }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => dataSource.advisors.cancelConsultation(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.consultations(user!.id) }),
  });

  return { consultations: query.data ?? [], query, request, cancel };
}

/* ------------------------------ reservations ------------------------------ */

export function useReservations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.reservations(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.reservations.listByUser(user!.id),
    enabled: Boolean(user),
  });

  const request = useMutation({
    mutationFn: (input: {
      placeId: string;
      placeName: string;
      requestedFor: string;
      partySize: number;
      notes?: string;
      tripId?: string;
    }) => dataSource.reservations.request({ ...input, userId: user!.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reservations(user!.id) }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => dataSource.reservations.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reservations(user!.id) }),
  });

  return { reservations: query.data ?? [], query, request, cancel };
}

/* -------------------------------- insurance ------------------------------- */

export function useInsurance() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.insurance(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.insurance.listByUser(user!.id),
    enabled: Boolean(user),
  });

  const create = useMutation({
    mutationFn: (input: {
      provider: string;
      policyNumber: string;
      emergencyPhone?: string;
      validUntil?: string;
      tripId?: string;
      file?: UploadableFile;
    }) => {
      const { file, ...rest } = input;
      return dataSource.insurance.create({ ...rest, userId: user!.id, fileUrl: file?.uri });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.insurance(user!.id) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.insurance.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.insurance(user!.id) }),
  });

  return { policies: query.data ?? [], query, create, remove };
}
