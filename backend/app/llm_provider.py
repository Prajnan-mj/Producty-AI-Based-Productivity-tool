"""LLM Provider abstraction with Mock + Real (Gemini) implementations.

Select via env var LLM_PROVIDER=mock|gemini (default: gemini).
Every AI endpoint goes through this — swap by changing one env var.
"""
from __future__ import annotations

import json
import os
import random
from typing import Any

from app.config import settings


# ─── Interface ────────────────────────────────────────────────────

class LLMProvider:
    async def generate(
        self, system: str, prompt: str | list, *,
        temperature: float = 0.4, json_mode: bool = True,
        max_output_tokens: int | None = None,
    ) -> str:
        raise NotImplementedError


# ─── Real Gemini provider ────────────────────────────────────────

class RealProvider(LLMProvider):
    async def generate(self, system, prompt, **kwargs):
        from app.llm import genai_generate
        return await genai_generate(system, prompt, **kwargs)


# ─── Mock provider (realistic, varied, includes edge cases) ──────

_MOCK_RESPONSES: dict[str, list[dict]] = {
    "triage": [
        {
            "micro_steps": [
                {"title": "Outline key points", "minutes": 15, "order": 1},
                {"title": "Draft first section", "minutes": 30, "order": 2},
                {"title": "Draft second section", "minutes": 25, "order": 3},
                {"title": "Review and polish", "minutes": 20, "order": 4},
            ],
            "recommended_calendar_blocks": [
                {"start": "2026-06-25T18:00:00Z", "end": "2026-06-25T18:15:00Z", "title": "Outline"},
                {"start": "2026-06-25T18:15:00Z", "end": "2026-06-25T18:45:00Z", "title": "Draft pt 1"},
                {"start": "2026-06-25T19:00:00Z", "end": "2026-06-25T19:25:00Z", "title": "Draft pt 2"},
                {"start": "2026-06-25T19:30:00Z", "end": "2026-06-25T19:50:00Z", "title": "Polish"},
            ],
        },
    ],
    "capture": [
        {
            "items": [
                {"title": "Submit assignment 3 — data structures", "type": "task", "deadline_iso": "2026-06-28T23:59:00Z", "confidence": 0.92, "source_snippet": "assignment 3 due Friday"},
                {"title": "Team standup at 10am", "type": "event", "deadline_iso": "2026-06-26T10:00:00Z", "confidence": 0.85, "source_snippet": "standup tomorrow 10"},
                {"title": "Maybe schedule dentist?", "type": "reminder", "deadline_iso": None, "confidence": 0.35, "source_snippet": "should probably go to dentist"},
            ]
        },
    ],
    "next_action": [
        {"task_id": "placeholder", "reason": "This has the tightest deadline and fits your available window. Start with the outline — don't aim for perfection.", "suggested_subscope": "Just write the intro paragraph and bullet-point the structure."},
    ],
    "avoidance": [
        {"intervention": "Open the document and just write the first sentence. Literally one sentence. The inertia breaks once you start typing.", "type": "starter"},
        {"intervention": "This task is too vague — 'work on project' isn't actionable. Try: 'Write the methodology section (2 pages)'.", "type": "reframe"},
        {"intervention": "You've deferred this 7 times in 3 weeks. Ask yourself honestly: if this disappeared, would anything bad happen? Consider explicitly dropping it.", "type": "drop"},
    ],
    "defrag": [
        {
            "proposed_changes": [
                {"event_id": "mock-1", "title": "Coffee with Alex", "action": "move", "reason": "Social — can reschedule", "new_start": "2026-06-27T15:00:00Z", "new_end": "2026-06-27T16:00:00Z"},
                {"event_id": "mock-2", "title": "Team standup", "action": "keep", "reason": "Work-critical, can't move"},
            ],
            "crisis_slots": [
                {"start": "2026-06-25T14:00:00Z", "end": "2026-06-25T15:30:00Z", "title": "Crisis work block 1"},
                {"start": "2026-06-25T16:00:00Z", "end": "2026-06-25T17:00:00Z", "title": "Crisis work block 2"},
            ],
        },
    ],
    "meeting_prep": [
        {
            "brief": "Review the Q3 roadmap changes from last week. Sarah owes a status update on the API migration.",
            "unresolved_actions": ["Sarah: complete API migration plan", "Dev team: finalize test coverage targets"],
            "discussion_questions": ["Are we on track for the August milestone given the API delay?", "Should we re-scope the dashboard feature to hit the deadline?"],
            "relevant_deadlines": ["API migration plan due June 30", "Q3 OKR check-in July 1"],
        },
    ],
    "syllabus": [
        {
            "deadlines": [
                {"title": "Problem Set 1", "due_date": "2026-09-15T23:59:00Z", "weight_pct": 5, "course_name": "CS 201"},
                {"title": "Midterm Exam", "due_date": "2026-10-20T14:00:00Z", "weight_pct": 25, "course_name": "CS 201"},
                {"title": "Final Project", "due_date": "2026-12-10T23:59:00Z", "weight_pct": 30, "course_name": "CS 201"},
            ]
        },
    ],
    "coordinate": [
        {
            "feasible": True,
            "warning": None,
            "assignments": [
                {"user_id": "placeholder", "name": "Alice", "subtask": "Research and outline", "hours": 3},
                {"user_id": "placeholder", "name": "Bob", "subtask": "Build the slides", "hours": 3},
                {"user_id": "placeholder", "name": "Carol", "subtask": "Write the report", "hours": 2},
            ],
        },
    ],
    "chunk": [
        {"steps": ["Read the assignment brief (5 min)", "Outline your approach in bullet points", "Write the first section", "Write the second section", "Proofread and submit"]},
    ],
    "prioritize": [
        {"tasks": []},
    ],
    "daily_plan": [
        {
            "morning_blocks": [{"time": "09:00", "activity": "Deep work: most urgent task", "item_type": "task"}],
            "afternoon_blocks": [{"time": "14:00", "activity": "Email + admin", "item_type": "task"}],
            "evening_blocks": [{"time": "19:00", "activity": "Review tomorrow", "item_type": "break"}],
            "top_3_priorities": ["Finish the report", "Reply to client email", "Prepare for standup"],
            "risk_items": ["Report deadline is tight"],
            "motivational_message": "You've got this — focus on one thing at a time.",
        },
    ],
    "focus": [
        "Focus only on your most urgent task for the next 25 minutes. Everything else can wait.",
    ],
    "categorize": ["professional"],
    "note_ai": [
        {"result": "This note covers three main topics: project timeline, team assignments, and budget constraints. Key action items include finalizing the Q3 roadmap and scheduling stakeholder reviews."},
    ],
    "generate_cards": [
        {
            "cards": [
                {"front": "What is the time complexity of binary search?", "back": "O(log n) — it halves the search space each step."},
                {"front": "Define Big-O notation", "back": "An upper bound on growth rate — f(n) is O(g(n)) if f(n) ≤ c·g(n) for large n."},
                {"front": "What is a hash collision?", "back": "When two different keys map to the same index in a hash table."},
            ]
        },
    ],
}

