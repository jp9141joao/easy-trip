import { isValidISODate } from '@/lib/date';
import { normalizeKey } from '@/data/images';
import type { Place, Trip } from './types';

/**
 * Mensagem de contato comercial sobre um estabelecimento (§3, §4, §5).
 *
 * Função pura, separada da tela, porque o que ela decide é conteúdo e não
 * apresentação: o que entra na mensagem, o que fica de fora e quando o contexto
 * da viagem é realmente aplicável.
 *
 * A regra que governa tudo aqui é o §5: só entra o que o atendimento precisa
 * para responder — estabelecimento, destino e, quando fizer sentido, as datas.
 * Telefone, e-mail, orçamento e qualquer outro dado do perfil ficam de fora por
 * construção: esta função nem recebe o `Profile`, então não há como vazarem.
 */

const MONTHS_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** `2026-08-20`, `2026-08-23` → `de 20 a 23 de agosto`. */
function describeStay(start: string, end: string): string | null {
  if (!isValidISODate(start) || !isValidISODate(end)) return null;
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  if (sm === em) return `de ${sd} a ${ed} de ${MONTHS_FULL[sm - 1]}`;
  return `de ${sd} de ${MONTHS_FULL[sm - 1]} a ${ed} de ${MONTHS_FULL[em - 1]}`;
}

/**
 * O contexto da viagem só entra quando ele é sobre *este* lugar.
 *
 * Sem esta verificação, um usuário com viagem marcada para Paris pediria
 * informações de um restaurante em Roma dizendo "para minha viagem a Paris". A
 * viagem ativa é apenas a última selecionada — ela não implica relação nenhuma
 * com o estabelecimento aberto na tela.
 */
function tripMatchesPlace(place: Place, trip: Trip | null | undefined): trip is Trip {
  if (!trip) return false;
  return normalizeKey(trip.destinationCity) === normalizeKey(place.city);
}

/**
 * Monta a mensagem já pronta para o WhatsApp comercial.
 *
 * Hotel e restaurante têm textos próprios porque o que se pergunta é diferente:
 * num hotel interessam valores, disponibilidade e reserva; num restaurante,
 * também horários. Reaproveitar um texto só e trocar a palavra produziria
 * mensagens estranhas nos dois casos.
 */
export function buildPlaceInquiryMessage(place: Place, trip?: Trip | null): string {
  const stay = tripMatchesPlace(place, trip) ? describeStay(trip.startDate, trip.endDate) : null;
  const destination = `${place.city}`;

  if (place.type === 'hotel') {
    const opening = stay
      ? `Olá! Encontrei o ${place.name} pelo Easy Trip e tenho interesse na hospedagem para minha viagem a ${destination}, ${stay}.`
      : `Olá! Encontrei o ${place.name} pelo Easy Trip e tenho interesse na hospedagem.`;

    return [
      opening,
      'Gostaria de receber mais informações sobre valores, disponibilidade e condições de reserva.',
      'Obrigado!',
    ].join('\n\n');
  }

  const opening = stay
    ? `Olá! Encontrei o ${place.name} pelo Easy Trip e gostaria de mais informações para minha viagem a ${destination}, ${stay}.`
    : `Olá! Encontrei o ${place.name} pelo Easy Trip e gostaria de mais informações.`;

  return [
    opening,
    'Tenho interesse em conhecer o local e gostaria de saber sobre valores, reservas, horários e disponibilidade.',
    'Obrigado!',
  ].join('\n\n');
}

/** Rótulo da ação, na palavra certa para cada tipo (§1, §61). */
export function placeInquiryLabel(place: Place): string {
  return place.type === 'hotel' ? 'Falar sobre este hotel' : 'Falar sobre este restaurante';
}

/**
 * Atrações ficam de fora: não existe atendimento comercial do Easy Trip para
 * um mirante ou um museu público, e um botão que abre uma conversa sobre "este
 * restaurante" numa atração seria pior do que não ter botão.
 */
export function supportsCommercialInquiry(place: Place): boolean {
  return place.type === 'hotel' || place.type === 'restaurant';
}
