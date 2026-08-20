import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, Platform } from 'react-native';

import { useKeyboardVisible } from '@/hooks/useKeyboard';

/**
 * O dock flutuante some enquanto o teclado está aberto, então este hook decide
 * quando ele desaparece e volta (§10, §19). Errar o nome do evento no Android
 * significaria um dock que nunca sai — ou, pior, que nunca volta.
 */

type Handler = () => void;

const listeners = new Map<string, Set<Handler>>();
const removals: string[] = [];

beforeEach(() => {
  listeners.clear();
  removals.length = 0;

  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, handler: Handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
    return {
      remove: () => {
        listeners.get(event)?.delete(handler);
        removals.push(event);
      },
    };
  }) as unknown as typeof Keyboard.addListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const emit = (event: string) =>
  act(() => {
    for (const handler of listeners.get(event) ?? []) handler();
  });

describe('useKeyboardVisible', () => {
  it('starts closed', () => {
    expect(renderHook(() => useKeyboardVisible()).result.current).toBe(false);
  });

  it('follows the android events, which are the only ones android emits', () => {
    Platform.OS = 'android';
    const { result } = renderHook(() => useKeyboardVisible());

    expect([...listeners.keys()].sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);

    emit('keyboardDidShow');
    expect(result.current).toBe(true);

    emit('keyboardDidHide');
    expect(result.current).toBe(false);
  });

  it('uses the ios events that fire before the animation', () => {
    Platform.OS = 'ios';
    const { result } = renderHook(() => useKeyboardVisible());

    expect([...listeners.keys()].sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);

    emit('keyboardWillShow');
    expect(result.current).toBe(true);

    emit('keyboardWillHide');
    expect(result.current).toBe(false);
  });

  it('always comes back down, so the dock can never be stranded off screen', () => {
    Platform.OS = 'android';
    const { result } = renderHook(() => useKeyboardVisible());

    for (let round = 0; round < 3; round += 1) {
      emit('keyboardDidShow');
      expect(result.current).toBe(true);
      emit('keyboardDidHide');
      expect(result.current).toBe(false);
    }
  });

  it('unsubscribes on unmount', () => {
    Platform.OS = 'android';
    const { unmount } = renderHook(() => useKeyboardVisible());

    unmount();

    expect(removals.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
