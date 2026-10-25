// 探针2：重点验证「能不能拿到可播放地址」
import crypto from 'node:crypto';

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_AND = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

async function hit(name, url, opts = {}, pick = null) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'User-Agent': opts.ua || UA_PC, Referer: opts.referer || '', ...(opts.headers || {}) },
      body: opts.body, signal: AbortSignal.timeout(15000), redirect: 'follow',
    });
    const text = await r.text();
    let summary;
    try { const j = JSON.parse(text); summary = pick ? pick(j) : JSON.stringify(j).slice(0, 220); }
    catch { summary = text.slice(0, 160).replace(/\s+/g, ' '); }
    console.log(`[${r.status}] ${name} (${Date.now() - t0}ms) :: ${summary}`);
    return { status: r.status, text, headers: r.headers };
  } catch (e) { console.log(`[ERR] ${name} :: ${e.message}`); return { status: 0, text: '' }; }
}

const NE_MOD = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const NE_NONCE = '0CoJUm6Qyw8W8jud';
const B62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function aesEncrypt(text, key) {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
  return Buffer.concat([c.update(Buffer.from(text)), c.final()]).toString('base64');
}
function rsaNoPad(text) {
  const base = BigInt('0x' + Buffer.from(text).toString('hex'));
  const mod = BigInt('0x' + NE_MOD);
  let r = 1n, b = base % mod, e = 65537n;
  while (e > 0n) { if (e & 1n) r = (r * b) % mod; b = (b * b) % mod; e >>= 1n; }
  return r.toString(16).padStart(256, '0');
}
function neWeapi(obj, secret) {
  const text = JSON.stringify(obj);
  const sk = secret || Array.from({ length: 16 }, () => B62[Math.floor(Math.random() * 62)]).join('');
  return new URLSearchParams({
    params: aesEncrypt(aesEncrypt(text, NE_NONCE), sk),
    encSecKey: rsaNoPad(sk.split('').reverse().join('')),
  }).toString();
}

const KNOWN_NE_ID = 186016; // 晴天

