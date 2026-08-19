import { useMutation } from '@tanstack/react-query';

import type { Profile } from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource, type UploadableFile } from '@/repositories';

/**
 * Profile edits are written through and reflected in the auth context, so
 * "Salvar" actually persists and survives a restart (§59, CA-05).
 */
export function useUpdateProfile() {
  const { user, profile, setProfile } = useAuth();

  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const next: Profile = {
        userId: user!.id,
        name: patch.name ?? profile?.name ?? '',
        phone: patch.phone ?? profile?.phone,
        avatarUrl: patch.avatarUrl ?? profile?.avatarUrl,
        homeCity: patch.homeCity ?? profile?.homeCity,
        homeCountry: patch.homeCountry ?? profile?.homeCountry,
        homeTimezone: patch.homeTimezone ?? profile?.homeTimezone,
        travelStyle: patch.travelStyle ?? profile?.travelStyle,
        defaultCurrency: patch.defaultCurrency ?? profile?.defaultCurrency ?? 'BRL',
      };
      return dataSource.profile.upsert(next);
    },
    onSuccess: (saved) => setProfile(saved),
  });
}

export function useUploadAvatar() {
  const { user, profile, setProfile } = useAuth();

  return useMutation({
    mutationFn: async (file: UploadableFile) => {
      const stored = await dataSource.profile.uploadAvatar(user!.id, file);
      return dataSource.profile.upsert({
        userId: user!.id,
        name: profile?.name ?? '',
        phone: profile?.phone,
        homeCity: profile?.homeCity,
        homeCountry: profile?.homeCountry,
        homeTimezone: profile?.homeTimezone,
        travelStyle: profile?.travelStyle,
        defaultCurrency: profile?.defaultCurrency ?? 'BRL',
        avatarUrl: stored.url,
      });
    },
    onSuccess: (saved) => setProfile(saved),
  });
}
