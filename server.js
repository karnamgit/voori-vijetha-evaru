const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = process.env.SURVEY_DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "survey-data.json");
const AUTH_FILE = path.join(DATA_DIR, "admin-auth.json");
const SESSION_DURATION = 8 * 60 * 60;
const MAX_BODY_BYTES = 5_000_000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const GOOGLE_ADMIN_EMAIL = (process.env.GOOGLE_ADMIN_EMAIL || "").trim().toLowerCase();

let store;
let writeQueue = Promise.resolve();

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else if (!tooLarge) body += chunk;
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function saveStore() {
  const contents = JSON.stringify(store, null, 2);
  const save = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    const temporaryFile = `${DATA_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, contents, { mode: 0o600 });
    await fs.rename(temporaryFile, DATA_FILE);
  });
  writeQueue = save.catch(() => {});
  return save;
}

function hashSecret(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("base64url");
}

function makeRecoveryCode() {
  return crypto.randomBytes(24).toString("base64url");
}

function setAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  store.auth.passwordSalt = salt;
  store.auth.passwordHash = hashSecret(password, salt);
}

function rotateRecoveryCode() {
  const code = makeRecoveryCode();
  const salt = crypto.randomBytes(16).toString("base64url");
  store.auth.recoverySalt = salt;
  store.auth.recoveryHash = hashSecret(code, salt);
  return code;
}

function verifySecret(secret, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashSecret(secret, salt));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sign(payload) {
  return crypto.createHmac("sha256", store.auth.sessionSecret).update(payload).digest("base64url");
}

function makeSessionCookie() {
  return makeSessionCookieFor({ role: "admin" });
}

function makeSessionCookieFor(identity) {
  const payload = Buffer.from(
    JSON.stringify({ ...identity, expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION }),
  ).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `admin_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION}${secure}`;
}

function getSession(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
      .filter(([name, value]) => name && value),
  );
  const [payload, signature] = (cookies.admin_session || "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return null;
  }
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return session.expiresAt > Date.now() / 1000 ? session : null;
  } catch {
    return null;
  }
}

function isAuthenticated(req) {
  return Boolean(getSession(req));
}

function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function cleanText(value, label, maxLength = 100) {
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!result || result.length > maxLength) {
    throw Object.assign(new Error(`${label} must be 1–${maxLength} characters.`), { status: 400 });
  }
  return result;
}

function cleanPhone(value) {
  if (typeof value !== "string") {
    throw Object.assign(new Error("A phone number is required."), { status: 400 });
  }
  const phone = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) {
    throw Object.assign(new Error("Phone numbers must contain 7–15 digits and may start with +."), {
      status: 400,
    });
  }
  return phone;
}

function findContact(id) {
  const contact = store.contacts.find((entry) => entry.id === id);
  if (!contact) throw Object.assign(new Error("Contact not found."), { status: 404 });
  return contact;
}

function findVillage(id) {
  const village = store.villages.find((entry) => entry.id === id);
  if (!village) throw Object.assign(new Error("Village not found."), { status: 404 });
  return village;
}

function findWard(village, value) {
  const ward = cleanText(value, "Ward", 40);
  if (!village.wards.includes(ward)) {
    throw Object.assign(new Error(`Ward ${ward} is not set up in ${village.name}.`), { status: 400 });
  }
  return ward;
}

function migrateStore(data) {
  if (!data || !Array.isArray(data.candidates) || !Array.isArray(data.contacts)) {
    throw new Error("Data file must contain candidate and contact lists.");
  }
  const villages = Array.isArray(data.villages) ? data.villages : [];
  const migratedVillages = villages.map((village) => ({
    id: village.id || crypto.randomUUID(),
    name: cleanText(village.name, "Village name", 100),
    wards: [...new Set((Array.isArray(village.wards) ? village.wards : []).map((ward) => cleanText(String(ward), "Ward", 40)))],
  }));
  for (const contact of data.contacts) {
    if (!contact.villageId && typeof contact.village === "string" && contact.village.trim()) {
      let village = migratedVillages.find((entry) =>
        entry.name.toLocaleLowerCase() === contact.village.trim().toLocaleLowerCase(),
      );
      if (!village) {
        village = { id: crypto.randomUUID(), name: cleanText(contact.village, "Village name", 100), wards: [] };
        migratedVillages.push(village);
      }
      contact.villageId = village.id;
    }
    const village = migratedVillages.find((entry) => entry.id === contact.villageId);
    if (village && contact.ward && !village.wards.includes(String(contact.ward))) {
      village.wards.push(cleanText(String(contact.ward), "Ward", 40));
    }
    delete contact.village;
    contact.consentGiven = contact.consentGiven === true;
    contact.consentAt = contact.consentAt || null;
  }
  const surveys = Array.isArray(data.surveys) ? data.surveys : [];
  const responsesByVillage = new Map();
  for (const village of migratedVillages) {
    const villageCandidates = data.candidates.filter((candidate) =>
      !candidate.villageId || candidate.villageId === village.id,
    );
    if (villageCandidates.length >= 2 && !surveys.some((survey) => survey.villageId === village.id)) {
      const responseDates = data.contacts
        .filter((contact) => contact.villageId === village.id && contact.response && contact.respondedAt)
        .map((contact) => Date.parse(contact.respondedAt))
        .filter(Number.isFinite);
      const survey = {
        id: crypto.randomUUID(),
        villageId: village.id,
        title: "Survey 1",
        createdAt: responseDates.length
          ? new Date(Math.min(...responseDates)).toISOString()
          : new Date().toISOString(),
        candidateIds: villageCandidates.map((candidate) => candidate.id),
      };
      surveys.push(survey);
      responsesByVillage.set(village.id, survey);
    }
  }
  for (const contact of data.contacts) {
    if (contact.response && contact.villageId && !responsesByVillage.has(contact.villageId)) {
      const survey = {
        id: crypto.randomUUID(),
        villageId: contact.villageId,
        title: "Survey 1",
        createdAt: contact.respondedAt || new Date().toISOString(),
        candidateIds: data.candidates
          .filter((candidate) => !candidate.villageId || candidate.villageId === contact.villageId)
          .map((candidate) => candidate.id),
      };
      responsesByVillage.set(contact.villageId, survey);
      surveys.push(survey);
    }
  }
  const migratedSurveys = surveys.map((survey) => ({
    id: survey.id || crypto.randomUUID(),
    villageId: survey.villageId,
    title: cleanText(survey.title || "Survey", "Survey name", 100),
    createdAt: survey.createdAt || new Date().toISOString(),
    candidateIds: Array.isArray(survey.candidateIds) ? survey.candidateIds : [],
  }));
  for (const contact of data.contacts) {
    if (!Array.isArray(contact.responses)) contact.responses = [];
    if (contact.response && !contact.responses.length) {
      const survey = responsesByVillage.get(contact.villageId);
      if (survey) {
        contact.responses.push({
          surveyId: survey.id,
          response: contact.response,
          channel: contact.responseChannel || "phone",
          respondedAt: contact.respondedAt || survey.createdAt,
          consentGiven: contact.consentGiven === true,
          consentAt: contact.consentAt || null,
        });
      }
    }
    delete contact.response;
    delete contact.status;
    delete contact.respondedAt;
    delete contact.responseChannel;
    delete contact.consentGiven;
    delete contact.consentAt;
  }
  return {
    version: 4,
    villages: migratedVillages,
    candidates: data.candidates.map((candidate) => ({
      id: candidate.id || crypto.randomUUID(),
      name: cleanText(candidate.name, "Candidate name", 80),
      villageId: candidate.villageId || null,
    })),
    contacts: data.contacts.map((contact) => ({
      ...contact,
      id: contact.id || crypto.randomUUID(),
      villageId: contact.villageId || null,
      responses: contact.responses,
    })),
    surveys: migratedSurveys,
    auth: data.auth || null,
    users: Array.isArray(data.users) ? data.users : [],
  };
}

function getViewerData() {
  const results = [];
  for (const survey of store.surveys) {
    const village = store.villages.find((entry) => entry.id === survey.villageId);
    if (!village) continue;
    for (const ward of village.wards) {
      const responses = store.contacts.flatMap((contact) =>
        contact.villageId === village.id && contact.ward === ward
          ? contact.responses.filter((response) =>
            response.surveyId === survey.id && survey.candidateIds.includes(response.response),
          )
          : [],
      );
      if (responses.length < 10) {
        results.push({ surveyId: survey.id, villageId: village.id, ward, suppressed: true });
        continue;
      }
      results.push({
        surveyId: survey.id,
        villageId: village.id,
        ward,
        sampleBand: `${Math.floor(responses.length / 5) * 5}+`,
        candidates: survey.candidateIds.map((candidateId) => {
          const count = responses.filter((response) => response.response === candidateId).length;
          return {
            candidateId,
            share: Math.round((count / responses.length) * 10) * 10,
          };
        }),
      });
    }
  }
  return {
    viewer: true,
    villages: store.villages.map(({ id, name, wards }) => ({ id, name, wards })),
    candidates: store.candidates.map(({ id, name, villageId }) => ({ id, name, villageId })),
    surveys: store.surveys,
    contacts: [],
    results,
  };
}

async function handleApi(req, res, url) {
  if (req.method !== "GET" && !checkOrigin(req)) {
    return sendJson(res, 403, { error: "Request origin was not accepted." });
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!store.auth.passwordHash) {
      return sendJson(res, 409, { error: "Create an admin password to set up the app." });
    }
    const body = await readBody(req);
    const provided = typeof body.password === "string" ? body.password : "";
    const matches = verifySecret(provided, store.auth.passwordSalt, store.auth.passwordHash);
    if (!matches) return sendJson(res, 401, { error: "That password is not correct." });
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": makeSessionCookie() });
  }

  if (url.pathname === "/api/google/start" && req.method === "GET") {
    if (!isGoogleConfigured()) {
      return sendJson(res, 503, { error: "Google sign-in is not configured on this server." });
    }
    const state = crypto.randomBytes(24).toString("base64url");
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    }).toString();
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.writeHead(302, {
      Location: authorization.toString(),
      "Set-Cookie": `google_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/google/callback; Max-Age=600${secureCookie}`,
      "Cache-Control": "no-store",
    });
    return res.end();
  }

  if (url.pathname === "/api/google/callback" && req.method === "GET") {
    if (!isGoogleConfigured()) return sendJson(res, 503, { error: "Google sign-in is not configured." });
    const cookies = Object.fromEntries((req.headers.cookie || "").split(";")
      .map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
      .filter(([name, value]) => name && value));
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const clearStateCookie = `google_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/google/callback; Max-Age=0${secureCookie}`;
    if (!url.searchParams.get("state") || url.searchParams.get("state") !== cookies.google_oauth_state) {
      return sendJson(res, 400, { error: "Google sign-in could not be verified. Please try again." }, { "Set-Cookie": clearStateCookie });
    }
    const code = url.searchParams.get("code");
    if (!code) return sendJson(res, 401, { error: "Google sign-in was cancelled." }, { "Set-Cookie": clearStateCookie });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      return sendJson(res, 502, { error: "Google could not complete sign-in. Please try again." }, { "Set-Cookie": clearStateCookie });
    }
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileResponse.ok) {
      return sendJson(res, 502, { error: "Google profile could not be verified." }, { "Set-Cookie": clearStateCookie });
    }
    const profile = await profileResponse.json();
    if (!profile.email_verified || !profile.sub || !profile.email) {
      return sendJson(res, 403, { error: "Use a Google account with a verified email address." }, { "Set-Cookie": clearStateCookie });
    }
    const email = String(profile.email).toLowerCase();
    if (GOOGLE_ADMIN_EMAIL && email === GOOGLE_ADMIN_EMAIL) {
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": [makeSessionCookieFor({ role: "admin", email }), clearStateCookie],
      });
      return res.end();
    }
    let user = store.users.find((entry) => entry.googleSub === profile.sub || entry.email === email);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        googleSub: profile.sub,
        email,
        name: typeof profile.name === "string" && profile.name.trim()
          ? cleanText(profile.name, "Google profile name", 100)
          : email,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      store.users.push(user);
      await saveStore();
    }
    if (user.googleSub !== profile.sub) user.googleSub = profile.sub;
    if (user.status === "rejected") {
      user.status = "pending";
      user.requestedAt = new Date().toISOString();
      await saveStore();
    }
    if (user.status === "approved") {
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": [makeSessionCookieFor({ role: "viewer", userId: user.id }), clearStateCookie],
      });
      return res.end();
    }
    const accessState = user.status === "rejected" ? "denied" : "pending";
    res.writeHead(302, { Location: `/?access=${accessState}`, "Set-Cookie": clearStateCookie });
    return res.end();
  }

  if (url.pathname === "/api/setup" && req.method === "POST") {
    if (store.auth.passwordHash) {
      return sendJson(res, 409, { error: "Admin setup is already complete. Please sign in." });
    }
    const body = await readBody(req);
    if (typeof body.password !== "string" || body.password.length < 12) {
      return sendJson(res, 400, { error: "Choose an admin password with at least 12 characters." });
    }
    setAdminPassword(body.password);
    const recoveryCode = rotateRecoveryCode();
    await saveStore();
    return sendJson(res, 201, { ok: true, recoveryCode }, { "Set-Cookie": makeSessionCookie() });
  }

  if (url.pathname === "/api/recover" && req.method === "POST") {
    const body = await readBody(req);
    if (typeof body.password !== "string" || body.password.length < 12) {
      return sendJson(res, 400, { error: "Choose a new password with at least 12 characters." });
    }
    if (!verifySecret(
      typeof body.recoveryCode === "string" ? body.recoveryCode : "",
      store.auth.recoverySalt,
      store.auth.recoveryHash,
    )) {
      return sendJson(res, 401, { error: "That recovery code is not correct. Check the code you saved during setup." });
    }
    setAdminPassword(body.password);
    const recoveryCode = rotateRecoveryCode();
    await saveStore();
    return sendJson(res, 200, { ok: true, recoveryCode }, { "Set-Cookie": makeSessionCookie() });
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    const session = getSession(req);
    const user = session?.role === "viewer" ? store.users.find((entry) =>
      entry.id === session.userId && entry.status === "approved",
    ) : null;
    const authenticated = Boolean(session && (session.role === "admin" || user));
    return sendJson(res, 200, {
      authenticated,
      role: authenticated ? session.role : null,
      name: user?.name || (session?.role === "admin" ? "Admin" : null),
      needsSetup: !store.auth.passwordHash,
      hasRecoveryCode: Boolean(store.auth.recoveryHash),
      googleEnabled: isGoogleConfigured(),
    });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
  }

  const session = getSession(req);
  const viewer = session?.role === "viewer" && store.users.some((entry) =>
    entry.id === session.userId && entry.status === "approved",
  );
  if (!session || (session.role !== "admin" && !viewer)) {
    return sendJson(res, 401, { error: "Please sign in as an admin." });
  }

  if (session.role !== "admin") {
    if (url.pathname === "/api/data" && req.method === "GET") {
      return sendJson(res, 200, getViewerData());
    }
    return sendJson(res, 403, { error: "This action is available to admins only." });
  }

  if (url.pathname === "/api/access-requests" && req.method === "GET") {
    return sendJson(res, 200, {
      users: store.users.map(({ id, name, email, status, createdAt }) => ({ id, name, email, status, createdAt })),
    });
  }

  const accessRequestMatch = url.pathname.match(/^\/api\/access-requests\/([^/]+)$/);
  if (accessRequestMatch && req.method === "POST") {
    const user = store.users.find((entry) => entry.id === decodeURIComponent(accessRequestMatch[1]));
    if (!user) return sendJson(res, 404, { error: "Access request not found." });
    const body = await readBody(req);
    if (!["approved", "rejected"].includes(body.status)) {
      return sendJson(res, 400, { error: "Choose approve or reject." });
    }
    user.status = body.status;
    user.reviewedAt = new Date().toISOString();
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/recovery-code" && req.method === "POST") {
    const recoveryCode = rotateRecoveryCode();
    await saveStore();
    return sendJson(res, 200, { recoveryCode });
  }

  if (url.pathname === "/api/data" && req.method === "GET") {
    const { auth, users, ...surveyData } = store;
    return sendJson(res, 200, {
      ...surveyData,
      viewer: false,
      auth: { recoveryConfigured: Boolean(auth.recoveryHash) },
    });
  }

  if (url.pathname === "/api/surveys" && req.method === "POST") {
    const body = await readBody(req);
    const village = findVillage(body.villageId);
    const title = cleanText(body.title, "Survey name", 100);
    const candidateIds = Array.isArray(body.candidateIds) ? [...new Set(body.candidateIds)] : [];
    if (candidateIds.length < 2) {
      return sendJson(res, 400, { error: "Select at least two candidates for a survey round." });
    }
    const villageCandidateIds = store.candidates.filter((candidate) =>
      !candidate.villageId || candidate.villageId === village.id,
    ).map((candidate) => candidate.id);
    if (candidateIds.some((id) => !villageCandidateIds.includes(id))) {
      return sendJson(res, 400, { error: "Choose candidates that belong to this village." });
    }
    const survey = {
      id: crypto.randomUUID(),
      villageId: village.id,
      title,
      createdAt: new Date().toISOString(),
      candidateIds,
    };
    store.surveys.push(survey);
    await saveStore();
    return sendJson(res, 201, { ok: true, survey });
  }

  const surveyMatch = url.pathname.match(/^\/api\/surveys\/([^/]+)$/);
  if (surveyMatch && req.method === "DELETE") {
    const survey = store.surveys.find((entry) => entry.id === decodeURIComponent(surveyMatch[1]));
    if (!survey) return sendJson(res, 404, { error: "Survey round not found." });
    if (store.contacts.some((contact) =>
      contact.responses.some((response) => response.surveyId === survey.id),
    )) {
      return sendJson(res, 409, { error: "This survey round has saved responses and cannot be deleted." });
    }
    store.surveys = store.surveys.filter((entry) => entry.id !== survey.id);
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/villages" && req.method === "POST") {
    const body = await readBody(req);
    const name = cleanText(body.name, "Village name", 100);
    const wards = Array.isArray(body.wards)
      ? body.wards.map((ward) => cleanText(ward, "Ward", 40)).filter((ward, index, list) =>
        list.findIndex((entry) => entry.toLocaleLowerCase() === ward.toLocaleLowerCase()) === index,
      )
      : [];
    if (!wards.length) return sendJson(res, 400, { error: "Add at least one ward to the village." });
    if (store.villages.some((village) => village.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return sendJson(res, 409, { error: "That village already exists." });
    }
    const village = { id: crypto.randomUUID(), name, wards };
    store.villages.push(village);
    await saveStore();
    return sendJson(res, 201, { ok: true, village });
  }

  const villageMatch = url.pathname.match(/^\/api\/villages\/([^/]+)$/);
  if (villageMatch && req.method === "DELETE") {
    const village = findVillage(decodeURIComponent(villageMatch[1]));
    if (
      store.contacts.some((contact) => contact.villageId === village.id) ||
      store.surveys.some((survey) => survey.villageId === village.id) ||
      store.candidates.some((candidate) => candidate.villageId === village.id)
    ) {
      return sendJson(res, 409, { error: "Remove this village’s contacts and candidates, and delete any empty survey rounds, before deleting it." });
    }
    store.villages = store.villages.filter((entry) => entry.id !== village.id);
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  const wardMatch = url.pathname.match(/^\/api\/villages\/([^/]+)\/wards(?:\/([^/]+))?$/);
  if (wardMatch && req.method === "POST" && !wardMatch[2]) {
    const village = findVillage(decodeURIComponent(wardMatch[1]));
    const body = await readBody(req);
    const ward = cleanText(body.name, "Ward", 40);
    if (village.wards.some((entry) => entry.toLocaleLowerCase() === ward.toLocaleLowerCase())) {
      return sendJson(res, 409, { error: "That ward already exists in this village." });
    }
    village.wards.push(ward);
    await saveStore();
    return sendJson(res, 201, { ok: true });
  }
  if (wardMatch && req.method === "DELETE" && wardMatch[2]) {
    const village = findVillage(decodeURIComponent(wardMatch[1]));
    const ward = decodeURIComponent(wardMatch[2]);
    if (!village.wards.includes(ward)) return sendJson(res, 404, { error: "Ward not found." });
    if (store.contacts.some((contact) => contact.villageId === village.id && contact.ward === ward)) {
      return sendJson(res, 409, { error: "Move or remove this ward’s contacts before deleting the ward." });
    }
    village.wards = village.wards.filter((entry) => entry !== ward);
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/candidates" && req.method === "POST") {
    const body = await readBody(req);
    const name = cleanText(body.name, "Candidate name", 80);
    const village = findVillage(body.villageId);
    if (store.candidates.some((candidate) =>
      candidate.villageId === village.id && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )) {
      return sendJson(res, 409, { error: "That candidate is already on the list." });
    }
    if (store.candidates.filter((candidate) => candidate.villageId === village.id).length >= 50) {
      return sendJson(res, 400, { error: "A village survey can have at most 50 candidates." });
    }
    store.candidates.push({ id: crypto.randomUUID(), name, villageId: village.id });
    await saveStore();
    return sendJson(res, 201, { ok: true });
  }

  const candidateMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)$/);
  if (candidateMatch && req.method === "DELETE") {
    const id = decodeURIComponent(candidateMatch[1]);
    if (!store.candidates.some((candidate) => candidate.id === id)) {
      return sendJson(res, 404, { error: "Candidate not found." });
    }
    if (
      store.surveys.some((survey) => survey.candidateIds.includes(id)) ||
      store.contacts.some((contact) => contact.responses.some((response) => response.response === id))
    ) {
      return sendJson(res, 409, { error: "This candidate is used by a survey round or saved response and cannot be removed." });
    }
    store.candidates = store.candidates.filter((candidate) => candidate.id !== id);
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/contacts/import" && req.method === "POST") {
    const body = await readBody(req);
    if (!Array.isArray(body.contacts) || body.contacts.length < 1 || body.contacts.length > 5000) {
      return sendJson(res, 400, { error: "Upload between 1 and 5,000 contacts at a time." });
    }
    const village = findVillage(body.villageId);
    const imported = body.contacts.map((entry) => {
      return {
        name: typeof entry.name === "string" && entry.name.trim()
          ? cleanText(entry.name, "Contact name", 80)
          : "",
        phone: cleanPhone(entry.phone),
        villageId: village.id,
        ward: findWard(village, entry.ward),
      };
    });
    let added = 0;
    let updated = 0;
    for (const entry of imported) {
      const existing = store.contacts.find((contact) =>
        contact.phone === entry.phone && contact.villageId === entry.villageId,
      );
      if (existing) {
        Object.assign(existing, entry);
        updated++;
      } else {
        store.contacts.push({
          id: crypto.randomUUID(),
          ...entry,
          responses: [],
        });
        added++;
      }
    }
    await saveStore();
    return sendJson(res, 200, { added, updated });
  }

  if (url.pathname === "/api/contacts" && req.method === "POST") {
    const body = await readBody(req);
    const village = findVillage(body.villageId);
    const phone = cleanPhone(body.phone);
    if (store.contacts.some((contact) => contact.phone === phone && contact.villageId === village.id)) {
      return sendJson(res, 409, { error: "That phone number is already on this village’s survey list." });
    }
    const contact = {
      id: crypto.randomUUID(),
      name: typeof body.name === "string" && body.name.trim() ? cleanText(body.name, "Contact name", 80) : "",
      phone,
      villageId: village.id,
      ward: findWard(village, body.ward),
      responses: [],
    };
    store.contacts.push(contact);
    await saveStore();
    return sendJson(res, 201, { ok: true });
  }

  const contactMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)(?:\/response)?$/);
  if (contactMatch && req.method === "DELETE" && !url.pathname.endsWith("/response")) {
    const contact = findContact(decodeURIComponent(contactMatch[1]));
    store.contacts = store.contacts.filter((entry) => entry.id !== contact.id);
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  if (contactMatch && url.pathname.endsWith("/response") && req.method === "POST") {
    const contact = findContact(decodeURIComponent(contactMatch[1]));
    const body = await readBody(req);
    const response = body.response;
    const channel = body.channel;
    const survey = store.surveys.find((entry) =>
      entry.id === body.surveyId && entry.villageId === contact.villageId,
    );
    if (!survey) return sendJson(res, 400, { error: "Choose an active survey round for this village." });
    if (!["phone", "message", "voice"].includes(channel)) {
      return sendJson(res, 400, { error: "Choose phone call, text message, or spoken response." });
    }
    const isCandidate = typeof response === "string" && survey.candidateIds.includes(response);
    if (!isCandidate && !["undecided", "declined", "no-answer"].includes(response)) {
      return sendJson(res, 400, { error: "Choose a listed candidate or a valid survey outcome." });
    }
    const needsConsent = isCandidate || response === "undecided";
    if (needsConsent && body.consent !== true) {
      return sendJson(res, 400, { error: "The person must agree before their preference is recorded." });
    }
    const now = new Date().toISOString();
    const savedResponse = {
      surveyId: survey.id,
      response,
      channel,
      respondedAt: now,
      consentGiven: needsConsent,
      consentAt: needsConsent ? now : null,
    };
    const existingIndex = contact.responses.findIndex((entry) => entry.surveyId === survey.id);
    if (existingIndex < 0) contact.responses.push(savedResponse);
    else contact.responses[existingIndex] = savedResponse;
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "API route not found." });
}

const publicFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(DATA_DIR, 0o700);
  let data;
  try {
    data = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    data = { version: 4, villages: [], candidates: [], contacts: [], surveys: [], users: [], auth: null };
  }
  store = migrateStore(data);
  if (!store.auth) {
    let legacyAuth = null;
    try {
      legacyAuth = JSON.parse(await fs.readFile(AUTH_FILE, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (SESSION_SECRET && SESSION_SECRET.length < 32) {
      throw new Error("SESSION_SECRET must contain at least 32 characters.");
    }
    store.auth = {
      sessionSecret: legacyAuth?.sessionSecret || SESSION_SECRET || crypto.randomBytes(32).toString("base64url"),
      passwordHash: legacyAuth?.passwordHash || "",
      passwordSalt: legacyAuth?.passwordSalt || "",
      recoveryHash: legacyAuth?.recoveryHash || "",
      recoverySalt: legacyAuth?.recoverySalt || "",
    };
  }
  if (
    typeof store.auth.sessionSecret !== "string" ||
    store.auth.sessionSecret.length < 32 ||
    typeof store.auth.passwordHash !== "string" ||
    typeof store.auth.passwordSalt !== "string"
  ) {
    throw new Error("Admin authentication data in the local database is incomplete.");
  }
  if (ADMIN_PASSWORD && !store.auth.passwordHash) {
    if (ADMIN_PASSWORD.length < 12) {
      throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
    }
    setAdminPassword(ADMIN_PASSWORD);
  }
  store.auth = {
    ...store.auth,
    recoveryHash: typeof store.auth.recoveryHash === "string" ? store.auth.recoveryHash : "",
    recoverySalt: typeof store.auth.recoverySalt === "string" ? store.auth.recoverySalt : "",
  };
  await saveStore();
  await fs.chmod(DATA_FILE, 0o600);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(req, res, url);
      }
      const asset = publicFiles[url.pathname];
      if (!asset || req.method !== "GET") {
        return sendJson(res, 404, { error: "Page not found." });
      }
      const file = await fs.readFile(path.join(__dirname, asset[0]));
      res.writeHead(200, {
        "Content-Type": asset[1],
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "Referrer-Policy": "same-origin",
      });
      return res.end(file);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error.status || 500, {
          error: error.status ? error.message : "The request could not be completed.",
        });
      } else {
        res.destroy();
      }
      if (!error.status) console.error(error);
    }
  });

  server.listen(PORT, () => {
    console.log(`Voori Vijetha Evaru is listening on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Could not start the app:", error);
  process.exitCode = 1;
});
