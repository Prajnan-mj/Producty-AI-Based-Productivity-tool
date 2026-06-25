import DocumentUploader from "../components/DocumentUploader";

export default function Documents() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 space-y-6">
      <h1 className="font-display text-xl font-extrabold">Document Analysis</h1>
      <p className="text-sm text-text-muted">Upload a document and AI will extract deadlines, action items, and create a step-by-step plan.</p>
      <DocumentUploader />
    </div>
  );
}
