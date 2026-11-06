// Empacota fonte.ts com as regras de cobrança do portal num index.ts só, para publicar no Supabase.
// Uso: node supabase/functions/cobrancas-automaticas/empacotar.mjs  (precisa do esbuild instalado)
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(aqui, 'fonte.ts')],
  outfile: resolve(aqui, 'index.ts'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  banner: { js: '// Gerado por empacotar.mjs a partir de fonte.ts e site/src/lib. Não edite este arquivo.' },
  plugins: [
    {
      name: 'servidor',
      setup(b) {
        // O cliente do navegador vira o cliente com a chave de serviço.
        b.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: resolve(aqui, 'servidor-supabase.ts') }));
        // Pacotes npm ficam como importação do Deno.
        b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'npm:@supabase/supabase-js@2.117.2', external: true }));
        b.onResolve({ filter: /^npm:/ }, (a) => ({ path: a.path, external: true }));
      },
    },
  ],
  logLevel: 'warning',
});
console.log('index.ts gerado');
