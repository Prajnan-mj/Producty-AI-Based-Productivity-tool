import api from "./api";

// Auth
export const getGoogleLoginUrl = () => api.get("/auth/google/login").then((r) => r.data);

// AI
export const fetchDailyPlan = () => api.get("/ai/daily-plan").then((r) => r.data);
export const fetchAgentPrompt = () => api.get("/ai/agent-prompt").then((r) => r.data);
export const aiPrioritize = () => api.post("/ai/prioritize-now").then((r) => r.data);
export const fetchFocusSuggestion = () => api.get("/ai/focus").then((r) => r.data);

// Tasks
export const fetchUrgentTasks = () => api.get("/tasks/urgent").then((r) => r.data);
export const fetchTasks = (params) => api.get("/tasks", { params }).then((r) => r.data);
export const createTask = (data) => api.post("/tasks", data).then((r) => r.data);
export const updateTask = (id, data) => api.patch(`/tasks/${id}`, data).then((r) => r.data);
export const deleteTask = (id) => api.delete(`/tasks/${id}`).then((r) => r.data);
export const markTaskDone = (id) => updateTask(id, { status: "done" });
export const importFromGmail = (max) => api.get("/tasks/from-gmail", { params: { max_results: max } }).then((r) => r.data);
export const fetchProcrastination = () => api.get("/tasks/procrastination/flagged").then((r) => r.data);
export const breakIntoChunks = (id) => api.post(`/tasks/${id}/break-into-chunks`).then((r) => r.data);

// Deadlines
export const fetchDeadlineSummary = () => api.get("/deadlines/summary").then((r) => r.data);
export const fetchDeadlineTimeline = (from, to) =>
  api.get("/deadlines/timeline", { params: { from_date: from, to_date: to } }).then((r) => r.data);
export const snoozeDeadline = (id, type, hours) =>
  api.post(`/deadlines/snooze/${id}`, { item_type: type, snooze_hours: hours }).then((r) => r.data);

// Calendar
export const fetchMeetings = (start, end, category = "all") =>
  api.get("/calendar/meetings", { params: { start_date: start, end_date: end, category } }).then((r) => r.data);
export const categorizeMeeting = (eventId, category) =>
  api.post(`/calendar/meetings/${eventId}/categorize`, { category }).then((r) => r.data);
export const syncCalendar = () => api.post("/calendar/sync").then((r) => r.data);

// Habits
export const fetchHabits = () => api.get("/habits").then((r) => r.data);
export const fetchHabitsSummary = () => api.get("/habits/summary/today").then((r) => r.data);
export const createHabit = (data) => api.post("/habits", data).then((r) => r.data);
export const completeHabit = (id, notes) => api.post(`/habits/${id}/complete`, { notes }).then((r) => r.data);
export const fetchHabitStats = (id, period) => api.get(`/habits/${id}/stats`, { params: { period } }).then((r) => r.data);

// Goals
export const fetchGoals = (params) => api.get("/goals", { params }).then((r) => r.data);
export const createGoal = (data) => api.post("/goals", data).then((r) => r.data);
export const updateGoalProgress = (id, data) => api.patch(`/goals/${id}/progress`, data).then((r) => r.data);
export const completeMilestone = (goalId, msId) =>
  api.post(`/goals/${goalId}/milestones/${msId}/complete`).then((r) => r.data);
export const fetchGoalVisual = (id) => api.get(`/goals/${id}/visual-data`).then((r) => r.data);
export const aiBreakdownGoal = (id) => api.post(`/goals/${id}/ai-breakdown`).then((r) => r.data);
export const goalResumeBullet = (id) => api.post(`/goals/${id}/resume-bullet`).then((r) => r.data);

// Bills
export const fetchBills = (params) => api.get("/bills", { params }).then((r) => r.data);
export const fetchUpcomingBills = () => api.get("/bills/upcoming").then((r) => r.data);
export const fetchBillsSummary = () => api.get("/bills/summary").then((r) => r.data);
export const createBill = (data) => api.post("/bills", data).then((r) => r.data);
export const markBillPaid = (id) => api.patch(`/bills/${id}/mark-paid`).then((r) => r.data);
export const detectBillsFromEmail = () => api.post("/bills/detect-from-email").then((r) => r.data);

