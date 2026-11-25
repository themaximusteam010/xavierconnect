# Sign in with Google — setup and security

## Google Cloud Console (one-time, by the account owner)
1. Create/select a project → APIs & Services → OAuth consent screen: External, app name "XavierConnect", support email,
   authorised domain (your production domain), scopes `openid`, `email`, `profile` (no sensitive scopes). Publish.
2. Credentials → Create credentials → OAuth client ID → Web application.
   - Authorised JavaScript origins: `https://<your-domain>`
   - Authorised redirect URIs: `https://<your-domain>/auth/google/callback` (add `http://localhost:3000/auth/google/callback` for local dev)
3. Put the Client ID and Client secret in Vercel env vars `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Production + Preview),
   and set `GOOGLE_REDIRECT_URI` if it differs from `$APP_URL/auth/google/callback`. Redeploy.
The "Continue with Google" button appears only when both values are set.

## Flow
`/auth/google/start` → Google (authorization code + PKCE S256, `state`, `nonce`, `prompt=select_account`) →
`/auth/google/callback`: the encrypted, 10-minute, single-use `xc_oauth` cookie is checked against `state`; the code is
exchanged server-side with the client secret and PKCE verifier; the ID token is verified with Google's published keys
(RS256, issuer `https://accounts.google.com`, audience = client ID, expiry, nonce). Endpoints come from Google's
discovery document. A normal XavierConnect session is then created (staff still need TOTP).

## Linking rules (no duplicates, no takeovers)
- An identity is the Google `sub`, never the email. Same `sub` ⇒ same account.
- New `sub` + no account with that email ⇒ new **customer** account (email verified, no password).
- New `sub` + existing account with that email ⇒ linked automatically **only** if the existing email is verified, the
  address is `@gmail.com`/`@googlemail.com`, and it is not a staff account. Otherwise the user signs in with their
  password and connects Google in Account → Settings.
- Google never grants vendor or staff roles; vendor access still requires an approved application.
- A Google-only account can't disconnect Google until it sets a password (via "Forgot password").
All link, unlink, sign-up and refused attempts are stored in `OAuthAccountLink` and the audit log.
