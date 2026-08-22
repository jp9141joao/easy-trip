import type { Advisor, Offer } from '@/domain/types';
import type { DataSource } from '@/repositories';

/**
 * Contrato público dos catálogos editáveis — Ofertas e Especialistas.
 *
 * Está fora de `tests/unit` de propósito: é uma bateria parametrizada, não uma
 * suíte. Quem a executa passa a implementação, e o que se mede é sempre a mesma
 * coisa — o **estado observado depois da mutação**, nunca o retorno do método.
 * Um `create` que devolve o objeto e some na leitura seguinte falha aqui, que é
 * exatamente a forma do P-05.
 *
 * Hoje roda contra o `LocalDataSource`. O lado Supabase é medido pelos scripts
 * E2E, que falam com o PostgREST de verdade — a autorização dele não cabe num
 * teste de unidade.
 */

export interface CatalogContractOptions {
  /** Nome da implementação, para aparecer no `describe`. */
  readonly name: string;
  /** Devolve a implementação já pronta para uso. */
  readonly create: () => Promise<DataSource> | DataSource;
}

const dia = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * dia).toISOString().slice(0, 10);

export const HOJE = isoDay(0);
export const ONTEM = isoDay(-1);
export const AMANHA = isoDay(1);

export const offer = (overrides: Partial<Offer> = {}): Offer => ({
  id: `offer-${Math.random().toString(36).slice(2, 10)}`,
  destination: 'Lisboa, Portugal',
  description: 'Cinco noites em Alfama.',
  costLevel: 'economy',
  imageUrl: 'https://exemplo/lisboa.jpg',
  thingsToDo: ['Alfama'],
  status: 'published',
  sortOrder: 100,
  ...overrides,
});

export const advisor = (overrides: Partial<Advisor> = {}): Advisor => ({
  id: `advisor-${Math.random().toString(36).slice(2, 10)}`,
  name: 'Zulmira Teste',
  specialty: 'Europa',
  status: 'online',
  active: true,
  ...overrides,
});

