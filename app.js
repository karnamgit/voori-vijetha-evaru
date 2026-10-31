const loginScreen = document.querySelector("#login-screen");
const appScreen = document.querySelector("#app-screen");
const setupForm = document.querySelector("#setup-form");
const loginForm = document.querySelector("#login-form");
const recoveryForm = document.querySelector("#recovery-form");
const loginError = document.querySelector("#login-error");
const toast = document.querySelector("#toast");
const responseDialog = document.querySelector("#response-dialog");
const responseForm = document.querySelector("#response-form");
const recoveryDialog = document.querySelector("#recovery-dialog");

let state = { villages: [], candidates: [], contacts: [], surveys: [], viewer: false };
let activeContactId = null;
let activeSurveyId = null;
const selectedContactIds = new Set();
let bulkNextIndex = { phone: 0, message: 0 };
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : {};
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getVillage(id) {
  return state.villages.find((village) => village.id === id);
}

function getContactCandidates(contact) {
  const survey = surveyForVillage(contact.villageId, activeSurveyId);
  return state.candidates.filter((candidate) => survey?.candidateIds.includes(candidate.id));
}

function responseLabel(response) {
  const candidate = state.candidates.find((entry) => entry.id === response);
  if (candidate) return candidate.name;
  return ({
    undecided: "Undecided",
    declined: "Declined",
    "no-answer": "No answer",
  })[response] || "Not contacted";
}

function responseChannelLabel(channel) {
  return ({
    phone: "Phone",
    message: "Message",
    voice: "Voice",
  })[channel] || "";
}

function getSurvey(surveyId) {
  return state.surveys.find((survey) => survey.id === surveyId);
}

function getSurveyResponse(contact, surveyId) {
  return contact.responses?.find((response) => response.surveyId === surveyId);
}

function surveyLabel(survey) {
  const date = new Date(survey.createdAt).toLocaleString();
  return `${survey.title} · ${date}`;
}

function setSelectOptions(select, options, placeholder, selectedValue) {
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options.map((option) =>
    `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
  ).join("");
  if (options.some((option) => option.value === selectedValue)) select.value = selectedValue;
}

function updateSurveyOptions(selector, villageId, placeholder, selectedValue, includeNone = false) {
  const select = document.querySelector(selector);
  const surveys = state.surveys
    .filter((survey) => survey.villageId === villageId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const options = surveys.map((survey) => ({ value: survey.id, label: surveyLabel(survey) }));
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options.map((option) =>
    `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
  ).join("");
  if (options.some((option) => option.value === selectedValue)) select.value = selectedValue;
  else if (!includeNone && options.length) select.value = options[0].value;
  select.disabled = options.length === 0;
  return select.value;
}

function renderSelectors() {
  const villageOptions = state.villages.map((village) => ({ value: village.id, label: village.name }));
  const villageSelects = ["#candidate-village", "#contact-village", "#csv-village", "#survey-village"];
  for (const selector of villageSelects) {
    const element = document.querySelector(selector);
    const previous = element.value;
    setSelectOptions(element, villageOptions, "Choose a village", previous);
    element.disabled = villageOptions.length === 0;
  }

  const villageFilter = document.querySelector("#village-filter");
  const previousVillageFilter = villageFilter.value;
  setSelectOptions(villageFilter, villageOptions, "Select a village", previousVillageFilter);

  const dashboardVillage = document.querySelector("#dashboard-village-filter");
  const previousDashboardVillage = dashboardVillage.value;
  setSelectOptions(dashboardVillage, villageOptions, "Select a village", previousDashboardVillage);

  const callVillageId = villageFilter.value;
  const callSurvey = updateSurveyOptions(
    "#call-survey-filter",
    callVillageId,
    "Select a survey",
    document.querySelector("#call-survey-filter").value,
  );
  activeSurveyId = callSurvey;
  updateSurveyOptions(
    "#dashboard-survey-filter",
    dashboardVillage.value,
    "Select a survey",
    document.querySelector("#dashboard-survey-filter").value,
  );
  updateSurveyOptions(
    "#compare-survey-filter",
    dashboardVillage.value,
    "No comparison",
    document.querySelector("#compare-survey-filter").value,
    true,
  );
  updateWardOptions("#contact-village", "#contact-ward", "Choose a ward");
  updateWardOptions("#village-filter", "#ward-filter", "All wards");
  updateWardOptions("#dashboard-village-filter", "#dashboard-ward-filter", "All wards");
  renderSurveyFormOptions();
}

