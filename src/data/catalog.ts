/**
 * Editorial catalogue (§55–§58, §51, §46).
 *
 * This is *product content*, not fake user data: offers, articles, the place
 * directory and the advisor roster are things Easy Trip publishes. It ships
 * with the app so Ofertas/Comunidade/Places are never empty, and the same
 * records are what a CMS/Supabase table would serve later.
 */

import { IMAGES } from './images';
import type { Advisor, Article, Offer, Place } from '@/domain/types';

export const OFFERS: Offer[] = [
  {
    id: 'offer-paris-primavera',
    destination: 'Paris, França',
    description:
      'Sete noites no Marais com café da manhã incluso, passeio guiado pelo Louvre e traslado de chegada. Ideal para quem quer a primavera parisiense sem abrir mão de conforto.',
    price: 8990,
    priceCurrency: 'BRL',
    discountType: 'percentage',
    discountValue: 15,
    costLevel: 'moderate',
    imageUrl: IMAGES.paris,
    weatherSummary: 'Primavera amena, 12°C a 19°C',
    bestTime: 'Abril a junho',
    thingsToDo: ['Museu do Louvre', 'Montmartre ao pôr do sol', 'Piquenique no Champ de Mars'],
    partnerUrl: 'https://www.google.com/search?q=pacote+viagem+Paris',
  },
  {
    id: 'offer-kyoto-outono',
    destination: 'Kyoto, Japão',
    description:
      'Roteiro de 10 dias pelo Japão clássico com hospedagem em ryokan tradicional, Japan Rail Pass e experiência de cerimônia do chá.',
    price: 17500,
    priceCurrency: 'BRL',
    discountType: 'label',
    discountValue: 'Últimas vagas',
    costLevel: 'luxury',
    imageUrl: IMAGES.kyoto,
    weatherSummary: 'Outono seco, 10°C a 20°C',
    bestTime: 'Outubro a novembro',
    thingsToDo: ['Fushimi Inari ao amanhecer', 'Bambuzal de Arashiyama', 'Templo Kinkaku-ji'],
    partnerUrl: 'https://www.google.com/search?q=pacote+viagem+Kyoto',
  },
  {
    id: 'offer-roma-historica',
    destination: 'Roma, Itália',
    description:
      'Cinco noites no centro histórico com ingresso sem fila para o Coliseu e Fórum Romano, mais um curso de massa fresca com chef local.',
    price: 6490,
    priceCurrency: 'BRL',
    discountType: 'fixed',
    discountValue: 800,
    costLevel: 'moderate',
    imageUrl: IMAGES.rome,
    weatherSummary: 'Mediterrâneo, 15°C a 26°C',
    bestTime: 'Abril a maio e setembro a outubro',
    thingsToDo: ['Coliseu e Fórum', 'Museus do Vaticano', 'Trastevere à noite'],
    partnerUrl: 'https://www.google.com/search?q=pacote+viagem+Roma',
  },
  {
    id: 'offer-lisboa-economica',
    destination: 'Lisboa, Portugal',
    description:
      'Cinco noites em Alfama com voos de ida e volta, seguro viagem e city pass de transporte. A porta de entrada mais econômica para a Europa.',
    price: 4290,
    priceCurrency: 'BRL',
    discountType: 'percentage',
    discountValue: 20,
    costLevel: 'economy',
    imageUrl: IMAGES.lisbon,
    weatherSummary: 'Ameno o ano todo, 14°C a 24°C',
    bestTime: 'Março a junho',
    thingsToDo: ['Mosteiro dos Jerónimos', 'Elevador de Santa Justa', 'Bairro Alto'],
    partnerUrl: 'https://www.google.com/search?q=pacote+viagem+Lisboa',
  },
  {
    id: 'offer-nova-york',
    destination: 'Nova York, Estados Unidos',
    description:
      'Seis noites em Manhattan com hotel a duas quadras do Central Park, City Pass para seis atrações e traslado do aeroporto.',
    price: 11200,
    priceCurrency: 'BRL',
    discountType: 'percentage',
    discountValue: 10,
    costLevel: 'luxury',
    imageUrl: IMAGES.newYork,
    weatherSummary: 'Outono ensolarado, 8°C a 18°C',
    bestTime: 'Setembro a novembro',
    thingsToDo: ['Top of the Rock', 'The High Line', 'Broadway'],
    partnerUrl: 'https://www.google.com/search?q=pacote+viagem+Nova+York',
  },
  {
    id: 'offer-santorini',
    destination: 'Santorini, Grécia',
    description:
      'Sete noites em Oia com vista para a caldeira, passeio de catamarã ao pôr do sol e degustação em vinícola local.',
    price: 13800,
    priceCurrency: 'BRL',
    discountType: 'label',
    discountValue: 'Alta temporada',
    costLevel: 'luxury',
    imageUrl: IMAGES.santorini,
    weatherSummary: 'Verão seco, 22°C a 29°C',
    bestTime: 'Maio a setembro',
    thingsToDo: ['Pôr do sol em Oia', 'Praia Vermelha', 'Sítio arqueológico de Akrotiri'],
    partnerUrl: 'https://www.google.com/search?q=pacote+viagem+Santorini',
  },
];