export function runCatalogContract({ name, create }: CatalogContractOptions): void {
  describe(`contrato de catálogo — ${name}`, () => {
    let source: DataSource;

    beforeEach(async () => {
      source = await create();
    });

    /* ------------------------------- OFERTAS ------------------------------- */

    describe('ofertas', () => {
      it('A: o catálogo semeado aparece na listagem pública', async () => {
        expect((await source.content.listOffers()).length).toBeGreaterThan(0);
      });

      it('C+E: criar uma oferta em rascunho — some do público, aparece na administração', async () => {
        const nova = offer({ status: 'draft', destination: 'Rascunho de teste' });
        await source.content.upsertOffer(nova);

        const publicas = await source.content.listOffers();
        const todas = await source.content.listAllOffers();

        expect(publicas.map((o) => o.id)).not.toContain(nova.id);
        expect(todas.map((o) => o.id)).toContain(nova.id);
      });

      it('D+F: publicar faz a oferta aparecer — a mutação é observável na leitura', async () => {
        const nova = offer({ status: 'draft' });
        await source.content.upsertOffer(nova);
        expect((await source.content.listOffers()).map((o) => o.id)).not.toContain(nova.id);

        await source.content.upsertOffer({ ...nova, status: 'published' });

        expect((await source.content.listOffers()).map((o) => o.id)).toContain(nova.id);
      });

      it('G: oferta agendada para o futuro não aparece', async () => {
        const futura = offer({ activeFrom: AMANHA });
        await source.content.upsertOffer(futura);
        expect((await source.content.listOffers()).map((o) => o.id)).not.toContain(futura.id);
      });

      it('H: oferta vencida não aparece', async () => {
        const vencida = offer({ activeUntil: ONTEM });
        await source.content.upsertOffer(vencida);
        expect((await source.content.listOffers()).map((o) => o.id)).not.toContain(vencida.id);
      });

      it('I: a que começa hoje já vale hoje — o limite é inclusivo, como o `<=` do SQL', async () => {
        const comecaHoje = offer({ activeFrom: HOJE });
        await source.content.upsertOffer(comecaHoje);
        expect((await source.content.listOffers()).map((o) => o.id)).toContain(comecaHoje.id);
      });

      it('J: a que termina hoje ainda vale hoje — inclusivo, como o `>=` do SQL', async () => {
        const terminaHoje = offer({ activeUntil: HOJE });
        await source.content.upsertOffer(terminaHoje);
        expect((await source.content.listOffers()).map((o) => o.id)).toContain(terminaHoje.id);
      });

      it('K: mudar `sortOrder` muda a ordem na próxima leitura', async () => {
        const primeira = offer({ sortOrder: 500, id: 'ordem-a' });
        const segunda = offer({ sortOrder: 600, id: 'ordem-b' });
        await source.content.upsertOffer(primeira);
        await source.content.upsertOffer(segunda);

        const antes = (await source.content.listOffers()).map((o) => o.id);
        expect(antes.indexOf('ordem-a')).toBeLessThan(antes.indexOf('ordem-b'));

        await source.content.upsertOffer({ ...primeira, sortOrder: 700 });

        const depois = (await source.content.listOffers()).map((o) => o.id);
        expect(depois.indexOf('ordem-b')).toBeLessThan(depois.indexOf('ordem-a'));
      });

      it('L: excluir remove de verdade — das duas listagens', async () => {
        const nova = offer();
        await source.content.upsertOffer(nova);
        expect(await source.content.getOffer(nova.id)).not.toBeNull();

        await source.content.removeOffer(nova.id);

        expect(await source.content.getOffer(nova.id)).toBeNull();
        expect((await source.content.listAllOffers()).map((o) => o.id)).not.toContain(nova.id);
        expect((await source.content.listOffers()).map((o) => o.id)).not.toContain(nova.id);
      });

      it('editar campos comuns preserva o que o patch não mencionou', async () => {
        const nova = offer({ bestTime: 'Abril a junho' });
        await source.content.upsertOffer(nova);
        await source.content.upsertOffer({ ...nova, destination: 'Porto, Portugal' });

        const salva = await source.content.getOffer(nova.id);
        expect(salva?.destination).toBe('Porto, Portugal');
        expect(salva?.bestTime).toBe('Abril a junho');
      });
    });

    /* ---------------------------- ESPECIALISTAS ---------------------------- */

    describe('especialistas', () => {
      it('A: o time semeado aparece', async () => {
        expect((await source.advisors.list()).length).toBeGreaterThan(0);
      });

      it('B+D: criar um especialista inativo — não aparece no diretório', async () => {
        const novo = advisor({ active: false, name: 'Inativo Teste' });
        await source.advisors.upsert(novo);

        expect((await source.advisors.list()).map((a) => a.id)).not.toContain(novo.id);
        expect((await source.advisors.listAll()).map((a) => a.id)).toContain(novo.id);
      });

      it('C: `offline` e ativo continua no diretório — presença não é cadastro', async () => {
        const novo = advisor({ status: 'offline', active: true });
        await source.advisors.upsert(novo);

        // Se `active` e `status` tivessem virado uma coluna só, esta linha
        // sumiria toda vez que a pessoa saísse do ar.
        expect((await source.advisors.list()).map((a) => a.id)).toContain(novo.id);
      });

      it('E: editar é observável na leitura seguinte', async () => {
        const novo = advisor({ specialty: 'Europa' });
        await source.advisors.upsert(novo);
        await source.advisors.upsert({ ...novo, specialty: 'Ásia' });

        expect((await source.advisors.get(novo.id))?.specialty).toBe('Ásia');
      });

      it('F+G: desativar tira do diretório, reativar recoloca', async () => {
        const novo = advisor();
        await source.advisors.upsert(novo);
        expect((await source.advisors.list()).map((a) => a.id)).toContain(novo.id);

        await source.advisors.upsert({ ...novo, active: false });
        expect((await source.advisors.list()).map((a) => a.id)).not.toContain(novo.id);

        await source.advisors.upsert({ ...novo, active: true });
        expect((await source.advisors.list()).map((a) => a.id)).toContain(novo.id);
      });

      it('H: excluir remove de verdade', async () => {
        const novo = advisor();
        await source.advisors.upsert(novo);

        await source.advisors.remove(novo.id);

        expect(await source.advisors.get(novo.id)).toBeNull();
        expect((await source.advisors.listAll()).map((a) => a.id)).not.toContain(novo.id);
      });

      it('excluir o especialista não apaga a consulta já pedida', async () => {
        const novo = advisor();
        await source.advisors.upsert(novo);
        const consulta = await source.advisors.requestConsultation({
          userId: 'usuario-contrato',
          advisorId: novo.id,
          scheduledAt: '2026-09-01T10:00:00.000Z',
        });

        await source.advisors.remove(novo.id);

        // Catálogo e pedido do usuário são coisas separadas: tirar alguém do
        // time não pode apagar o histórico de quem falou com essa pessoa.
        const consultas = await source.advisors.listConsultations('usuario-contrato');
        expect(consultas.map((c) => c.id)).toContain(consulta.id);
      });
    });
  });
}
