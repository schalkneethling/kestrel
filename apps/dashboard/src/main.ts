import { SUPPORTED_ATS_TYPES } from "@kestrel/core";
import "./style.css";

const supportedAtsList = SUPPORTED_ATS_TYPES.map((type) => `<li>${type}</li>`).join("");

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">Prototype scaffold</p>
      <h1>Kestrel Job Tracker</h1>
      <p class="lede">
        Single-user job posting tracker for ATS polling, repost detection, saved criteria, and desktop notifications.
      </p>
    </header>

    <section aria-labelledby="supported-ats">
      <h2 id="supported-ats">Supported ATS platforms</h2>
      <ul>${supportedAtsList}</ul>
    </section>
  </main>
`;
