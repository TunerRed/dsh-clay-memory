// 校验 lib/client.js 与 src/client 的构建结果一致（防止改完源码忘了 npm run build:client）
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const 现在 = readFileSync('lib/client.js', 'utf8')

const 结果 = await build({
  entryPoints: ['src/client/index.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  charset: 'utf8',
  legalComments: 'none',
  write: false,
  logLevel: 'silent',
  banner: {
    js: '// DSH 黏土记忆（原「鱼的记忆」）· 客户端半边 —— 由 src/client/ 构建生成，别直接改这个文件',
  },
})

const 应得 = 结果.outputFiles[0].text
if (应得 !== 现在) {
  const 差 = 应得.length - 现在.length
  console.error('✗ lib/client.js 和 src/client 对不上（构建 ' + 应得.length + ' 字节 / 仓库里 ' + 现在.length + ' 字节，差 ' + 差 + '）')
  console.error('  改了 src/client/ 就跑一下：npm run build:client')
  process.exit(1)
}
console.log('✓ lib/client.js 与 src/client 一致（' + 现在.length + ' 字节）')
