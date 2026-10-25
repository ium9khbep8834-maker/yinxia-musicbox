// 探针4：酷狗播放地址为何对某类曲目失败 + 网易云 URL 是否真的可播
import crypto from 'node:crypto';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function req(url, opts = {}) {
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'User-Agent': opts.ua || UA, Referer: opts.referer || '', ...(opts.headers || {}) },
    body: opts.body, redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  return r;
}
async function j(url, opts) { const r = await req(url, opts); const t = await r.text(); try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 300) }; } }

(async () => {
  console.log('===== 酷狗 songsearch v2 返回字段诊断 =====');
  for (const kw of ['小星星', '周杰伦', '起风了']) {
    const g = await j('https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent(kw) + '&page=1&pagesize=3&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0', { referer: 'https://www.kugou.com/' });
    console.log(`  [${kw}] err=${g.error_code ?? g.errcode} total=${g.data?.total} lists=${g.data?.lists?.length}`);
    for (const s of (g.data?.lists || []).slice(0, 3)) {
      const hash = s.FileHash || '';
      console.log(`    name=${String(s.SongName).replace(/<[^>]+>/g, '')} hash=${hash || '(空)'} album=${s.AlbumID} audio_id=${s.Audioid} privilege=${s.Privilege} pay=${s.PayType}`);
      if (!hash) continue;
      const key = crypto.createHash('md5').update(hash + 'kgcloudv2').digest('hex');
      const r1 = await j(`https://trackercdn.kugou.com/i/v2/?key=${key}&hash=${hash}&br=hq&appid=1005&pid=2&cmd=25&behavior=play`, { referer: 'https://www.kugou.com/' });
      console.log(`      trackercdn: err=${r1.error_code} errno=${r1.errno} urls=${(r1.url || []).length} msg=${r1.msg || ''}`);
      const r2 = await j(`https://m3ws.kugou.com/api/v1/song/get_song_info?cmd=playInfo&hash=${hash}`, { ua: UA, referer: 'https://m.kugou.com/' });
      console.log(`      m3ws: err=${r2.error_code} url=${r2.url ? 'YES len=' + r2.url.length : 'no'} backup=${(r2.backup_url || []).length}`);
    }
  }

  console.log('===== 酷狗 gateway 签名方式（MOMusic 同款）=====');
  // gateway.kugou.com/v2/get_res_privilege/lite?appid=1005&clientver=20489&clienttime=..&mid=..&uuid=..&dfid=..&platid=4&hash=..&signature=md5(salt+appid+clientver+...)
  const hash = 'B9B3A55FFB5B95F165839A26120E9FEC';
  const mid = crypto.randomBytes(16).toString('hex');
  const clienttime = Date.now();
  const param = `appid=1005clientver20489`;
  console.log('  (先跳过，下一步读 MOMusic kugou-api.js 的签名细节)');

  console.log('===== 网易云 URL 真可播？ =====');
  const ne = await j('https://music.163.com/api/cloudsearch/pc?s=' + encodeURIComponent('小星星') + '&type=1&limit=20', { referer: 'https://music.163.com/' });
  const s0 = (ne.result?.songs || []).find(x => x.feel === 0 || x.fee === 0);
  const id = s0?.id;
  const u = await j(`https://music.163.com/api/song/enhance/player/url?ids=[${id}]&br=128000`, { referer: 'https://music.163.com/', headers: { Cookie: 'os=pc; appver=8.9.70' } });
  const url = u.data?.[0]?.url;
  console.log(`  song=${s0?.name} url=${String(url).slice(0, 90)}`);
  if (url) {
    const h1 = await req(url, { method: 'HEAD', ua: UA });
    console.log(`  HEAD(no referer): ${h1.status} ${h1.headers.get('content-type')} len=${h1.headers.get('content-length')}`);
    const h2 = await req(url, { method: 'HEAD', ua: 'okhttp/3.12.13', referer: 'https://music.163.com/' });
    console.log(`  HEAD(okhttp+referer): ${h2.status} ${h2.headers.get('content-type')} len=${h2.headers.get('content-length')}`);
  }
})();
