import {
  BackendCapabilityError,
  describeBackendCapability,
  throwBackendError,
  toBackendCapabilityError,
} from '@/repositories/backendCapabilities';

describe('BackendCapabilityError', () => {
  it('classifies PostgREST missing trip_members without calling it a permission failure', () => {
    const error = toBackendCapabilityError(
      {
        code: 'PGRST205',
        message: "Could not find the table 'public.trip_members' in the schema cache",
        status: 404,
      },
      'MISSING_TRIP_MEMBERS',
    );

    expect(error).toBeInstanceOf(BackendCapabilityError);
    expect(error).toMatchObject({ code: 'MISSING_TRIP_MEMBERS' });
    expect(describeBackendCapability(error)).toContain('servidor');
    expect(describeBackendCapability(error)).toContain('não foi alterada');
  });

  it('also recognizes the missing collaboration RPC from migration 0008', () => {
    expect(
      toBackendCapabilityError(
        {
          code: 'PGRST202',
          message:
            'Could not find the function public.trip_member_profiles(target_trip) in the schema cache',
        },
        'MISSING_TRIP_MEMBERS',
      ),
    ).toMatchObject({ code: 'MISSING_TRIP_MEMBERS' });
  });

  it('does not turn an authorization denial into a missing capability', () => {
    expect(
      toBackendCapabilityError(
        { code: '42501', message: 'permission denied for table trip_members' },
        'MISSING_TRIP_MEMBERS',
      ),
    ).toBeNull();
  });

  it('does not misclassify an unrelated missing table', () => {
    expect(
      toBackendCapabilityError(
        { code: 'PGRST205', message: "Could not find the table 'public.places'" },
        'MISSING_TRIP_MEMBERS',
      ),
    ).toBeNull();
  });

  it('preserves an ordinary backend message instead of pretending success', () => {
    expect(() =>
      throwBackendError(
        { code: '42501', message: 'permission denied for table trip_members' },
        'MISSING_TRIP_MEMBERS',
      ),
    ).toThrow('permission denied for table trip_members');
  });
});
