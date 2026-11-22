// 构建产物一致性：改了 src/client/ 却忘了 npm run build:client，这里要挡住
// 注意：esbuild 是 devDependency。发布出去的插件包里没有 node_modules，
//   在装机副本里跑测试会 import 失败 —— 那种情况跳过，不算失败（2026-11-11 踩到）
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const 有构建器 = existsSync(new URL('../node_modules/esbuild/', import.meta.url))

test('lib/client.js 与 src/client 的构建结果一致', { skip: 有构建器 ? false : '没装 esbuild（devDependency），跳过' }, () => {
  const 出 = execFileSync(process.execPath, ['tools/check-client-build.mjs'], { encoding: 'utf8' })
  assert.match(出, /一致/)
})