export const ARTICLES: Article[] = [
  {
    id: 'article-mala-10-dias',
    slug: 'como-fazer-mala-10-dias',
    title: 'Como fazer a mala para 10 dias levando só bagagem de mão',
    category: 'Preparação',
    imageUrl: IMAGES.luggage,
    authorName: 'Marina Alcântara',
    publishedAt: '2026-05-12T09:00:00.000Z',
    estimatedReadMinutes: 6,
    status: 'published',
    content: `Viajar só com bagagem de mão deixa de ser um desafio quando você troca a lógica de "levar tudo que pode ser útil" pela lógica de "levar o que combina entre si".

## Comece pela paleta

Escolha duas cores neutras e uma cor de destaque. Com isso, praticamente todas as peças se combinam e você reduz o volume pela metade sem perder variedade nas fotos.

## A regra 5-4-3-2-1

Para dez dias, funciona muito bem: cinco camisetas, quatro peças de baixo, três peças de sobreposição, dois pares de sapato e um casaco. Some roupa íntima e meias e você tem um guarda-roupa completo em nove litros.

## Enrole, não dobre

Peças enroladas ocupam menos espaço e chegam com menos marcas. Use os sapatos como estojo: meias e carregadores cabem dentro deles.

## Líquidos

A maioria dos aeroportos limita líquidos a 100 ml por embalagem, somando no máximo 1 litro em saco transparente. Xampu em barra resolve boa parte do problema e não conta como líquido.

## Deixe 15% livre

Se a mala sai 100% cheia, ela não volta fechando. Reserve espaço para o que você vai trazer.`,
  },
  {
    id: 'article-documentos-europa',
    slug: 'documentos-para-a-europa',
    title: 'Documentos para a Europa: o que conferir antes de embarcar',
    category: 'Documentos',
    imageUrl: IMAGES.passport,
    authorName: 'Rafael Nogueira',
    publishedAt: '2026-04-28T09:00:00.000Z',
    estimatedReadMinutes: 5,
    status: 'published',
    content: `Regras de imigração mudam com frequência, então trate esta lista como um roteiro de conferência — e confirme sempre na fonte oficial do país de destino antes de viajar.

## Passaporte com validade folgada

Muitos países do espaço Schengen exigem passaporte válido por pelo menos três meses além da data prevista de saída, e emitido há menos de dez anos.

## Comprovantes que podem ser pedidos

Na fronteira é comum pedirem passagem de volta, comprovante de hospedagem e demonstração de meios de subsistência. Ter tudo salvo offline no aplicativo evita procurar e-mail com o agente esperando.

## Seguro viagem

Para o espaço Schengen o seguro com cobertura mínima de 30 mil euros é obrigatório. Guarde o número da apólice e o telefone de emergência da seguradora.

## Autorização eletrônica

Sistemas de autorização prévia de viagem entraram em operação recentemente para vários destinos. Verifique com antecedência se o seu caso exige o registro — ele costuma ser rápido, mas não é feito no aeroporto.

## Salve tudo em dois lugares

Uma cópia digital no Easy Trip e uma cópia física separada da original. Se a carteira sumir, você ainda consegue se identificar no consulado.`,
  },
  {
    id: 'article-comer-bem-barato',
    slug: 'comer-bem-gastando-pouco',
    title: 'Comer bem gastando pouco: a estratégia dos mercados municipais',
    category: 'Gastronomia',
    imageUrl: IMAGES.restaurantTable,
    authorName: 'Julia Sampaio',
    publishedAt: '2026-06-02T09:00:00.000Z',
    estimatedReadMinutes: 4,
    status: 'published',
    content: `Alimentação costuma ser o segundo maior gasto de uma viagem, atrás só da hospedagem. A boa notícia é que ela é o gasto mais fácil de controlar sem sacrificar a experiência.

## Inverta as refeições

Muitos restaurantes bons servem no almoço o mesmo cardápio do jantar por um preço bem menor. Faça a refeição principal ao meio-dia.

## Mercados municipais

Mercados são a forma mais honesta de comer a comida local. Em Roma, Lisboa ou Barcelona você monta uma refeição completa por uma fração do valor de um restaurante turístico.

## A regra das duas quadras

Afaste-se duas quadras da atração principal e o preço médio cai visivelmente. A mesma cozinha, sem o aluguel da vista.

## Registre na hora

Anotar o gasto no momento em que ele acontece é o que mantém o orçamento real. Depois de três dias, ninguém lembra quanto custou o café.`,
  },
  {
    id: 'article-jetlag',
    slug: 'vencendo-o-jet-lag',
    title: 'Vencendo o jet lag: o que realmente funciona',
    category: 'Saúde',
    imageUrl: IMAGES.airplaneWing,
    authorName: 'Dr. Henrique Vasques',
    publishedAt: '2026-03-18T09:00:00.000Z',
    estimatedReadMinutes: 5,
    status: 'published',
    content: `O jet lag acontece porque o relógio biológico continua no fuso de origem enquanto o ambiente já mudou. A adaptação natural leva cerca de um dia por fuso cruzado — mas dá para acelerar.

## Ajuste antes de embarcar

Nos três dias anteriores, mova o horário de dormir de 30 a 60 minutos por dia no sentido do destino. Chegar parcialmente adaptado encurta muito a recuperação.

## Luz é o sinal mais forte

Viajando para leste, busque luz da manhã. Para oeste, busque luz do fim da tarde. Luz na hora errada atrasa a adaptação em vez de ajudar.

## Hidratação e cafeína

A cabine é muito seca. Beba água com regularidade e concentre a cafeína na primeira metade do dia do destino.

## Resista ao cochilo longo

Ao chegar de dia, fique acordado até a noite local. Se precisar, um cochilo de 20 minutos resolve sem comprometer o sono da noite.`,
  },
  {
    id: 'article-orcamento-real',
    slug: 'montando-um-orcamento-de-viagem-realista',
    title: 'Montando um orçamento de viagem que sobrevive à viagem',
    category: 'Finanças',
    imageUrl: IMAGES.mapPlanning,
    authorName: 'Camila Ferraz',
    publishedAt: '2026-07-01T09:00:00.000Z',
    estimatedReadMinutes: 7,
    status: 'published',
    content: `A maioria dos orçamentos de viagem falha pelo mesmo motivo: eles registram o que foi planejado, não o que foi gasto.

## Separe fixo de variável

Passagem, hospedagem e seguro são fixos e já estão definidos antes de embarcar. Alimentação, transporte local e compras são variáveis — é aqui que o orçamento escapa.

## Trabalhe com um valor por dia

Divida o variável pelo número de dias. Um teto diário é muito mais fácil de administrar mentalmente do que um total de viagem.

## Anote na moeda que você pagou

Converter de cabeça na hora gera erro. Registre o valor na moeda local e deixe a conversão com a taxa do dia para o aplicativo — assim o histórico não muda de valor quando o câmbio mexe.

## Reserve 15% de folga

Imprevistos não são exceção, são estatística: taxa de bagagem, remédio, táxi na chuva. Um orçamento sem folga vira dívida.

## Revise no meio da viagem

Na metade dos dias, compare o gasto acumulado com o previsto. Ainda dá tempo de ajustar — no último dia, não dá.`,
  },
  {
    id: 'article-primeira-viagem-internacional',
    slug: 'primeira-viagem-internacional',
    title: 'Primeira viagem internacional: 12 coisas que ninguém te conta',
    category: 'Preparação',
    imageUrl: IMAGES.coast,
    authorName: 'Marina Alcântara',
    publishedAt: '2026-02-09T09:00:00.000Z',
    estimatedReadMinutes: 8,
    status: 'published',
    content: `A primeira viagem internacional tem uma curva de aprendizado que quase ninguém descreve. Estes são os pontos que mais pegam viajantes de primeira viagem.

## Chegue cedo, mesmo achando exagero

Três horas antes para voos internacionais não é folclore. Fila de check-in, despacho e imigração somam mais do que parece.

## Avise o banco

Cartões são bloqueados por segurança quando aparecem transações em outro país. Um aviso pelo aplicativo evita ficar sem meio de pagamento.

## Tenha dinheiro local do primeiro dia

Nem todo táxi ou pequeno comércio aceita cartão, e a casa de câmbio do aeroporto costuma ter a pior taxa.

## Baixe o mapa offline

Você vai precisar de mapa exatamente onde não tem sinal.

## Fotografe seus documentos

Passaporte, seguro e cartão de embarque. Se perder o original, a cópia acelera muito o atendimento consular.

## Adaptador de tomada

O padrão brasileiro é raro fora do Brasil. Um adaptador universal resolve o problema inteiro.

## Não lote o roteiro

Duas atividades principais por dia é um ritmo sustentável. Três vira maratona e você deixa de aproveitar.

## Aprenda cinco palavras

Bom dia, por favor, obrigado, quanto custa e desculpe. A diferença no tratamento é imediata.

## Confirme o horário do check-in

Muitos hotéis só liberam o quarto às 14h ou 15h. Saber disso evita carregar mala pela cidade.

## Guarde os comprovantes

Alguns países exigem nota fiscal para reembolso de impostos na saída.

## Conecte-se com cuidado

Wi-Fi público aberto não é lugar para acessar banco. Prefira o plano de dados ou um eSIM local.

## Deixe um dia de folga

O melhor dia da viagem costuma ser o que não estava planejado.`,
  },
];