// Calendar — manual meeting
export const createManualMeeting = (data) => api.post("/calendar/meetings", data).then((r) => r.data);

// Journal
export const fetchJournalEntries = (days = 30) => api.get("/journal", { params: { days } }).then((r) => r.data);
export const fetchJournalEntry = (date) => api.get(`/journal/${date}`).then((r) => r.data);
export const upsertJournalEntry = (date, content, mood) =>
  api.put(`/journal/${date}`, { content, mood }).then((r) => r.data);
export const summarizeDay = (date) => api.post(`/journal/${date}/summarize`).then((r) => r.data);
export const fetchWeeklyWrapped = () => api.get("/journal/weekly/wrapped").then((r) => r.data);

// Voice
export const parseVoice = (transcript) => api.post("/voice/parse", { transcript }).then((r) => r.data);
export const executeVoice = (action, extracted_data, confirmed) =>
  api.post("/voice/execute", { action, extracted_data, confirmed }).then((r) => r.data);

// Documents
export const analyzeDocument = (file, context = "") => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("user_context", context);
  return api.post("/documents/analyze", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const bulkCreateTasks = (tasks) => Promise.all(tasks.map((t) => createTask(t)));

// Notes & folders
export const fetchFolders = () => api.get("/notes/folders").then((r) => r.data);
export const createFolder = (data) => api.post("/notes/folders", data).then((r) => r.data);
export const deleteFolder = (id) => api.delete(`/notes/folders/${id}`).then((r) => r.data);
export const fetchNotes = (folderId) =>
  api.get("/notes", { params: folderId ? { folder_id: folderId } : {} }).then((r) => r.data);
export const createNote = (data) => api.post("/notes", data).then((r) => r.data);
export const updateNote = (id, data) => api.put(`/notes/${id}`, data).then((r) => r.data);
export const deleteNote = (id) => api.delete(`/notes/${id}`).then((r) => r.data);
export const summarizeNote = (id) => api.post(`/notes/${id}/summarize`).then((r) => r.data);
export const noteAI = (id, body) => api.post(`/notes/${id}/ai`, body).then((r) => r.data);
export const toggleNoteFavorite = (id) => api.post(`/notes/${id}/favorite`).then((r) => r.data);
export const duplicateNote = (id) => api.post(`/notes/${id}/duplicate`).then((r) => r.data);
export const moveNote = (id, folderId) => api.patch(`/notes/${id}/move`, { folder_id: folderId }).then((r) => r.data);

// Panic Mode
export const createPanicPlan = () => api.post("/panic").then((r) => r.data);
export const fetchSharedPanic = (token) => api.get(`/panic/share/${token}`).then((r) => r.data);

// Countdown events
export const fetchCountdowns = () => api.get("/countdown").then((r) => r.data);
export const createCountdown = (data) => api.post("/countdown", data).then((r) => r.data);
export const deleteCountdown = (id) => api.delete(`/countdown/${id}`).then((r) => r.data);
export const generatePrepPlan = (id) => api.post(`/countdown/${id}/prep-plan`).then((r) => r.data);

// Peer accountability rooms
export const fetchRooms = () => api.get("/rooms").then((r) => r.data);
export const createRoom = (name) => api.post("/rooms", { name }).then((r) => r.data);
export const joinRoom = (code) => api.post("/rooms/join", { code }).then((r) => r.data);
export const leaveRoom = (id) => api.post(`/rooms/${id}/leave`).then((r) => r.data);

// Mood check-in
export const fetchMoodToday = () => api.get("/mood/today").then((r) => r.data);
export const submitMood = (energy) => api.post("/mood", { energy }).then((r) => r.data);

// Universal Capture Inbox
export const captureParseText = (text) => {
  const fd = new FormData();
  fd.append("text", text);
  return api.post("/capture/parse", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};
export const captureParseFile = (file, text = "") => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("text", text);
  return api.post("/capture/parse", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};
export const fetchReviewQueue = () => api.get("/capture/review").then((r) => r.data);
export const actOnReview = (id, action) => api.post(`/capture/review/${id}`, { action }).then((r) => r.data);

// Next action / avoidance
export const fetchNextAction = (mins = 30, energy = "med") =>
  api.get("/tasks/next-action", { params: { available_minutes: mins, energy } }).then((r) => r.data);
export const fetchAvoidancePatterns = () => api.get("/tasks/avoidance-patterns").then((r) => r.data);

// Document ingestion
export const extractDeadlines = (docId, mode = "syllabus") =>
  api.post(`/documents/${docId}/extract-deadlines`, null, { params: { mode } }).then((r) => r.data);

// Meeting prep
export const fetchMeetingPrep = (meetingId) => api.get(`/calendar/meetings/${meetingId}/prep`).then((r) => r.data);

// Notification suppression
export const checkReminder = (taskId) => api.get(`/calendar/reminder-check/${taskId}`).then((r) => r.data);

// Group coordinator
export const coordinateProject = (roomId, data) => api.post(`/rooms/${roomId}/coordinate`, data).then((r) => r.data);

// Triage / Rescue Agent
export const triageTask = (id, data) => api.post(`/triage/${id}`, data).then((r) => r.data);
export const acceptTriage = (triageId, accepted) => api.post(`/triage/accept/${triageId}`, { accepted }).then((r) => r.data);
export const defragCalendar = (taskId) => api.post(`/triage/defrag/${taskId}`).then((r) => r.data);
export const fetchReminderWindow = () => api.get("/triage/reminder-window").then((r) => r.data);
export const fetchMomentum = () => api.get("/triage/momentum").then((r) => r.data);

// Infrastructure
export const searchEverything = (q) => api.get("/infra/search", { params: { q } }).then((r) => r.data);
export const setTaskRecurrence = (id, rule, interval = 1) => api.patch(`/infra/tasks/${id}/recurrence`, { rule, interval }).then((r) => r.data);
export const materializeRecurrence = (id, count = 5) => api.post(`/infra/tasks/${id}/materialize`, null, { params: { count } }).then((r) => r.data);
export const billDueCheck = (days = 7) => api.get("/infra/bills/due-check", { params: { threshold_days: days } }).then((r) => r.data);
export const materializeBillRecurrence = (id, count = 6) => api.post(`/infra/bills/${id}/materialize-recurrence`, null, { params: { count } }).then((r) => r.data);
export const fetchHabitStreaks = (id) => api.get(`/infra/habits/${id}/streaks`).then((r) => r.data);
export const updateTaskTags = (id, tags) => api.patch(`/infra/tasks/${id}/tags`, { tags }).then((r) => r.data);
export const fetchAllTags = () => api.get("/infra/tags").then((r) => r.data);
export const scheduleReminder = (data) => api.post("/infra/reminders", data).then((r) => r.data);
export const fetchPendingReminders = () => api.get("/infra/reminders/pending").then((r) => r.data);
export const fireReminder = (id) => api.post(`/infra/reminders/${id}/fire`).then((r) => r.data);
export const pushToGoogleCalendar = (data) => api.post("/calendar/events", data).then((r) => r.data);

// Flashcards (spaced repetition)
export const fetchDecks = () => api.get("/flashcards/decks").then((r) => r.data);
export const fetchCards = (deck, due = false) =>
  api.get("/flashcards", { params: { ...(deck ? { deck } : {}), due } }).then((r) => r.data);
export const createCard = (data) => api.post("/flashcards", data).then((r) => r.data);
export const reviewCard = (id, grade) => api.post(`/flashcards/review/${id}`, { grade }).then((r) => r.data);
export const deleteCard = (id) => api.delete(`/flashcards/${id}`).then((r) => r.data);
export const generateCards = (data) => api.post("/flashcards/generate", data).then((r) => r.data);