function updateWardOptions(villageSelector, wardSelector, placeholder, allowAll = false) {
  const villageId = document.querySelector(villageSelector).value;
  let wards = [];
  if (villageId) {
    wards = getVillage(villageId)?.wards || [];
  } else if (allowAll) {
    wards = [...new Set(state.villages.flatMap((village) => village.wards))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }
  const select = document.querySelector(wardSelector);
  const previous = select.value;
  setSelectOptions(select, wards.map((ward) => ({ value: ward, label: `Ward ${ward}` })), placeholder, previous);
  select.disabled = wards.length === 0;
}

function renderVillages() {
  const list = document.querySelector("#village-list");
  if (!state.villages.length) {
    list.innerHTML = '<p class="field-help">Add a village to set up its wards, candidates and phone list.</p>';
    return;
  }
  list.innerHTML = state.villages.map((village) => `
    <article class="village-card">
      <div class="village-card-top">
        <strong>${escapeHtml(village.name)}</strong>
        <button class="delete-contact" type="button" data-delete-village="${escapeHtml(village.id)}" aria-label="Delete ${escapeHtml(village.name)}">×</button>
      </div>
      <div class="ward-chips">
        ${village.wards.map((ward) => `
          <span class="ward-chip">Ward ${escapeHtml(ward)}
            <button type="button" data-delete-ward-village="${escapeHtml(village.id)}" data-delete-ward="${escapeHtml(ward)}" aria-label="Delete ward ${escapeHtml(ward)}">×</button>
          </span>
        `).join("")}
      </div>
      <form class="add-ward-form" data-add-ward-village="${escapeHtml(village.id)}">
        <input name="name" maxlength="40" placeholder="Add ward" aria-label="New ward for ${escapeHtml(village.name)}" required>
        <button class="text-button" type="submit">+ Add ward</button>
      </form>
    </article>
  `).join("");
}

function renderCandidates() {
  const list = document.querySelector("#candidate-list");
  const villageId = document.querySelector("#candidate-village").value;
  const candidates = state.candidates.filter((candidate) =>
    villageId && (!candidate.villageId || candidate.villageId === villageId),
  );
  if (!candidates.length) {
    list.innerHTML = '<p class="field-help">Select a village and add its candidates.</p>';
    return;
  }
  list.innerHTML = candidates.map((candidate) => {
    const village = getVillage(candidate.villageId);
    return `
      <span class="candidate-chip">
        <span>${escapeHtml(candidate.name)}${village ? ` · ${escapeHtml(village.name)}` : ""}</span>
        <button type="button" data-remove-candidate="${escapeHtml(candidate.id)}" aria-label="Remove ${escapeHtml(candidate.name)}">×</button>
      </span>
    `;
  }).join("");
}

function renderSurveyFormOptions() {
  const villageId = document.querySelector("#survey-village").value;
  const candidates = state.candidates.filter((candidate) =>
    candidate.villageId === villageId || !candidate.villageId,
  );
  document.querySelector("#survey-candidate-options").innerHTML = candidates.length
    ? candidates.map((candidate) => `
      <label class="survey-candidate-option">
        <input type="checkbox" name="surveyCandidate" value="${escapeHtml(candidate.id)}">
        <span>${escapeHtml(candidate.name)}</span>
      </label>
    `).join("")
    : '<p class="field-help">Select a village with at least two candidates.</p>';
  const surveys = state.surveys.filter((survey) => survey.villageId === villageId);
  document.querySelector("#survey-list").innerHTML = surveys.length
    ? surveys.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((survey) => {
      const hasResponses = state.contacts.some((contact) =>
        contact.responses?.some((response) => response.surveyId === survey.id),
      );
      return `
        <div class="survey-list-item">
          <strong>${escapeHtml(survey.title)}</strong>
          <span>${escapeHtml(new Date(survey.createdAt).toLocaleString())} · ${survey.candidateIds.length} candidates</span>
          ${hasResponses
            ? "<small>Has saved responses</small>"
            : `<button class="delete-contact" type="button" data-delete-survey="${escapeHtml(survey.id)}" aria-label="Delete ${escapeHtml(survey.title)}">×</button>`}
        </div>
      `;
    }).join("")
    : '<p class="field-help">No survey rounds yet. Create one to start recording responses.</p>';
}

function renderResults() {
  const villageId = document.querySelector("#dashboard-village-filter").value;
  const wardFilter = document.querySelector("#dashboard-ward-filter").value;
  const surveyId = document.querySelector("#dashboard-survey-filter").value;
  const compareSurveyId = document.querySelector("#compare-survey-filter").value;
  const survey = getSurvey(surveyId);
  const compareSurvey = getSurvey(compareSurveyId);
  const village = getVillage(villageId);
  const resultContainer = document.querySelector("#candidate-results");
  const groups = [];
  if (state.viewer) {
    for (const result of state.results.filter((entry) =>
      entry.surveyId === surveyId && (!wardFilter || entry.ward === wardFilter),
    )) {
      if (result.suppressed) {
        groups.push(`<section class="ward-result-card"><div class="ward-result-heading"><h3>${escapeHtml(village?.name || "")} · Ward ${escapeHtml(result.ward)}</h3></div><p class="no-results">Results are hidden to protect privacy (fewer than 10 responses).</p></section>`);
        continue;
      }
      const currentResults = result.candidates || [];
      const previousResults = state.results.find((entry) =>
        entry.surveyId === compareSurveyId && entry.ward === result.ward,
      );
      groups.push(`
        <section class="ward-result-card">
          <div class="ward-result-heading">
            <h3>${escapeHtml(village?.name || "")} <span>· Ward ${escapeHtml(result.ward)}</span></h3>
            <span>${escapeHtml(result.sampleBand)} responses</span>
          </div>
          ${currentResults.map((item) => {
            const candidate = state.candidates.find((entry) => entry.id === item.candidateId);
            if (!candidate) return "";
            const priorShare = previousResults?.candidates?.find((entry) => entry.candidateId === item.candidateId)?.share;
            return `
              <div class="result-row">
                <div class="result-top">
                  <span class="result-name">${escapeHtml(candidate.name)}</span>
                  <span class="result-value">${item.share}%${priorShare !== undefined ? ` · ${priorShare}% prior` : ""}</span>
                </div>
                <svg class="result-track" viewBox="0 0 100 7" preserveAspectRatio="none" role="progressbar" aria-label="${escapeHtml(candidate.name)} preference in Ward ${escapeHtml(result.ward)}" aria-valuenow="${item.share}" aria-valuemin="0" aria-valuemax="100">
                  <rect class="result-fill" x="0" y="0" width="${item.share}" height="7" rx="3.5"></rect>
                </svg>
              </div>
            `;
          }).join("")}
        </section>
      `);
    }
  } else if (survey && village) {
    for (const ward of village.wards.filter((entry) => !wardFilter || entry === wardFilter)) {
      const contacts = state.contacts.filter((contact) =>
        contact.villageId === village.id && contact.ward === ward,
      );
      const candidateResponses = contacts.flatMap((contact) => {
        const answer = getSurveyResponse(contact, survey.id);
        return answer && survey.candidateIds.includes(answer.response) ? [{ contact, answer }] : [];
      });
      const total = candidateResponses.length;
      const previousResponses = compareSurvey?.villageId === village.id
        ? contacts.flatMap((contact) => {
          const answer = getSurveyResponse(contact, compareSurvey.id);
          return answer && compareSurvey.candidateIds.includes(answer.response) ? [{ contact, answer }] : [];
        })
        : [];
      groups.push(`
        <section class="ward-result-card">
          <div class="ward-result-heading">
            <h3>${escapeHtml(village.name)} <span>· Ward ${escapeHtml(ward)}</span></h3>
            <span>${total} ${total === 1 ? "preference" : "preferences"}</span>
          </div>
          ${survey.candidateIds.map((candidateId) => {
            const candidate = state.candidates.find((entry) => entry.id === candidateId);
            if (!candidate) return "";
            const count = candidateResponses.filter(({ answer }) => answer.response === candidateId).length;
            const share = total ? Math.round((count / total) * 100) : 0;
            const priorTotal = previousResponses.length;
            const priorCount = previousResponses.filter(({ answer }) => answer.response === candidateId).length;
            const priorShare = priorTotal ? Math.round((priorCount / priorTotal) * 100) : null;
            const change = priorShare === null ? "" : ` · ${priorShare}% prior (${share - priorShare > 0 ? "+" : ""}${share - priorShare} pp)`;
            return `
              <div class="result-row">
                <div class="result-top">
                  <span class="result-name">${escapeHtml(candidate.name)}</span>
                  <span class="result-value">${count} · ${share}%${change}</span>
                </div>
                <svg class="result-track" viewBox="0 0 100 7" preserveAspectRatio="none" role="progressbar" aria-label="${escapeHtml(candidate.name)} preference in ${escapeHtml(village.name)} Ward ${escapeHtml(ward)}" aria-valuenow="${share}" aria-valuemin="0" aria-valuemax="100">
                  <rect class="result-fill" x="0" y="0" width="${share}" height="7" rx="3.5"></rect>
                </svg>
              </div>
            `;
          }).join("")}
        </section>
      `);
    }
  }
  resultContainer.innerHTML = groups.length
    ? groups.join("")
    : `<p class="no-results">${!villageId ? "Select a village to see its survey rounds." : !surveyId ? "Create a survey round for this village, then choose it above." : "No results are available for this survey yet."}</p>`;
  const villageLabel = villageId ? village?.name : "Choose a village";
  const surveyLabelText = survey ? survey.title : "Choose a survey";
  document.querySelector(".snapshot-label").innerHTML =
    `<span class="status-dot"></span> ${escapeHtml(villageLabel || "Choose a village")} · ${escapeHtml(surveyLabelText)}${wardFilter ? ` · Ward ${escapeHtml(wardFilter)}` : ""}`;
  const latestSurveyByVillage = new Map();
  for (const entry of state.surveys) {
    const existing = latestSurveyByVillage.get(entry.villageId);
    if (!existing || entry.createdAt > existing.createdAt) latestSurveyByVillage.set(entry.villageId, entry);
  }
  const statSurveys = survey ? [survey] : [...latestSurveyByVillage.values()];
  const statAnswers = state.contacts.flatMap((contact) => {
    if (
      (villageId && contact.villageId !== villageId) ||
      (wardFilter && contact.ward !== wardFilter)
    ) return [];
    const statSurvey = statSurveys.find((entry) => entry.villageId === contact.villageId);
    if (!statSurvey) return [];
    const answer = getSurveyResponse(contact, statSurvey.id);
    return answer && statSurvey.candidateIds.includes(answer.response)
      ? [{ candidateId: answer.response }]
      : [];
  });
  const candidateIds = [...new Set(statAnswers.map((answer) => answer.candidateId))];
  const counts = candidateIds.map((candidateId) => ({
    candidate: state.candidates.find((entry) => entry.id === candidateId),
    count: statAnswers.filter((answer) => answer.candidateId === candidateId).length,
  })).filter((entry) => entry.candidate);
  const leader = [...counts].sort((a, b) => b.count - a.count)[0];
  document.querySelector("#leading-candidate").textContent = leader?.count ? leader.candidate.name : "—";
  document.querySelector("#leading-share").textContent = statAnswers.length
    ? `${leader.count} of ${statAnswers.length} named preferences`
    : "No preferences yet";
}

function renderPeople() {
  const savedContactIds = new Set(state.contacts.map((contact) => contact.id));
  for (const contactId of selectedContactIds) {
    if (!savedContactIds.has(contactId)) selectedContactIds.delete(contactId);
  }
  const villageId = document.querySelector("#village-filter").value;
  const ward = document.querySelector("#ward-filter").value;
  const surveyId = document.querySelector("#call-survey-filter").value;
  const query = document.querySelector("#people-search").value.trim().toLocaleLowerCase();
  const contacts = villageId ? state.contacts.filter((contact) => {
    const village = getVillage(contact.villageId);
    const searchable = `${contact.name} ${contact.phone} ${village?.name || ""} ${contact.ward}`.toLocaleLowerCase();
    return (!villageId || contact.villageId === villageId) &&
      (!ward || contact.ward === ward) &&
      (!query || searchable.includes(query));
  }) : [];
  const table = document.querySelector("#people-table");
  document.querySelector("#people-list-content").hidden = !villageId;
  document.querySelector("#choose-village-prompt").hidden = Boolean(villageId);
  document.querySelector("#empty-people").hidden = contacts.length > 0;
  document.querySelector("#empty-people").querySelector("strong").textContent =
    state.contacts.some((contact) => contact.villageId === villageId)
      ? "No phone numbers match this filter"
      : "No phone numbers for this village yet";
  table.innerHTML = contacts.map((contact) => {
    const savedResponse = getSurveyResponse(contact, surveyId);
    const response = savedResponse?.response;
    const village = getVillage(contact.villageId);
    const responseClass = response && response !== "no-answer" ? "answered" : "";
    return `
      <tr>
        <td><label class="contact-select-label"><input type="checkbox" data-select-contact="${escapeHtml(contact.id)}" ${selectedContactIds.has(contact.id) ? "checked" : ""} aria-label="Select ${escapeHtml(contact.name || contact.phone)}"><span class="person-name">${escapeHtml(contact.name || "Resident")}</span></label><span class="person-phone">${escapeHtml(contact.phone)}</span></td>
        <td>${escapeHtml(village?.name || "Unknown village")}<span class="ward-secondary">Ward ${escapeHtml(contact.ward)}</span></td>
        <td><span class="response-pill ${responseClass}">${escapeHtml(responseLabel(response))}${savedResponse?.channel ? `<small>${escapeHtml(responseChannelLabel(savedResponse.channel))}</small>` : ""}</span></td>
        <td>
          <div class="contact-actions">
            <a class="button button-outline table-action call-action" href="tel:${escapeHtml(contact.phone)}" aria-label="Call ${escapeHtml(contact.name || contact.phone)} using the phone app"><span aria-hidden="true">☎</span> Call</a>
            <a class="button button-outline table-action message-action" href="sms:${escapeHtml(contact.phone)}?body=${encodeURIComponent("నమస్కారం. ఈ ఎన్నికల్లో మీరు ఎవరికి ఓటు వేయాలని అనుకుంటున్నారు? మీ సమాధానం సందేశంగా పంపండి.")}" aria-label="Draft a text message to ${escapeHtml(contact.name || contact.phone)}"><span aria-hidden="true">✉</span> Message</a>
          </div>
        </td>
        <td><button class="button button-outline table-action" type="button" data-record="${escapeHtml(contact.id)}" ${surveyId ? "" : "disabled"}>${response ? "Update" : "Record"}</button></td>
        <td><button class="delete-contact" type="button" data-delete-contact="${escapeHtml(contact.id)}" aria-label="Remove ${escapeHtml(contact.name || contact.phone)}">×</button></td>
      </tr>
    `;
  }).join("");
  if (villageId && contacts.length === 0 && state.contacts.some((contact) => contact.villageId === villageId)) {
    table.innerHTML = '<tr><td colspan="6" class="muted">No people match this search.</td></tr>';
  }
  const visibleIds = contacts.map((contact) => contact.id);
  const selectedVisible = visibleIds.filter((id) => selectedContactIds.has(id)).length;
  const selectVisible = document.querySelector("#select-visible-contacts");
  selectVisible.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  selectVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  document.querySelector("#selected-count").textContent = `${selectedContactIds.size} selected`;
  document.querySelector("#call-next-selected").disabled = selectedContactIds.size === 0;
  document.querySelector("#message-next-selected").disabled = selectedContactIds.size === 0;
  document.querySelector("#clear-contact-selection").disabled = selectedContactIds.size === 0;
}

function selectTab(name) {
  for (const button of document.querySelectorAll(".primary-tab")) {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.id !== `tab-${name}`;
  }
  if (name === "calls") renderPeople();
  if (name === "results") renderResults();
}

function applyRoleUi() {
  const viewer = Boolean(state.viewer);
  document.querySelectorAll(".primary-tab").forEach((button) => {
    button.hidden = viewer && button.dataset.tab !== "results";
  });
  document.querySelector("#recovery-settings").hidden = viewer;
  document.querySelector("#role-label").innerHTML =
    `<span class="status-dot"></span> ${viewer ? "Approved viewer · masked results" : "Admin view"}`;
  if (viewer) selectTab("results");
}

function render() {
  renderSelectors();
  renderVillages();
  renderCandidates();
  const latestSurveyByVillage = new Map();
  for (const survey of state.surveys) {
    const existing = latestSurveyByVillage.get(survey.villageId);
    if (!existing || survey.createdAt > existing.createdAt) latestSurveyByVillage.set(survey.villageId, survey);
  }
  const latestResponses = state.contacts.flatMap((contact) => {
    const survey = latestSurveyByVillage.get(contact.villageId);
    return survey ? [{ contact, response: getSurveyResponse(contact, survey.id) }] : [];
  });
  const answered = latestResponses.filter(({ response, contact }) =>
    response && (
      response.response === "undecided" ||
      response.response === "declined" ||
      surveyForVillage(contact.villageId, response.surveyId)?.candidateIds.includes(response.response)
    ),
  ).length;
  const pending = latestResponses.filter(({ response }) => !response || response.response === "no-answer").length;
  const rate = state.contacts.length ? Math.round((answered / state.contacts.length) * 100) : 0;
  document.querySelector("#total-count").textContent = state.contacts.length;
  document.querySelector("#response-count").textContent = answered;
  document.querySelector("#response-rate").textContent = `${rate}% of your list`;
  document.querySelector("#pending-count").textContent = pending;
  document.querySelector("#recovery-settings").textContent =
    state.auth?.recoveryConfigured ? "Admin & recovery" : "Set recovery code";
  renderSurveyFormOptions();
  renderResults();
  renderPeople();
}

function surveyForVillage(villageId, surveyId) {
  const survey = getSurvey(surveyId);
  return survey?.villageId === villageId ? survey : null;
}

async function refreshData() {
  state = await api("/api/data");
  state.contacts ||= [];
  state.surveys ||= [];
  applyRoleUi();
  render();
}

function showApp() {
  loginScreen.hidden = true;
  setupForm.hidden = true;
  loginForm.hidden = true;
  recoveryForm.hidden = true;
  appScreen.hidden = false;
  refreshData().catch((error) => showToast(error.message));
}

function showRecoveryCode(
  code,
  title = "Save your recovery code",
  copy = "Keep this code somewhere private. It can reset your admin password if you forget it.",
) {
  document.querySelector("#recovery-dialog-title").textContent = title;
  document.querySelector("#recovery-dialog-copy").textContent = copy;
  document.querySelector("#recovery-code-display").textContent = code;
  document.querySelector("#recovery-dialog-status").textContent = "";
  recoveryDialog.showModal();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const submit = loginForm.querySelector("button");
  submit.disabled = true;
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: new FormData(loginForm).get("password") }),
    });
    loginForm.reset();
    showApp();
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#setup-error");
  errorElement.textContent = "";
  const password = document.querySelector("#setup-password").value;
  const confirmation = document.querySelector("#setup-password-confirm").value;
  if (password.length < 12) {
    errorElement.textContent = "Choose a password with at least 12 characters.";
    return;
  }
  if (password !== confirmation) {
    errorElement.textContent = "The passwords do not match.";
    return;
  }
  const submit = setupForm.querySelector("button");
  submit.disabled = true;
  try {
    const result = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setupForm.reset();
    showApp();
    showRecoveryCode(result.recoveryCode);
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#show-recovery").addEventListener("click", () => {
  loginForm.hidden = true;
  recoveryForm.hidden = false;
});

