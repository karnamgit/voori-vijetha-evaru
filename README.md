# Voori Vijetha Evaru

A village election survey app with **villages → wards → people**, village-scoped candidates, dated survey rounds, Telugu question playback, optional browser speech recognition, and ward-level result comparisons. People can have a phone number, email address, or both. Admins see private contact records; approved Google viewers see only masked aggregates.

## Features

- Separate **Villages**, **Candidates**, **Create survey**, and **Add people** tabs keep administration tasks focused. Add wards as separate fields while creating a village; existing villages stay collapsed until opened to manage wards.
- Villages include mandal, district, state, and country so same-named villages are distinguishable. Village names stay separate from those location fields throughout the app; use the optional location filters to narrow village pickers and the village directory.
- Manual contact entry and CSV import (`name,phone,email,village,mandal,district,state,country,ward`); phone and email are optional individually, but each person needs at least one. A selected default village can be used for rows without village/location values. Location columns resolve each CSV row to its matching village, and ambiguous duplicate names require enough location columns to identify the right village. Contact lists stay on the local server.
- Edit a person's name, phone, email, village, or ward without losing prior survey responses; response records retain the location where they were collected.
- Create a ward-specific self-registration QR code. People scan it to volunteer their contact details and consent to follow-up; registrations remain pending until an admin approves them. Rejections remove the submitted details.
- Separate survey rounds per village, each with a selected candidate set, a customizable Telugu question, an optional locally recorded voice prompt, and its own response history. Previously used questions can be saved as village-specific or global templates.
- Select all currently visible contacts or individual contacts in a village/ward. Phone, SMS, WhatsApp, and email actions open the selected device handler one person at a time; they do not make calls or send messages automatically.
- Email surveys open a `mailto:` draft containing the saved question and candidate choices. Review and send each email yourself, then record replies with the **Email reply** response channel. This needs a configured mail app and does not send email in the background.
- Record responses against a selected survey round, with response channel (phone, text reply, email reply, or spoken answer) and consent confirmation.
- Telugu question playback using an installed device/browser voice or a locally recorded voice prompt; optional speech recognition can transcribe a candidate name for admin confirmation.
- Edit the question in **Call & record**, save it to the active survey, and reuse or remove village-specific saved question templates without changing past survey rounds.
- Survey rounds always belong to one village so candidates, contacts, and results stay village-specific. Question templates may be saved for that village or globally for reuse across villages.
- Admins can delete any survey round; deleting a round with answers requires confirmation and permanently removes its saved responses.
- Admin dashboard with ward summaries, candidate percentages, survey dates, and comparison against a previous round.
- Optional Google sign-in with admin approval and revocation for viewer accounts. Viewers can access only rounded, threshold-masked aggregates.
- Persistent local JSON storage, password setup/recovery, migration from the earlier single-response data format, and local QR code generation using the `qrcode` package.

## Run locally

Requires Node.js 20 or newer. From this folder, start the server:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). On first run, create an admin password of at least 12 characters in the setup screen; the app signs you in automatically and displays a one-time recovery code. Save the code somewhere private. On later runs, sign in with that password. The password itself is never stored: a salted password hash, recovery-code hash, generated session secret, and survey data are saved together in `data/survey-data.json`, so they survive restarts. The database is local and excluded from Git. Back it up securely; it contains phone numbers, email addresses, authentication hashes, and sensitive survey preferences.

Install the QR code dependency with `npm install` after cloning the project. `node_modules/` is excluded from Git.

To reset a forgotten password, choose **Forgot your password?** on the sign-in screen and use the recovery code. Resetting rotates the code, so save its replacement. Admins can generate a replacement code from **Admin & recovery** while signed in. Existing installations with the older separate admin-auth file are migrated into the survey database on startup.

To keep the local database somewhere else, set `SURVEY_DATA_DIR` to a directory the server can write to before running `npm start`.

### Local data and backups

The app writes its database to `data/survey-data.json` by default. It creates the directory with private permissions and writes the file with owner-only permissions. The database includes personal contact details, individual survey responses, account hashes, Google user approvals, and the session-signing secret. **Do not commit this file or send it to GitHub.** The `data/` directory is ignored by Git. Back it up only to a private, access-controlled location. Restore a backup only while the app is stopped.

The application is intended for a trusted, single-admin server. Anyone with filesystem access to the database can access sensitive survey information; JSON persistence does not encrypt the file at rest. Phone numbers, email addresses, and election preferences are private contact data.

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

