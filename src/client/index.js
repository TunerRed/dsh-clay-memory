// DSH 黏土记忆 · 客户端入口：套宿主模块加载器的壳，正文在 正文.js
import { 装客户端 } from './正文.js'

window.__ModuleLoader__.load({
  id: 'dsh-clay-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const 客户端 = 装客户端(require)
    exports.apply = 客户端.apply
    exports.inject = 客户端.inject
    return module.exports
  },
})
