export function browserThatDoesNotFollowRedirects(runtime) {
  const jar = new Map();
  return {
    jar,
    async visit(url, init = {}) {
      const headers = new Headers(init.headers);
      if (jar.size) {
        headers.set("Cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      }
      const response = await runtime.dispatchFetch(url, { ...init, headers, redirect: "manual" });
      for (const raw of response.headers.getSetCookie()) {
        const [pair, ...attributes] = raw.split(";");
        const name = pair.slice(0, pair.indexOf("=")).trim();
        const value = pair.slice(pair.indexOf("=") + 1);
        if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
        else jar.set(name, value);
      }
      return response;
    },
  };
}
