(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WineAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MEMBERS = Object.freeze({
    'gkdbs1249@naver.com': '하윤',
    'wprnjs1213@naver.com': '제권',
  });

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function personForEmail(email) {
    return MEMBERS[normalizeEmail(email)] || null;
  }

  function personForSession(session) {
    return personForEmail(session?.user?.email);
  }

  async function sendMagicLink(client, email, redirectTo) {
    const normalized = normalizeEmail(email);
    if (!personForEmail(normalized)) throw new Error('허용된 사용자 이메일이 아닙니다.');
    const { error } = await client.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) throw error;
    return true;
  }

  return { MEMBERS, normalizeEmail, personForEmail, personForSession, sendMagicLink };
});
