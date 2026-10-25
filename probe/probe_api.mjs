// 探针：实测三平台各类候选接口是否还活着（2026-10）
// 只打印状态码 + 少量摘要，不落原始大响应
import crypto from 'node:crypto';

const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function hit(name, url, opts = {}, pick = null) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'User-Agent': opts.ua || UA_PC, Referer: opts.referer || '', ...(opts.headers || {}) },
      body: opts.body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    let summary;
    try {
      const j = JSON.parse(text);
      summary = pick ? pick(j) : JSON.stringify(j).slice(0, 220);
    } catch { summary = text.slice(0, 160).replace(/\s+/g, ' '); }
    console.log(`[${r.status}] ${name} (${Date.now() - t0}ms) :: ${summary}`);
    return { status: r.status, text };
  } catch (e) {
    console.log(`[ERR] ${name} :: ${e.message}`);
    return { status: 0, text: '' };
  }
}

// ---------------- NetEase weapi ----------------
const NE_MOD = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const NE_NONCE = '0CoJUm6Qyw8W8jud';
const NE_PUBKEY = '010001';

function aesEncrypt(text, key) {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
  return Buffer.concat([c.update(Buffer.from(text)), c.final()]).toString('base64');
}
function rsaNoPad(text, pubKey, modulus) {
  const base = BigInt('0x' + Buffer.from(text).toString('hex'));
  const exp = BigInt('0x' + pubKey);
  const mod = BigInt('0x' + modulus);
  let r = 1n, b = base % mod, e = exp;
  while (e > 0n) { if (e & 1n) r = (r * b) % mod; b = (b * b) % mod; e >>= 1n; }
  return r.toString(16).padStart(256, '0');
}
function neWeapi(obj) {
  const text = JSON.stringify(obj);
  const secret = crypto.randomBytes(8).toString('hex').slice(0, 16);
  const params = aesEncrypt(aesEncrypt(text, NE_NONCE), secret);
  const encSecKey = rsaNoPad(secret.split('').reverse().join(''), NE_PUBKEY, NE_MOD);
  return new URLSearchParams({ params, encSecKey }).toString();
}

// ---------------- QQ ----------------
function qqGuid() { return String(Math.floor(Math.random() * 1e10)).padStart(10, '0'); }

(async () => {
  console.log('===== NetEase =====');
  const neCookie = 'os=pc; appver=8.9.70; NMTID=00O' + crypto.randomBytes(8).toString('hex');
  const neBody = neWeapi({ s: '周杰伦', type: 1, limit: 2, offset: 0, total: true, csrf_token: '' });
  const neSearch = await hit('weapi/cloudsearch/get/web', 'https://music.163.com/weapi/cloudsearch/get/web?csrf_token=', {
    method: 'POST', ua: UA_PC, referer: 'https://music.163.com',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: neCookie }, body: neBody,
  }, j => `code=${j.code} songs=${j.result?.songs?.length} first=${j.result?.songs?.[0]?.name}(${j.result?.songs?.[0]?.id})`);

  if (neSearch.text.includes('"songs"')) {
    const j = JSON.parse(neSearch.text);
    const song = j.result.songs[0];
    const neUrlBody = neWeapi({ ids: `[${song.id}]`, br: 128000, csrf_token: '' });
    await hit('weapi/song/enhance/player/url', 'https://music.163.com/weapi/song/enhance/player/url?csrf_token=', {
      method: 'POST', ua: UA_PC, referer: 'https://music.163.com',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: neCookie }, body: neUrlBody,
    }, j2 => `code=${j2.code} url=${String(j2.data?.[0]?.url).slice(0, 80)} fee=${j2.data?.[0]?.fee} br=${j2.data?.[0]?.br}`);
  }

  console.log('===== QQ Music =====');
  await hit('client_search_cp(no new_json)', 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=2&w=' + encodeURIComponent('周杰伦') + '&format=json', { referer: 'https://y.qq.com/' },
    j => `code=${j.code} list=${j.data?.song?.list?.length} first=${j.data?.song?.list?.[0]?.songname}(${j.data?.song?.list?.[0]?.songmid})`);
  await hit('musicu DoSearchForQQMusicDesktop', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST', referer: 'https://y.qq.com/',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comm: { ct: '19', cv: '1859', uin: '0' }, req: { method: 'DoSearchForQQMusicDesktop', module: 'music.search.SearchCgiService', param: { num_per_page: 2, page_num: 1, query: '周杰伦', search_type: 0 } } }),
  }, j => `code=${j.code} data.code=${j.req?.data?.code} list=${j.req?.data?.body?.song?.list?.length} first=${j.req?.data?.body?.song?.list?.[0]?.name}(${j.req?.data?.body?.song?.list?.[0]?.mid})`);
  await hit('smartbox_new', 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=' + encodeURIComponent('周杰伦') + '&format=json', { referer: 'https://y.qq.com/' },
    j => `code=${j.code} songs=${j.data?.song?.itemlist?.length} first=${j.data?.song?.itemlist?.[0]?.name}(${j.data?.song?.itemlist?.[0]?.mid})`);

  console.log('===== Kugou =====');
  await hit('mobilecdn v3 search', 'https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=' + encodeURIComponent('周杰伦') + '&page=1&pagesize=2&showtype=1', { ua: UA_MOBILE },
    j => `code=${j.errcode} total=${j.data?.total} first=${j.data?.info?.[0]?.songname}(${j.data?.info?.[0]?.hash})`);
  await hit('songsearch v2', 'https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent('周杰伦') + '&page=1&pagesize=2&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0', { ua: UA_PC, referer: 'https://www.kugou.com/' },
    j => `code=${j.error_code ?? j.errcode} total=${j.data?.total} first=${j.data?.lists?.[0]?.SongName}(${j.data?.lists?.[0]?.FileHash})`);
  await hit('searchcomplex', 'https://complexsearch.kugou.com/v2/search/song?keyword=' + encodeURIComponent('周杰伦') + '&page=1&pagesize=2&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0&signature=' + crypto.createHash('md5').update('NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt' + '1' + '2' + 'WebFilter' + 'em2' + '周杰伦').digest('hex'), { ua: UA_PC, referer: 'https://www.kugou.com/' },
    j => `code=${j.error_code ?? j.errcode} total=${j.data?.total} first=${j.data?.lists?.[0]?.SongName}(${j.data?.lists?.[0]?.FileHash})`);
})();
