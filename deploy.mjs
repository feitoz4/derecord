/**
 * Publica o build na branch gh-pages.
 *
 *   npm run deploy
 *
 * Não usa GitHub Actions de propósito: criar arquivos em .github/workflows
 * exige o escopo `workflow` no token, e para um projeto de um grupo só isso
 * é burocracia sem retorno. Aqui o dist/ vira um repositório descartável e
 * é empurrado por cima da branch.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DIST = path.resolve('dist')
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: false })

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('Sem build. Rode "npm run build" antes.')
  process.exit(1)
}

const remote = execFileSync('git', ['remote', 'get-url', 'origin']).toString().trim()

// Sem isto o Pages ignora qualquer arquivo ou pasta começando com "_".
fs.writeFileSync(path.join(DIST, '.nojekyll'), '')

// Repositório descartável dentro do dist: o histórico da branch não importa,
// só o conteúdo atual.
fs.rmSync(path.join(DIST, '.git'), { recursive: true, force: true })
run('git', ['init', '-q', '-b', 'main'], DIST)
run('git', ['add', '-A'], DIST)
run('git', ['-c', 'user.name=deploy', '-c', 'user.email=deploy@local',
            'commit', '-q', '-m', 'publicar'], DIST)
run('git', ['push', '--force', '--quiet', remote, 'main:gh-pages'], DIST)
fs.rmSync(path.join(DIST, '.git'), { recursive: true, force: true })

console.log('\npublicado em gh-pages')
