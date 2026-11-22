// 前端构建：src/client/index.js → lib/client.js（单文件，供宿主 __ModuleLoader__ 装载）
// 为什么还要打成单文件：宿主只按 package.json 的 ./client 取一个文件，多文件得靠它自己的
// chunk 机制（那是 rolldown 的私有行为，不想绑死）。源码拆开是为了好读好改，产物依旧一个文件。
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client/index.js'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: '// DSH 黏土记忆（原「鱼的记忆」）· 客户端半边 —— 由 src/client/ 构建生成，别直接改这个文件',
  },
})
console.log('lib/client.js 已生成')