export const PLACES: Place[] = [
  {
    id: 'place-le-comptoir',
    name: 'Le Comptoir du Marais',
    type: 'restaurant',
    rating: 4.6,
    priceLevel: 3,
    averagePrice: 45,
    currency: 'EUR',
    city: 'Paris',
    country: 'França',
    address: '18 Rue des Archives, 75004 Paris',
    phone: '+33142781234',
    openingHours: ['Seg–Sex 12:00–14:30, 19:00–23:00', 'Sáb–Dom 12:00–23:00'],
    description:
      'Bistrô contemporâneo no coração do Marais, conhecido pelo menu sazonal de quatro tempos e por uma carta de vinhos naturais franceses.',
    latitude: 48.8592,
    longitude: 2.3596,
    imageUrl: IMAGES.bistro,
    amenities: ['Menu vegetariano', 'Wi-Fi', 'Reserva recomendada', 'Terraço'],
    partnerUrl: 'https://www.google.com/maps/search/Le+Comptoir+du+Marais+Paris',
  },
  {
    id: 'place-hotel-lumiere',
    name: 'Hôtel Lumière Rivoli',
    type: 'hotel',
    rating: 4.4,
    priceLevel: 3,
    averagePrice: 210,
    currency: 'EUR',
    city: 'Paris',
    country: 'França',
    address: '42 Rue de Rivoli, 75001 Paris',
    phone: '+33144556677',
    openingHours: ['Recepção 24 horas'],
    description:
      'Hotel boutique a dez minutos a pé do Louvre, com quartos silenciosos voltados para o pátio interno e café da manhã servido até as 11h.',
    latitude: 48.8571,
    longitude: 2.3519,
    imageUrl: IMAGES.hotelRoom,
    amenities: ['Café da manhã', 'Wi-Fi gratuito', 'Ar-condicionado', 'Recepção 24h'],
    partnerUrl: 'https://www.google.com/maps/search/hotel+rue+de+rivoli+paris',
  },
  {
    id: 'place-kikunoi',
    name: 'Kikunoi Higashiyama',
    type: 'restaurant',
    rating: 4.8,
    priceLevel: 4,
    averagePrice: 22000,
    currency: 'JPY',
    city: 'Kyoto',
    country: 'Japão',
    address: '459 Shimokawara-cho, Higashiyama-ku, Kyoto',
    phone: '+81755000117',
    openingHours: ['Ter–Dom 12:00–13:00, 17:00–20:00', 'Segunda fechado'],
    description:
      'Casa de kaiseki tradicional em Higashiyama, com menu que muda a cada estação e serviço em salas privativas de tatame.',
    latitude: 35.0011,
    longitude: 135.7807,
    imageUrl: IMAGES.ramen,
    amenities: ['Kaiseki sazonal', 'Salas privativas', 'Reserva obrigatória'],
    partnerUrl: 'https://www.google.com/maps/search/kaiseki+higashiyama+kyoto',
  },
  {
    id: 'place-ryokan-sakura',
    name: 'Ryokan Sakura-an',
    type: 'hotel',
    rating: 4.7,
    priceLevel: 4,
    averagePrice: 38000,
    currency: 'JPY',
    city: 'Kyoto',
    country: 'Japão',
    address: 'Gion, Higashiyama-ku, Kyoto',
    phone: '+81755551234',
    openingHours: ['Check-in 15:00', 'Check-out 11:00'],
    description:
      'Ryokan familiar em Gion com onsen privativo, jantar kaiseki incluso e quartos de tatame voltados para o jardim.',
    latitude: 35.0037,
    longitude: 135.7788,
    imageUrl: IMAGES.hotelSuite,
    amenities: ['Onsen privativo', 'Jantar incluso', 'Yukata', 'Jardim japonês'],
    partnerUrl: 'https://www.google.com/maps/search/ryokan+gion+kyoto',
  },
  {
    id: 'place-trattoria-vecchia',
    name: 'Trattoria Vecchia Roma',
    type: 'restaurant',
    rating: 4.5,
    priceLevel: 2,
    averagePrice: 28,
    currency: 'EUR',
    city: 'Roma',
    country: 'Itália',
    address: 'Via del Governo Vecchio, 00186 Roma',
    phone: '+390668801234',
    openingHours: ['Todos os dias 12:00–15:00, 19:00–23:30'],
    description:
      'Trattoria familiar a três quadras da Piazza Navona, especializada em cacio e pepe e carbonara feitas na hora.',
    latitude: 41.8986,
    longitude: 12.4687,
    imageUrl: IMAGES.pasta,
    amenities: ['Massa fresca', 'Mesas na calçada', 'Aceita cartão'],
    partnerUrl: 'https://www.google.com/maps/search/trattoria+governo+vecchio+roma',
  },
  {
    id: 'place-albergo-fontana',
    name: 'Albergo della Fontana',
    type: 'hotel',
    rating: 4.3,
    priceLevel: 2,
    averagePrice: 145,
    currency: 'EUR',
    city: 'Roma',
    country: 'Itália',
    address: 'Via delle Muratte, 00187 Roma',
    phone: '+390669921000',
    openingHours: ['Recepção 24 horas'],
    description:
      'Hotel de charme com terraço voltado para a Fontana di Trevi e café da manhã italiano servido no último andar.',
    latitude: 41.9009,
    longitude: 12.4833,
    imageUrl: IMAGES.hotelLobby,
    amenities: ['Terraço panorâmico', 'Café da manhã', 'Wi-Fi gratuito'],
    partnerUrl: 'https://www.google.com/maps/search/hotel+fontana+di+trevi+roma',
  },
  {
    id: 'place-brooklyn-grill',
    name: 'Brooklyn Harbor Grill',
    type: 'restaurant',
    rating: 4.4,
    priceLevel: 3,
    averagePrice: 62,
    currency: 'USD',
    city: 'Nova York',
    country: 'Estados Unidos',
    address: '1 Water St, Brooklyn, NY 11201',
    phone: '+17185550123',
    openingHours: ['Seg–Qui 17:00–22:00', 'Sex–Dom 12:00–23:00'],
    description:
      'Grill contemporâneo em Dumbo com vista para a ponte do Brooklyn e cardápio focado em frutos do mar da costa leste.',
    latitude: 40.7033,
    longitude: -73.9903,
    imageUrl: IMAGES.restaurantChef,
    amenities: ['Vista para a ponte', 'Bar de ostras', 'Brunch aos domingos'],
    partnerUrl: 'https://www.google.com/maps/search/restaurant+dumbo+brooklyn',
  },
  {
    id: 'place-midtown-suites',
    name: 'Midtown Park Suites',
    type: 'hotel',
    rating: 4.2,
    priceLevel: 4,
    averagePrice: 340,
    currency: 'USD',
    city: 'Nova York',
    country: 'Estados Unidos',
    address: '160 W 56th St, New York, NY 10019',
    phone: '+12125550188',
    openingHours: ['Recepção 24 horas'],
    description:
      'Suítes amplas a duas quadras do Central Park, com cozinha compacta e academia aberta 24 horas.',
    latitude: 40.7648,
    longitude: -73.9808,
    imageUrl: IMAGES.hotelSuite,
    amenities: ['Cozinha no quarto', 'Academia 24h', 'Wi-Fi gratuito', 'Pet friendly'],
    partnerUrl: 'https://www.google.com/maps/search/hotel+midtown+central+park',
  },
  {
    id: 'place-louvre',
    name: 'Museu do Louvre',
    type: 'attraction',
    rating: 4.7,
    priceLevel: 2,
    averagePrice: 22,
    currency: 'EUR',
    city: 'Paris',
    country: 'França',
    address: 'Rue de Rivoli, 75001 Paris',
    openingHours: ['Qua–Seg 09:00–18:00', 'Terça fechado'],
    description:
      'O maior museu de arte do mundo. Reserve o ingresso com horário marcado e entre pela Porte des Lions para evitar a fila da pirâmide.',
    latitude: 48.8606,
    longitude: 2.3376,
    imageUrl: IMAGES.paris,
    amenities: ['Ingresso com horário', 'Audioguia', 'Acessível'],
    partnerUrl: 'https://www.google.com/maps/search/musee+du+louvre',
  },
  {
    id: 'place-fushimi-inari',
    name: 'Santuário Fushimi Inari',
    type: 'attraction',
    rating: 4.8,
    priceLevel: 1,
    city: 'Kyoto',
    country: 'Japão',
    address: '68 Fukakusa Yabunouchicho, Fushimi-ku, Kyoto',
    openingHours: ['Aberto 24 horas'],
    description:
      'Milhares de portais torii vermelhos subindo o monte Inari. Chegue antes das 7h para percorrer o caminho praticamente sozinho.',
    latitude: 34.9671,
    longitude: 135.7727,
    imageUrl: IMAGES.kyoto,
    amenities: ['Entrada gratuita', 'Aberto 24h', 'Trilha de 2h'],
    partnerUrl: 'https://www.google.com/maps/search/fushimi+inari+taisha',
  },
  {
    id: 'place-coliseu',
    name: 'Coliseu de Roma',
    type: 'attraction',
    rating: 4.7,
    priceLevel: 2,
    averagePrice: 18,
    currency: 'EUR',
    city: 'Roma',
    country: 'Itália',
    address: 'Piazza del Colosseo, 00184 Roma',
    openingHours: ['Todos os dias 08:30–19:00'],
    description:
      'O anfiteatro romano mais bem preservado do mundo. O ingresso combinado inclui Fórum Romano e Monte Palatino, válido por 24 horas.',
    latitude: 41.8902,
    longitude: 12.4922,
    imageUrl: IMAGES.rome,
    amenities: ['Ingresso combinado', 'Visita guiada', 'Acessível'],
    partnerUrl: 'https://www.google.com/maps/search/colosseo+roma',
  },
  {
    id: 'place-central-park',
    name: 'Central Park',
    type: 'attraction',
    rating: 4.8,
    priceLevel: 1,
    city: 'Nova York',
    country: 'Estados Unidos',
    address: 'New York, NY 10024',
    openingHours: ['Todos os dias 06:00–01:00'],
    description:
      'Os 340 hectares que organizam Manhattan. Bethesda Terrace e o Bow Bridge concentram as vistas mais conhecidas do parque.',
    latitude: 40.7829,
    longitude: -73.9654,
    imageUrl: IMAGES.newYork,
    amenities: ['Entrada gratuita', 'Aluguel de bicicleta', 'Acessível'],
    partnerUrl: 'https://www.google.com/maps/search/central+park+new+york',
  },
];

