# SSC CGL Mock Test Bot — Bot specification

**Archetype:** education

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A bilingual (English/Hindi) Telegram bot for SSC CGL aspirants to take full-length mock tests with 100 questions across 4 sections. Features include timed exams, question review, bilingual explanations, and admin controls for test management. Results are auto-scored and exportable as CSV.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- SSC CGL aspirants
- test administrators

## Success criteria

- User completes full 100-question mock test with accurate scoring
- Admin successfully uploads and manages test content
- System auto-saves progress and resumes after accidental reload

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu with test selection and instructions
- **Start Test** (button, actor: user, callback: test:start) — Begin test after entering name and roll number
- **Admin Panel** (button, actor: user, callback: admin:login) — Access password-protected admin interface

## Flows

### Test Attempt
_Trigger:_ test:start

1. Enter name and roll number
2. Select mock test
3. Answer questions with navigation and timer
4. Submit test
5. View results and explanations

_Data touched:_ User, Test, Attempt

### Admin Management
_Trigger:_ admin:login

1. Enter admin password
2. Upload test JSON
3. View test attempts
4. Export results as CSV
5. Reset admin password

_Data touched:_ Test, Attempt, Admin credentials

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Candidate profile with test progress
  - fields: name, roll_number, current_attempt, dark_mode_preference
- **Test** _(retention: persistent)_ — Mock test metadata and question set
  - fields: name, sections, total_time, questions
- **Attempt** _(retention: persistent)_ — User's test attempt record
  - fields: user_id, test_id, answers, marked_for_review, timestamps, score
- **Admin credentials** _(retention: persistent)_ — Password for admin access
  - fields: password_hash

## Integrations

- **Telegram** (required) — Bot API messaging and UI
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set admin password at first run
- Upload test content via JSON
- Export test results as CSV
- Reset admin password

## Permissions & privacy

- User data (name, roll number) stored securely for test tracking
- Test attempts stored for result generation and review
- Admin password hashed and stored securely

## Edge cases

- User disconnects during test - auto-resume from last question
- Admin uploads invalid JSON format
- User attempts to access admin panel without password

## Required tests

- End-to-end test of 100-question mock test with scoring
- Admin panel password protection and JSON upload validation
- Auto-save and resume functionality after simulated disconnection

## Assumptions

- Owner will provide initial admin password
- Test content will be provided in valid JSON format
- Users will have stable internet connection for test completion
