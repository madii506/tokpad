// Reads a TikTok account live from tiktok.com's own page payload (the same JSON the app hydrates from).
// Returns exactly what TikTok publishes: avatar, nickname, followers, likes, video count, verified, private.
// If TikTok refuses the read (it sometimes blocks datacenter ranges), the response says so honestly.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const clean = (u) => String(u || '').replace(/&amp;/g, '&');

async function readTikTok(handle) {
  const r = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  });
  if (r.status === 404) return { missing: true };
  if (!r.ok) return { blocked: r.status };
  const html = await r.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return { blocked: 'no payload' };
  let j; try { j = JSON.parse(m[1]); } catch (e) { return { blocked: 'bad payload' }; }
  const scope = j.__DEFAULT_SCOPE__ || {};
  const ud = scope['webapp.user-detail'] || {};
  if (ud.statusCode === 10202 || ud.statusCode === 10221) return { missing: true };
  const u = ud.userInfo;
  if (!u || !u.user) return { blocked: 'no user' };
  const icon = clean(u.user.avatarLarger || u.user.avatarMedium || '');
  return {
    user: {
      handle: u.user.uniqueId, name: u.user.nickname, verified: !!u.user.verified, private: !!u.user.privateAccount,
      bio: u.user.signature || '', icon: icon ? '/api/img?u=' + encodeURIComponent(icon) : '',
      followers: u.stats.followerCount || 0, likes: u.stats.heartCount || 0, videos: u.stats.videoCount || 0,
    }, via: 'tiktok.com page payload',
  };
}

export default async function handler(req, res) {
  const raw = String((req.query && req.query.u) || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_.]{2,24}$/.test(raw)) {
    return res.status(200).json({ ok: false, error: 'That is not a TikTok handle. 2–24 letters, numbers, _ or . — with or without the @.' });
  }
  let r = null;
  try { r = await readTikTok(raw); } catch (e) { r = { blocked: 'fetch failed' }; }
  if (r.missing) return res.status(200).json({ ok: false, error: `@${raw} does not exist on TikTok.` });
  if (r.blocked) return res.status(200).json({ ok: false, blocked: true, error: 'TikTok is refusing reads from our server right now. Try again in a minute, or open their profile yourself and check the handle.' });
  if (r.user.private) return res.status(200).json({ ok: false, error: `@${r.user.handle} is a private account. Nothing can be promoted there.` });
  if (!r.user.videos) return res.status(200).json({ ok: false, error: `@${r.user.handle} has no videos yet. TokPad refuses to launch on an account with nothing to promote.` });
  return res.status(200).json({ ok: true, ...r.user, via: r.via, line: `promotes @${r.user.handle} via TokPad`, url: `https://www.tiktok.com/@${r.user.handle}` });
}