export const ADVISORS: Advisor[] = [
  {
    id: 'advisor-ana-europa',
    name: 'Ana Beatriz Correia',
    specialty: 'Europa',
    rating: 4.9,
    status: 'online',
    avatarUrl: IMAGES.mapPlanning,
    bio: 'Doze anos montando roteiros pela Europa Ocidental. Especialista em itinerários multi-cidade com trem e em vistos Schengen.',
  },
  {
    id: 'advisor-caio-gastronomia',
    name: 'Caio Menezes',
    specialty: 'Gastronomia',
    rating: 4.8,
    status: 'online',
    avatarUrl: IMAGES.restaurantChef,
    bio: 'Ex-chef, hoje desenha roteiros gastronômicos. Conhece mercados, bistrôs de bairro e casas com estrela em nove países.',
  },
  {
    id: 'advisor-luiza-trilhas',
    name: 'Luíza Prado',
    specialty: 'Trilhas e natureza',
    rating: 4.7,
    status: 'busy',
    avatarUrl: IMAGES.alps,
    bio: 'Guia de montanha certificada. Planeja travessias nos Alpes, Patagônia e Andes com foco em segurança e aclimatação.',
  },
  {
    id: 'advisor-pedro-luademel',
    name: 'Pedro Arantes',
    specialty: 'Lua de mel',
    rating: 4.9,
    status: 'online',
    avatarUrl: IMAGES.santorini,
    bio: 'Especialista em viagens de casal, das ilhas gregas às Maldivas. Cuida de upgrades, jantares e surpresas combinadas com o hotel.',
  },
  {
    id: 'advisor-marcia-corporativo',
    name: 'Márcia Toledo',
    specialty: 'Corporativo',
    rating: 4.6,
    status: 'offline',
    avatarUrl: IMAGES.newYork,
    bio: 'Atende viajantes a trabalho: remarcações, política de despesas, salas VIP e otimização de conexões.',
  },
];
