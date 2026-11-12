/**
 * G01-017: every post-authentication destination stays inside the finite
 * contractor route allowlist. Reject encoded separators, nested decoding,
 * recursive login, traversal, control characters and external origins.
 * This module is shared by the real login page and negative browser tests.
 */
function containsUnsafeNavigationCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const code=character.charCodeAt(0);
    return code === 92 || code < 32 || code === 127;
  });
}

export function safeReturnPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') ||
      containsUnsafeNavigationCharacters(next) ||
      /%(?:2f|5c|00|0a|0d|09|25)/i.test(next)) {
    return '/dashboard';
  }
  try {
    let decoded=next;
    for(let i=0;i<3;i++){
      const previous=decoded;
      decoded=decodeURIComponent(decoded);
      if(decoded===previous)break;
    }
    if(!decoded.startsWith('/')||decoded.startsWith('//')||
      containsUnsafeNavigationCharacters(decoded)||
      decoded.split('/').includes('..')) return '/dashboard';
    const url=new URL(next,'https://auth-navigation.local');
    const routes=['dashboard','projects','parties','billing','audit'];
    if(url.origin!=='https://auth-navigation.local'||
       !routes.includes(url.pathname.split('/')[1])) return '/dashboard';
    return url.pathname+url.search;
  }catch {
    return '/dashboard';
  }
}
