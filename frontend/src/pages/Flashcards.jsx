import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchDecks, fetchCards, createCard, reviewCard, deleteCard, generateCards,
} from "../lib/queries";

/* ----------------------------------------------------------------- */
/* Add-card modal                                                     */
/* ----------------------------------------------------------------- */
function AddCardModal({ open, onClose, onCreate, defaultDeck }) {
  const [deck, setDeck] = useState(defaultDeck || "General");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  useEffect(() => { if (open) { setDeck(defaultDeck || "General"); setFront(""); setBack(""); } }, [open, defaultDeck]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-text-primary">New flashcard</h2>
        <input value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="Deck"
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} placeholder="Front (question)"
          className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={2} placeholder="Back (answer)"
          className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={() => front.trim() && back.trim() && onCreate({ deck: deck.trim() || "General", front, back })}
            disabled={!front.trim() || !back.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent disabled:opacity-50">Add</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* AI generate modal                                                  */
/* ----------------------------------------------------------------- */
function GenerateModal({ open, onClose, onGenerate, pending, defaultDeck }) {
  const [topic, setTopic] = useState("");
  const [deck, setDeck] = useState(defaultDeck || "");
  const [count, setCount] = useState(8);
  useEffect(() => { if (open) { setTopic(""); setDeck(defaultDeck || ""); setCount(8); } }, [open, defaultDeck]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-text-primary">Generate with AI</h2>
        <p className="text-xs text-text-muted">Describe a topic and Producty drafts a deck for you.</p>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} autoFocus
          placeholder="e.g. The French Revolution causes and key events"
          className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <div className="flex gap-2">
          <input value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="Deck name (optional)"
            className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))}
            className="w-20 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={() => topic.trim() && onGenerate({ topic: topic.trim(), deck: deck.trim() || (topic.trim().slice(0, 40)), count })}
            disabled={!topic.trim() || pending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent disabled:opacity-50">
            {pending ? "Generating…" : "Generate"}</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Study mode                                                         */
/* ----------------------------------------------------------------- */
function Study({ deck, onExit }) {
  const qc = useQueryClient();
  const cardsQ = useQuery({ queryKey: ["cards", deck, "due"], queryFn: () => fetchCards(deck, true) });
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const cards = cardsQ.data || [];
  const card = cards[idx];

  const reviewMut = useMutation({
    mutationFn: ({ id, grade }) => reviewCard(id, grade),
    onSuccess: () => { setFlipped(false); setIdx((i) => i + 1); },
    onError: () => toast.error("Couldn't save review"),
  });

  const finish = () => { qc.invalidateQueries({ queryKey: ["decks"] }); onExit(); };

  if (cardsQ.isLoading) return <p className="p-8 text-sm text-text-muted">Loading cards…</p>;

  if (!card) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="text-4xl">🎉</p>
        <p className="text-lg text-text-primary">{cards.length === 0 ? "Nothing due in this deck." : "Deck complete for now!"}</p>
        <p className="text-sm text-text-muted">Come back later — spaced repetition will resurface these.</p>
        <button onClick={finish} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent">Back to decks</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-6">
      <div className="mb-4 flex items-center justify-between text-xs text-text-muted">
        <button onClick={finish} className="hover:text-text-primary">← {deck}</button>
        <span>{idx + 1} / {cards.length}</span>
      </div>

      <button onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[240px] w-full flex-col items-center justify-center rounded-2xl border border-border bg-bg-surface p-8 text-center transition hover:border-accent/40">
        <span className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{flipped ? "Answer" : "Question"}</span>
        <p className="text-lg leading-relaxed text-text-primary">{flipped ? card.back : card.front}</p>
        {!flipped && <span className="mt-4 text-xs text-text-muted">Tap to reveal</span>}
      </button>

      {flipped ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button onClick={() => reviewMut.mutate({ id: card.id, grade: "again" })}
            className="rounded-lg bg-accent-red/20 py-2.5 text-sm font-semibold text-accent-red hover:bg-accent-red/30">Again</button>
          <button onClick={() => reviewMut.mutate({ id: card.id, grade: "good" })}
            className="rounded-lg bg-bg-elevated py-2.5 text-sm font-semibold text-text-primary hover:brightness-110">Good</button>
          <button onClick={() => reviewMut.mutate({ id: card.id, grade: "easy" })}
            className="rounded-lg bg-accent py-2.5 text-sm font-bold text-text-onaccent hover:brightness-105">Easy</button>
        </div>
      ) : (
        <button onClick={() => setFlipped(true)}
          className="mt-4 w-full rounded-lg bg-bg-elevated py-2.5 text-sm font-semibold text-text-primary hover:brightness-110">Show answer</button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Page                                                               */
/* ----------------------------------------------------------------- */
export default function Flashcards() {
  const qc = useQueryClient();
  const decksQ = useQuery({ queryKey: ["decks"], queryFn: fetchDecks });
  const [studyDeck, setStudyDeck] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);

  const decks = decksQ.data || [];

  const createMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["decks"] }); setAddOpen(false); toast.success("Card added"); },
    onError: () => toast.error("Couldn't add card"),
  });

  const genMut = useMutation({
    mutationFn: generateCards,
    onSuccess: (cards) => { qc.invalidateQueries({ queryKey: ["decks"] }); setGenOpen(false); toast.success(`${cards.length} cards generated`); },
    onError: () => toast.error("AI generation failed — check your Gemini key"),
  });

  if (studyDeck) {
    return (
      <div className="px-6 py-6">
        <Study deck={studyDeck} onExit={() => setStudyDeck(null)} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Flashcards</h1>
          <p className="text-sm text-text-muted">Spaced repetition — Producty resurfaces cards right before you'd forget them.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setGenOpen(true)}
            className="rounded-lg bg-accent/10 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/20">✨ AI generate</button>
          <button onClick={() => setAddOpen(true)}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-text-onaccent hover:brightness-105">+ Card</button>
        </div>
      </div>

      {decksQ.isLoading ? (
        <p className="text-sm text-text-muted">Loading decks…</p>
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-4xl">🗂️</p>
          <p className="mt-3 text-text-primary">No decks yet.</p>
          <p className="mt-1 text-sm text-text-muted">Add a card by hand, or let AI generate a whole deck from a topic.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => setGenOpen(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent">✨ Generate a deck</button>
            <button onClick={() => setAddOpen(true)} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm font-semibold text-text-primary">+ Add a card</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((d) => (
            <div key={d.deck} className="flex flex-col rounded-2xl border border-border bg-bg-surface p-5">
              <h3 className="truncate font-display text-lg text-text-primary">{d.deck}</h3>
              <p className="mt-1 text-sm text-text-muted">{d.total} card{d.total === 1 ? "" : "s"}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className={`text-sm font-semibold ${d.due > 0 ? "text-accent" : "text-text-muted"}`}>
                  {d.due > 0 ? `${d.due} due` : "All caught up"}
                </span>
                <button onClick={() => setStudyDeck(d.deck)}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-text-onaccent hover:brightness-105">Study</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddCardModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={(d) => createMut.mutate(d)} defaultDeck={decks[0]?.deck} />
      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} onGenerate={(d) => genMut.mutate(d)} pending={genMut.isPending} defaultDeck={decks[0]?.deck} />
    </div>
  );
}
