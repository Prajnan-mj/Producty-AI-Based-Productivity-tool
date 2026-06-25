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

export default function Privacy() {
  return (
    <div className="min-h-dvh bg-bg-base px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2">
          <Link to="/" className="text-xs text-accent hover:underline">← Back to Producty</Link>
          <h1 className="font-display text-3xl font-extrabold text-text-primary">Privacy Policy</h1>
          <p className="text-sm text-text-muted">Last updated: {UPDATED}</p>
        </header>

        <Section title="Overview">
          <p>
            Producty (“we”, “us”, “the app”) is a personal productivity tool that helps you
            manage tasks, deadlines, habits, goals, notes, and your schedule, with optional
            AI assistance. This policy explains what data we access, why, and how we protect it.
          </p>
        </Section>

        <Section title="Information We Collect">
          <p>When you sign in with Google, with your explicit consent, we access:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-text-primary">Profile information</strong> — your name, email address, and profile picture, used to create and identify your account.</li>
            <li><strong className="text-text-primary">Google Calendar</strong> — your calendar events, used to display your meetings and deadlines inside the app and to help plan your day.</li>
            <li><strong className="text-text-primary">Gmail (read-only)</strong> — we scan recent emails only to detect actionable tasks and deadlines that you can choose to import. We never read, store, or transmit your full inbox.</li>
            <li><strong className="text-text-primary">Gmail (send)</strong> — only when you explicitly draft and click “Send,” we send an email on your behalf. We do not send anything automatically.</li>
          </ul>
          <p>We also store the content you create in the app: tasks, notes, habits, goals, bills, and journal entries.</p>
        </Section>

        <Section title="How We Use Your Information">
          <ul className="list-disc space-y-1 pl-5">
            <li>To display your tasks, meetings, and deadlines in one place.</li>
            <li>To generate AI-assisted plans, summaries, task breakdowns, and email drafts at your request.</li>
            <li>To authenticate you and keep your data separate from other users.</li>
          </ul>
          <p>We do <strong className="text-text-primary">not</strong> sell your data, use it for advertising, or share it with third parties for their own purposes.</p>
        </Section>

        <Section title="Google User Data and Limited Use">
          <p>
            Producty’s use of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Google API Services User Data Policy
            </a>, including the Limited Use requirements. Specifically:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>We only use Google user data to provide and improve the features you use.</li>
            <li>We do not transfer or sell Google user data for advertising, market research, or other unrelated purposes.</li>
            <li>We do not allow humans to read your Google user data unless you give explicit consent, it is necessary for security, or it is required by law.</li>
          </ul>
        </Section>

        <Section title="AI Processing">
          <p>
            When you use an AI feature, the relevant content (for example, a task description or
            an email instruction you provide) is sent to our AI provider (NVIDIA NIM) to generate
            a response. This content is transmitted securely and is used only to produce the
            requested output. Do not submit information you do not wish to be processed by an AI model.
          </p>
        </Section>

        <Section title="Data Storage and Security">
          <ul className="list-disc space-y-1 pl-5">
            <li>Data is stored in a managed PostgreSQL database with access controls.</li>
            <li>All traffic is encrypted in transit over HTTPS.</li>
            <li>Authentication uses Google OAuth 2.0 — we never see or store your Google password.</li>
            <li>Access tokens are stored securely and used only to make the API calls you authorized.</li>
          </ul>
        </Section>

        <Section title="Data Retention and Deletion">
          <p>
            We retain your data while your account is active. You can request deletion of your
            account and all associated data at any time by emailing us at the address below.
            Revoking access from your{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Google Account permissions
            </a>{" "}
            immediately stops all further access to your Google data.
          </p>
        </Section>

        <Section title="Children's Privacy">
          <p>Producty is not directed to children under 13, and we do not knowingly collect their data.</p>
        </Section>

        <Section title="Changes to This Policy">
          <p>We may update this policy from time to time. The “Last updated” date reflects the most recent change.</p>
        </Section>

        <Section title="Contact">
          <p>
            For privacy questions or data deletion requests, contact:{" "}
            <a href="mailto:mj.prajnan@gmail.com" className="text-accent hover:underline">mj.prajnan@gmail.com</a>
          </p>
        </Section>

        <footer className="border-t border-border pt-6 text-xs text-text-muted">
          <Link to="/terms" className="text-accent hover:underline">Terms of Service</Link>
          <span className="mx-2">·</span>
          <Link to="/" className="text-accent hover:underline">Home</Link>
        </footer>
      </div>
    </div>
  );
}
