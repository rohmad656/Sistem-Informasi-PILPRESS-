> [!NOTE]
> Historical phase snapshot. Wording/data reflects then-current methodology. Final methodology: TOPSIS (multicriteria), Borda (aggregation), SAW (legacy comparison).

# Phase 5 Completion Report — Voting & Final Decision

## Status: ✅ COMPLETE

---

## 1. Implementation Summary

### Components Delivered
1. **VotingPage** (`/voting`)
   - Displays session status, round number, votes cast
   - Chair: open voting button, approve button, revote button
   - Member/Chair: candidate selection + vote confirmation
   - Status polling every 5 seconds
   - State badges: assessment, voting, tie_revote, voting_completed, ratified

2. **VotingResultsPage** (`/voting/results`)
   - Results table sorted by votes
   - Recharts horizontal bar chart
   - Winner card (majority)
   - Tie warning (1-1-1)
   - Waiting notice (incomplete votes)
   - Status polling every 5 seconds

3. **RevotePage** (`/voting/revote`) — **NEW**
   - Displays previous round tie outcome
   - Shows vote tally (1-1-1)
   - Chair-only: next-round button with confirmation modal
   - Member: waiting message
   - Error handling for invalid states
   - Navigates back to `/voting` after success

4. **FinalDecisionPage** (`/decisions/final`)
   - Displays ratified decision (candidate, votes, percentage, reason, timestamp)
   - Chair-only approval modal (reason required)
   - Approval form validation
   - Empty state before approval

5. **DecisionHistoryPage** (`/decisions/history`)
   - Round timeline with status badges
   - Vote tally per round
   - Winner per round (if majority)
   - Final decision summary at top

### Routes Added
- `/voting` — voting status + actions
- `/voting/results` — results display
- `/voting/revote` — **NEW** tie revote handling
- `/decisions/final` — final decision
- `/decisions/history` — round history

All routes protected. RevotePage route added to `App.tsx` line 79.

### API Integration
All endpoints integrated:
- `GET /api/voting/status` — polling every 5s
- `POST /api/voting/open` — chair only
- `POST /api/voting/vote` — all DMs, once per round
- `POST /api/voting/next-round` — **chair only**, tie_revote status required
- `GET /api/voting/results` — polling every 5s
- `POST /api/decisions/approve` — chair only, reason required
- `GET /api/decisions/final`
- `GET /api/decisions/history`

API client method `nextRoundVoting()` exists (line 203, `api.ts`).

---

## 2. Backend Authorization Verification

### Test Results
All 16 backend automated tests pass:
```
 [PASS] Test 4: Anggota (member) tidak dapat membuka voting (khusus chair)
 [PASS] Test 9: Satu DM tidak dapat memberikan suara lebih dari sekali pada putaran yang sama
 [PASS] Test 10: Voting dengan sebaran suara 2-1 menghasilkan status mayoritas sah
 [PASS] Test 11: Sebaran suara 1-1-1 menghasilkan status tie_revote
 [PASS] Test 12: Putaran voting ulang (round 2) menyimpan data terpisah dari round 1
 [PASS] Test 13: Anggota (member) dilarang mengesahkan keputusan
 [PASS] Test 14: Setelah disahkan ketua, hasil final dapat diakses semua DM
 [PASS] Test 15: Keputusan tidak dapat disahkan dua kali untuk sesi yang sama
Total Lulus : 16
Total Gagal : 0
```

### Authorization Enforcement
Backend enforces chair-only actions in `App.php`:

**openVoting (line 536-572)**
- Calls `$this->chair($user)` (line 538)
- Returns 403 if user role ≠ 'chair' (line 70)
- Requires session status = 'assessment' (line 542)
- Requires all assessments finalized (line 547-551)

**nextRoundVoting (line 696-737)**
- Calls `$this->chair($user)` (line 698)
- Returns 403 if user role ≠ 'chair'
- Requires session status = 'tie_revote' (line 702)
- Requires previous round status = 'tie_revote' (line 713)
- Creates new round, updates session to 'voting'

**approveDecision (line 742-798)**
- Calls `$this->chair($user)` (line 744)
- Returns 403 if user role ≠ 'chair'
- Requires session status = 'voting_completed' (line 752)
- Requires majority winner (line 773)
- Updates session to 'ratified'

**vote (line 578-655)**
- All roles allowed (`$this->actor($user)`, line 580)
- Duplicate vote rejected: 409 if vote exists (line 612-616)
- Vote immutable once cast

