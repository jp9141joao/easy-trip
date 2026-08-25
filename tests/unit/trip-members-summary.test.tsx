import { fireEvent, render } from '@testing-library/react-native';

import { MembersSummary } from '@/components/collaboration/MemberRow';

describe('MembersSummary', () => {
  it('keeps Viajantes reachable for a solo owner', () => {
    const onPress = jest.fn();
    const view = render(<MembersSummary count={1} onPress={onPress} />);

    expect(view.getByText('Viajantes')).toBeTruthy();
    expect(view.getByText('Só você nesta viagem')).toBeTruthy();
    fireEvent.press(view.getByLabelText(/Só você nesta viagem/));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the participant count once the trip is shared', () => {
    const view = render(<MembersSummary count={2} onPress={() => {}} />);
    expect(view.getByText('2 viajantes')).toBeTruthy();
  });

  it('does not invent a participant entry before membership resolves', () => {
    const view = render(<MembersSummary count={0} onPress={() => {}} />);
    expect(view.toJSON()).toBeNull();
  });
});
