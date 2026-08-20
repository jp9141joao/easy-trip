import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { SegmentedTabs } from '@/components/ui';
import { RoteiroModules } from '@/features/trip/RoteiroModules';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: (path: string) => mockReplace(path) }) }));

const mockItinerary = jest.fn();
const mockChecklist = jest.fn();
const mockJournal = jest.fn();
jest.mock('@/hooks/useTripData', () => ({
  useItinerary: () => mockItinerary(),
  useChecklist: () => mockChecklist(),
  useJournal: () => mockJournal(),
}));

/**
 * Os dois níveis da tela da viagem precisam ter naturezas visuais diferentes
 * (§13, §16). Abas anteriores falhavam por serem, como o nível primário, uma
 * fileira de rótulos com um selecionado — mesma forma, decoração diferente.
 */

interface Node {
  type: string;
  props?: { style?: unknown };
  children?: unknown[] | null;
}

function styles(node: unknown, out: ViewStyle[] = []): ViewStyle[] {
  if (!node || typeof node !== 'object') return out;
  const current = node as Node;
  const flat = StyleSheet.flatten(current.props?.style as ViewStyle) ?? {};
  if (Object.keys(flat).length > 0) out.push(flat);
  for (const child of current.children ?? []) styles(child, out);
  return out;
}

const item = (id: string) => ({ id });

beforeEach(() => {
  mockReplace.mockClear();
  mockItinerary.mockReturnValue({ data: [item('a'), item('b'), item('c')] });
  mockChecklist.mockReturnValue({
    data: [
      { id: '1', completed: true },
      { id: '2', completed: true },
      { id: '3', completed: false },
    ],
  });
  mockJournal.mockReturnValue({ data: [item('j')] });
});

const renderModules = (active: 'itinerary' | 'checklist' | 'journal' = 'itinerary') =>
  render(<RoteiroModules tripId="t1" active={active} />);

describe('Roteiro modules', () => {
  it('is built from cards, not from a row of bare labels', () => {
    const cards = styles(renderModules().toJSON()).filter(
      (style) => Number(style.borderWidth ?? 0) > 0 && style.borderRadius !== undefined,
    );

    // Três superfícies próprias — é essa diferença de natureza, e não de cor,
    // que separa os módulos do nível primário.
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.backgroundColor).toBeTruthy();
  });

  it('does not sit on a shared track the way the primary tabs do', () => {
    const primary = StyleSheet.flatten(
      (
        render(
          <SegmentedTabs
            items={[{ value: 'a' as const, label: 'A' }]}
            value="a"
            onChange={() => {}}
          />,
        ).toJSON() as Node
      ).props?.style as ViewStyle,
    );
    const secondary = StyleSheet.flatten(
      (renderModules().toJSON() as Node).props?.style as ViewStyle,
    );

    expect(primary.backgroundColor).toBeTruthy();
    expect(secondary.backgroundColor).toBeFalsy();
  });

  it('states what each area currently holds', () => {
    const view = renderModules();

    expect(view.getByText('3 atividades')).toBeTruthy();
    expect(view.getByText('2 de 3')).toBeTruthy();
    expect(view.getByText('1 entrada')).toBeTruthy();
  });

  it('says nothing rather than inventing a zero while data loads', () => {
    mockItinerary.mockReturnValue({ data: undefined });
    expect(renderModules().getByText('—')).toBeTruthy();
  });

  it('spells out an empty area instead of showing a bare zero', () => {
    mockJournal.mockReturnValue({ data: [] });
    mockChecklist.mockReturnValue({ data: [] });
    const view = renderModules();

    expect(view.getByText('Nenhuma entrada')).toBeTruthy();
    expect(view.getByText('Vazio')).toBeTruthy();
  });

  it('marks the open module for assistive tech', () => {
    const view = renderModules('checklist');

    expect(view.getByLabelText('Checklist. 2 de 3.').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('Jornada. 3 atividades.').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('navigates to the module the user picked', () => {
    fireEvent.press(renderModules().getByLabelText('Diário. 1 entrada.'));
    expect(mockReplace).toHaveBeenCalledWith('/trip/t1/journal');
  });

  it('does not re-navigate to the module already open', () => {
    fireEvent.press(renderModules().getByLabelText('Jornada. 3 atividades.'));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