document.querySelector("#back-to-login").addEventListener("click", () => {
  recoveryForm.reset();
  recoveryForm.hidden = true;
  loginForm.hidden = false;
});

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#recovery-error");
  errorElement.textContent = "";
  const password = document.querySelector("#recovery-password").value;
  if (password !== document.querySelector("#recovery-password-confirm").value) {
    errorElement.textContent = "The new passwords do not match.";
    return;
  }
  const submit = recoveryForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const result = await api("/api/recover", {
      method: "POST",
      body: JSON.stringify({
        recoveryCode: document.querySelector("#recovery-code").value.trim(),
        password,
      }),
    });
    recoveryForm.reset();
    showApp();
    showRecoveryCode(
      result.recoveryCode,
      "Password reset. Save your new recovery code",
      "Your old recovery code is no longer valid. Keep this replacement somewhere private.",
    );
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

async function loadAccessRequests() {
  const container = document.querySelector("#access-request-list");
  try {
    const result = await api("/api/access-requests");
    container.innerHTML = result.users.length
      ? result.users.map((user) => `
        <article class="access-request">
          <div><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)}</span><small>${escapeHtml(user.status)} · ${escapeHtml(new Date(user.createdAt).toLocaleString())}</small></div>
          ${user.status === "pending"
            ? `<div class="access-request-actions"><button class="button button-outline" type="button" data-review-user="${escapeHtml(user.id)}" data-review-status="rejected">Reject</button><button class="button button-primary" type="button" data-review-user="${escapeHtml(user.id)}" data-review-status="approved">Approve</button></div>`
            : user.status === "approved"
              ? `<div class="access-request-actions"><button class="button button-outline" type="button" data-review-user="${escapeHtml(user.id)}" data-review-status="rejected">Revoke</button></div>`
              : ""}
        </article>
      `).join("")
      : '<p class="field-help">No Google access requests yet.</p>';
  } catch (error) {
    container.textContent = error.message;
  }
}

