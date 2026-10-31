# Voori Vijetha Evaru

A village election survey app with **villages → wards → phone numbers**, village-scoped candidates, dated survey rounds, Telugu question playback, optional browser speech recognition, and ward-level result comparisons. Admins see private contact records; approved Google viewers see only masked aggregates.

## Features

- Multiple villages, each with its own wards, candidates, and resident phone list.
- Manual contact entry and CSV import (`name,phone,ward`); contact lists stay on the local server.
- Separate survey rounds per village, each with a selected candidate set and its own response history. Set up head-to-head rounds such as A vs B, B vs C, and A vs C, plus an all-candidate round.
- Select all currently visible contacts or individual contacts in a village/ward. The call/message queue opens the selected device handler one person at a time; it does not make calls simultaneously.
- Record responses against a selected survey round, with response channel (phone, text reply, or spoken answer) and consent confirmation.
- Telugu question playback using browser speech synthesis; optional speech recognition can transcribe a candidate name for admin confirmation.
- Admin dashboard with ward summaries, candidate percentages, survey dates, and comparison against a previous round.
- Optional Google sign-in with admin approval and revocation for viewer accounts. Viewers can access only rounded, threshold-masked aggregates.
- Persistent local JSON storage, password setup/recovery, migration from the earlier single-response data format, and no runtime package dependencies.

## Run locally

Requires Node.js 20 or newer. From this folder, start the server:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). On first run, create an admin password of at least 12 characters in the setup screen; the app signs you in automatically and displays a one-time recovery code. Save the code somewhere private. On later runs, sign in with that password. The password itself is never stored: a salted password hash, recovery-code hash, generated session secret, and survey data are saved together in `data/survey-data.json`, so they survive restarts. The database is local and excluded from Git. Back it up securely; it contains phone numbers, authentication hashes, and sensitive survey preferences.

To reset a forgotten password, choose **Forgot your password?** on the sign-in screen and use the recovery code. Resetting rotates the code, so save its replacement. Admins can generate a replacement code from **Admin & recovery** while signed in. Existing installations with the older separate admin-auth file are migrated into the survey database on startup.

To keep the local database somewhere else, set `SURVEY_DATA_DIR` to a directory the server can write to before running `npm start`.

### Local data and backups

The app writes its database to `data/survey-data.json` by default. It creates the directory with private permissions and writes the file with owner-only permissions. The database includes personal contact details, individual survey responses, account hashes, Google user approvals, and the session-signing secret. **Do not commit this file or send it to GitHub.** The `data/` directory is ignored by Git. Back it up only to a private, access-controlled location. Restore a backup only while the app is stopped.

The application is intended for a trusted, single-admin server. Anyone with filesystem access to the database can access sensitive survey information; JSON persistence does not encrypt the file at rest.

## Optional Google sign-in and approved viewers

Google sign-in is optional. Create an OAuth 2.0 web application in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and configure its exact redirect URI as `https://YOUR-DOMAIN/api/google/callback` (for local testing, use the matching `http://localhost:3000/api/google/callback`). Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the server environment. Set `GOOGLE_ADMIN_EMAIL` to the verified Google account that should receive admin access. Keep the client secret on the server; never put it in `app.js` or `index.html`. OAuth requires a reachable HTTPS callback for public deployment; set `NODE_ENV=production` so session cookies are marked `Secure`. See Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

Other Google users can submit a request. The admin reviews requests from **Admin & recovery** and can revoke approved viewers. Approved users can view dated survey aggregates only; they cannot view contacts or individual responses. Viewer ward results are suppressed below 10 candidate preferences and percentages are rounded to the nearest 10 percentage points. Rejected users can sign in with Google again to resubmit a request.

Google configuration variables:

| Variable | Required | Purpose |
|---|---:|---|
| `GOOGLE_CLIENT_ID` | Yes, for Google sign-in | OAuth web application client ID |
| `GOOGLE_CLIENT_SECRET` | Yes, for Google sign-in | Server-only OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Yes, for Google sign-in | Exact callback URL registered with Google |
| `GOOGLE_ADMIN_EMAIL` | Recommended | Verified Google email allowed to sign in as admin |
| `NODE_ENV` | For production | Set to `production` to mark session cookies `Secure` |

