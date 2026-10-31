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

let state = { villages: [], candidates: [], contacts: [], surveys: [], questionTemplates: [], viewer: false };
let activeContactId = null;
let activeSurveyId = null;
const selectedContactIds = new Set();
let outreachQueueIndex = 0;
let toastTimer;
let teluguVoices = [];
let voiceRecorder = null;
let voiceStream = null;
let voiceRecordingChunks = [];

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

function villageNameLabel(village) {
  return village.name;
}

function villageLocationEntries(village) {
  return [
    ["Mandal", village.mandal],
    ["District", village.district],
    ["State", village.state],
    ["Country", village.country],
  ].filter(([, value]) => value);
}

function villageLocationLabel(village) {
  return villageLocationEntries(village)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" · ");
}

function villageLocationMarkup(village) {
  const location = villageLocationLabel(village);
  return location ? `<small class="village-location-meta">${escapeHtml(location)}</small>` : "";
}

function villageSearchText(village) {
  return [village.name, village.mandal, village.district, village.state, village.country]
    .filter(Boolean).join(" ").toLocaleLowerCase();
}

const villagePickerSelectors = [
  "#candidate-village",
  "#contact-village",
  "#contact-edit-village",
  "#csv-village",
  "#survey-village",
  "#village-filter",
  "#dashboard-village-filter",
];
const expandedVillagePickerSelectors = new Set([
  "#candidate-village",
  "#contact-village",
  "#contact-edit-village",
  "#csv-village",
  "#survey-village",
]);
const locationFilterFields = [
  ["country", "Country"],
  ["state", "State"],
  ["district", "District"],
  ["mandal", "Mandal"],
];

function ensureVillagePickerControls(select) {
  if (select.dataset.villagePicker === "true") return;
  select.dataset.villagePicker = "true";
  const control = document.createElement("div");
  control.className = "village-picker-control";
  control.dataset.villagePickerOwner = select.id;
  control.innerHTML = `
    <details class="village-picker-filters" ${expandedVillagePickerSelectors.has(`#${select.id}`) ? "open" : ""}>
      <summary>Filter villages by location <span>Optional</span></summary>
      <div class="village-picker-filter-fields">
        ${locationFilterFields.map(([key, label]) => `
          <label>${label}<select data-location-filter="${key}" aria-label="Filter villages by ${label.toLowerCase()}"></select></label>
        `).join("")}
        <button class="text-button" type="button" data-clear-location-filter>Clear location filters</button>
      </div>
    </details>
    <small class="village-picker-location" data-selected-village-location></small>
  `;
  select.insertAdjacentElement("afterend", control);
}

function villagesMatchingLocationFilters(villages, filters) {
  return villages.filter((village) =>
    locationFilterFields.every(([key]) => !filters[key] || village[key] === filters[key]),
  );
}

function renderVillagePicker(select, villages) {
  ensureVillagePickerControls(select);
  const control = select.nextElementSibling;
  const filters = Object.fromEntries(locationFilterFields.map(([key]) => [
    key,
    control.querySelector(`[data-location-filter="${key}"]`).value,
  ]));

  for (const [index, [key, label]] of locationFilterFields.entries()) {
    const filterSelect = control.querySelector(`[data-location-filter="${key}"]`);
    const previousValue = filters[key];
    const availableVillages = villages.filter((village) =>
      locationFilterFields.slice(0, index).every(([priorKey]) =>
        !filters[priorKey] || village[priorKey] === filters[priorKey],
      ),
    );
    const values = [...new Set(availableVillages.map((village) => village[key]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const placeholder = key === "country" ? "All countries" : `All ${label.toLowerCase()}s`;
    setSelectOptions(filterSelect, values.map((value) => ({ value, label: value })), placeholder, previousValue);
    filters[key] = filterSelect.value;
  }

  const matchingVillages = villagesMatchingLocationFilters(villages, filters);
  const previousVillageId = select.value;
  setSelectOptions(select, matchingVillages.map((village) => ({
    value: village.id,
    label: villageNameLabel(village),
  })), "Choose a village", previousVillageId);
  select.disabled = matchingVillages.length === 0;
  if (previousVillageId && !select.value) {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  updateVillagePickerSummary(select, matchingVillages);
}

function updateVillagePickerSummary(select, matchingVillages = state.villages) {
  const control = select.nextElementSibling;
  const selectedVillage = getVillage(select.value);
  if (selectedVillage) {
    control.querySelector("[data-selected-village-location]").textContent =
      `Location · ${villageLocationLabel(selectedVillage) || "No additional location details"}`;
    return;
  }
  const names = new Map();
  for (const village of matchingVillages) names.set(village.name, (names.get(village.name) || 0) + 1);
  const duplicate = [...names.entries()].find(([, count]) => count > 1);
  control.querySelector("[data-selected-village-location]").textContent = duplicate
    ? `${duplicate[1]} villages are named “${duplicate[0]}”. Filter by location to pick the right one.`
    : "Select a village; its location will appear here.";
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
    email: "Email",
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

function currentSurveyQuestion(surveyId = document.querySelector("#call-survey-filter").value) {
  const editor = document.querySelector("#call-question-editor");
  if (surveyId && surveyId === document.querySelector("#call-survey-filter").value && editor?.value.trim()) {
    return editor.value.trim();
  }
  return getSurvey(surveyId)?.question || editor?.value.trim() ||
    "ఈ ఎన్నికల్లో మీరు ఎవరికి ఓటు వేయాలని అనుకుంటున్నారు?";
}

function renderSurveyQuestion() {
  const surveyId = document.querySelector("#call-survey-filter").value;
  const survey = getSurvey(surveyId);
  const question = survey?.question || "ఈ ఎన్నికల్లో మీరు ఎవరికి ఓటు వేయాలని అనుకుంటున్నారు?";
  document.querySelector("#call-question-editor").value = question;
  document.querySelector("#survey-question-display").textContent = question;
  document.querySelector("#dialog-question").textContent = question;
  document.querySelector(".question-translation").textContent = survey
    ? `Question saved for “${survey.title}”. Edit the text below and save to update it.`
    : "Select a survey round to load its saved question.";
  const audio = document.querySelector("#voice-recording-player");
  audio.hidden = !survey?.voiceRecording;
  if (survey?.voiceRecording) audio.src = survey.voiceRecording;
  else {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  renderQuestionTemplateOptions();
  const savedTemplate = state.questionTemplates.find((entry) =>
    (entry.villageId === survey?.villageId || entry.villageId === null) &&
    entry.question === survey?.question,
  );
  document.querySelector("#call-question-preset").value = savedTemplate?.id || "";
  updateVoiceControls();
}

function whatsAppChatUrl(phone, message) {
  const normalized = phone.replace(/[\s().-]/g, "");
  if (!/^\+\d{7,15}$/.test(normalized)) return null;
  return `https://wa.me/${normalized.slice(1)}?text=${encodeURIComponent(message)}`;
}

