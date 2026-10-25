// 探针3：判定「匿名可听比例」——免费曲目是否匿名能拿到 URL
import crypto from 'node:crypto';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getJson(url, opts = {}) {
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'User-Agent': UA, Referer: opts.referer || '', ...(opts.headers || {}) },
    body: opts.body, signal: AbortSignal.timeout(15000),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 200) }; }
}

(async () => {
  // ---------- QQ ----------
  console.log('===== QQ 匿名 getVkey 命中率 =====');
  const q = await getJson('https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=12&w=' + encodeURIComponent('小星星') + '&format=json', { referer: 'https://y.qq.com/' });
  const songs = (q.data?.song?.list || []).map(s => ({ mid: s.songmid, name: s.songname, pay: s.pay?.pay_play, fee: s.fee }));
  console.log(`  搜索到 ${songs.length} 首；pay_play=0 的：${songs.filter(s => !s.pay).length}`);
  for (const group of [{ label: '全部前5首', list: songs.slice(0, 5) }, { label: '免费曲目', list: songs.filter(s => !s.pay).slice(0, 5) }]) {
    let ok = 0;
    for (const s of group.list) {
      const body = JSON.stringify({
        req: { module: 'music.vkey.GetVkey', method: 'UrlGetVkey', param: { guid: '1234567890', songmid: [s.mid], songtype: [0], uin: '0', loginflag: 1, platform: '20' } },
        comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
      });
      const j = await getJson('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', referer: 'https://y.qq.com/', headers: { 'Content-Type': 'application/json' }, body });
      const info = j.req?.data?.midurlinfo?.[0];
      const purl = info?.purl || '';
      if (purl) ok++;
      console.log(`    [${group.label}] ${s.name} pay=${s.pay} fee=${s.fee} -> purl=${purl ? 'YES' : 'empty'} sip=${j.req?.data?.sip?.length || 0}`);
    }
    console.log(`  => ${group.label} 命中 ${ok}/${group.list.length}`);
  }

  // ---------- NetEase ----------
  console.log('===== 网易云 匿名播放地址命中率 =====');
  const ne = await getJson('https://music.163.com/api/cloudsearch/pc?s=' + encodeURIComponent('小星星') + '&type=1&limit=20', { referer: 'https://music.163.com/' });
  const neSongs = (ne.result?.songs || []).map(s => ({ id: s.id, name: s.name, fee: s.fee, pl: s.privilege?.pl, dl: s.privilege?.dl, st: s.privilege?.st, cp: s.privilege?.cp }));
  console.log(`  搜索到 ${neSongs.length} 首；privilege.pl>0 的 ${neSongs.filter(s => s.pl > 0).length} 首`);
  const free = neSongs.filter(s => s.pl > 0 && s.fee === 0).slice(0, 5);
  let ok = 0;
  for (const s of free) {
    const j = await getJson(`https://music.163.com/api/song/enhance/player/url?ids=[${s.id}]&br=128000`, { referer: 'https://music.163.com/', headers: { Cookie: 'os=pc; appver=8.9.70; NMTID=00O' + crypto.randomBytes(8).toString('hex') } });
    const d = j.data?.[0];
    if (d?.url) ok++;
    console.log(`    ${s.name} fee=${s.fee} pl=${s.pl} -> ${d?.url ? 'URL' : 'null'} br=${d?.br} code=${d?.code}`);
  }
  console.log(`  => 网易云免费曲目命中 ${ok}/${free.length}`);

  // ---------- Kugou ----------
  console.log('===== 酷狗 匿名播放地址可用性 =====');
  const kg = await getJson('https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent('小星星') + '&page=1&pagesize=5&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0', { referer: 'https://www.kugou.com/' });
  const list = (kg.data?.lists || []);
  let kOk = 0;
  for (const s of list.slice(0, 3)) {
    const hash = s.FileHash;
    const key = crypto.createHash('md5').update(hash + 'kgcloudv2').digest('hex');
    const j = await getJson(`https://trackercdn.kugou.com/i/v2/?key=${key}&hash=${hash}&br=hq&appid=1005&pid=2&cmd=25&behavior=play`, { referer: 'https://www.kugou.com/' });
    const url = j.url?.[0];
    let head = '-';
    if (url) {
      kOk++;
      try {
        const h = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        head = `${h.status} ${h.headers.get('content-type')} ${h.headers.get('content-length')}`;
      } catch (e) { head = 'HEAD失败:' + e.message; }
    }
    console.log(`    ${s.SongName.slice(0, 18)} -> ${url ? 'URL' : 'none'} head=${head}`);
  }
  console.log(`  => 酷狗命中 ${kOk}/${Math.min(3, list.length)}`);
})();
