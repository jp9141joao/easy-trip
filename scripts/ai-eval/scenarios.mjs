/**
 * Cenários de avaliação da IA acionável.
 *
 * DUAS CAMADAS DE DEFESA, E MEDIR SÓ UMA DÁ O RESULTADO ERRADO
 *
 * A primeira versão deste arquivo reprovou quatro cenários. Nenhum era defeito
 * do produto: eram expectativas erradas minhas, e a diferença vale ser
 * registrada porque ela é o desenho da validação.
 *
 *   `parseAIActions`     valida o CONTRATO. Tipo desconhecido, campo inventado,
 *                        data impossível, valor absurdo: nada disso vira ação.
 *                        Um campo acessório ruim — um horário `25:99` — vira
 *                        CAMPO AUSENTE, e não item recusado: derrubar "Café" do
 *                        dia porque o modelo escreveu um horário torto custaria
 *                        mais a quem pediu do que o horário vale.
 *
 *   `buildReviewGroups`  valida a COERÊNCIA COM A VIAGEM. Uma data fora do
 *                        período não some — chega à tela **desmarcada e com
 *                        aviso**. É melhor do que descartar em silêncio: a
 *                        pessoa pediu aquilo, e ver "12 de dezembro está fora
 *                        do período" explica; o item sumir, não.
 *
 * Por isso cada cenário declara até quatro números, e não um:
 *
 *   acoes      propostas que sobreviveram ao contrato
 *   itens      itens dentro delas
 *   incluidos  itens já marcados — o que seria aplicado ao confirmar
 *   avisados   itens desmarcados, com aviso, esperando decisão
 *
 * TODOS SINTÉTICOS. Nenhum diário real, nenhuma viagem real, nenhum dado
 * pessoal de ninguém. As viagens abaixo são inventadas para o teste, e as
 * "respostas do modelo" são construídas à mão para exercitar um comportamento
 * específico cada — inclusive os comportamentos ruins que a validação existe
 * para barrar.
 *
 * A ESTRUTURA DE UM CENÁRIO
 *
 *   nome        o que ele mede, em uma frase
 *   familia     para agrupar no relatório
 *   trip        a viagem contra a qual a proposta é validada
 *   raw         o que o modelo teria devolvido (array cru de actions)
 *   esperado    o que deve sobreviver a `parseAIActions`
 *   porque      por que este é o comportamento correto
 *
 * `esperado` NUNCA é "o que a implementação atual faz". É o que deveria
 * acontecer, decidido a partir da regra — e é por isso que um cenário pode
 * reprovar.
 */