1. Use the **Villages** tab to add a village and one or more wards. Add later wards from that village’s collapsed ward manager. Use the separate **Candidates** tab to add or remove candidates for a selected village.
2. Create a named survey round for a village, choose a previously used question or enter a new Telugu question, choose whether its wording is reusable in that village or globally, and select at least two candidates from that village. Survey rounds and results remain village-specific. Create additional rounds for each matchup or all candidates; each round stores its own question and answers.
3. Use **Add people** to save a phone number, email address, or both for a village and ward. The downloadable CSV template includes `name,phone,email,ward`; `name` is optional, and each row needs at least a phone or email address. Ward values must already exist for the selected village. Include country codes for phone numbers when needed. Re-importing a matching person updates their details without erasing survey answers; a blank phone or email field preserves that existing contact method.
4. In **Call & record**, select a village and survey round. Edit the Telugu question in the text box and choose **Save question for this survey**; choose village or global scope for its reusable template. Remove templates from the list as needed; existing rounds and responses remain unchanged. Optionally filter by ward, then select people for a manual outreach queue. **Call next selected**, **Message next selected**, **WhatsApp next selected**, and **Email next selected** open one person's handler at a time; the admin reviews and completes each action before choosing the next. Email drafts contain the survey question and candidate choices.
5. To delete a survey, use its delete button in the **Create survey** tab. If it has saved responses, confirm the permanent deletion; the round and its responses are removed.
6. Play that round's Telugu question using an installed Telugu device voice. If none is available, choose **Record a Telugu voice for this question**, allow microphone access, read the question, and stop/save; or upload a supported recording. The prompt is stored with the survey round and used by Play. Browser speech recognition can help enter the spoken candidate name after selecting **Record**. Respondent audio is not stored, and incoming texts or phone-call audio are not captured automatically.
7. **Survey results** shows village/ward results for the selected dated round and can compare it with another round from that village. Percentages use named preferences in that round and ward; they are not a forecast or probability of winning.

For a comparison, select the newer round under **Survey round** and the earlier round under **Compare with**. The dashboard compares candidate percentages and percentage-point changes within each ward. Only contacts with a named candidate preference in that particular round are included in the denominator; undecided, declined, and no-answer entries are excluded. Results are descriptive survey responses, not a prediction of election results.

Candidates or villages referenced by a survey round or saved response cannot be deleted, to avoid losing survey history. Wards with contacts cannot be deleted. A village can only be deleted after its candidates, rounds, and contacts are removed.

### Self-registration QR codes

Open a village in the **Villages** tab, choose a ward, and select **Create QR code**. The resulting QR opens a public registration page for that exact village/ward. It collects only name, phone, and/or email plus explicit contact permission; it does not submit a survey answer. QR registrations are held out of the admin call list and results until approved in **Add people**. Rejecting a registration permanently deletes its submitted contact details.

For people to scan the QR from another device, the generated URL must be reachable from their phones. When running on a local network, open the app using the computer's reachable LAN address before generating the QR. For a hosted deployment, set `PUBLIC_BASE_URL` to the public app origin (for example `https://survey.example.org`) in the server environment. Use HTTPS for public access. Public registrations are rate-limited per network address; the local in-memory limit resets when the server restarts.

## Voice and calling limitations

Telugu text-to-speech requires a Telugu voice installed and enabled on the device/browser. When no Telugu voice is available, record the question in a Telugu-speaking person's voice using the microphone controls, or upload an MP3, WAV, M4A, OGG, or WebM recording (up to 3 MB). Voice prompts are stored in the local survey database and do not leave the server. Microphone access requires HTTPS or localhost and browser permission. Browser microphone recognition cannot hear audio from a separate phone call, so the respondent would need to repeat the answer near the microphone or the admin can select the answer manually. Browser speech-recognition implementations may process response audio through their speech service; check the browser's privacy terms before using it.

Calls and texts use the device's `tel:` and `sms:` handlers. The operating system chooses the handler, so the app cannot force a particular dialer or guarantee Skype is not the default. Using the phone's normal SIM and existing call/SMS bundle is the simplest no-extra-provider-cost option, but standard carrier plan charges still apply. The browser cannot directly use the carrier network or send calls/SMS for free.

The WhatsApp action opens a manually reviewed `wa.me` chat using the saved contact number and the selected round's question as a draft. Save numbers in international format with country code (for example `+91...` for India), and review each chat and message before sending. This is not WhatsApp Business API messaging and does not send automatically. The app cannot import or scrape WhatsApp address books/chats; add contacts yourself or use the permission-based CSV import.

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
