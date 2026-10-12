// Is `url` Weft's own server, given the URL its app view shows (`own`)? localhost and 127.0.0.1 count as
// one host. Only http(s) can be Weft: file:// pages (splash, error page, a thread's ~/.weft/show page)
// have no host or port, so comparing them would make every file:// URL look like Weft.
function isSelfUrl(url, own) {
  try {
    if (!own) return false;
    const a = new URL(url);
    const b = new URL(own);
    const web = (u) => u.protocol === "http:" || u.protocol === "https:";
    if (!web(a) || !web(b)) return false;
    const key = (u) => `${u.protocol}//${u.hostname === "localhost" ? "127.0.0.1" : u.hostname}:${u.port}`;
    return key(a) === key(b);
  } catch {
    return false;
  }
}

module.exports = { isSelfUrl };
