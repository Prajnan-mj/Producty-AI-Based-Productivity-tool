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
          <p>When you sign in with Google, with your explicit consent, we request the following OAuth scopes:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-text-primary">openid</strong> — associates you with your Google identity for authentication.</li>
            <li><strong className="text-text-primary">…/auth/userinfo.email</strong> — your primary Google email address, used to create and identify your account.</li>
            <li><strong className="text-text-primary">…/auth/userinfo.profile</strong> — your name and profile picture, shown in the app interface.</li>
            <li><strong className="text-text-primary">…/auth/calendar</strong> — your Google Calendar events, used to display your meetings and deadlines and to help plan your day.</li>
            <li><strong className="text-text-primary">…/auth/gmail.readonly</strong> — read-only access used solely to scan recent emails for actionable tasks and deadlines you can choose to import. We never read, store, or transmit your full inbox.</li>
            <li><strong className="text-text-primary">…/auth/gmail.send</strong> — used only when you explicitly draft and click “Send” to send an email on your behalf. We never send anything automatically.</li>
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

        <Section title="Disclaimer and Limitation of Liability">
          <p>
            Producty is provided on an “as is” and “as available” basis, without warranties of any
            kind, whether express or implied. To the fullest extent permitted by law, the operator
            of Producty accepts <strong className="text-text-primary">no liability whatsoever</strong> for
            any direct, indirect, incidental, special, consequential, or exemplary damages — including
            but not limited to loss of data, loss of profits, missed deadlines, unauthorized access,
            service interruptions, or any consequences arising from AI-generated content (such as
            emails drafted or sent through the app) — even if advised of the possibility of such damages.
          </p>
          <p>
            You use Producty entirely at your own risk. You are solely responsible for reviewing all
            AI-generated content before relying on or sending it, and for any actions taken through
            the Service. By using Producty you acknowledge and accept that the operator is not liable
            for any outcome related to your use of the app.
          </p>
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
