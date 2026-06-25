# Producty - AI-Powered Productivity Tool

A full-stack AI productivity application that combines task management, habit tracking, smart scheduling, document analysis, and an AI assistant — all powered by NVIDIA NIM (LLaMA 3.3 70B). Built with FastAPI and React.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Deployment](#deployment)
- [Security](#security)
- [Screenshots](#screenshots)

---

## Features

### Core Productivity
- **Task Management** — Create, prioritize, and track tasks with deadlines, urgency scoring, and AI-powered breakdowns
- **Smart Dashboard** — Personalized daily overview with urgency feed, habit rings, upcoming meetings, and bills
- **Calendar Integration** — Google Calendar sync with automatic meeting categorization (personal/professional)
- **Habit Tracker** — Daily/weekly habits with streak tracking, completion stats, and visual progress rings
- **Goal Setting** — Long-term goals with milestone tracking, progress visualization, and AI-generated action plans
- **Bill Management** — Track bills with due dates, recurrence, currency support (INR/USD), and autopay status

### AI-Powered Features
- **AI Chat Assistant** — Conversational AI (sidebar panel) with full context of your tasks, meetings, and goals. Gives concise, actionable answers under 100 words
- **AI Daily Plan** — Auto-generated morning/afternoon/evening schedule based on your tasks and priorities
- **Smart Capture** — Paste text, upload images, or upload PDFs and let AI extract tasks, deadlines, and action items automatically
- **Document Analysis** — Upload PDFs, DOCX, or images for AI-powered content extraction and summarization
- **AI Flashcard Generator** — Automatically generate study flashcards from any document or topic
- **Procrastination Detector** — AI flags tasks you keep pushing back and suggests concrete next steps
- **AI Task Breakdown** — Break complex tasks into manageable sub-tasks with time estimates

### Focus & Wellness
- **Focus Timer** — Pomodoro-style timer with AI context about what to work on and why
- **Mood Check-in** — Quick mood logging that triggers AI-powered task reprioritization based on energy levels
- **Panic Mode** — When overwhelmed, get an instant 48-hour survival plan. Generates a shareable link for accountability
- **Rescue Page** — Emergency triage view showing only what matters right now

### Notes
- **Notion-Style Editor** — Full Tiptap-based rich text editor with:
  - Slash commands (headings, lists, code blocks, tables, callouts, toggles)
  - Bubble toolbar for inline formatting
  - Task lists with checkboxes
  - Code blocks with syntax highlighting (lowlight)
  - Tables with column resizing
  - Image embedding
  - Character count
- **Folder Organization** — Nested folder structure with drag-and-drop
- **AI Writing Assistant** — Summarize, expand, fix grammar, or change tone of selected text
- **Export** — PDF and HTML export for any note
- **Favorites & Search** — Pin important notes, quick-filter by title

### Additional Features
- **Countdown Mode** — Visual countdown timers for exams, interviews, or deadlines with AI prep plans
- **Journal** — Daily journaling with AI reflection prompts
- **Voice Commands** — Speech-to-action (create tasks, set meetings, add habits via voice) — *currently disabled in UI, backend ready*
- **Command Palette** — `Ctrl/Cmd+K` to quickly navigate anywhere
- **Keyboard Shortcuts** — Press `?` to see all shortcuts
- **Cursor Glow** — Subtle yellow glow follows your cursor on interactive elements

---

## Tech Stack

### Backend
| Technology | Purpose |
|---|---|
| **Python 3.11** | Runtime |
| **FastAPI** | Async REST API framework |
| **SQLAlchemy 2.0** | Async ORM with PostgreSQL |
| **asyncpg** | PostgreSQL async driver |
| **NVIDIA NIM** | LLM provider (LLaMA 3.3 70B via OpenAI-compatible API) |
| **Google OAuth 2.0** | Authentication (no passwords stored) |
| **Pydantic v2** | Request/response validation + settings |
| **python-jose** | JWT token generation/validation |
| **pypdf / python-docx / Pillow** | Document parsing (PDF, DOCX, images) |
| **Redis** | Caching (optional, for production) |
| **APScheduler** | Background job scheduling |

### Frontend
| Technology | Purpose |
|---|---|
| **React 19** | UI framework |
| **Vite 8** | Build tool + dev server |
| **Tailwind CSS 4** | Utility-first styling |
| **Tiptap** | Rich text editor (Notion-style) |
| **Framer Motion** | Animations and transitions |
| **React Query (TanStack)** | Server state management + caching |
| **Zustand** | Client state (sidebar, AI panel) |
| **Recharts** | Charts and data visualization |
| **Lenis** | Smooth scrolling |
| **React Router v7** | Client-side routing |
| **react-hot-toast** | Toast notifications |
| **jsPDF + html2canvas** | PDF export |
| **dnd-kit** | Drag and drop |

### Infrastructure
| Technology | Purpose |
|---|---|
| **PostgreSQL** | Primary database |
| **Docker** | Containerization (non-root user) |
| **Nginx** | Frontend static server + API reverse proxy |
| **Render** | Deployment platform (render.yaml included) |

---

## Architecture

```
Browser
  |
  |--- React SPA (Nginx, port 80)
  |       |
  |       |--- /api/* ---> FastAPI (uvicorn, port 8000)
  |                             |
  |                             |--- PostgreSQL (asyncpg)
  |                             |--- NVIDIA NIM API (LLaMA 3.3 70B)
  |                             |--- Google OAuth 2.0
  |                             |--- Google Calendar API
```

**Auth flow:** Google OAuth 2.0 only — no passwords are ever stored. The `User` model has no password column. Login redirects to Google, callback exchanges a one-time code for a JWT (HS256, 60-min expiry).

**AI flow:** All LLM calls go through a unified OpenAI-compatible client (`app/openai_client.py`) that points at NVIDIA NIM. The client includes a safety interceptor that handles empty `choices` responses (content filter triggers) so `choices[0]` never throws.

---

## Project Structure

```
Producty/
├── backend/
│   ├── app/
│   │   ├── routers/           # API route handlers
│   │   │   ├── ai.py          # AI chat, daily plan, agent prompt, focus
│   │   │   ├── auth.py        # Google OAuth login/callback/refresh
│   │   │   ├── bills.py       # Bill CRUD + upcoming bills
│   │   │   ├── calendar.py    # Google Calendar sync + meetings
│   │   │   ├── capture.py     # Smart capture (text/image/PDF → tasks)
│   │   │   ├── countdown.py   # Exam/interview countdowns
│   │   │   ├── deadlines.py   # Deadline summary + snooze + timeline
│   │   │   ├── documents.py   # Document upload + AI analysis
│   │   │   ├── flashcards.py  # AI flashcard generation
│   │   │   ├── goals.py       # Goals + milestones + AI breakdown
│   │   │   ├── habits.py      # Habit CRUD + streaks + stats
│   │   │   ├── infra.py       # Procrastination detection + momentum
│   │   │   ├── journal.py     # Daily journal entries
│   │   │   ├── mood.py        # Mood check-in + reprioritization
│   │   │   ├── notes.py       # Notes CRUD + folders + AI assist
│   │   │   ├── panic.py       # Panic mode triage + shareable links
│   │   │   ├── rooms.py       # Peer accountability rooms
│   │   │   ├── tasks.py       # Task CRUD + urgency + Gmail import
│   │   │   ├── triage.py      # AI triage + micro-step generation
│   │   │   └── voice.py       # Voice command parse + execute
│   │   ├── services/
│   │   │   ├── ai_service.py  # Document analysis AI pipeline
│   │   │   └── google_service.py  # Google Calendar/Gmail integration
│   │   ├── config.py          # Pydantic settings (env vars)
│   │   ├── database.py        # SQLAlchemy async engine + session
│   │   ├── main.py            # FastAPI app, middleware, lifespan
│   │   ├── models.py          # All SQLAlchemy ORM models
│   │   ├── openai_client.py   # Unified LLM client (NVIDIA/Gemini/OpenAI)
│   │   ├── security.py        # JWT validation + get_current_user
│   │   └── security_utils.py  # Rate limiting, file validation, prompt injection defense
│   ├── Dockerfile
│   ├── requirements.txt       # Pinned dependencies
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   │   ├── AIPanel.jsx    # AI sidebar (Daily Plan, Chat, Agent tabs)
│   │   │   ├── editor/        # Tiptap editor components
│   │   │   └── ...
│   │   ├── pages/             # Route-level page components
│   │   ├── hooks/             # Custom React hooks (useVoice)
│   │   ├── lib/               # API client, queries, chat streaming
│   │   ├── store/             # Zustand stores (ui, user)
│   │   ├── App.jsx            # App shell (sidebar + main + AI panel)
│   │   ├── main.jsx           # Router + providers
│   │   └── index.css          # Theme, Tiptap styles, animations
│   ├── Dockerfile
│   ├── nginx.conf             # Local dev nginx config
│   ├── nginx.conf.template    # Production nginx (envsubst for API_URL)
│   └── package.json
├── render.yaml                # One-click Render deployment blueprint
├── SECURITY_AUDIT.md          # Full security audit report
└── README.md
```

---

## Prerequisites

- **Node.js** 20+
- **Python** 3.11+
- **PostgreSQL** 14+
- **Google Cloud Console** project with OAuth 2.0 credentials
- **NVIDIA NIM API key** ([build.nvidia.com](https://build.nvidia.com))

---

## Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/Prajnan-mj/Producty-AI-Based-Productivity-tool.git
cd Producty-AI-Based-Productivity-tool
```

### 2. Backend setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your actual keys (see Environment Variables below)

# Create the database
createdb producty_db  # or use pgAdmin / psql

# Start the backend
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend setup

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api/*` to `http://localhost:8000`.

### 4. Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. Enable **Google Calendar API** and **Gmail API**
4. Go to **Credentials** → **Create OAuth 2.0 Client ID**
5. Set **Authorized redirect URIs** to: `http://localhost:8000/api/auth/google/callback`
6. Copy `Client ID` and `Client Secret` into your `.env`

---

## Environment Variables

Create `backend/.env` with the following:

```env
# Database
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/producty_db

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback

# NVIDIA NIM (get a key at https://build.nvidia.com)
NVIDIA_API_KEY=nvapi-your_key_here
NVIDIA_MODEL=meta/llama-3.3-70b-instruct
LLM_PROVIDER=nvidia

# JWT Secret (generate with: python -c "import secrets; print(secrets.token_hex(32))")
SECRET_KEY=your_random_64_char_hex_string

# Environment
DEBUG=true
FRONTEND_URL=http://localhost:5173
```

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/google/login` | Get Google OAuth login URL |
| GET | `/api/auth/google/callback` | OAuth callback (redirects with one-time code) |
| POST | `/api/auth/google/exchange` | Exchange one-time code for JWT |
| POST | `/api/auth/refresh` | Refresh JWT token |

### Tasks
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | List tasks (filterable by status, priority) |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/{id}` | Update a task |
| DELETE | `/api/tasks/{id}` | Delete a task |
| GET | `/api/tasks/urgent` | Get urgent tasks sorted by deadline |
| POST | `/api/tasks/{id}/break-into-chunks` | AI-break task into sub-tasks |

### AI
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/ai/chat` | Streaming AI chat (SSE) |
| GET | `/api/ai/daily-plan` | AI-generated daily schedule |
| GET | `/api/ai/agent-prompt` | Export prompt for external AI agents |
| GET | `/api/ai/focus` | AI focus suggestion |
| POST | `/api/ai/prioritize-now` | AI re-prioritize all tasks |

### Calendar
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/calendar/sync` | Sync Google Calendar events |
| GET | `/api/calendar/meetings` | List meetings in date range |

### Documents & Capture
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/documents/upload` | Upload + AI-analyze a document |
| POST | `/api/capture/parse` | Smart capture (text/image/PDF → structured tasks) |

### Notes
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/notes` | List all notes |
| POST | `/api/notes` | Create a note |
| PATCH | `/api/notes/{id}` | Update note content/title |
| DELETE | `/api/notes/{id}` | Delete a note |
| POST | `/api/notes/{id}/ai-assist` | AI writing assistance |
| POST | `/api/notes/folders` | Create a folder |

### Other
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/habits/*` | Habit CRUD + completion + stats |
| GET/POST | `/api/goals/*` | Goal CRUD + milestones + AI breakdown |
| GET/POST | `/api/bills/*` | Bill CRUD + upcoming |
| GET/POST | `/api/journal/*` | Journal entry CRUD |
| GET/POST | `/api/flashcards/*` | AI flashcard generation |
| POST | `/api/panic/start` | Start panic mode triage |
| GET | `/api/panic/share/{token}` | Public shareable panic plan |
| POST | `/api/mood/checkin` | Mood check-in + reprioritize |
| GET | `/api/deadlines/summary` | Deadline overview |
| POST | `/api/voice/parse` | Parse voice transcript to action |
| POST | `/api/voice/execute` | Execute parsed voice action |
| GET | `/health` | Health check |

Full interactive API docs available at `http://localhost:8000/docs` when `DEBUG=true`.

---

## Deployment

### Render (Recommended — Free Tier)

The repo includes a `render.yaml` blueprint that auto-creates all three services:

1. Push to GitHub
2. Go to [render.com](https://render.com) → **New** → **Blueprint**
3. Connect your GitHub repo — Render reads `render.yaml` and creates:
   - `producty-api` — Backend (Docker, FastAPI)
   - `producty-web` — Frontend (Docker, Nginx)
   - `producty-db` — Managed PostgreSQL
4. Set the environment variables when prompted:

| Service | Key | Value |
|---|---|---|
| producty-api | `GOOGLE_CLIENT_ID` | Your Google OAuth client ID |
| producty-api | `GOOGLE_CLIENT_SECRET` | Your Google OAuth secret |
| producty-api | `GOOGLE_REDIRECT_URI` | `https://producty-api.onrender.com/api/auth/google/callback` |
| producty-api | `NVIDIA_API_KEY` | Your NVIDIA NIM key |
| producty-api | `FRONTEND_URL` | `https://producty-web.onrender.com` |
| producty-api | `CORS_ALLOW_ORIGINS` | `https://producty-web.onrender.com` |
| producty-web | `API_URL` | `https://producty-api.onrender.com` |

5. Update **Google Cloud Console** → Authorized redirect URIs to include the production callback URL.

### Docker (Manual)

```bash
# Backend
cd backend
docker build -t producty-api .
docker run -p 8000:8000 --env-file .env producty-api

# Frontend
cd frontend
docker build -t producty-web --build-arg API_URL=http://localhost:8000 .
docker run -p 80:80 -e API_URL=http://localhost:8000 producty-web
```

---

## Security

A full production-readiness security audit has been completed. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the detailed report.

### Summary of protections

- **Rate limiting** — Per-IP sliding window: auth 15/min, AI 30/min, default 200/min
- **Prompt injection defense** — All user/document content wrapped with untrusted-data markers before LLM submission
- **File upload hardening** — Magic-byte validation (not just extension), chunked reads with 10MB hard cap
- **Security headers** — CSP, X-Frame-Options, HSTS (prod), X-Content-Type-Options, Referrer-Policy
- **OAuth security** — State tokens with 10-min TTL, one-time codes with 2-min TTL, HTTPS-only in production
- **No secrets in git** — `.env` is gitignored, verified with `git check-ignore`
- **No SQL injection** — 100% parameterized ORM queries
- **No XSS** — React auto-escapes all output, zero `dangerouslySetInnerHTML`
- **No IDOR** — Every data query filters by `user_id == current_user.id`
- **Production boot guard** — App refuses to start if `DEBUG=false` and `SECRET_KEY` is default or under 32 chars
- **Non-root Docker** — Container runs as uid 10001
- **Pinned dependencies** — All 23 backend packages pinned to exact versions

### Production checklist

- [ ] Set `DEBUG=false`
- [ ] Set a strong `SECRET_KEY` (64+ hex chars)
- [ ] Set `CORS_ALLOW_ORIGINS` to your frontend domain
- [ ] Terminate TLS (HTTPS) in front of the app
- [ ] Rotate API keys if they were ever shared
- [ ] Run `pip-audit` against `requirements.txt`

---

## Design

The UI follows a **dark minimalist** design language:

- **Color palette:** `#292929` base, `#ffc815` accent (yellow), `#e5484d` danger only
- **Typography:** Foglihten (display/brand), Geist (body), Geist Mono (code)
- **Principles:** Single accent color, restrained scrollbars, subtle cursor glow, smooth Lenis scrolling
- **Layout:** Fixed sidebar + scrollable main content + docked AI panel (right)

---

Built by [Prajnan MJ](https://github.com/Prajnan-mj)
