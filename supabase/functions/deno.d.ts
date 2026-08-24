/**
 * Declarações mínimas para conferir as Edge Functions com o TypeScript do
 * projeto, sem Deno instalado.
 *
 * Por que isto existe: a rodada anterior enviou uma Function com sintaxe
 * inválida porque nada no repositório a compilava — `tsc` e o Jest ignoram
 * `supabase/functions` (Deno, especificadores `jsr:`, global `Deno`). Um erro
 * de sintaxe só aparecia no deploy, que é o pior lugar para descobrir.
 *
 * O que isto NÃO é: um substituto do runtime Deno. Não valida permissões, não
 * resolve o grafo de módulos remotos e não executa nada. Valida sintaxe e
 * tipos do código que escrevemos — que é exatamente o que faltava.
 *
 * Rodar com: `npm run check:functions`.
 */

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

declare module 'jsr:@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, options?: unknown): any;
}