export const VIAGEM = {
  id: 'trip-lisboa',
  userId: 'u1',
  destinationCity: 'Lisboa',
  destinationCountry: 'Portugal',
  countryCode: 'PT',
  timezone: 'Europe/Lisbon',
  startDate: '2026-09-10',
  endDate: '2026-09-15',
  budgetTotal: 6000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const item = (over = {}) => ({
  title: 'Mosteiro dos Jerónimos',
  date: '2026-09-11',
  startTime: '10:00',
  type: 'atracao',
  ...over,
});

export const CENARIOS = [
  /* ------------------------------ datas -------------------------------- */
  {
    nome: 'roteiro dentro das datas da viagem',
    familia: 'datas',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia 2', items: [item(), item({ title: 'Belém', date: '2026-09-12' })] }],
    esperado: { acoes: 1, itens: 2 },
    porque: 'As duas datas caem na viagem. Nada a descartar.',
  },
  {
    nome: 'item ANTES do início chega desmarcado, com aviso',
    familia: 'datas',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia', items: [item({ date: '2026-09-01' }), item({ date: '2026-09-11' })] }],
    esperado: { acoes: 1, itens: 2, incluidos: 1, avisados: 1 },
    porque:
      'O item fora do período NÃO some: chega desmarcado e com aviso. A pessoa pediu ' +
      'aquilo, e "1 de setembro está fora do período" explica; o item sumir, não.',
  },
  {
    nome: 'proposta só com item fora do período chega inteira desligada',
    familia: 'datas',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia', items: [item({ date: '2026-09-30' })] }],
    esperado: { acoes: 1, itens: 1, incluidos: 0, avisados: 1, grupoDesligado: true },
    porque:
      'Único item fora do período: a proposta chega com NADA marcado, e o grupo inteiro ' +
      'desligado. Confirmar sem tocar em nada não aplica coisa alguma.',
  },
  {
    nome: 'data inexistente no calendário é descartada',
    familia: 'datas',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia', items: [item({ date: '2026-02-30' })] }],
    esperado: { acoes: 0, itens: 0 },
    porque: '30 de fevereiro não existe. O modelo às vezes escreve datas assim.',
  },
  {
    nome: 'data em formato errado é descartada',
    familia: 'datas',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia', items: [item({ date: '11/09/2026' })] }],
    esperado: { acoes: 0, itens: 0 },
    porque: 'O contrato é ISO. Aceitar outro formato deixaria o banco decidir, e ele decidiria errado.',
  },

  /* ------------------------- campos alucinados -------------------------- */
  {
    nome: 'campo que não existe no contrato é ignorado',
    familia: 'alucinação',
    trip: VIAGEM,
    raw: [{
      type: 'itinerary.add', label: 'Dia',
      items: [{ ...item(), preco: 120, telefone: '+351 21 000 0000', avaliacao: 4.8 }],
    }],
    esperado: { acoes: 1, itens: 1, semCampos: ['preco', 'telefone', 'avaliacao'] },
    porque: 'Preço e telefone inventados pelo modelo viram informação falsa se forem gravados.',
  },
  {
    nome: 'tipo de ação desconhecido é descartado',
    familia: 'alucinação',
    trip: VIAGEM,
    raw: [{ type: 'trip.delete', label: 'Apagar viagem', items: [] }],
    esperado: { acoes: 0, itens: 0 },
    porque: 'A lista de tipos é fechada. Um tipo novo inventado pelo modelo não vira operação.',
  },
  {
    nome: 'ação sem items é descartada',
    familia: 'alucinação',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia cheio' }],
    esperado: { acoes: 0, itens: 0 },
    porque: 'Rótulo sem conteúdo é um card que promete e não entrega.',
  },
  {
    nome: 'payload malformado não derruba a validação',
    familia: 'alucinação',
    trip: VIAGEM,
    raw: [null, 'texto solto', 42, [], { semTipo: true }],
    esperado: { acoes: 0, itens: 0 },
    porque: 'A resposta do modelo é entrada não confiável; nada aqui pode levantar exceção.',
  },
  {
    nome: 'resposta que não é lista devolve lista vazia',
    familia: 'alucinação',
    trip: VIAGEM,
    raw: { type: 'itinerary.add' },
    esperado: { acoes: 0, itens: 0 },
    porque: 'Idem. O contrato é um array.',
  },

  /* ------------------------------ limites ------------------------------- */
  {
    nome: 'mais ações do que o limite: o excesso é cortado',
    familia: 'limites',
    trip: VIAGEM,
    raw: [
      { type: 'itinerary.add', label: 'A', items: [item()] },
      { type: 'checklist.add', label: 'B', items: [{ label: 'Adaptador', category: 'documentos' }] },
      { type: 'expenses.add', label: 'C', items: [{ description: 'Almoço', amount: 50, category: 'alimentacao', transactionDate: '2026-09-11' }] },
      { type: 'goal.add', label: 'D', items: [{ title: 'Guardar', targetValue: 1000, type: 'economia' }] },
      { type: 'budget.update', label: 'E', budgetTotal: 7000 },
    ],
    esperado: { acoesMax: 4 },
    porque: 'Quatro é o limite. Uma tela com cinco cards de proposta deixa de ser revisável.',
  },
  {
    nome: 'duas ações do MESMO tipo: só a primeira sobrevive',
    familia: 'limites',
    trip: VIAGEM,
    raw: [
      { type: 'itinerary.add', label: 'Manhã', items: [item()] },
      { type: 'itinerary.add', label: 'Tarde', items: [item({ title: 'Belém', startTime: '15:00' })] },
    ],
    esperado: { acoes: 1 },
    porque: 'Dois cards iguais na tela de revisão são indistinguíveis para quem escolhe.',
  },
  {
    nome: 'lista de itens acima do teto é truncada',
    familia: 'limites',
    trip: VIAGEM,
    raw: [{
      type: 'itinerary.add', label: 'Muitos',
      items: Array.from({ length: 50 }, (_, i) => item({ title: `Parada ${i}` })),
    }],
    esperado: { acoes: 1, itensMax: 20 },
    porque: 'O teto protege a tela e o banco de uma resposta que fugiu do schema.',
  },

  /* ------------------------------ orçamento ----------------------------- */
  {
    nome: 'valor negativo é descartado',
    familia: 'orçamento',
    trip: VIAGEM,
    raw: [{ type: 'expenses.add', label: 'Gastos', items: [
      { description: 'Estorno', amount: -100, category: 'alimentacao', transactionDate: '2026-09-11' },
      { description: 'Jantar', amount: 80, category: 'alimentacao', transactionDate: '2026-09-11' },
    ] }],
    esperado: { acoes: 1, itens: 1 },
    porque: 'Despesa negativa quebraria o CHECK do banco e a soma do orçamento.',
  },
  {
    nome: 'valor absurdo é descartado',
    familia: 'orçamento',
    trip: VIAGEM,
    raw: [{ type: 'expenses.add', label: 'Gastos', items: [
      { description: 'Hotel', amount: 999_999_999, category: 'hospedagem', transactionDate: '2026-09-11' },
    ] }],
    esperado: { acoes: 0, itens: 0 },
    porque: 'Um zero a mais do modelo viraria um orçamento estourado que ninguém entende.',
  },
  {
    nome: 'despesa fora das datas chega desmarcada, com aviso',
    familia: 'orçamento',
    trip: VIAGEM,
    raw: [{ type: 'expenses.add', label: 'Gastos', items: [
      { description: 'Café', amount: 15, category: 'alimentacao', transactionDate: '2025-01-01' },
    ] }],
    esperado: { acoes: 1, itens: 1, incluidos: 0, avisados: 1 },
    porque:
      'Mesma regra do roteiro, e a mesma resposta: aviso e desmarcado, não descarte ' +
      'silencioso. Despesa não é deduplicada, mas a data é sempre conferida.',
  },

  /* ---------------------------- dia inteiro ----------------------------- */
  {
    nome: 'roteiro de dia inteiro com horários crescentes',
    familia: 'dia inteiro',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia 2 completo', items: [
      item({ title: 'Café', startTime: '08:00', type: 'refeicao' }),
      item({ title: 'Jerónimos', startTime: '10:00' }),
      item({ title: 'Almoço', startTime: '13:00', type: 'refeicao' }),
      item({ title: 'Torre de Belém', startTime: '15:00' }),
      item({ title: 'Jantar', startTime: '20:00', type: 'refeicao' }),
    ] }],
    esperado: { acoes: 1, itens: 5 },
    porque: 'O caso de uso central: um dia inteiro proposto de uma vez.',
  },
  {
    nome: 'horário impossível vira campo ausente, o item fica',
    familia: 'dia inteiro',
    trip: VIAGEM,
    raw: [{ type: 'itinerary.add', label: 'Dia', items: [
      item({ title: 'Café', startTime: '25:99' }),
      item({ title: 'Jerónimos', startTime: '10:00' }),
    ] }],
    esperado: { acoes: 1, itens: 2, incluidos: 2, semCampos: ['25:99'] },
    porque:
      'O horário impossível vira CAMPO AUSENTE — o "Café" continua no dia, sem hora. ' +
      'Derrubar o item por causa do acessório custaria mais a quem pediu do que o ' +
      'horário vale, e `25:99` não chega ao banco.',
  },
];
