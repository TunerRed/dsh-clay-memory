#!/usr/bin/env node
/**
 * embed-probe.mjs —— 本地中文 embedding 模型探测脚本
 *
 * 用途：用 @huggingface/transformers（Node 后端 onnxruntime-node）加载
 *       models/bge-small-zh 下的 ONNX 模型，对中文句子做 encode，
 *       打印维度 / 单句推理耗时中位数 / 余弦相似度区分度。
 *
 * 用法：
 *   node tools/bench/embed-probe.mjs
 *   EMBED_DTYPE=q8 node tools/bench/embed-probe.mjs   # 用 int8 量化模型
 *
 * 只读模型与依赖，不改 lib/ 业务代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MODEL_DIR = path.join(ROOT, 'models', 'bge-small-zh');

const SENTENCES = [
  '我生日是五月十二日',
  '我全名咋写',
  'nginx 限流配置在哪',
];

function fileInfo(p) {
  if (!fs.existsSync(p)) return `${p}  [缺失]`;
  const st = fs.statSync(p);
  return `${path.relative(ROOT, p)}  ${(st.size / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  if (!fs.existsSync(path.join(MODEL_DIR, 'onnx'))) {
    console.error(`[probe] 模型目录不存在: ${MODEL_DIR}`);
    process.exit(1);
  }

  console.log('=== 模型文件 ===');
  for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt', 'onnx/model.onnx', 'onnx/model_quantized.onnx']) {
    console.log('  ' + fileInfo(path.join(MODEL_DIR, f)));
  }

  const { env, pipeline } = await import('@huggingface/transformers');
  const readVer = (pkg) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version; }
    catch { return '?'; }
  };
  const ortVersion = readVer('onnxruntime-node');
  const hfVersion = readVer('@huggingface/transformers');
  console.log(`\n=== 依赖 ===\n  @huggingface/transformers ${hfVersion} / onnxruntime-node ${ortVersion}`);

  // 只读本地模型，不联网
  env.allowRemoteModels = false;
  env.localModelPath = path.join(ROOT, 'models');
  env.loggingLevel = 'error';

  const dtype = process.env.EMBED_DTYPE || 'fp32';
  const tLoad = performance.now();
  const extractor = await pipeline('feature-extraction', 'bge-small-zh', { dtype });
  const loadMs = performance.now() - tLoad;
  console.log(`\n=== 加载 ===\n  模型 bge-small-zh (${dtype}) 加载耗时 ${loadMs.toFixed(0)} ms`);

  // encode：BGE 用 CLS pooling + L2 normalize
  const embed = async (text) => {
    const out = await extractor(text, { pooling: 'cls', normalize: true });
    return Float32Array.from(out.data);
  };

  const dims = [];
  const vecs = [];
  for (const s of SENTENCES) {
    const v = await embed(s);
    vecs.push(v);
    dims.push(v.length);
    console.log(`  编码「${s}」 -> 维度 ${v.length}`);
  }

  // 单句推理耗时：5 次取中位数（句中即第一句）
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await embed(SENTENCES[0]);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`\n=== 性能 ===\n  单句推理 5 次: [${times.map((t) => t.toFixed(1)).join(', ')}] ms，中位数 ${median.toFixed(1)} ms`);

  const cos = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };

  const simRelated = cos(vecs[0], vecs[1]);
  const simUnrelated = cos(vecs[0], vecs[2]);
  const simAlso = cos(vecs[1], vecs[2]);
  console.log(`\n=== 相似度 ===`);
  console.log(`  「${SENTENCES[0]}」 vs 「${SENTENCES[1]}」       = ${simRelated.toFixed(4)}  (相关: 生日/姓名)`.replace('生日/姓名', '个人资料类'));
  console.log(`  「${SENTENCES[0]}」 vs 「${SENTENCES[2]}」     = ${simUnrelated.toFixed(4)}  (不相关: 生日/运维配置)`);
  console.log(`  「${SENTENCES[1]}」 vs 「${SENTENCES[2]}」     = ${simAlso.toFixed(4)}  (不相关: 姓名/运维配置)`);
  console.log(`  区分度 (相关 - 不相关) = ${(simRelated - Math.max(simUnrelated, simAlso)).toFixed(4)}`);

  const ok = dims.every((d) => d === dims[0] && d > 0) && simRelated > simUnrelated;
  console.log(`\n[probe] ${ok ? 'PASS' : 'FAIL'} —— 维度 ${dims[0]}，中位耗时 ${median.toFixed(1)} ms，相关度高于不相关`);
}

main().catch((e) => {
  console.error('[probe] 失败:', e && e.stack || e);
  process.exit(1);
});
