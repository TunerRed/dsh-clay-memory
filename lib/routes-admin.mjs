// 管理路由总装配：按领域拆到 routes-admin-*.mjs，保持对外导出注册管理路由(mroute, 环)不变
import { 注册语义与整理路由 } from './routes-admin-embed.mjs'
import { 注册记忆维护路由 } from './routes-admin-crud.mjs'
import { 注册工作区与去重路由 } from './routes-admin-workspace.mjs'
import { 注册检视路由 } from './routes-admin-inspect.mjs'
import { 注册导入路由 } from './routes-admin-import.mjs'

export function 注册管理路由(mroute, 环) {
  注册语义与整理路由(mroute, 环)
  注册记忆维护路由(mroute, 环)
  注册工作区与去重路由(mroute, 环)
  注册检视路由(mroute, 环)
  注册导入路由(mroute, 环)
}
