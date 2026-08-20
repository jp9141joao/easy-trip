import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Se o teclado está aberto.
 *
 * Usa apenas os eventos que o próprio React Native emite — nenhum módulo
 * nativo extra, então continua funcionando no Expo Go. No iOS escutamos os
 * eventos `Will*`, que chegam antes da animação e deixam a interface acompanhar
 * o teclado em vez de saltar depois dele; no Android só existem os `Did*`.
 *
 * Deliberadamente não devolve a altura do teclado: nada no app deve posicionar
 * elementos a partir dela. Quem precisa se desviar do teclado usa
 * `KeyboardAvoidingView`, que mede a sobreposição real. Aqui a pergunta é só
 * "está digitando?", para elementos que não fazem sentido durante a digitação.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
