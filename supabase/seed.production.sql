-- =============================================================================
-- Easy Trip — seed de PRODUÇÃO
--
-- ARQUIVO GERADO — não edite à mão.
-- Origem: src/data/catalog.ts   Regenerar: npm run seed:generate
--
-- Diferenças em relação a `seed.sql` (que é o seed de DEMONSTRAÇÃO):
--   • especialistas  → não entram (D-05: são pessoas fictícias)
--   • ofertas        → não entram (preço/desconto são compromisso comercial)
--   • artigos        → assinatura institucional, não nomes inventados
--   • lugares        → sem telefone e sem nota (dados não verificáveis)
--
-- As imagens continuam sendo URLs externas enquanto os arquivos originais não
-- existirem em assets/content/ (P-04). Ver scripts/seed-content-assets.mjs.
--
-- Este arquivo NÃO é aplicado por `supabase db push`, que só roda migrations.
-- Aplicação manual e deliberada — ver GO_LIVE_SUPABASE.md.
-- =============================================================================

-- Articles -------------------------------------------------------------------
insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values ('a64cbe0f-bf3a-4061-8976-3e6e65873e70', 'como-fazer-mala-10-dias', 'Como fazer a mala para 10 dias levando só bagagem de mão', 'Preparação', 'https://images.unsplash.com/photo-1517840901100-8179e982acb7?auto=format&fit=crop&w=1200&q=80', 'Equipe Easy Trip', 'Viajar só com bagagem de mão deixa de ser um desafio quando você troca a lógica de "levar tudo que pode ser útil" pela lógica de "levar o que combina entre si".

## Comece pela paleta

Escolha duas cores neutras e uma cor de destaque. Com isso, praticamente todas as peças se combinam e você reduz o volume pela metade sem perder variedade nas fotos.

## A regra 5-4-3-2-1

Para dez dias, funciona muito bem: cinco camisetas, quatro peças de baixo, três peças de sobreposição, dois pares de sapato e um casaco. Some roupa íntima e meias e você tem um guarda-roupa completo em nove litros.

## Enrole, não dobre

Peças enroladas ocupam menos espaço e chegam com menos marcas. Use os sapatos como estojo: meias e carregadores cabem dentro deles.

## Líquidos

A maioria dos aeroportos limita líquidos a 100 ml por embalagem, somando no máximo 1 litro em saco transparente. Xampu em barra resolve boa parte do problema e não conta como líquido.

## Deixe 15% livre

Se a mala sai 100% cheia, ela não volta fechando. Reserve espaço para o que você vai trazer.', '2026-05-12T09:00:00.000Z', 6, 'published') on conflict (id) do nothing;
insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values ('8352bc8c-8e67-4b90-8d35-671c11ba981c', 'documentos-para-a-europa', 'Documentos para a Europa: o que conferir antes de embarcar', 'Documentos', 'https://images.unsplash.com/photo-1541971875076-8f970d573be6?auto=format&fit=crop&w=1200&q=80', 'Equipe Easy Trip', 'Regras de imigração mudam com frequência, então trate esta lista como um roteiro de conferência — e confirme sempre na fonte oficial do país de destino antes de viajar.

## Passaporte com validade folgada

Muitos países do espaço Schengen exigem passaporte válido por pelo menos três meses além da data prevista de saída, e emitido há menos de dez anos.

## Comprovantes que podem ser pedidos

Na fronteira é comum pedirem passagem de volta, comprovante de hospedagem e demonstração de meios de subsistência. Ter tudo salvo offline no aplicativo evita procurar e-mail com o agente esperando.

## Seguro viagem

Para o espaço Schengen o seguro com cobertura mínima de 30 mil euros é obrigatório. Guarde o número da apólice e o telefone de emergência da seguradora.

## Autorização eletrônica

Sistemas de autorização prévia de viagem entraram em operação recentemente para vários destinos. Verifique com antecedência se o seu caso exige o registro — ele costuma ser rápido, mas não é feito no aeroporto.

## Salve tudo em dois lugares

Uma cópia digital no Easy Trip e uma cópia física separada da original. Se a carteira sumir, você ainda consegue se identificar no consulado.', '2026-04-28T09:00:00.000Z', 5, 'published') on conflict (id) do nothing;
insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values ('bd492df7-d2ad-4095-8fe4-8d628ff6ce8c', 'comer-bem-gastando-pouco', 'Comer bem gastando pouco: a estratégia dos mercados municipais', 'Gastronomia', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80', 'Equipe Easy Trip', 'Alimentação costuma ser o segundo maior gasto de uma viagem, atrás só da hospedagem. A boa notícia é que ela é o gasto mais fácil de controlar sem sacrificar a experiência.

## Inverta as refeições

Muitos restaurantes bons servem no almoço o mesmo cardápio do jantar por um preço bem menor. Faça a refeição principal ao meio-dia.

## Mercados municipais

Mercados são a forma mais honesta de comer a comida local. Em Roma, Lisboa ou Barcelona você monta uma refeição completa por uma fração do valor de um restaurante turístico.

## A regra das duas quadras

Afaste-se duas quadras da atração principal e o preço médio cai visivelmente. A mesma cozinha, sem o aluguel da vista.

## Registre na hora

Anotar o gasto no momento em que ele acontece é o que mantém o orçamento real. Depois de três dias, ninguém lembra quanto custou o café.', '2026-06-02T09:00:00.000Z', 4, 'published') on conflict (id) do nothing;
insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values ('072e3b09-4f43-4db0-886d-c6b9567238b9', 'vencendo-o-jet-lag', 'Vencendo o jet lag: o que realmente funciona', 'Saúde', 'https://images.unsplash.com/photo-1444723121867-7a241cacace9?auto=format&fit=crop&w=1200&q=80', 'Equipe Easy Trip', 'O jet lag acontece porque o relógio biológico continua no fuso de origem enquanto o ambiente já mudou. A adaptação natural leva cerca de um dia por fuso cruzado — mas dá para acelerar.

## Ajuste antes de embarcar

Nos três dias anteriores, mova o horário de dormir de 30 a 60 minutos por dia no sentido do destino. Chegar parcialmente adaptado encurta muito a recuperação.

## Luz é o sinal mais forte

Viajando para leste, busque luz da manhã. Para oeste, busque luz do fim da tarde. Luz na hora errada atrasa a adaptação em vez de ajudar.

## Hidratação e cafeína

A cabine é muito seca. Beba água com regularidade e concentre a cafeína na primeira metade do dia do destino.

## Resista ao cochilo longo

Ao chegar de dia, fique acordado até a noite local. Se precisar, um cochilo de 20 minutos resolve sem comprometer o sono da noite.', '2026-03-18T09:00:00.000Z', 5, 'published') on conflict (id) do nothing;
insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values ('529a9f39-e0dc-492a-8246-661333779863', 'montando-um-orcamento-de-viagem-realista', 'Montando um orçamento de viagem que sobrevive à viagem', 'Finanças', 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?auto=format&fit=crop&w=1200&q=80', 'Equipe Easy Trip', 'A maioria dos orçamentos de viagem falha pelo mesmo motivo: eles registram o que foi planejado, não o que foi gasto.

## Separe fixo de variável

Passagem, hospedagem e seguro são fixos e já estão definidos antes de embarcar. Alimentação, transporte local e compras são variáveis — é aqui que o orçamento escapa.

## Trabalhe com um valor por dia

Divida o variável pelo número de dias. Um teto diário é muito mais fácil de administrar mentalmente do que um total de viagem.

## Anote na moeda que você pagou

Converter de cabeça na hora gera erro. Registre o valor na moeda local e deixe a conversão com a taxa do dia para o aplicativo — assim o histórico não muda de valor quando o câmbio mexe.

## Reserve 15% de folga

Imprevistos não são exceção, são estatística: taxa de bagagem, remédio, táxi na chuva. Um orçamento sem folga vira dívida.

## Revise no meio da viagem

Na metade dos dias, compare o gasto acumulado com o previsto. Ainda dá tempo de ajustar — no último dia, não dá.', '2026-07-01T09:00:00.000Z', 7, 'published') on conflict (id) do nothing;
insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values ('d131c52f-be56-41b7-8f67-e4988f87e6e6', 'primeira-viagem-internacional', 'Primeira viagem internacional: 12 coisas que ninguém te conta', 'Preparação', 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1200&q=80', 'Equipe Easy Trip', 'A primeira viagem internacional tem uma curva de aprendizado que quase ninguém descreve. Estes são os pontos que mais pegam viajantes de primeira viagem.

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

O melhor dia da viagem costuma ser o que não estava planejado.', '2026-02-09T09:00:00.000Z', 8, 'published') on conflict (id) do nothing;

-- Places ---------------------------------------------------------------------
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('1ced5572-b489-4824-8864-cd56d176ed96', 'Le Comptoir du Marais', 'restaurant', null, 3, 45, 'EUR', 'Paris', 'França', '18 Rue des Archives, 75004 Paris', null, '{"Seg–Sex 12:00–14:30, 19:00–23:00","Sáb–Dom 12:00–23:00"}', 'Bistrô contemporâneo no coração do Marais, conhecido pelo menu sazonal de quatro tempos e por uma carta de vinhos naturais franceses.', 48.8592, 2.3596, 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80', '{"Menu vegetariano","Wi-Fi","Reserva recomendada","Terraço"}', 'https://www.google.com/maps/search/Le+Comptoir+du+Marais+Paris') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('cf7dc25f-fa15-4510-8568-674fc993676f', 'Hôtel Lumière Rivoli', 'hotel', null, 3, 210, 'EUR', 'Paris', 'França', '42 Rue de Rivoli, 75001 Paris', null, '{"Recepção 24 horas"}', 'Hotel boutique a dez minutos a pé do Louvre, com quartos silenciosos voltados para o pátio interno e café da manhã servido até as 11h.', 48.8571, 2.3519, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80', '{"Café da manhã","Wi-Fi gratuito","Ar-condicionado","Recepção 24h"}', 'https://www.google.com/maps/search/hotel+rue+de+rivoli+paris') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('36dd692f-0bbc-496d-8d61-d042429a229c', 'Kikunoi Higashiyama', 'restaurant', null, 4, 22000, 'JPY', 'Kyoto', 'Japão', '459 Shimokawara-cho, Higashiyama-ku, Kyoto', null, '{"Ter–Dom 12:00–13:00, 17:00–20:00","Segunda fechado"}', 'Casa de kaiseki tradicional em Higashiyama, com menu que muda a cada estação e serviço em salas privativas de tatame.', 35.0011, 135.7807, 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80', '{"Kaiseki sazonal","Salas privativas","Reserva obrigatória"}', 'https://www.google.com/maps/search/kaiseki+higashiyama+kyoto') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('25e93d03-5925-4dba-8ccc-40b97f0ebabd', 'Ryokan Sakura-an', 'hotel', null, 4, 38000, 'JPY', 'Kyoto', 'Japão', 'Gion, Higashiyama-ku, Kyoto', null, '{"Check-in 15:00","Check-out 11:00"}', 'Ryokan familiar em Gion com onsen privativo, jantar kaiseki incluso e quartos de tatame voltados para o jardim.', 35.0037, 135.7788, 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', '{"Onsen privativo","Jantar incluso","Yukata","Jardim japonês"}', 'https://www.google.com/maps/search/ryokan+gion+kyoto') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('3ed32f5d-ae20-44c2-80f3-2b9fecf3341f', 'Trattoria Vecchia Roma', 'restaurant', null, 2, 28, 'EUR', 'Roma', 'Itália', 'Via del Governo Vecchio, 00186 Roma', null, '{"Todos os dias 12:00–15:00, 19:00–23:30"}', 'Trattoria familiar a três quadras da Piazza Navona, especializada em cacio e pepe e carbonara feitas na hora.', 41.8986, 12.4687, 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=1200&q=80', '{"Massa fresca","Mesas na calçada","Aceita cartão"}', 'https://www.google.com/maps/search/trattoria+governo+vecchio+roma') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('ea7fa3d9-a7c7-4bb9-8db8-98609246df92', 'Albergo della Fontana', 'hotel', null, 2, 145, 'EUR', 'Roma', 'Itália', 'Via delle Muratte, 00187 Roma', null, '{"Recepção 24 horas"}', 'Hotel de charme com terraço voltado para a Fontana di Trevi e café da manhã italiano servido no último andar.', 41.9009, 12.4833, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80', '{"Terraço panorâmico","Café da manhã","Wi-Fi gratuito"}', 'https://www.google.com/maps/search/hotel+fontana+di+trevi+roma') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('c4d681c8-953f-46c8-81e9-87005a158890', 'Brooklyn Harbor Grill', 'restaurant', null, 3, 62, 'USD', 'Nova York', 'Estados Unidos', '1 Water St, Brooklyn, NY 11201', null, '{"Seg–Qui 17:00–22:00","Sex–Dom 12:00–23:00"}', 'Grill contemporâneo em Dumbo com vista para a ponte do Brooklyn e cardápio focado em frutos do mar da costa leste.', 40.7033, -73.9903, 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=80', '{"Vista para a ponte","Bar de ostras","Brunch aos domingos"}', 'https://www.google.com/maps/search/restaurant+dumbo+brooklyn') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('738c8bdf-df11-4631-8c9d-9dee529da210', 'Midtown Park Suites', 'hotel', null, 4, 340, 'USD', 'Nova York', 'Estados Unidos', '160 W 56th St, New York, NY 10019', null, '{"Recepção 24 horas"}', 'Suítes amplas a duas quadras do Central Park, com cozinha compacta e academia aberta 24 horas.', 40.7648, -73.9808, 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', '{"Cozinha no quarto","Academia 24h","Wi-Fi gratuito","Pet friendly"}', 'https://www.google.com/maps/search/hotel+midtown+central+park') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('490ef2e8-1740-4ad0-8e4e-0838604fedb8', 'Museu do Louvre', 'attraction', null, 2, 22, 'EUR', 'Paris', 'França', 'Rue de Rivoli, 75001 Paris', null, '{"Qua–Seg 09:00–18:00","Terça fechado"}', 'O maior museu de arte do mundo. Reserve o ingresso com horário marcado e entre pela Porte des Lions para evitar a fila da pirâmide.', 48.8606, 2.3376, 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80', '{"Ingresso com horário","Audioguia","Acessível"}', 'https://www.google.com/maps/search/musee+du+louvre') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('f1cf0440-c473-40ef-85bc-d4afb642d52f', 'Santuário Fushimi Inari', 'attraction', null, 1, null, null, 'Kyoto', 'Japão', '68 Fukakusa Yabunouchicho, Fushimi-ku, Kyoto', null, '{"Aberto 24 horas"}', 'Milhares de portais torii vermelhos subindo o monte Inari. Chegue antes das 7h para percorrer o caminho praticamente sozinho.', 34.9671, 135.7727, 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=80', '{"Entrada gratuita","Aberto 24h","Trilha de 2h"}', 'https://www.google.com/maps/search/fushimi+inari+taisha') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('01a1f019-d68c-44e3-872d-c4fad82e24fc', 'Coliseu de Roma', 'attraction', null, 2, 18, 'EUR', 'Roma', 'Itália', 'Piazza del Colosseo, 00184 Roma', null, '{"Todos os dias 08:30–19:00"}', 'O anfiteatro romano mais bem preservado do mundo. O ingresso combinado inclui Fórum Romano e Monte Palatino, válido por 24 horas.', 41.8902, 12.4922, 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=1200&q=80', '{"Ingresso combinado","Visita guiada","Acessível"}', 'https://www.google.com/maps/search/colosseo+roma') on conflict (id) do nothing;
insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values ('c114ed23-26b8-4e32-87ac-e311e7ccfb55', 'Central Park', 'attraction', null, 1, null, null, 'Nova York', 'Estados Unidos', 'New York, NY 10024', null, '{"Todos os dias 06:00–01:00"}', 'Os 340 hectares que organizam Manhattan. Bethesda Terrace e o Bow Bridge concentram as vistas mais conhecidas do parque.', 40.7829, -73.9654, 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=1200&q=80', '{"Entrada gratuita","Aluguel de bicicleta","Acessível"}', 'https://www.google.com/maps/search/central+park+new+york') on conflict (id) do nothing;

-- Offers e Advisors: deliberadamente ausentes. Cadastre pelo painel.