document.querySelector("#access-request-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review-user]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/access-requests/${encodeURIComponent(button.dataset.reviewUser)}`, {
      method: "POST",
      body: JSON.stringify({ status: button.dataset.reviewStatus }),
    });
    await loadAccessRequests();
    showToast(button.dataset.reviewStatus === "approved" ? "Viewer approved." : "Access request rejected.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

document.querySelector("#recovery-settings").addEventListener("click", async () => {
  document.querySelector("#admin-dialog").showModal();
  await loadAccessRequests();
});

async function rotateRecoveryCode() {
  if (!window.confirm("Create a new recovery code? Any previous recovery code will stop working.")) return;
  try {
    const result = await api("/api/recovery-code", { method: "POST", body: "{}" });
    showRecoveryCode(
      result.recoveryCode,
      "Save your new recovery code",
      "Your previous recovery code is no longer valid. Keep this new code somewhere private.",
    );
    await refreshData();
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#rotate-recovery-code").addEventListener("click", rotateRecoveryCode);
document.querySelector("#close-admin-dialog").addEventListener("click", () => document.querySelector("#admin-dialog").close());
document.querySelector("#close-admin-dialog-done").addEventListener("click", () => document.querySelector("#admin-dialog").close());

document.querySelector("#copy-recovery-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector("#recovery-code-display").textContent);
    document.querySelector("#recovery-dialog-status").textContent = "Recovery code copied.";
  } catch {
    document.querySelector("#recovery-dialog-status").textContent = "Copy is unavailable. Select and copy the code above.";
  }
});
document.querySelector("#close-recovery-dialog").addEventListener("click", () => recoveryDialog.close());
document.querySelector("#done-recovery-code").addEventListener("click", () => recoveryDialog.close());

for (const button of document.querySelectorAll(".primary-tab, [data-open-tab]")) {
  button.addEventListener("click", () => selectTab(button.dataset.tab || button.dataset.openTab));
}

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    appScreen.hidden = true;
    loginScreen.hidden = false;
    loginForm.hidden = false;
    setupForm.hidden = true;
    recoveryForm.hidden = true;
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#village-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const wards = document.querySelector("#village-wards").value.split(",").map((ward) => ward.trim()).filter(Boolean);
  try {
    await api("/api/villages", {
      method: "POST",
      body: JSON.stringify({ name: document.querySelector("#village-name").value, wards }),
    });
    event.target.reset();
    await refreshData();
    showToast("Village and wards added.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#village-list").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-add-ward-village]");
  if (!form) return;
  event.preventDefault();
  const name = new FormData(form).get("name");
  try {
    await api(`/api/villages/${encodeURIComponent(form.dataset.addWardVillage)}/wards`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    await refreshData();
    showToast("Ward added.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#village-list").addEventListener("click", async (event) => {
  const deleteWardButton = event.target.closest("[data-delete-ward-village]");
  const deleteVillageButton = event.target.closest("[data-delete-village]");
  if (!deleteWardButton && !deleteVillageButton) return;
  const button = deleteWardButton || deleteVillageButton;
  const villageId = deleteWardButton
    ? deleteWardButton.dataset.deleteWardVillage
    : deleteVillageButton.dataset.deleteVillage;
  const path = deleteWardButton
    ? `/api/villages/${encodeURIComponent(villageId)}/wards/${encodeURIComponent(deleteWardButton.dataset.deleteWard)}`
    : `/api/villages/${encodeURIComponent(villageId)}`;
  if (!window.confirm(deleteWardButton ? "Delete this ward?" : "Delete this village?")) return;
  button.disabled = true;
  try {
    await api(path, { method: "DELETE" });
    await refreshData();
    showToast(deleteWardButton ? "Ward deleted." : "Village deleted.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

document.querySelector("#candidate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#candidate-name");
  try {
    await api("/api/candidates", {
      method: "POST",
      body: JSON.stringify({
        name: input.value,
        villageId: document.querySelector("#candidate-village").value,
      }),
    });
    input.value = "";
    await refreshData();
    showToast("Candidate added.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#candidate-village").addEventListener("change", renderCandidates);

document.querySelector("#survey-village").addEventListener("change", renderSurveyFormOptions);

document.querySelector("#survey-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidateIds = [...document.querySelectorAll('input[name="surveyCandidate"]:checked')]
    .map((input) => input.value);
  if (candidateIds.length < 2) {
    showToast("Select at least two candidates for this survey round.");
    return;
  }
  try {
    await api("/api/surveys", {
      method: "POST",
      body: JSON.stringify({
        villageId: document.querySelector("#survey-village").value,
        title: document.querySelector("#survey-title").value,
        candidateIds,
      }),
    });
    document.querySelector("#survey-title").value = "";
    await refreshData();
    showToast("Survey round created. Its responses will be tracked separately.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#survey-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-survey]");
  if (!button || !window.confirm("Delete this survey round?")) return;
  button.disabled = true;
  try {
    await api(`/api/surveys/${encodeURIComponent(button.dataset.deleteSurvey)}`, { method: "DELETE" });
    await refreshData();
    showToast("Survey round deleted.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

document.querySelector("#candidate-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-candidate]");
  if (!button || !window.confirm("Delete this candidate?")) return;
  button.disabled = true;
  try {
    await api(`/api/candidates/${encodeURIComponent(button.dataset.removeCandidate)}`, { method: "DELETE" });
    await refreshData();
    showToast("Candidate deleted.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

function updateContactWardOptions() {
  updateWardOptions("#contact-village", "#contact-ward", "Choose a ward");
}

document.querySelector("#contact-village").addEventListener("change", updateContactWardOptions);

document.querySelector("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#contact-name").value,
        phone: document.querySelector("#contact-phone").value,
        villageId: document.querySelector("#contact-village").value,
        ward: document.querySelector("#contact-ward").value,
      }),
    });
    form.reset();
    await refreshData();
    showToast("Phone number added.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#download-template").addEventListener("click", () => {
  const template = "name,phone,ward\nRavi,+919876543210,1\nSita,+919876543211,2\n";
  const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "village-survey-template.csv";
  link.click();
  URL.revokeObjectURL(url);
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && text[index + 1] === "\n") index++;
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one contact.");
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase());
  const missing = ["phone", "ward"].filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Missing CSV column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  return rows.map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    return { name: record.name || "", phone: record.phone || "", ward: record.ward || "" };
  });
}

document.querySelector("#csv-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const message = document.querySelector("#upload-message");
  message.textContent = `Reading ${file.name}…`;
  try {
    const villageId = document.querySelector("#csv-village").value;
    if (!villageId) throw new Error("Choose a village before importing its contact list.");
    const contacts = parseCsv(await file.text());
    const result = await api("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({ villageId, contacts }),
    });
    await refreshData();
    message.textContent = `${result.added} added · ${result.updated} updated.`;
    showToast("Village contact list imported.");
  } catch (error) {
    message.textContent = error.message;
    showToast(error.message);
  } finally {
    event.target.value = "";
  }
});

function openResponseDialog(contactId) {
  const contact = state.contacts.find((entry) => entry.id === contactId);
  if (!contact || !getSurvey(activeSurveyId)) return;
  activeContactId = contactId;
  const village = getVillage(contact.villageId);
  document.querySelector("#dialog-contact-name").textContent = contact.name || contact.phone;
  document.querySelector("#dialog-contact-meta").textContent =
    `${contact.phone} · ${village?.name || "Unknown village"} · Ward ${contact.ward}`;
  const candidates = getContactCandidates(contact);
  document.querySelector("#response-choice").innerHTML = `
    <option value="">Choose an answer</option>
    ${candidates.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</option>`).join("")}
    <option value="undecided">Undecided</option>
    <option value="declined">Declined to share</option>
    <option value="no-answer">No answer</option>
  `;
  const savedResponse = getSurveyResponse(contact, activeSurveyId);
  document.querySelector("#response-choice").value = savedResponse?.response || "";
  document.querySelector("#response-channel").value = savedResponse?.channel || "phone";
  document.querySelector("#response-consent").checked = false;
  document.querySelector("#consent-label").hidden = false;
  document.querySelector("#dialog-error").textContent = "";
  document.querySelector("#dialog-voice-status").textContent =
    "Or choose the answer below. The person must agree before a preference is saved.";
  responseDialog.showModal();
}

document.querySelector("#people-table").addEventListener("click", async (event) => {
  const recordButton = event.target.closest("[data-record]");
  if (recordButton) return openResponseDialog(recordButton.dataset.record);
  const deleteButton = event.target.closest("[data-delete-contact]");
  if (!deleteButton || !window.confirm("Remove this phone number from the survey?")) return;
  deleteButton.disabled = true;
  try {
    await api(`/api/contacts/${encodeURIComponent(deleteButton.dataset.deleteContact)}`, { method: "DELETE" });
    await refreshData();
    showToast("Phone number deleted.");
  } catch (error) {
    showToast(error.message);
    deleteButton.disabled = false;
  }
});

document.querySelector("#people-table").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-contact]");
  if (!checkbox) return;
  if (checkbox.checked) selectedContactIds.add(checkbox.dataset.selectContact);
  else selectedContactIds.delete(checkbox.dataset.selectContact);
  bulkNextIndex = { phone: 0, message: 0 };
  renderPeople();
});

document.querySelector("#select-visible-contacts").addEventListener("change", (event) => {
  for (const checkbox of document.querySelectorAll("#people-table [data-select-contact]")) {
    if (event.target.checked) selectedContactIds.add(checkbox.dataset.selectContact);
    else selectedContactIds.delete(checkbox.dataset.selectContact);
  }
  bulkNextIndex = { phone: 0, message: 0 };
  renderPeople();
});

document.querySelector("#clear-contact-selection").addEventListener("click", () => {
  selectedContactIds.clear();
  bulkNextIndex = { phone: 0, message: 0 };
  renderPeople();
});

function openNextSelectedContact(channel) {
  const villageId = document.querySelector("#village-filter").value;
  const ward = document.querySelector("#ward-filter").value;
  const selected = state.contacts.filter((contact) =>
    selectedContactIds.has(contact.id) &&
    contact.villageId === villageId &&
    (!ward || contact.ward === ward),
  );
  if (!selected.length) {
    showToast("Select contacts in the current village and ward first.");
    return;
  }
  const queueKey = channel === "phone" ? "phone" : "message";
  if (bulkNextIndex[queueKey] >= selected.length) {
    showToast(`All selected ${channel === "phone" ? "calls" : "messages"} were opened. Clear or change selection to start again.`);
    return;
  }
  const contact = selected[bulkNextIndex[queueKey]];
  bulkNextIndex[queueKey]++;
  const link = document.createElement("a");
  link.href = channel === "phone"
    ? `tel:${contact.phone}`
    : `sms:${contact.phone}?body=${encodeURIComponent("నమస్కారం. ఈ ఎన్నికల్లో మీరు ఎవరికి ఓటు వేయాలని అనుకుంటున్నారు? మీ సమాధానం సందేశంగా పంపండి.")}`;
  link.rel = "noreferrer";
  document.body.append(link);
  link.click();
  link.remove();
  showToast(`${channel === "phone" ? "Call" : "Message draft"} opened for ${contact.name || contact.phone}. Select the next person after finishing.`);
}

document.querySelector("#call-next-selected").addEventListener("click", () => openNextSelectedContact("phone"));
document.querySelector("#message-next-selected").addEventListener("click", () => openNextSelectedContact("message"));

responseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = document.querySelector("#response-choice").value;
  const consent = document.querySelector("#response-consent").checked;
  const errorElement = document.querySelector("#dialog-error");
  errorElement.textContent = "";
  if (!response) {
    errorElement.textContent = "Choose a response first.";
    return;
  }
  if ((getContactCandidates(state.contacts.find((contact) => contact.id === activeContactId) || {}).some(
    (candidate) => candidate.id === response,
  ) || response === "undecided") && !consent) {
    errorElement.textContent = "Please confirm the person agreed to share their preference.";
    return;
  }
  try {
    await api(`/api/contacts/${encodeURIComponent(activeContactId)}/response`, {
      method: "POST",
      body: JSON.stringify({
        response,
        consent,
        channel: document.querySelector("#response-channel").value,
        surveyId: activeSurveyId,
      }),
    });
    responseDialog.close();
    await refreshData();
    showToast("Response saved.");
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

document.querySelector("#cancel-response").addEventListener("click", () => responseDialog.close());
document.querySelector("#close-dialog").addEventListener("click", () => responseDialog.close());

document.querySelector("#village-filter").addEventListener("change", () => {
  selectedContactIds.clear();
  bulkNextIndex = { phone: 0, message: 0 };
  activeSurveyId = updateSurveyOptions(
    "#call-survey-filter",
    document.querySelector("#village-filter").value,
    "Select a survey",
    "",
  );
  updateWardOptions("#village-filter", "#ward-filter", "All wards");
  renderPeople();
});
document.querySelector("#call-survey-filter").addEventListener("change", (event) => {
  activeSurveyId = event.target.value;
  renderPeople();
});
document.querySelector("#ward-filter").addEventListener("change", renderPeople);
document.querySelector("#people-search").addEventListener("input", renderPeople);
document.querySelector("#dashboard-village-filter").addEventListener("change", () => {
  updateSurveyOptions(
    "#dashboard-survey-filter",
    document.querySelector("#dashboard-village-filter").value,
    "Select a survey",
    "",
  );
  updateSurveyOptions(
    "#compare-survey-filter",
    document.querySelector("#dashboard-village-filter").value,
    "No comparison",
    "",
    true,
  );
  updateWardOptions("#dashboard-village-filter", "#dashboard-ward-filter", "All wards");
  renderResults();
});
document.querySelector("#dashboard-survey-filter").addEventListener("change", renderResults);
document.querySelector("#compare-survey-filter").addEventListener("change", renderResults);
document.querySelector("#dashboard-ward-filter").addEventListener("change", renderResults);

document.querySelector("#speak-question").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    return showToast("Telugu voice playback is not supported in this browser.");
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance("ఈ ఎన్నికల్లో మీరు ఎవరికి ఓటు వేయాలని అనుకుంటున్నారు?");
  utterance.lang = "te-IN";
  window.speechSynthesis.speak(utterance);
  document.querySelector("#voice-status").textContent = "Playing the question in Telugu.";
});

document.querySelector("#voice-answer").addEventListener("click", () => {
  showToast("Open a person’s Record form to capture and confirm their spoken answer.");
});

document.querySelector("#dialog-voice-answer").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.querySelector("#dialog-voice-status").textContent =
      "Voice recognition is not available here. Choose the answer from the list instead.";
    return;
  }
  const contact = state.contacts.find((entry) => entry.id === activeContactId);
  const candidates = contact ? getContactCandidates(contact) : [];
  if (!candidates.length) {
    document.querySelector("#dialog-voice-status").textContent = "Add candidates for this village before recording an answer.";
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "te-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  const voiceStatus = document.querySelector("#dialog-voice-status");
  voiceStatus.textContent = "Listening… Ask the person to say a candidate’s name.";
  recognition.onresult = (event) => {
    const normalizeSpeech = (value) => value
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    const transcript = normalizeSpeech(event.results[0][0].transcript);
    const exactMatches = candidates.filter((candidate) => normalizeSpeech(candidate.name) === transcript);
    const phraseMatches = candidates.filter((candidate) =>
      ` ${transcript} `.includes(` ${normalizeSpeech(candidate.name)} `),
    );
    const matches = exactMatches.length ? exactMatches : phraseMatches;
    if (!transcript || matches.length !== 1) {
      voiceStatus.textContent = matches.length > 1
        ? `Heard “${transcript}”. More than one candidate could match; choose manually.`
        : `Heard “${transcript}”. Please confirm the answer in the response form.`;
      return;
    }
    document.querySelector("#response-choice").value = matches[0].id;
    document.querySelector("#response-channel").value = "voice";
    document.querySelector("#response-consent").checked = false;
    voiceStatus.textContent = `Heard “${transcript}”. Confirm the candidate and consent before saving.`;
  };
  recognition.onerror = (event) => {
    voiceStatus.textContent = `Voice recognition stopped (${event.error}). Choose the response manually.`;
  };
  recognition.onend = () => {
    if (voiceStatus.textContent === "Listening… Ask the person to say a candidate’s name.") {
      voiceStatus.textContent = "No speech was captured. Choose the answer manually.";
    }
  };
  try {
    recognition.start();
  } catch {
    voiceStatus.textContent = "Could not start the microphone. Check its permission and try again.";
  }
});

document.querySelector("#response-choice").addEventListener("change", (event) => {
  document.querySelector("#consent-label").hidden =
    event.target.value === "declined" || event.target.value === "no-answer";
});

async function initialize() {
  try {
    const result = await api("/api/me");
    document.querySelector("#google-login").hidden = !result.googleEnabled;
    if (result.authenticated) showApp();
    else if (result.needsSetup) setupForm.hidden = false;
    else loginForm.hidden = false;
    const access = new URLSearchParams(window.location.search).get("access");
    if (access === "pending" || access === "denied") {
      const status = document.querySelector("#access-status");
      status.hidden = false;
      status.textContent = access === "pending"
        ? "Your request is waiting for admin approval. Sign in with Google again after you are approved."
        : "Your request was not approved. Contact the survey admin if you think this is an error.";
    }
  } catch {
    loginForm.hidden = false;
    loginError.textContent = "Could not connect to the survey server. Refresh the page to try again.";
  }
}

initialize();