function emailSurveyDraft(contact, surveyId) {
  const survey = getSurvey(surveyId);
  if (!contact.email || !survey) return null;
  const candidates = survey.candidateIds.map((id) =>
    state.candidates.find((candidate) => candidate.id === id)?.name,
  ).filter(Boolean);
  const body = [
    `నమస్కారం${contact.name ? ` ${contact.name}` : ""},`,
    "",
    survey.question,
    "",
    `Survey: ${survey.title}`,
    "Please reply with one candidate name:",
    ...candidates.map((name) => `- ${name}`),
    "",
    "Your answer is voluntary. Reply only if you agree to share your preference.",
  ].join("\n");
  return `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`Village survey: ${survey.title}`)}&body=${encodeURIComponent(body)}`;
}

function refreshTeluguVoices() {
  const select = document.querySelector("#voice-selection");
  const status = document.querySelector("#voice-status");
  if (!("speechSynthesis" in window)) {
    select.innerHTML = '<option value="">Speech synthesis is not supported</option>';
    status.textContent = "This browser does not support speech playback. Try a current version of Chrome, Edge, or Safari.";
    teluguVoices = [];
    updateVoiceControls();
    return;
  }

  const previous = select.value;
  teluguVoices = window.speechSynthesis.getVoices()
    .filter((voice) => /^te(?:-|_)/i.test(voice.lang))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!teluguVoices.length) {
    select.innerHTML = '<option value="">No Telugu voice found on this device</option>';
    status.textContent = "No Telugu text-to-speech voice is installed. Record a Telugu voice for this question below, or enable a Telugu voice in device settings.";
    updateVoiceControls();
    return;
  }

  select.innerHTML = `<option value="">Best available Telugu voice</option>${teluguVoices.map((voice) =>
    `<option value="${escapeHtml(voice.voiceURI)}">${escapeHtml(voice.name)} (${escapeHtml(voice.lang)})</option>`,
  ).join("")}`;
  if (teluguVoices.some((voice) => voice.voiceURI === previous)) select.value = previous;
  status.textContent = "Choose an installed Telugu voice and preview the question. Voice gender and accent depend on the selected voice.";
  updateVoiceControls();
}

function updateVoiceControls() {
  const survey = getSurvey(document.querySelector("#call-survey-filter").value);
  const editor = document.querySelector("#call-question-editor");
  const question = editor.value.trim();
  const recordingMatchesQuestion = Boolean(survey?.voiceRecording && question === survey.question);
  const canRecord = Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  document.querySelector("#speak-question").disabled =
    !question || (!recordingMatchesQuestion && teluguVoices.length === 0);
  document.querySelector("#record-voice-question").disabled = !survey || !canRecord || Boolean(voiceRecorder);
  document.querySelector("#voice-recording-upload").disabled = !survey || Boolean(voiceRecorder);
  document.querySelector("#save-call-question").disabled =
    !survey || !question || question === survey.question;
  document.querySelector("#call-question-delete").disabled =
    !document.querySelector("#call-question-preset").value;
  if (voiceRecorder) return;
  if (survey?.voiceRecording && recordingMatchesQuestion) {
    document.querySelector("#voice-status").textContent =
      "A locally saved voice recording is ready for this survey question. Use Play to hear it.";
  } else if (!teluguVoices.length) {
    document.querySelector("#voice-status").textContent = canRecord
      ? "No Telugu text-to-speech voice is installed. Record this question or upload an audio clip below, then Play it."
      : "No Telugu text-to-speech voice is installed. Use HTTPS/localhost with microphone permission to record, or upload a Telugu audio file.";
  } else if (survey && question !== survey.question) {
    document.querySelector("#voice-status").textContent =
      "This text has edits not yet saved to the survey. Play uses device speech; save it before recording a voice.";
  }
}

function renderQuestionTemplateOptions() {
  for (const [selector, villageSelector] of [
    ["#call-question-preset", "#village-filter"],
    ["#survey-question-preset", "#survey-village"],
  ]) {
    const villageId = document.querySelector(villageSelector).value;
    const templates = state.questionTemplates.filter((entry) =>
      entry.villageId === villageId || entry.villageId === null,
    );
    const select = document.querySelector(selector);
    const previous = select.value;
    const placeholder = selector === "#call-question-preset" ? "Choose a saved question" : "Write a new question";
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${templates.map((entry) =>
      `<option value="${escapeHtml(entry.id)}">${entry.villageId === null ? "[Global] " : ""}${escapeHtml(entry.question)}</option>`,
    ).join("")}`;
    if (templates.some((entry) => entry.id === previous)) select.value = previous;
  }
  document.querySelector("#call-question-delete").disabled =
    !document.querySelector("#call-question-preset").value;
  document.querySelector("#survey-question-delete").disabled =
    !document.querySelector("#survey-question-preset").value;
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
  const options = surveys.map((survey) => ({
    value: survey.id,
    label: selector === "#call-survey-filter"
      ? `${survey.question.slice(0, 60)}${survey.question.length > 60 ? "…" : ""} · ${survey.title} · ${new Date(survey.createdAt).toLocaleDateString()}`
      : surveyLabel(survey),
  }));
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options.map((option) =>
    `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
  ).join("");
  if (options.some((option) => option.value === selectedValue)) select.value = selectedValue;
  else if (!includeNone && options.length) select.value = options[0].value;
  select.disabled = options.length === 0;
  return select.value;
}