(async () => {
  console.log('===== NetEase: 无加密 /api 直连 =====');
  const cookie = 'os=pc; appver=8.9.70; osver=; deviceId=x; channel=netease; NMTID=00O' + crypto.randomBytes(8).toString('hex');
  await hit('api/search/get', 'https://music.163.com/api/search/get?s=' + encodeURIComponent('周杰伦') + '&type=1&limit=2', { referer: 'https://music.163.com/', headers: { Cookie: cookie } },
    j => `code=${j.code} songs=${j.result?.songs?.length} first=${j.result?.songs?.[0]?.name}(${j.result?.songs?.[0]?.id})`);
  await hit('api/cloudsearch/pc', 'https://music.163.com/api/cloudsearch/pc?s=' + encodeURIComponent('周杰伦') + '&type=1&limit=2', { referer: 'https://music.163.com/', headers: { Cookie: cookie } },
    j => `code=${j.code} songs=${j.result?.songs?.length} first=${j.result?.songs?.[0]?.name}(${j.result?.songs?.[0]?.id})`);
  await hit('api/search/get (android UA)', 'https://music.163.com/api/search/get?s=' + encodeURIComponent('周杰伦') + '&type=1&limit=2', { ua: UA_AND, referer: 'https://music.163.com/', headers: { Cookie: cookie } },
    j => `code=${j.code} songs=${j.result?.songs?.length}`);

  console.log('===== NetEase: 播放地址 =====');
  await hit('api/song/enhance/player/url GET', `https://music.163.com/api/song/enhance/player/url?ids=[${KNOWN_NE_ID}]&br=128000`, { referer: 'https://music.163.com/', headers: { Cookie: cookie } },
    j => `code=${j.code} url=${String(j.data?.[0]?.url).slice(0, 70)} fee=${j.data?.[0]?.fee} br=${j.data?.[0]?.br}`);
  await hit('weapi/song/enhance/player/url POST', 'https://music.163.com/weapi/song/enhance/player/url?csrf_token=', {
    method: 'POST', referer: 'https://music.163.com/', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: neWeapi({ ids: `[${KNOWN_NE_ID}]`, br: 128000, csrf_token: '' }),
  }, j => `code=${j.code} url=${String(j.data?.[0]?.url).slice(0, 70)}`);
  await hit('weapi/song/enhance/player/url/v1', 'https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=', {
    method: 'POST', referer: 'https://music.163.com/', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: neWeapi({ ids: `[${KNOWN_NE_ID}]`, level: 'standard', encodeType: 'aac', csrf_token: '' }),
  }, j => `code=${j.code} url=${String(j.data?.[0]?.url).slice(0, 70)}`);

  console.log('===== QQ: getVkey 取播放地址 =====');
  const qqMid = '0039MnYb0qxYhV';
  const body = JSON.stringify({
    req: {
      module: 'music.vkey.GetVkey', method: 'UrlGetVkey',
      param: { guid: '1234567890', songmid: [qqMid], songtype: [0], uin: '0', loginflag: 1, platform: '20' },
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  });
  const r = await hit('musicu GetVkey(UrlGetVkey)', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST', referer: 'https://y.qq.com/', headers: { 'Content-Type': 'application/json' }, body,
  }, j => {
    const d = j.req?.data;
    return `code=${j.code} d.code=${d?.code} midurlinfo=${JSON.stringify(d?.midurlinfo)?.slice(0, 200)} sip=${JSON.stringify(d?.sip)?.slice(0, 80)}`;
  });
  // 尝试拼接 url
  try {
    const j = JSON.parse(r.text);
    const info = j.req?.data?.midurlinfo?.[0];
    const sip = j.req?.data?.sip?.[0] || 'https://ws.stream.qqmusic.qq.com/';
    if (info?.purl) {
      const full = sip.replace(/\/$/, '') + info.purl;
      console.log('  -> QQ 拼出 URL:', full.slice(0, 120));
      const head = await fetch(full, { method: 'HEAD', headers: { 'User-Agent': UA_PC }, signal: AbortSignal.timeout(15000) });
      console.log('  -> HEAD', head.status, head.headers.get('content-type'), head.headers.get('content-length'));
    } else console.log('  -> purl 为空（该曲目需要 VIP/登录）');
  } catch (e) { console.log('  解析失败', e.message); }

  console.log('===== Kugou: 取播放地址 =====');
  const khash = 'B9B3A55FFB5B95F165839A26120E9FEC';
  const key = crypto.createHash('md5').update(khash + 'kgcloudv2').digest('hex');
  await hit('trackercdn i/v2', `https://trackercdn.kugou.com/i/v2/?key=${key}&hash=${khash}&br=hq&appid=1005&pid=2&cmd=25&behavior=play`, { ua: UA_PC, referer: 'https://www.kugou.com/' },
    j => `code=${j.error_code ?? j.errcode} urls=${(j.url || []).length} first=${String(j.url?.[0]).slice(0, 90)}`);
  const mid = crypto.randomBytes(16).toString('hex');
  await hit('wwwapi play/getdata', `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${khash}&album_id=&mid=${mid}&platid=4&_=${Date.now()}`, {
    ua: UA_PC, referer: 'https://www.kugou.com/',
    headers: { Cookie: `kg_mid=${mid}; kg_dfid=1&0&xx; kg_mid_temp=${mid}` },
  }, j => `code=${j.err_code ?? j.status} url=${String(j.data?.play_url).slice(0, 90)}`);
  await hit('m3ws get_song_info', `https://m3ws.kugou.com/api/v1/song/get_song_info?cmd=playInfo&hash=${khash}`, { ua: UA_AND, referer: 'https://m.kugou.com/' },
    j => `code=${j.error_code ?? j.errcode} url=${String(j.url || j.data?.url).slice(0, 90)}`);
})();