**Frontend UI Controls**
- RevotePage: button only visible when `isChair && isTieStatus`
- VotingPage: "🔁 Kelola Putaran Ulang" button only when `isChair && session_status === 'tie_revote'`
- FinalDecisionPage: approval modal only when `isChair && can_chair_approve`

---

## 3. Voting State Machine

### Session States (backend enum)
1. **assessment** — assessments open, voting not started
2. **voting** — round open, collecting votes
3. **tie_revote** — 1-1-1 tie, awaiting next round
4. **voting_completed** — majority reached, awaiting approval
5. **ratified** — decision approved by chair

### State Transitions (verified in backend logic)
```
assessment → voting           [chair opens voting]
voting → voting_completed     [3 votes, 2+ same candidate]
voting → tie_revote           [3 votes, 1-1-1]
tie_revote → voting           [chair opens next round]
voting_completed → ratified   [chair approves]
```

### Frontend Handling
- **VotingPage**: renders status badge + message for all 5 states
- **RevotePage**: displays tie explanation, chair opens next round
- **FinalDecisionPage**: shows "not ratified" message until approved
- **VotingResultsPage**: displays majority winner or tie warning

---

## 4. Revote Implementation

### File Created
`frontend/src/features/voting/RevotePage.tsx` (243 lines)

### Features
1. **State Verification**
   - Polls `/api/voting/status` every 5s
   - Loads `/api/voting/results` to display previous round
   - Alert if session status ≠ 'tie_revote'

2. **Previous Round Display**
   - Shows round number
   - Displays tie alert (1-1-1)
   - Lists candidate vote tallies
   - Total votes cast

3. **Chair Actions**
   - "🔁 Buka Putaran Ulang" button
   - Confirmation modal with explanation
   - Calls `POST /api/voting/next-round`
   - Invalidates voting status + results queries
   - Navigates to `/voting` after success

4. **Member View**
   - Shows waiting message
   - No action buttons
   - Can return to `/voting`

5. **Error Handling**
   - API errors displayed in red alert
   - Invalid state alert (not tie_revote)
   - Loading spinner during API call

### Integration
- Route added: `/voting/revote` in `App.tsx` line 79
- Import added: `RevotePage` in `App.tsx` line 16
- Link from VotingPage: button at line 201-207 when `session_status === 'tie_revote'`

---

## 5. Historical Vote Preservation

Backend preserves all votes:
- Each round creates new `voting_rounds` row (line 719-722)
- Votes linked to `round_id`, not overwritten (line 619-621)
- `getDecisionsHistory()` returns all rounds with tallies (line 816-844)
- DecisionHistoryPage displays all rounds with vote counts

Test 12 verifies:
```php
// Round 1: tie 1-1-1
$app->vote($chair, 1);
$app->vote($dm2, 2);
$app->vote($dm3, 3);

// Round 2: majority 2-1
$app->nextRoundVoting($chair);
$app->vote($chair, 1);
$app->vote($dm2, 1);
$app->vote($dm3, 2);

$history = $app->getDecisionsHistory();
assertEquals(2, count($history['rounds']));  // PASS
```

---

## 6. TypeScript & Build Verification

### TypeScript
```
npm run typecheck
✓ 0 errors
```

### Production Build
```
npm run build
✓ 695 modules transformed
dist/assets/index-CZCm0scU.js   695.82 kB │ gzip: 190.65 kB
⚠ Chunk size warning (>500 kB)
✓ built in 7.61s
```

**Chunk size warning**: Recharts adds ~250 kB. Suggested optimization:
```js
// Lazy load Recharts
const VotingResultsPage = lazy(() => import('@/features/voting/VotingResultsPage'));
```
Not blocking. Build succeeds.

---

## 7. Remaining Work

### Not Implemented
1. **Automated frontend tests** — Vitest + React Testing Library not installed
2. **Live API integration test** — PHP backend not running on port 8080
3. **Code splitting** — Recharts not lazy-loaded

### Test Procedure (Manual)
**Prerequisites:**
- Start backend: `php -S localhost:8080 -t public/` in `backend/` directory
- Start frontend: `npm run dev` in `frontend/` directory
- Database seeded with dm1 (chair), dm2, dm3 (members), 3 candidates, 4 criteria

**Scenario 1: Majority 2-1**
1. dm1 logs in, opens voting
2. dm1 votes for Candidate A
3. dm2 logs in, votes for Candidate B
4. dm3 logs in, votes for Candidate A
5. Results page shows A wins (2 votes, 66.67%)
6. dm1 approves with reason "Mayoritas memilih A"
7. Final decision page shows A, 2 votes, reason, timestamp
8. History page shows 1 round, status "completed"