Use the existing local password login as a fallback for the admin. Do not store these settings in tracked files; configure them in your hosting provider's secret/environment settings. Google authentication cannot be tested until valid OAuth credentials and a registered callback are configured.

## Survey workflow

1. Use the **Villages & candidates** tab to add villages and wards, then add or remove candidates for the selected village.
2. Create a named survey round for that village and select at least two candidates. Create additional rounds for each head-to-head matchup or for a comparison among all candidates. Each round is dated and stores a separate answer for every person.
3. Add phone numbers manually or select a village and import its CSV. The sample uses `name,phone,ward`; `name` is optional. Ward values must already exist for the selected village. Include country codes when needed. A phone number can be listed once per village; the same number may appear in a different village. Re-importing a number for the same village updates its contact details without erasing survey answers.
4. In **Call & record**, select a village, survey round, and optionally a ward. Select all visible contacts or individual contacts to prepare a manual outreach queue. **Call next selected** and **Message next selected** open one person's phone or SMS handler at a time; the admin must complete each action and choose the next. The app does not place simultaneous calls or send messages automatically.
5. Play the Telugu survey question on the device during a call. Browser speech recognition can help enter the spoken candidate name after selecting **Record**. Save the answer under the selected survey round and record its source. Audio is not stored, and incoming texts or phone-call audio are not captured automatically.
6. **Survey results** shows village/ward results for the selected dated round and can compare it with another round from that village. Percentages use named preferences in that round and ward; they are not a forecast or probability of winning.

For a comparison, select the newer round under **Survey round** and the earlier round under **Compare with**. The dashboard compares candidate percentages and percentage-point changes within each ward. Only contacts with a named candidate preference in that particular round are included in the denominator; undecided, declined, and no-answer entries are excluded. Results are descriptive survey responses, not a prediction of election results.

Candidates or villages referenced by a survey round or saved response cannot be deleted, to avoid losing survey history. Wards with contacts cannot be deleted. A village can only be deleted after its candidates, rounds, and contacts are removed.

## Voice and calling limitations

Telugu voice playback and optional speech recognition use browser features. The question plays locally; the app does not create or send a recorded voice message. Browser microphone recognition cannot hear audio from a separate phone call, so the respondent would need to repeat the answer near the microphone or the admin can select the answer manually.

Calls and texts use the device's `tel:` and `sms:` handlers. The operating system chooses the handler, so the app cannot force a particular dialer or guarantee Skype is not the default. Using the phone's normal SIM and existing call/SMS bundle is the simplest no-extra-provider-cost option, but standard carrier plan charges still apply. The browser cannot directly use the carrier network or send calls/SMS for free.

True simultaneous automated calls or bulk network messaging require a telephony/SMS provider, account credentials, and usually per-minute/per-message charges; there is no reliable, general-purpose free option for this. A low-cost integration can be added later behind a provider adapter (for example, [Exotel](https://exotel.com/pricing/) or [Twilio](https://www.twilio.com/en-us/voice/pricing/in) for voice). Confirm current regional availability, pricing, number provisioning, consent, and applicable telecom/DLT rules with the provider before enabling it. This app intentionally does not transmit a contact list to any provider.

## Security checklist

- Create a unique admin password of at least 12 characters and retain the one-time recovery code in a separate secure location.
- Keep `data/`, `.env` files, OAuth secrets, local backups, and private contact imports out of GitHub. The `.gitignore` excludes common local secret/data paths; review staged files before every commit.
- Use HTTPS for any public deployment and set `NODE_ENV=production`.
- Limit server and backup filesystem access. Do not expose the local server directly to the public internet without a secure deployment configuration.
- Obtain appropriate consent before collecting or recording preferences. Do not use the contact list for unrelated purposes; follow applicable privacy, election, and telecom rules.
- Approved Google viewers are not admins; their API is restricted to public-style aggregate data. The admin should still approve viewers carefully.

## Privacy and deployment

The app requires an admin password. API data is admin-authenticated, the session cookie is HTTP-only and same-site, and survey responses are not sent to analytics. The recovery code is shown only when generated; the app stores its hash, not the code. For a shared or public deployment, put the app behind HTTPS, restrict server and backup access, choose a strong unique password, safeguard the recovery code, and follow applicable privacy and election rules. This small app is intended for a trusted, single-admin deployment, not as a substitute for a reviewed multi-user election-survey platform.
