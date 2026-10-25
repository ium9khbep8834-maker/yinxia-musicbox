// merge.js 单元验证：同名同作者合并 + 音源优先级 QQ > 酷狗 > 网易云
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'web/js/core/merge.js'), 'utf8');
const sandbox = { window: {} };
new Function('window', src)(sandbox.window);
const { mergeResults, normalize } = sandbox.window.Merge;

function s(platform, id, name, artists, album) {
  return { platform, id, name, artists: artists || [], album: album || '', durationMs: 200000, coverUrl: platform + '.jpg' };
}

const cases = [];
function check(label, cond, detail) {
  cases.push({ label, ok: !!cond, detail });
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  :: ' + detail : ''));
}

// 1. 三平台同名同作者 → 合并一条，且 sources 顺序 qq > kugou > netease
const g1 = [
  { platform: 'netease', songs: [s('netease', 'n1', '晴天', ['周杰伦'], '叶惠美')] },
  { platform: 'qq', songs: [s('qq', 'q1', '晴天', ['周杰伦'], '叶惠美')] },
  { platform: 'kugou', songs: [s('kugou', 'k1', '晴天', ['周杰伦'], '叶惠美')] },
];
const r1 = mergeResults(g1);
check('同名同作者合并为 1 条', r1.length === 1, '实际 ' + r1.length);
check('音源顺序 QQ>酷狗>网易', r1[0] && r1[0].sources.map(x => x.platform).join('>') === 'qq>kugou>netease',
  r1[0] ? r1[0].sources.map(x => x.platform).join('>') : '-');
check('primary 是 QQ', r1[0] && r1[0].primary.platform === 'qq');

// 2. 同名不同作者 → 不合并
const g2 = [
  { platform: 'qq', songs: [s('qq', 'q1', '小星星', ['王心凌'])] },
  { platform: 'netease', songs: [s('netease', 'n1', '小星星', ['汪苏泷'])] },
];
const r2 = mergeResults(g2);
check('同名不同作者不合并', r2.length === 2, '实际 ' + r2.length);

// 3. 缺少某平台时仍合并到剩下的（只有酷狗+网易）
const g3 = [
  { platform: 'kugou', songs: [s('kugou', 'k1', '起风了', ['买辣椒也用券'])] },
  { platform: 'netease', songs: [s('netease', 'n1', '起风了', ['买辣椒也用券'])] },
];
const r3 = mergeResults(g3);
check('酷狗+网易合并，primary=酷狗', r3.length === 1 && r3[0].primary.platform === 'kugou');

// 4. 全角/空格/大小写归一
const g4 = [
  { platform: 'qq', songs: [s('qq', 'q1', 'Hello  World', ['Adele'])] },
  { platform: 'kugou', songs: [s('kugou', 'k1', 'ｈｅｌｌｏ　ｗｏｒｌｄ', ['ａｄｅｌｅ'])] },
];
const r4 = mergeResults(g4);
check('全角/空格/大小写归一后合并', r4.length === 1, '实际 ' + r4.length);

// 5. 同平台重复 id 去重
const g5 = [{ platform: 'qq', songs: [s('qq', 'q1', 'A', ['X']), s('qq', 'q1', 'A', ['X'])] }];
check('同平台同 id 去重', mergeResults(g5).length === 1);

// 6. 多作者其中一人相同也算同作者
const g6 = [
  { platform: 'qq', songs: [s('qq', 'q1', '因为爱情', ['陈奕迅', '王菲'])] },
  { platform: 'netease', songs: [s('netease', 'n1', '因为爱情', ['陈奕迅'])] },
];
check('部分作者重叠 -> 合并', mergeResults(g6).length === 1);

// 7. 空输入
check('空输入不崩', mergeResults([{ platform: 'qq', songs: [] }, null]).length === 0);

const failed = cases.filter(c => !c.ok);
console.log('\n' + (failed.length ? 'FAILED ' + failed.length + '/' + cases.length : 'ALL PASS (' + cases.length + ')'));
process.exit(failed.length ? 1 : 0);