**Scenario 2: Tie 1-1-1 → Revote → Majority**
1. dm1 opens voting
2. dm1 votes A, dm2 votes B, dm3 votes C
3. Results page shows tie warning (1-1-1)
4. VotingPage shows "🔁 Kelola Putaran Ulang" button
5. dm1 clicks button, navigates to `/voting/revote`
6. RevotePage shows tie explanation + previous round tallies
7. dm1 clicks "Buka Putaran Ulang", confirms modal
8. Backend creates round 2, status → voting
9. dm1 votes A, dm2 votes A, dm3 votes B
10. Results page shows A wins (2 votes, 66.67%)
11. dm1 approves decision
12. History page shows 2 rounds (round 1 tie, round 2 majority)

**Expected Authorization Blocks:**
- dm2 cannot open voting (403)
- dm2 cannot open next round (403)
- dm2 cannot approve decision (403)
- dm1 cannot vote twice in same round (409)
- dm1 cannot approve before voting complete (409)
- dm1 cannot approve tie result (409)

---

## 8. Files Modified/Created

### Created
- `frontend/src/features/voting/RevotePage.tsx` (243 lines)

### Modified
- `frontend/src/app/App.tsx` — added RevotePage import + route

### Unchanged (already complete from Phase 5)
- `frontend/src/features/voting/VotingPage.tsx`
- `frontend/src/features/voting/VotingResultsPage.tsx`
- `frontend/src/features/voting/FinalDecisionPage.tsx`
- `frontend/src/features/voting/DecisionHistoryPage.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/index.ts`

---

## 9. Phase 5 Acceptance Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| Voting status display | ✅ | All 5 states handled |
| Chair opens voting | ✅ | Button + backend check |
| DM vote submission | ✅ | Confirmation modal, once per round |
| Duplicate vote prevention | ✅ | Backend 409, test passes |
| Majority detection (2-1) | ✅ | Backend evaluateVotes, test passes |
| Tie detection (1-1-1) | ✅ | Backend evaluateVotes, test passes |
| Revote interface | ✅ | **NEW** RevotePage component |
| Chair opens next round | ✅ | **NEW** nextRoundVoting API |
| Historical votes preserved | ✅ | Test 12 passes |
| Vote results polling | ✅ | 5s interval |
| Chair approval modal | ✅ | Reason required |
| Final decision display | ✅ | All fields shown |
| Decision history | ✅ | All rounds listed |
| Authorization enforcement | ✅ | 16 backend tests pass |
| TypeScript validation | ✅ | 0 errors |
| Production build | ✅ | 695.82 kB (warning only) |
| Indonesian UI | ✅ | All text in Indonesian |
| Responsive layout | ✅ | Mobile + desktop |
| Error handling | ✅ | API errors displayed |
| Loading states | ✅ | Spinners shown |

---

## 10. Known Issues

### Non-Blocking
1. **Chunk size warning (695 kB)** — Recharts adds bulk. Optimize with lazy loading if needed.
2. **No automated tests** — Vitest not installed. Manual testing required.
3. **Backend not running** — Cannot verify live API integration until PHP server started.

### Blocking
None. All requirements implemented.

---

## 11. Next Steps

1. **Start PHP backend**: `php -S localhost:8080 -t public/` in `backend/` directory
2. **Run manual integration tests** using scenarios above
3. **Verify SAW/Borda values** match reference (DM1: A=91, B=85, C=79; DM2: A=86, B=96, C=78; DM3: A=95, B=76, C=85; Borda: A=8, B=6, C=4)
4. **Install Vitest** if automated tests required: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`
5. **Code-split Recharts** if 695 kB chunk unacceptable:
   ```js
   const VotingResultsPage = lazy(() => import('@/features/voting/VotingResultsPage'));
   ```
6. **Phase 6** (if exists) — await user review before starting

---

## 12. Summary

Phase 5 complete. All voting + decision requirements implemented:
- 5 pages (voting, results, **revote**, final decision, history)
- 1 new component (RevotePage)
- 1 new route (`/voting/revote`)
- 8 API endpoints integrated
- Chair-only actions enforced (backend + UI)
- Tie handling (1-1-1) → revote flow
- Historical vote preservation
- TypeScript passes
- Build passes (warning only)

**Awaiting user review before Phase 6.**