function renderSelectors() {
  for (const selector of villagePickerSelectors) {
    renderVillagePicker(document.querySelector(selector), state.villages);
  }
  const villageFilter = document.querySelector("#village-filter");
  const dashboardVillage = document.querySelector("#dashboard-village-filter");

  const callVillageId = villageFilter.value;
  const callSurvey = updateSurveyOptions(
    "#call-survey-filter",
    callVillageId,
    "Select a survey",
    document.querySelector("#call-survey-filter").value,
  );
  activeSurveyId = callSurvey;
  renderSurveyQuestion();
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

document.addEventListener("change", (event) => {
  const pickerFilter = event.target.closest("[data-location-filter]");
  if (pickerFilter) {
    const control = pickerFilter.closest("[data-village-picker-owner]");
    const changedIndex = locationFilterFields.findIndex(([key]) =>
      key === pickerFilter.dataset.locationFilter,
    );
    for (const [key] of locationFilterFields.slice(changedIndex + 1)) {
      control.querySelector(`[data-location-filter="${key}"]`).value = "";
    }
    const select = document.getElementById(control.dataset.villagePickerOwner);
    renderVillagePicker(select, state.villages);
    return;
  }

  const villageSelect = event.target.closest("select[data-village-picker]");
  if (villageSelect) updateVillagePickerSummary(villageSelect);

  const directoryFilter = event.target.closest("[data-directory-location-filter]");
  if (!directoryFilter) return;
  const changedIndex = locationFilterFields.findIndex(([key]) =>
    key === directoryFilter.dataset.directoryLocationFilter,
  );
  const container = document.querySelector("#village-directory-filters");
  for (const [key] of locationFilterFields.slice(changedIndex + 1)) {
    container.querySelector(`[data-directory-location-filter="${key}"]`).value = "";
  }
  renderVillages();
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-clear-location-filter]")) {
    const control = event.target.closest("[data-village-picker-owner]");
    for (const filter of control.querySelectorAll("[data-location-filter]")) filter.value = "";
    const select = document.getElementById(control.dataset.villagePickerOwner);
    renderVillagePicker(select, state.villages);
  }
  if (event.target.closest("[data-clear-directory-filters]")) {
    for (const filter of document.querySelectorAll("[data-directory-location-filter]")) filter.value = "";
    renderVillages();
  }
});

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
  const directoryFilters = document.querySelector("#village-directory-filters");
  const filterValues = Object.fromEntries(locationFilterFields.map(([key]) => [
    key,
    directoryFilters.querySelector(`[data-directory-location-filter="${key}"]`).value,
  ]));
  for (const [index, [key, label]] of locationFilterFields.entries()) {
    const select = directoryFilters.querySelector(`[data-directory-location-filter="${key}"]`);
    const previousValue = filterValues[key];
    const availableVillages = state.villages.filter((village) =>
      locationFilterFields.slice(0, index).every(([priorKey]) =>
        !filterValues[priorKey] || village[priorKey] === filterValues[priorKey],
      ),
    );
    const values = [...new Set(availableVillages.map((village) => village[key]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const placeholder = key === "country" ? "All countries" : `All ${label.toLowerCase()}s`;
    setSelectOptions(select, values.map((value) => ({ value, label: value })), placeholder, previousValue);
    filterValues[key] = select.value;
  }
  const matchingVillages = villagesMatchingLocationFilters(state.villages, filterValues);
  const list = document.querySelector("#village-list");
  if (!state.villages.length) {
    list.innerHTML = '<p class="field-help">Add a village to set up its wards, candidates and people list.</p>';
    return;
  }
  const openVillageIds = new Set([...list.querySelectorAll("details[open]")].map((detail) => detail.dataset.villageId));
  list.innerHTML = matchingVillages.length ? matchingVillages.map((village) => `
    <details class="village-card" data-village-id="${escapeHtml(village.id)}" ${openVillageIds.has(village.id) ? "open" : ""}>
      <summary>
        <div class="village-card-identity"><strong>${escapeHtml(villageNameLabel(village))}</strong>${villageLocationMarkup(village)}</div>
        <span>${village.wards.length} ${village.wards.length === 1 ? "ward" : "wards"} · Manage</span>
      </summary>
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
      <form class="village-edit-form" data-update-village="${escapeHtml(village.id)}">
        <strong>Village details</strong>
        <label>Village name<input name="name" maxlength="100" value="${escapeHtml(village.name)}" required></label>
        <label>Mandal<input name="mandal" maxlength="100" value="${escapeHtml(village.mandal || "")}" required></label>
        <label>District<input name="district" maxlength="100" value="${escapeHtml(village.district || "")}" required></label>
        <label>State<input name="state" maxlength="100" value="${escapeHtml(village.state || "")}" required></label>
        <label>Country<input name="country" maxlength="100" value="${escapeHtml(village.country || "")}" required></label>
        <button class="button button-outline" type="submit">Save village details</button>
      </form>
      <div class="village-qr-tools">
        <label>Self-registration QR
          <select data-qr-ward="${escapeHtml(village.id)}">
            <option value="">Choose ward</option>
            ${village.wards.map((ward) => `<option value="${escapeHtml(ward)}">Ward ${escapeHtml(ward)}</option>`).join("")}
          </select>
        </label>
        <button class="button button-outline" type="button" data-generate-qr="${escapeHtml(village.id)}">Create QR code</button>
        <div class="village-qr-result" data-qr-result="${escapeHtml(village.id)}" hidden></div>
      </div>
      <button class="delete-contact village-delete-button" type="button" data-delete-village="${escapeHtml(village.id)}" aria-label="Delete ${escapeHtml(village.name)}">Delete village</button>
    </details>
  `).join("") : '<p class="field-help">No villages match these location filters. Clear the filters to see all villages.</p>';
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
        <span class="candidate-chip-details"><strong>${escapeHtml(candidate.name)}</strong>${village ? `<span>${escapeHtml(villageNameLabel(village))}${villageLocationMarkup(village)}</span>` : ""}</span>
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
  renderQuestionTemplateOptions();
  document.querySelector("#survey-list").innerHTML = surveys.length
    ? surveys.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((survey) => {
      const hasResponses = state.contacts.some((contact) =>
        contact.responses?.some((response) => response.surveyId === survey.id),
      );
      return `
        <div class="survey-list-item">
          <strong>${escapeHtml(survey.title)}</strong>
          <span>${escapeHtml(new Date(survey.createdAt).toLocaleString())} · ${survey.candidateIds.length} candidates</span>
          ${hasResponses ? "<small>Deleting removes saved responses</small>" : ""}
          <button class="delete-contact" type="button" data-delete-survey="${escapeHtml(survey.id)}" data-response-count="${state.contacts.reduce((count, contact) =>
            count + (contact.responses?.filter((response) => response.surveyId === survey.id).length || 0), 0)}" aria-label="Delete ${escapeHtml(survey.title)}">×</button>
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
        groups.push(`<section class="ward-result-card"><div class="ward-result-heading"><h3>${escapeHtml(village ? villageNameLabel(village) : "")}${village ? villageLocationMarkup(village) : ""}<span>· Ward ${escapeHtml(result.ward)}</span></h3></div><p class="no-results">Results are hidden to protect privacy (fewer than 10 responses).</p></section>`);
        continue;
      }
      const currentResults = result.candidates || [];
      const previousResults = state.results.find((entry) =>
        entry.surveyId === compareSurveyId && entry.ward === result.ward,
      );
      groups.push(`
        <section class="ward-result-card">
          <div class="ward-result-heading">
            <h3>${escapeHtml(village ? villageNameLabel(village) : "")}${village ? villageLocationMarkup(village) : ""}<span>· Ward ${escapeHtml(result.ward)}</span></h3>
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
      const contacts = state.contacts.filter((contact) => contact.approvalStatus !== "pending");
      const candidateResponses = contacts.flatMap((contact) => {
        const answer = getSurveyResponse(contact, survey.id);
        return answer &&
          (answer.villageId || contact.villageId) === village.id &&
          (answer.ward || contact.ward) === ward &&
          survey.candidateIds.includes(answer.response) ? [{ contact, answer }] : [];
      });
      const total = candidateResponses.length;
      const previousResponses = compareSurvey?.villageId === village.id
        ? contacts.flatMap((contact) => {
          const answer = getSurveyResponse(contact, compareSurvey.id);
          return answer &&
            (answer.villageId || contact.villageId) === village.id &&
            (answer.ward || contact.ward) === ward &&
            compareSurvey.candidateIds.includes(answer.response) ? [{ contact, answer }] : [];
        })
        : [];
      groups.push(`
        <section class="ward-result-card">
          <div class="ward-result-heading">
            <h3>${escapeHtml(villageNameLabel(village))}${villageLocationMarkup(village)}<span>· Ward ${escapeHtml(ward)}</span></h3>
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
                <svg class="result-track" viewBox="0 0 100 7" preserveAspectRatio="none" role="progressbar" aria-label="${escapeHtml(candidate.name)} preference in ${escapeHtml(village.name)}, ${escapeHtml(villageLocationLabel(village))}, Ward ${escapeHtml(ward)}" aria-valuenow="${share}" aria-valuemin="0" aria-valuemax="100">
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
  const villageLabel = villageId && village ? villageNameLabel(village) : "Choose a village";
  const surveyLabelText = survey ? survey.title : "Choose a survey";
  document.querySelector(".snapshot-label").innerHTML =
    `<span class="status-dot"></span><span>${escapeHtml(villageLabel || "Choose a village")} · ${escapeHtml(surveyLabelText)}${wardFilter ? ` · Ward ${escapeHtml(wardFilter)}` : ""}${village ? villageLocationMarkup(village) : ""}</span>`;
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
    const searchable = `${contact.name} ${contact.phone} ${contact.email || ""} ${village ? villageSearchText(village) : ""} ${contact.ward}`.toLocaleLowerCase();
    return contact.approvalStatus !== "pending" &&
      (!villageId || contact.villageId === villageId) &&
      (!ward || contact.ward === ward) &&
      (!query || searchable.includes(query));
  }) : [];
  const table = document.querySelector("#people-table");
  document.querySelector("#people-list-content").hidden = !villageId;
  document.querySelector("#choose-village-prompt").hidden = Boolean(villageId);
  document.querySelector("#empty-people").hidden = contacts.length > 0;
  const approvedVillagePeople = state.contacts.filter((contact) =>
    contact.villageId === villageId && contact.approvalStatus !== "pending",
  );
  document.querySelector("#empty-people").querySelector("strong").textContent =
    approvedVillagePeople.length
      ? "No people match this filter"
      : "No approved people for this village yet";
  table.innerHTML = contacts.map((contact) => {
    const savedResponse = getSurveyResponse(contact, surveyId);
    const response = savedResponse?.response;
    const village = getVillage(contact.villageId);
    const message = `${currentSurveyQuestion(surveyId)} మీ సమాధానం సందేశంగా పంపండి.`;
    const whatsappUrl = contact.phone ? whatsAppChatUrl(contact.phone, message) : null;
    const emailUrl = emailSurveyDraft(contact, surveyId);
    const responseClass = response && response !== "no-answer" ? "answered" : "";
    return `
      <tr>
        <td><label class="contact-select-label"><input type="checkbox" data-select-contact="${escapeHtml(contact.id)}" ${selectedContactIds.has(contact.id) ? "checked" : ""} aria-label="Select ${escapeHtml(contact.name || contact.phone || contact.email)}"><span class="person-name">${escapeHtml(contact.name || "Resident")}</span></label>${contact.phone ? `<span class="person-phone">${escapeHtml(contact.phone)}</span>` : ""}${contact.email ? `<span class="person-phone">${escapeHtml(contact.email)}</span>` : ""}</td>
        <td><span class="village-name-cell">${escapeHtml(village ? villageNameLabel(village) : "Unknown village")}</span><span class="ward-secondary">Ward ${escapeHtml(contact.ward)}</span></td>
        <td><span class="response-pill ${responseClass}">${escapeHtml(responseLabel(response))}${savedResponse?.channel ? `<small>${escapeHtml(responseChannelLabel(savedResponse.channel))}</small>` : ""}</span></td>
        <td>
          <div class="contact-actions">
            ${contact.phone ? `<a class="button button-outline table-action call-action" href="tel:${escapeHtml(contact.phone)}" aria-label="Call ${escapeHtml(contact.name || contact.phone)} using the phone app"><span aria-hidden="true">☎</span> Call</a>
            <a class="button button-outline table-action message-action" href="sms:${escapeHtml(contact.phone)}?body=${encodeURIComponent(`${currentSurveyQuestion(surveyId)} మీ సమాధానం సందేశంగా పంపండి.`)}" aria-label="Draft a text message to ${escapeHtml(contact.name || contact.phone)}"><span aria-hidden="true">✉</span> Message</a>` : ""}
            ${whatsappUrl
              ? `<a class="button button-outline table-action whatsapp-action" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open WhatsApp chat with ${escapeHtml(contact.name || contact.phone)}">WhatsApp</a>`
              : ""}
            ${emailUrl
              ? `<a class="button button-outline table-action email-action" href="${emailUrl}" aria-label="Draft survey email to ${escapeHtml(contact.name || contact.email)}">Email survey</a>`
              : ""}
          </div>
        </td>
        <td><div class="contact-actions"><button class="button button-outline table-action" type="button" data-record="${escapeHtml(contact.id)}" ${surveyId ? "" : "disabled"}>${response ? "Update" : "Record"}</button><button class="button button-outline table-action" type="button" data-edit-contact="${escapeHtml(contact.id)}">Edit</button></div></td>
        <td><button class="delete-contact" type="button" data-delete-contact="${escapeHtml(contact.id)}" aria-label="Remove ${escapeHtml(contact.name || contact.phone || contact.email)}">×</button></td>
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
  const selectedContacts = state.contacts.filter((contact) => selectedContactIds.has(contact.id));
  const selectedChannels = [...document.querySelectorAll("[data-outreach-channel]:checked")]
    .map((checkbox) => checkbox.dataset.outreachChannel);
  const villageContacts = selectedContacts.filter((contact) =>
    contact.approvalStatus !== "pending" &&
    contact.villageId === villageId &&
    (!ward || contact.ward === ward),
  );
  const hasOutreachTask = villageContacts.some((contact) => selectedChannels.some((channel) =>
    channel === "email" ? Boolean(contact.email && surveyId) :
      channel === "whatsapp" ? Boolean(contact.phone && whatsAppChatUrl(contact.phone, currentSurveyQuestion(surveyId))) :
        Boolean(contact.phone),
  ));
  document.querySelector("#open-next-outreach").disabled = !hasOutreachTask;
  document.querySelector("#clear-contact-selection").disabled = selectedContactIds.size === 0;
}

function renderPendingContacts() {
  const pendingContacts = state.contacts.filter((contact) => contact.approvalStatus === "pending");
  const list = document.querySelector("#pending-contact-list");
  list.innerHTML = pendingContacts.length
    ? pendingContacts.map((contact) => {
      const village = getVillage(contact.villageId);
      return `
        <article class="pending-contact">
          <div>
            <strong>${escapeHtml(contact.name || "New registration")}</strong>
            <span>${escapeHtml(contact.phone || contact.email)}</span>
            ${contact.phone && contact.email ? `<span>${escapeHtml(contact.email)}</span>` : ""}
            <strong>${escapeHtml(village ? villageNameLabel(village) : "Village")} · Ward ${escapeHtml(contact.ward)}</strong>
            ${village ? villageLocationMarkup(village) : ""}
          </div>
          <div class="pending-contact-actions">
            <button class="button button-primary" type="button" data-review-contact="${escapeHtml(contact.id)}" data-review-status="approved">Approve</button>
            <button class="button button-outline" type="button" data-review-contact="${escapeHtml(contact.id)}" data-review-status="rejected">Reject</button>
          </div>
        </article>
      `;
    }).join("")
    : '<p class="field-help">No QR registrations are awaiting approval.</p>';
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
  renderPendingContacts();
  const approvedContacts = state.contacts.filter((contact) => contact.approvalStatus !== "pending");
  const latestSurveyByVillage = new Map();
  for (const survey of state.surveys) {
    const existing = latestSurveyByVillage.get(survey.villageId);
    if (!existing || survey.createdAt > existing.createdAt) latestSurveyByVillage.set(survey.villageId, survey);
  }
  const latestResponses = approvedContacts.flatMap((contact) => {
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
  const rate = approvedContacts.length ? Math.round((answered / approvedContacts.length) * 100) : 0;
  document.querySelector("#total-count").textContent = approvedContacts.length;
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
  state.questionTemplates ||= [];
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

document.querySelector("#add-village-ward").addEventListener("click", () => {
  const row = document.createElement("div");
  row.className = "new-ward-row";
  row.innerHTML = '<input name="ward" maxlength="40" aria-label="Ward name or number" placeholder="Ward name or number" required><button class="delete-contact" type="button" aria-label="Remove ward field">×</button>';
  document.querySelector("#new-village-wards").append(row);
  row.querySelector("input").focus();
});

document.querySelector("#new-village-wards").addEventListener("click", (event) => {
  const removeButton = event.target.closest(".new-ward-row button");
  if (!removeButton) return;
  const rows = document.querySelectorAll("#new-village-wards .new-ward-row");
  if (rows.length === 1) {
    rows[0].querySelector("input").value = "";
    rows[0].querySelector("input").focus();
    return;
  }
  removeButton.closest(".new-ward-row").remove();
});

document.querySelector("#village-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const wards = [...document.querySelectorAll("#new-village-wards input[name=ward]")]
    .map((input) => input.value.trim()).filter(Boolean);
  try {
    await api("/api/villages", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#village-name").value,
        mandal: document.querySelector("#village-mandal").value,
        district: document.querySelector("#village-district").value,
        state: document.querySelector("#village-state").value,
        country: document.querySelector("#village-country").value,
        wards,
      }),
    });
    event.target.reset();
    document.querySelector("#new-village-wards").innerHTML =
      '<div class="new-ward-row"><input name="ward" maxlength="40" aria-label="Ward name or number" placeholder="Ward name or number (e.g. 1)" required></div>';
    await refreshData();
    showToast("Village and wards added.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#village-list").addEventListener("submit", async (event) => {
  const villageEditForm = event.target.closest("[data-update-village]");
  if (villageEditForm) {
    event.preventDefault();
    const formData = new FormData(villageEditForm);
    try {
      await api(`/api/villages/${encodeURIComponent(villageEditForm.dataset.updateVillage)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: formData.get("name"),
          mandal: formData.get("mandal"),
          district: formData.get("district"),
          state: formData.get("state"),
          country: formData.get("country"),
        }),
      });
      await refreshData();
      showToast("Village details updated.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
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
  const qrButton = event.target.closest("[data-generate-qr]");
  if (qrButton) {
    const villageId = qrButton.dataset.generateQr;
    const ward = document.querySelector(`[data-qr-ward="${CSS.escape(villageId)}"]`).value;
    const result = document.querySelector(`[data-qr-result="${CSS.escape(villageId)}"]`);
    if (!ward) {
      showToast("Choose a ward before creating its registration QR code.");
      return;
    }
    qrButton.disabled = true;
    try {
      const qr = await api(`/api/villages/${encodeURIComponent(villageId)}/registration-qr?ward=${encodeURIComponent(ward)}`);
      result.innerHTML = `
        <img src="${qr.image}" alt="Self-registration QR for ${escapeHtml(qr.villageLabel)}, Ward ${escapeHtml(qr.ward)}">
        <div class="qr-place"><strong>Village: ${escapeHtml(qr.villageLabel)}</strong>${villageLocationMarkup(qr.villageLocation)}<span>Ward ${escapeHtml(qr.ward)}</span></div>
        <a href="${escapeHtml(qr.url)}" target="_blank" rel="noopener noreferrer">Open registration form</a>
        <button class="button button-outline" type="button" data-download-qr="${escapeHtml(villageId)}" data-qr-ward-name="${escapeHtml(ward)}">Download QR</button>
        <small>Anyone scanning this code can submit a registration for admin approval. Use an app URL that people can reach from their phones.</small>
      `;
      result.hidden = false;
    } catch (error) {
      showToast(error.message);
    } finally {
      qrButton.disabled = false;
    }
    return;
  }
  const downloadQr = event.target.closest("[data-download-qr]");
  if (downloadQr) {
    const image = downloadQr.closest(".village-qr-result").querySelector("img");
    const link = document.createElement("a");
    link.href = image.src;
    link.download = `survey-registration-ward-${downloadQr.dataset.qrWardName}.png`;
    link.click();
    return;
  }
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

document.querySelector("#survey-village").addEventListener("change", () => {
  document.querySelector("#survey-question-preset").value = "";
  document.querySelector("#survey-question").value = "ఈ ఎన్నికల్లో మీరు ఎవరికి ఓటు వేయాలని అనుకుంటున్నారు?";
  renderSurveyFormOptions();
});
document.querySelector("#survey-question-preset").addEventListener("change", (event) => {
  const template = state.questionTemplates.find((entry) => entry.id === event.target.value);
  if (template) {
    document.querySelector("#survey-question").value = template.question;
    document.querySelector("#survey-question-scope").value = template.villageId === null ? "global" : "village";
  }
});

async function deleteQuestionTemplate(templateId) {
  if (!templateId || !window.confirm("Remove this saved question template? Existing survey rounds keep their saved question.")) return;
  try {
    await api(`/api/questions/${encodeURIComponent(templateId)}`, { method: "DELETE" });
    await refreshData();
    showToast("Saved question removed. Existing survey rounds are unchanged.");
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#survey-question-delete").addEventListener("click", () => {
  deleteQuestionTemplate(document.querySelector("#survey-question-preset").value);
});
document.querySelector("#call-question-delete").addEventListener("click", () => {
  deleteQuestionTemplate(document.querySelector("#call-question-preset").value);
});

document.querySelector("#call-question-preset").addEventListener("change", (event) => {
  const template = state.questionTemplates.find((entry) => entry.id === event.target.value);
  if (!template) return;
  document.querySelector("#call-question-editor").value = template.question;
  document.querySelector("#call-question-scope").value = template.villageId === null ? "global" : "village";
  document.querySelector("#survey-question-display").textContent = template.question;
  document.querySelector("#dialog-question").textContent = template.question;
  updateVoiceControls();
  renderPeople();
});

document.querySelector("#call-question-editor").addEventListener("input", (event) => {
  const question = event.target.value.trim();
  document.querySelector("#survey-question-display").textContent = question ||
    "Enter the Telugu question you want to ask.";
  document.querySelector("#dialog-question").textContent = question ||
    "Enter the Telugu question you want to ask.";
  updateVoiceControls();
  renderPeople();
});

document.querySelector("#save-call-question").addEventListener("click", async () => {
  const surveyId = document.querySelector("#call-survey-filter").value;
  const question = document.querySelector("#call-question-editor").value.trim();
  if (!surveyId || !question) {
    showToast("Choose a survey round and enter a question first.");
    return;
  }
  try {
    await api(`/api/surveys/${encodeURIComponent(surveyId)}/question`, {
      method: "POST",
      body: JSON.stringify({
        question,
        questionScope: document.querySelector("#call-question-scope").value,
      }),
    });
    await refreshData();
    showToast(document.querySelector("#call-question-scope").value === "global"
      ? "Survey question saved. Its template is now available in every village."
      : "Survey question saved for this survey and village.");
  } catch (error) {
    showToast(error.message);
  }
});

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
        question: document.querySelector("#survey-question").value,
        questionScope: document.querySelector("#survey-question-scope").value,
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
  if (!button) return;
  const responseCount = Number(button.dataset.responseCount || 0);
  const confirmation = responseCount
    ? `Delete this survey and permanently remove ${responseCount} saved response${responseCount === 1 ? "" : "s"}? This cannot be undone.`
    : "Delete this survey round?";
  if (!window.confirm(confirmation)) return;
  button.disabled = true;
  try {
    await api(`/api/surveys/${encodeURIComponent(button.dataset.deleteSurvey)}`, { method: "DELETE" });
    await refreshData();
    showToast(responseCount
      ? `Survey and ${responseCount} saved response${responseCount === 1 ? "" : "s"} deleted.`
      : "Survey round deleted.");
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

document.querySelector("#pending-contact-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-review-contact]");
  if (!button) return;
  const status = button.dataset.reviewStatus;
  if (status === "rejected" && !window.confirm("Reject this registration and permanently remove its submitted contact details?")) return;
  button.disabled = true;
  try {
    await api(`/api/contacts/${encodeURIComponent(button.dataset.reviewContact)}/approval`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    await refreshData();
    showToast(status === "approved" ? "Registration approved and added to the contact list." : "Registration rejected and contact details removed.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

function updateContactWardOptions() {
  updateWardOptions("#contact-village", "#contact-ward", "Choose a ward");
}

document.querySelector("#contact-village").addEventListener("change", updateContactWardOptions);
document.querySelector("#contact-edit-village").addEventListener("change", () => {
  updateWardOptions("#contact-edit-village", "#contact-edit-ward", "Choose a ward");
});

document.querySelector("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#contact-name").value,
        phone: document.querySelector("#contact-phone").value,
        email: document.querySelector("#contact-email").value,
        villageId: document.querySelector("#contact-village").value,
        ward: document.querySelector("#contact-ward").value,
      }),
    });
    form.reset();
    await refreshData();
    showToast("Person added.");
  } catch (error) {
    showToast(error.message);
  }
});

function openContactEdit(contactId) {
  const contact = state.contacts.find((entry) => entry.id === contactId);
  if (!contact) return;
  document.querySelector("#contact-edit-name").value = contact.name || "";
  document.querySelector("#contact-edit-phone").value = contact.phone || "";
  document.querySelector("#contact-edit-email").value = contact.email || "";
  document.querySelector("#contact-edit-village").value = contact.villageId;
  updateWardOptions("#contact-edit-village", "#contact-edit-ward", "Choose a ward");
  document.querySelector("#contact-edit-ward").value = contact.ward;
  document.querySelector("#contact-edit-error").textContent = "";
  document.querySelector("#contact-edit-dialog").dataset.contactId = contact.id;
  document.querySelector("#contact-edit-dialog").showModal();
}

document.querySelector("#contact-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const dialog = document.querySelector("#contact-edit-dialog");
  const contactId = dialog.dataset.contactId;
  const error = document.querySelector("#contact-edit-error");
  error.textContent = "";
  try {
    await api(`/api/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: document.querySelector("#contact-edit-name").value,
        phone: document.querySelector("#contact-edit-phone").value,
        email: document.querySelector("#contact-edit-email").value,
        villageId: document.querySelector("#contact-edit-village").value,
        ward: document.querySelector("#contact-edit-ward").value,
      }),
    });
    dialog.close();
    selectedContactIds.delete(contactId);
    await refreshData();
    showToast("Contact details updated. Previous survey answers are retained.");
  } catch (requestError) {
    error.textContent = requestError.message;
  }
});

for (const selector of ["#close-contact-edit", "#cancel-contact-edit"]) {
  document.querySelector(selector).addEventListener("click", () =>
    document.querySelector("#contact-edit-dialog").close(),
  );
}

document.querySelector("#download-template").addEventListener("click", () => {
  const template = "name,phone,email,village,mandal,district,state,country,ward\nRavi,+919876543210,ravi@example.com,Adigoppula,Durgi,Palnadu,Andhra Pradesh,India,1\nSita,,sita@example.com,Adigoppula,Durgi,Palnadu,Andhra Pradesh,India,2\n";
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
  const missing = ["ward"].filter((column) => !headers.includes(column));
  if (!headers.includes("phone") && !headers.includes("email")) missing.push("phone or email");
  if (missing.length) throw new Error(`Missing CSV column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  return rows.map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    if (!record.phone && !record.email) throw new Error("Every CSV row needs a phone number, an email address, or both.");
    return {
      name: record.name || "",
      phone: record.phone || "",
      email: record.email || "",
      village: record.village || "",
      mandal: record.mandal || "",
      district: record.district || "",
      state: record.state || "",
      country: record.country || "",
      ward: record.ward || "",
    };
  });
}

document.querySelector("#csv-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const message = document.querySelector("#upload-message");
  message.textContent = `Reading ${file.name}…`;
  try {
    const contacts = parseCsv(await file.text());
    const villageId = document.querySelector("#csv-village").value;
    if (!villageId && contacts.some((contact) => !contact.village &&
      !contact.mandal && !contact.district && !contact.state && !contact.country)) {
      throw new Error("Choose a default village or include village and location columns for every row.");
    }
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
  document.querySelector("#dialog-contact-name").textContent =
    contact.name || contact.phone || contact.email || "Resident";
  const contactDetails = [contact.phone, contact.email].filter(Boolean).join(" · ");
  document.querySelector("#dialog-contact-meta").textContent =
    `${contactDetails ? `${contactDetails} · ` : ""}${village?.name || "Unknown village"} · Ward ${contact.ward}`;
  document.querySelector("#dialog-question").textContent = currentSurveyQuestion(activeSurveyId);
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
  document.querySelector("#response-channel").value = savedResponse?.channel ||
    (contact.email && !contact.phone ? "email" : "phone");
  document.querySelector("#response-consent").checked = false;
  document.querySelector("#consent-label").hidden = false;
  document.querySelector("#dialog-error").textContent = "";
  document.querySelector("#dialog-voice-status").textContent =
    "Or choose the answer below. The person must agree before a preference is saved.";
  responseDialog.showModal();
}

document.querySelector("#people-table").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-contact]");
  if (editButton) return openContactEdit(editButton.dataset.editContact);
  const recordButton = event.target.closest("[data-record]");
  if (recordButton) return openResponseDialog(recordButton.dataset.record);
  const deleteButton = event.target.closest("[data-delete-contact]");
  if (!deleteButton || !window.confirm("Remove this person from the survey list?")) return;
  deleteButton.disabled = true;
  try {
    await api(`/api/contacts/${encodeURIComponent(deleteButton.dataset.deleteContact)}`, { method: "DELETE" });
    await refreshData();
    showToast("Person removed.");
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
  outreachQueueIndex = 0;
  renderPeople();
});

document.querySelector("#select-visible-contacts").addEventListener("change", (event) => {
  for (const checkbox of document.querySelectorAll("#people-table [data-select-contact]")) {
    if (event.target.checked) selectedContactIds.add(checkbox.dataset.selectContact);
    else selectedContactIds.delete(checkbox.dataset.selectContact);
  }
  outreachQueueIndex = 0;
  renderPeople();
});

document.querySelector("#clear-contact-selection").addEventListener("click", () => {
  selectedContactIds.clear();
  outreachQueueIndex = 0;
  renderPeople();
});

for (const checkbox of document.querySelectorAll("[data-outreach-channel]")) {
  checkbox.addEventListener("change", () => {
    outreachQueueIndex = 0;
    renderPeople();
  });
}

function openNextOutreach() {
  const villageId = document.querySelector("#village-filter").value;
  const ward = document.querySelector("#ward-filter").value;
  const surveyId = document.querySelector("#call-survey-filter").value;
  const selectedChannels = [...document.querySelectorAll("[data-outreach-channel]:checked")]
    .map((checkbox) => checkbox.dataset.outreachChannel);
  if (!selectedChannels.length) {
    showToast("Choose one or more outreach channels first.");
    return;
  }
  const queue = state.contacts
    .filter((contact) =>
      selectedContactIds.has(contact.id) &&
      contact.approvalStatus !== "pending" &&
      contact.villageId === villageId &&
      (!ward || contact.ward === ward),
    )
    .flatMap((contact) => selectedChannels.flatMap((channel) => {
      if (channel === "email") return contact.email && surveyId ? [{ contact, channel }] : [];
      if (!contact.phone) return [];
      if (channel === "whatsapp" && !whatsAppChatUrl(contact.phone, currentSurveyQuestion(surveyId))) return [];
      return [{ contact, channel }];
    }));
  if (!queue.length) {
    showToast("No selected people have the contact details needed for those channels.");
    return;
  }
  if (outreachQueueIndex >= queue.length) {
    showToast("All selected contact actions have been opened. Clear or change the selection to start again.");
    return;
  }
  const { contact, channel } = queue[outreachQueueIndex];
  const message = `${currentSurveyQuestion()} మీ సమాధానం సందేశంగా పంపండి.`;
  const whatsappUrl = channel === "whatsapp" ? whatsAppChatUrl(contact.phone, message) : null;
  outreachQueueIndex++;
  const link = document.createElement("a");
  link.href = channel === "email"
    ? emailSurveyDraft(contact, document.querySelector("#call-survey-filter").value)
    : channel === "phone"
    ? `tel:${contact.phone}`
    : channel === "message"
      ? `sms:${contact.phone}?body=${encodeURIComponent(message)}`
      : whatsappUrl;
  link.rel = "noopener noreferrer";
  if (channel === "whatsapp" || channel === "email") link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
  const label = channel === "phone" ? "Call"
    : channel === "message" ? "Message draft"
      : channel === "whatsapp" ? "WhatsApp chat" : "Email survey draft";
  showToast(`${label} opened for ${contact.name || contact.phone || contact.email}. Review it, then choose Open next selected outreach.`);
}

document.querySelector("#open-next-outreach").addEventListener("click", openNextOutreach);

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
  outreachQueueIndex = 0;
  activeSurveyId = updateSurveyOptions(
    "#call-survey-filter",
    document.querySelector("#village-filter").value,
    "Select a survey",
    "",
  );
  renderSurveyQuestion();
  updateWardOptions("#village-filter", "#ward-filter", "All wards");
  renderPeople();
});
document.querySelector("#call-survey-filter").addEventListener("change", (event) => {
  activeSurveyId = event.target.value;
  outreachQueueIndex = 0;
  renderSurveyQuestion();
  renderPeople();
});
document.querySelector("#ward-filter").addEventListener("change", () => {
  outreachQueueIndex = 0;
  renderPeople();
});
document.querySelector("#people-search").addEventListener("input", () => {
  outreachQueueIndex = 0;
  renderPeople();
});
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
  const survey = getSurvey(document.querySelector("#call-survey-filter").value);
  const question = currentSurveyQuestion();
  if (survey?.voiceRecording && question === survey.question) {
    const audio = document.querySelector("#voice-recording-player");
    audio.currentTime = 0;
    audio.play().then(() => {
      document.querySelector("#voice-status").textContent = "Playing the saved Telugu voice recording.";
    }).catch((error) => {
      document.querySelector("#voice-status").textContent =
        `Could not play the saved recording (${error.message}). Try uploading it as MP3, WAV, M4A, OGG, or WebM.`;
    });
    return;
  }
  if (!("speechSynthesis" in window)) {
    return showToast("Telugu voice playback is not supported in this browser.");
  }
  refreshTeluguVoices();
  if (!teluguVoices.length) return;
  const voiceURI = document.querySelector("#voice-selection").value;
  const voice = teluguVoices.find((entry) => entry.voiceURI === voiceURI) ||
    teluguVoices.find((entry) => /female|woman|lady|heera|lekha|vani/i.test(entry.name)) ||
    teluguVoices.find((entry) => entry.default) ||
    teluguVoices[0];
  const villageStyle = document.querySelector("#voice-style").value === "village";
  const utterance = new SpeechSynthesisUtterance(question);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = villageStyle ? 0.78 : 0.82;
  utterance.pitch = villageStyle ? 1.18 : 1;
  utterance.onstart = () => {
    document.querySelector("#voice-status").textContent =
      `Playing with ${voice.name}. A specific Palleturu dialect or female voice cannot be guaranteed by browser voices.`;
  };
  utterance.onend = () => {
    document.querySelector("#voice-status").textContent = "Question playback finished.";
  };
  utterance.onerror = (event) => {
    document.querySelector("#voice-status").textContent =
      `Telugu playback failed (${event.error}). Choose another installed Telugu voice or check the device's speech settings.`;
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
});

document.querySelector("#record-voice-question").addEventListener("click", async () => {
  const surveyId = document.querySelector("#call-survey-filter").value;
  const survey = getSurvey(surveyId);
  if (!survey) {
    showToast("Choose a village and survey question before recording.");
    return;
  }
  try {
    const question = document.querySelector("#call-question-editor").value.trim();
    if (!question) throw new Error("Enter a question before recording its voice.");
    if (question !== survey.question) {
      await api(`/api/surveys/${encodeURIComponent(surveyId)}/question`, {
        method: "POST",
        body: JSON.stringify({
          question,
          questionScope: document.querySelector("#call-question-scope").value,
        }),
      });
      await refreshData();
    }
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    voiceRecorder = new MediaRecorder(voiceStream, mimeType ? { mimeType } : undefined);
    voiceRecordingChunks = [];
    voiceRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) voiceRecordingChunks.push(event.data);
    });
    voiceRecorder.addEventListener("error", () => {
      document.querySelector("#voice-status").textContent =
        "The browser could not record audio. Check microphone permission and try again.";
    });
    voiceRecorder.addEventListener("stop", async () => {
      const recorder = voiceRecorder;
      const recording = new Blob(voiceRecordingChunks, { type: recorder.mimeType || "audio/webm" });
      voiceRecordingChunks = [];
      voiceStream?.getTracks().forEach((track) => track.stop());
      voiceStream = null;
      voiceRecorder = null;
      document.querySelector("#stop-voice-recording").hidden = true;
      updateVoiceControls();
      if (recording.size > 3_000_000) {
        document.querySelector("#voice-status").textContent =
          "Recording is too large to save. Keep it under 3 MB and record again.";
        return;
      }
      try {
        const voiceRecording = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Could not read the recorded audio."));
          reader.readAsDataURL(recording);
        });
        await api(`/api/surveys/${encodeURIComponent(surveyId)}/voice`, {
          method: "POST",
          body: JSON.stringify({ voiceRecording }),
        });
        await refreshData();
        document.querySelector("#voice-status").textContent =
          "Voice recording saved locally for this survey question.";
      } catch (error) {
        document.querySelector("#voice-status").textContent = error.message;
      }
    }, { once: true });
    voiceRecorder.start();
    document.querySelector("#stop-voice-recording").hidden = false;
    document.querySelector("#voice-status").textContent =
      "Recording. Read the Telugu question clearly, then choose Stop and save recording.";
    updateVoiceControls();
  } catch (error) {
    voiceStream?.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    voiceRecorder = null;
    updateVoiceControls();
    document.querySelector("#voice-status").textContent =
      `Could not start microphone recording (${error.message}). Allow microphone access and try again.`;
  }
});

document.querySelector("#stop-voice-recording").addEventListener("click", () => {
  if (voiceRecorder?.state === "recording") voiceRecorder.stop();
});

document.querySelector("#voice-recording-upload").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  const surveyId = document.querySelector("#call-survey-filter").value;
  if (!file) return;
  if (!getSurvey(surveyId)) {
    showToast("Choose a village and survey round before uploading a voice recording.");
    event.target.value = "";
    return;
  }
  if (!/^audio\/(webm|ogg|mp4|wav|x-wav|mpeg|aac|x-m4a|m4a|aiff|3gpp|3gpp2)$/i.test(file.type) || file.size > 3_000_000) {
    document.querySelector("#voice-status").textContent =
      "Choose an MP3, WAV, M4A, OGG, or WebM audio file smaller than 3 MB.";
    event.target.value = "";
    return;
  }
  try {
    const question = document.querySelector("#call-question-editor").value.trim();
    if (!question) throw new Error("Enter a question before adding its voice recording.");
    const survey = getSurvey(surveyId);
    if (question !== survey.question) {
      await api(`/api/surveys/${encodeURIComponent(surveyId)}/question`, {
        method: "POST",
        body: JSON.stringify({
          question,
          questionScope: document.querySelector("#call-question-scope").value,
        }),
      });
    }
    const voiceRecording = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the selected audio file."));
      reader.readAsDataURL(file);
    });
    await api(`/api/surveys/${encodeURIComponent(surveyId)}/voice`, {
      method: "POST",
      body: JSON.stringify({ voiceRecording }),
    });
    await refreshData();
    document.querySelector("#voice-status").textContent =
      `Saved ${file.name} locally for this survey question.`;
  } catch (error) {
    document.querySelector("#voice-status").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#voice-answer").addEventListener("click", () => {
  showToast("Open a person’s Record form to capture and confirm their spoken answer.");
});

document.querySelector("#voice-recording-player").addEventListener("error", (event) => {
  if (event.currentTarget.hidden) return;
  document.querySelector("#voice-status").textContent =
    "This audio format could not be played by the browser. Upload a compatible MP3, WAV, M4A, OGG, or WebM recording.";
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

refreshTeluguVoices();
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", refreshTeluguVoices);
}
initialize();
