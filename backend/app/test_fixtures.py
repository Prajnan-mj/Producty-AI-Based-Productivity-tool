"""Test fixtures: 30 realistic messy inputs for testing AI parsing.

These are wired into the mock provider's responses and can be replayed against
the real provider by running:
    LLM_PROVIDER=gemini python -m app.test_fixtures
"""
from __future__ import annotations

VOICE_TRANSCRIPTS = [
    "I have an exam tomorrow at 9am and haven't started studying",
    "ugh I need to submit the lab report by like thursday or whenever",
    "remind me to pay the electricity bill its like 2400 rupees due on the 15th",
    "set up a meeting with prof sharma at 3pm day after tomorrow about the thesis",
    "I need to buy groceries milk eggs bread and also return the library books",
    "my rent is due in 3 days twelve thousand rupees monthly",
    "oh god the project presentation is in 6 hours and my slides arent done",
    "add a habit to meditate for 10 minutes every morning",
    "I should probably start working on the resume for internship applications",
    "cancel the gym membership no wait just remind me to go tomorrow at 7am",
]

EMAIL_DUMPS = [
    """Subject: CS 201 - Assignment 3 Due Date Change
    Dear students, please note that Assignment 3 (Linked Lists & Trees)
    is now due on Friday, July 4th at 11:59 PM IST instead of July 1st.
    Late submissions will incur a 10% penalty per day. The assignment is
    worth 15% of your final grade.""",

    """Hey team, quick update from today's standup:
    - @sarah: finalize the API migration plan by EOD Thursday
    - @raj: the staging deploy is blocked on the config fix, needs to be done today
    - @everyone: client demo moved to next Monday 2pm, prep slides by Friday
    Sprint velocity is looking tight, let's skip the retro this week.""",

    """Your Netflix subscription of $15.99 will be charged on June 30, 2026.
    Your Spotify Premium ($9.99) payment failed. Please update your payment method.""",
]

SYLLABUS_TEXT = """
CS 201: Data Structures and Algorithms — Fall 2026
Instructor: Dr. Priya Sharma

Assessment Breakdown:
- Problem Set 1 (5%): Due Sep 15
- Problem Set 2 (5%): Due Oct 1
- Problem Set 3 (5%): Due Oct 15
- Midterm Exam (25%): Oct 20, 2:00-4:00 PM, Room 301
- Problem Set 4 (5%): Due Nov 1
- Problem Set 5 (5%): Due Nov 15
- Final Project Proposal (5%): Due Nov 20
- Final Project (15%): Due Dec 10
- Final Exam (30%): Dec 18, 9:00 AM - 12:00 PM

Attendance: Mandatory for all lab sessions (Tuesdays 2-4 PM).
Missing more than 3 labs results in an automatic grade reduction.
"""

AMBIGUOUS_INPUTS = [
    "by EOD Thursday or whenever, no rush really",
    "do the thing for sarah, you know what i mean",
    "something about taxes idk my dad mentioned it",
    "fix the bug maybe? or don't, it's a feature lol",
    "I'll do it later",
    "muy importante hacer la tarea de matematicas para el viernes",  # Spanish mixed
    "meeting with 田中さん about the Tokyo project at 15:00 JST",  # Japanese name
]

GARBLED_VOICE = [
    "I knee to sub mitt the the report buy friday",
    "add a task for uhh um cleaning the the apartment",
    "set reminder for [inaudible] at 3pm no wait 4pm actually yeah 4",
    "billpay amazon prime ninety nine dollars monthly recurring",
]

WHITEBOARD_OCR_SIMULATION = """
Sprint Planning - Week 26
=========================
[  ] API refactor (raj) - 3 pts
[  ] Auth bug #412 (sarah) - 2 pts
[  ] Dashboard redesign (everyone) - 8 pts
[  ] Write tests for billing module - 5 pts

Deadline: July 2 (hard)
Retro: skipped this sprint
Demo: Monday July 7 @ 2pm
"""

ALL_FIXTURES = (
    [("voice", t) for t in VOICE_TRANSCRIPTS] +
    [("email", e) for e in EMAIL_DUMPS] +
    [("syllabus", SYLLABUS_TEXT)] +
    [("ambiguous", a) for a in AMBIGUOUS_INPUTS] +
    [("garbled", g) for g in GARBLED_VOICE] +
    [("whiteboard", WHITEBOARD_OCR_SIMULATION)]
)


if __name__ == "__main__":
    import asyncio
    import json
    import os
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    from app.llm_provider import get_llm_provider

    async def main():
        provider = get_llm_provider()
        mode = os.environ.get("LLM_PROVIDER", "gemini")
        print(f"Running {len(ALL_FIXTURES)} fixtures against {mode} provider\n")

        system = (
            "You are a universal capture parser. Extract actionable items. "
            'Return JSON: {"items": [{"title": "...", "type": "task|event|bill|reminder", '
            '"deadline_iso": "...|null", "confidence": 0.0-1.0, "source_snippet": "..."}]}'
        )

        for i, (kind, text) in enumerate(ALL_FIXTURES):
            print(f"[{i+1}/{len(ALL_FIXTURES)}] {kind}: {text[:60]}...")
            try:
                raw = await provider.generate(system, text, temperature=0.2)
                data = json.loads(raw)
                items = data.get("items", [])
                print(f"  -> {len(items)} items extracted")
                for it in items[:3]:
                    print(f"    * {it.get('title', '?')[:50]} ({it.get('type')}, {it.get('confidence', 0):.0%})")
            except json.JSONDecodeError:
                print(f"  -> PARSE ERROR: not valid JSON")
            except Exception as e:
                print(f"  -> ERROR: {type(e).__name__}: {str(e)[:80]}")
            print()

    asyncio.run(main())
