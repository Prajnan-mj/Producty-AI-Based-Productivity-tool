import { Link } from "react-router-dom";

const UPDATED = "June 25, 2026";

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-bold text-text-primary">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-text-muted">{children}</div>
    </section>
  );
}

export default function Terms() {
  return (
    <div className="min-h-dvh bg-bg-base px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2">
          <Link to="/" className="text-xs text-accent hover:underline">← Back to Producty</Link>
          <h1 className="font-display text-3xl font-extrabold text-text-primary">Terms of Service</h1>
          <p className="text-sm text-text-muted">Last updated: {UPDATED}</p>
        </header>

        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using Producty (“the Service”), you agree to be bound by these Terms
            of Service. If you do not agree, please do not use the Service.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            Producty is a personal productivity application that provides task management, habit
            tracking, scheduling, note-taking, and AI-assisted features. The Service integrates
            with Google Calendar and Gmail with your explicit permission.
          </p>
        </Section>

        <Section title="3. Your Account">
          <ul className="list-disc space-y-1 pl-5">
            <li>You sign in using your Google account via OAuth 2.0.</li>
            <li>You are responsible for activity that occurs under your account.</li>
            <li>You must provide accurate information and not impersonate others.</li>
          </ul>
        </Section>

        <Section title="4. Acceptable Use">
          <p>You agree not to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Use the Service for any unlawful purpose or to send spam or malicious content.</li>
            <li>Attempt to gain unauthorized access to the Service or other users’ data.</li>
            <li>Interfere with or disrupt the integrity or performance of the Service.</li>
            <li>Use the email-sending feature to send unsolicited bulk or deceptive messages.</li>
          </ul>
        </Section>

        <Section title="5. AI-Generated Content">
          <p>
            The Service uses AI to generate plans, summaries, and email drafts. AI output may be
            inaccurate or incomplete. You are responsible for reviewing any AI-generated content —
            including emails — before sending or acting on it.
          </p>
        </Section>

        <Section title="6. Your Content">
          <p>
            You retain ownership of the content you create in the Service (tasks, notes, etc.).
            You grant us a limited license to store and process that content solely to operate the
            Service for you.
          </p>
        </Section>

        <Section title="7. Third-Party Services">
          <p>
            The Service relies on third-party providers including Google (Calendar, Gmail) and an
            AI provider (NVIDIA NIM). Your use of those integrations is also subject to their
            respective terms. Our use of Google APIs follows the Google API Services User Data Policy.
          </p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p>
            The Service is provided “as is” and “as available” without warranties of any kind,
            express or implied. We do not warrant that the Service will be uninterrupted, secure,
            or error-free.
          </p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>
            To the fullest extent permitted by law, the operator of Producty shall
            <strong className="text-text-primary"> not be liable for anything </strong>
            arising out of or related to your use of the Service. This includes, without limitation,
            any direct, indirect, incidental, special, consequential, punitive, or exemplary damages;
            any loss of data, profits, revenue, or goodwill; missed deadlines; unauthorized access to
            your account or data; service interruptions or errors; and any consequences of
            AI-generated content, including emails drafted or sent through the Service.
          </p>
          <p>
            You use the Service entirely at your own risk and are solely responsible for reviewing
            and verifying any AI-generated content before sending it or acting on it. In no event
            shall the operator’s total liability exceed the amount you paid to use the Service, which
            for a free service is zero.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            You may stop using the Service at any time and revoke access from your{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Google Account permissions
            </a>. We may suspend or terminate access if these Terms are violated.
          </p>
        </Section>

        <Section title="11. Changes to These Terms">
          <p>We may update these Terms from time to time. Continued use after changes constitutes acceptance of the updated Terms.</p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about these Terms? Contact:{" "}
            <a href="mailto:mj.prajnan@gmail.com" className="text-accent hover:underline">mj.prajnan@gmail.com</a>
          </p>
        </Section>

        <footer className="border-t border-border pt-6 text-xs text-text-muted">
          <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>
          <span className="mx-2">·</span>
          <Link to="/" className="text-accent hover:underline">Home</Link>
        </footer>
      </div>
    </div>
  );
}
