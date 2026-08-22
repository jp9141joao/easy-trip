# Imagens editoriais do Easy Trip

Esta pasta é onde entram as fotografias do conteúdo editorial — capas de artigo,
fotos de lugar, imagens de oferta e retratos de especialista. Ela existe porque
o defeito **P-04** só se fecha por inteiro quando o produto deixar de depender
de um host de terceiro (`images.unsplash.com`) para exibir o próprio conteúdo.

O código já está pronto: bucket, políticas, upload pelo painel e script de
migração. O que falta são os arquivos.

## O que colocar aqui

Um arquivo por registro, com o nome do **slug** do catálogo:

```
assets/content/articles/article-mala-10-dias.jpg
assets/content/places/place-comptoir-marais.jpg
assets/content/offers/offer-paris-primavera.jpg
assets/content/advisors/advisor-ana-europa.jpg
```

A lista completa, sempre atualizada, está em [`manifest.json`](./manifest.json),
gerado pelo próprio script de migração. Cada entrada traz a entidade, o slug, o
id no banco, o rótulo legível e o nome de arquivo esperado.

| Regra | Valor |
|---|---|
| Formatos | `.jpg`, `.jpeg`, `.png`, `.webp` |
| Tamanho máximo | 5 MB (é o limite do bucket `content`, na migration `0007`) |
| Nome do arquivo | o slug do catálogo — nada além disso entra no caminho |

## Quantos arquivos são necessários

**29 no total**, mas só **18 são necessários para o ambiente de produção**:
artigos (6) e lugares (12).

Ofertas (6) e especialistas (5) **não entram no seed de produção** — ofertas
porque preço e desconto são compromisso comercial que ninguém assumiu, e
especialistas porque são pessoas fictícias (decisão D-05). As fotos deles só
fazem falta na demonstração local; em produção esses cadastros nascem vazios e
são preenchidos pelo painel administrativo, com dados reais.

O `manifest.json` marca cada pendência com `necessarioEmProducao`.

## Como aplicar depois de conseguir os arquivos

Com o Supabase **local** rodando:

```bash
npx supabase start
node scripts/seed-content-assets.mjs
```

O script envia cada arquivo para `content/{entidade}/{id}/catalogo.{ext}`, aponta
a coluna do registro para a URL pública e regrava este manifesto. Ele recusa
qualquer host que não seja `127.0.0.1`/`localhost`, não baixa nada da internet e
falha listando o que ainda faltar.

## O que **não** fazer

- baixar as imagens do Unsplash automaticamente — só mudaria *quando* o produto
  depende do host de terceiro, não *se*;
- gerar imagens sintéticas de estabelecimentos que existem de verdade;
- repetir a mesma foto em vários registros para "completar" a lista;
- transformar a foto de um especialista fictício em conteúdo próprio: o
  problema ali é a pessoa inventada, não o endereço da imagem.

## Versionamento

Os arquivos de imagem **não** estão neste repositório hoje. Ao adicioná-los,
confirme o peso total antes do commit: 29 fotografias de 5 MB seriam 145 MB no
histórico do Git. Comprimir para ~300 KB por imagem (largura de 1200 px, que é o
que a interface usa) mantém a pasta abaixo de 10 MB.
