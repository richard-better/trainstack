/** The few Strava API calls Ride makes. They return Strava's response for the caller to read. */

const OAUTH = "https://www.strava.com/oauth";
const API = "https://www.strava.com/api/v3";

export type StravaCredentials = { id: string; secret: string };

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

export function authorizeUrl(credentials: StravaCredentials, redirectUri: string, state: string) {
  const url = new URL(`${OAUTH}/authorize`);
  url.search = new URLSearchParams({
    client_id: credentials.id,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    // Uploading a ride is all Ride does with Strava.
    scope: "activity:write",
    state,
  }).toString();
  return url.toString();
}

const requestTokens = (
  fetcher: typeof fetch,
  credentials: StravaCredentials,
  body: Record<string, string>,
) =>
  fetcher(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.id,
      client_secret: credentials.secret,
      ...body,
    }),
  });

export const exchangeCode = (fetcher: typeof fetch, credentials: StravaCredentials, code: string) =>
  requestTokens(fetcher, credentials, { code, grant_type: "authorization_code" });

export const refreshTokens = (
  fetcher: typeof fetch,
  credentials: StravaCredentials,
  refreshToken: string,
) =>
  requestTokens(fetcher, credentials, { refresh_token: refreshToken, grant_type: "refresh_token" });

export const deauthorize = (fetcher: typeof fetch, accessToken: string) =>
  fetcher(`${OAUTH}/deauthorize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

export function createUpload(
  fetcher: typeof fetch,
  accessToken: string,
  fit: ArrayBuffer,
  name: string,
  fileName: string,
) {
  const form = new FormData();
  form.set("data_type", "fit");
  form.set("name", name);
  form.set("description", "Recorded with TrainStack Ride");
  form.set("trainer", "1");
  form.set("file", new Blob([fit]), fileName);
  return fetcher(`${API}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
}

export const getUpload = (fetcher: typeof fetch, accessToken: string, id: number) =>
  fetcher(`${API}/uploads/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
