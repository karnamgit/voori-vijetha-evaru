const registrationForm = document.querySelector("#self-registration-form");
const registrationStatus = document.querySelector("#registration-status");
const registrationQuery = new URLSearchParams(window.location.search);
const registrationVillageId = registrationQuery.get("villageId");
const registrationWard = registrationQuery.get("ward");
let registrationReady = false;

async function loadRegistrationLocation() {
  try {
    if (!registrationVillageId || !registrationWard) {
      throw new Error("This QR code does not contain a valid village and ward.");
    }
    const response = await fetch(
      `/api/public/registration?villageId=${encodeURIComponent(registrationVillageId)}&ward=${encodeURIComponent(registrationWard)}`,
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "This registration link is not available.");
    document.querySelector("[data-registration-village]").textContent = `Village: ${result.village.name}`;
    document.querySelector("[data-registration-area]").textContent =
      ["mandal", "district", "state", "country"]
        .map((key) => result.village[key] && `${key[0].toUpperCase()}${key.slice(1)}: ${result.village[key]}`)
        .filter(Boolean)
        .join(" · ");
    document.querySelector("[data-registration-ward]").textContent = `Ward ${result.ward}`;
    registrationReady = true;
    document.querySelector("#registration-submit").disabled = false;
  } catch (error) {
    document.querySelector("#registration-location").textContent = error.message;
    registrationStatus.textContent = "Ask the survey admin for a current registration QR code.";
  }
}

registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registrationStatus.textContent = "";
  const phone = document.querySelector("#registration-phone").value.trim();
  const email = document.querySelector("#registration-email").value.trim();
  if (!registrationReady) {
    registrationStatus.textContent = "This registration link is not ready.";
    return;
  }
  if (!phone && !email) {
    registrationStatus.textContent = "Enter a phone number, an email address, or both.";
    return;
  }
  if (!document.querySelector("#registration-consent").checked) {
    registrationStatus.textContent = "Please agree before sharing your contact details.";
    return;
  }
  const submit = document.querySelector("#registration-submit");
  submit.disabled = true;
  try {
    const response = await fetch("/api/public/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        villageId: registrationVillageId,
        ward: registrationWard,
        name: document.querySelector("#registration-name").value,
        phone,
        email,
        consent: true,
        website: document.querySelector("#registration-website").value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not submit registration.");
    registrationForm.hidden = true;
    registrationStatus.textContent =
      "Thank you. Your details were submitted for admin review; they will not be used until approved.";
  } catch (error) {
    registrationStatus.textContent = error.message;
    submit.disabled = false;
  }
});

loadRegistrationLocation();