# Deliberately malformed responses for error-handling exercise
_EDGE_CASES = [
    '{"items": "not an array"}',  # wrong type
    '{"micro_steps": [{"title": "", "minutes": -5}]}',  # empty title, negative minutes
    'This is not JSON at all, just plain text response',  # not JSON
]


def _pick(key: str) -> str:
    if key in _MOCK_RESPONSES:
        choice = random.choice(_MOCK_RESPONSES[key])
        if isinstance(choice, str):
            return choice
        return json.dumps(choice)
    return json.dumps({"result": "Mock response — no specific handler for this prompt."})


def _detect_intent(system: str, prompt: str | list) -> str:
    text = (system + " " + (prompt if isinstance(prompt, str) else str(prompt))).lower()
    if "rescue" in text or "micro_steps" in text or "deadline rescue" in text:
        return "triage"
    if "capture" in text or "universal capture" in text or "actionable items" in text:
        return "capture"
    if "exactly one task" in text or "next-action" in text or "recommend exactly" in text:
        return "next_action"
    if "deferred" in text or "intervention" in text or "avoidance" in text:
        return "avoidance"
    if "calendar blocks" in text or "move/shrink" in text or "defrag" in text:
        return "defrag"
    if "prep brief" in text or "meeting prep" in text or "discussion questions" in text:
        return "meeting_prep"
    if "syllabus" in text or "gradeable" in text:
        return "syllabus"
    if "action item" in text and "meeting" in text:
        return "syllabus"  # reuse
    if "coordinate" in text or "sub-task split" in text or "fair" in text:
        return "coordinate"
    if "break" in text and "steps" in text and "chunk" in text.replace("break", ""):
        return "chunk"
    if "daily" in text and "schedule" in text:
        return "daily_plan"
    if "focus coach" in text or "25 minutes" in text:
        return "focus"
    if "classify" in text and "meeting" in text:
        return "categorize"
    if "flashcard" in text or "question/answer" in text:
        return "generate_cards"
    if "summarize" in text or "note" in text:
        return "note_ai"
    if "priorit" in text:
        return "prioritize"
    return "capture"


class MockLLMProvider(LLMProvider):
    """Returns realistic mock responses matched by intent detection on the prompt."""

    async def generate(self, system, prompt, **kwargs):
        intent = _detect_intent(system, prompt)
        # 5% chance of returning an edge case to exercise error handling
        if random.random() < 0.05:
            return random.choice(_EDGE_CASES)
        return _pick(intent)


# ─── Factory ─────────────────────────────────────────────────────

def get_llm_provider() -> LLMProvider:
    mode = os.environ.get("LLM_PROVIDER", settings.__dict__.get("LLM_PROVIDER", "nvidia")).lower()
    if mode == "mock":
        return MockLLMProvider()
    return RealProvider()


llm = get_llm_provider()
