# YAGE level editor agent workflow

Use this workflow for every task that plans, implements, reviews, or continues
the YAGE level editor. The workflow is tool-independent. `AGENTS.md` makes it
automatic for agents that support repository instructions, and `CLAUDE.md`
imports those instructions for Claude Code.

## Locate the canonical queue

The live queue is `plans/level-editor-implementation/00-index.md`. The `plans/`
directory is local working state and is excluded from Git, so it may live only
in the repository's main worktree.

1. Look for the queue in the current worktree.
2. If it is absent, run `git worktree list --porcelain` and look for the same
   path in the main worktree.
3. Read the queue from exactly one location. Do not copy it into another
   worktree or create a second queue.
4. If no queue exists, stop and report that the local planning state is
   unavailable. Do not reconstruct it from conversation memory.

The queue index is the source of truth for status, dependencies, the active
lock, branch state, and the common verification commands. Each item document is
self-contained. The detailed product and system contracts remain in the five
editor documents linked from the queue.

Before implementing anything, read "What this is optimizing for" in
`plans/yage-tools/editor-implementation-plan.md`. It states what the rules in
this workflow are for: an architecture that survives many iterations by agents
who share no memory, without drifting into disjointed code on one side or
over-built structure on the other. A rule applied against that intent is being
applied wrong.

## Invocation phrases

Interpret these requests consistently:

| Request                                    | Action                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level editor status`                      | Report queue counts, active locks, and the next actionable item. Make no changes.                                                                           |
| `continue the level editor`                | Recheck the queue and take the safest next action. Discuss an open decision; implement a decided item only when the request also authorizes implementation. |
| `decide the next level editor item`        | Reverify and discuss the first open item. Record the user's decision, then stop.                                                                            |
| `implement the next level editor item`     | Implement the first decided item whose `done` dependencies are satisfied, then leave it ready for review.                                                   |
| `run the next level editor item`           | Decide, implement, run the item's required independent review passes, and verify the first actionable item using `decision-rule.md`. Stop at any red gate.  |
| `run level editor items N-M automatically` | Run the named items sequentially through decision, implementation, the required independent review passes, and verification.                                |
| `review level editor item N`               | Run the next missing mandatory review pass. Do not mark the item `done`.                                                                                    |
| `critical review level editor item N`      | Run only the critical implementation review.                                                                                                                |
| `adversarial review level editor item N`   | Run only the adversarial review.                                                                                                                            |
| `coherence review level editor item N`     | Run only the big-picture coherence review.                                                                                                                  |

Requests to run or implement authorize local edits and tests for the named
scope. They do not authorize commits, pushes, pull requests, package releases,
or destructive cleanup.

For an agent that does not read `AGENTS.md`, use this prompt:

> Continue the YAGE level editor. Read
> `docs/AGENT_LEVEL_EDITOR_WORKFLOW.md`, locate
> `plans/level-editor-implementation/00-index.md`, and follow the requested
> queue mode. Claim an item before editing. Do not commit.

## Claiming and dependencies

Queue statuses are `open`, `in progress`, `decided`, `done`, `closed`, and
`superseded`.

- Before slow investigation or code changes, set the selected item to
  `in progress` in both the index and item document. Include the date, agent or
  task identifier, and worktree path in the item document.
- Never work on an item already marked `in progress`. Report the owner and lock
  age instead.
- Never silently take over an old lock. The user must reopen the recorded task
  or return the item to its prior status.
- A `decided` dependency blocks discussion until that decision exists. A
  `done` dependency permits discussion but blocks implementation.
- Work on the first actionable item unless the user names another item.

## Decision work

1. Read the queue index, selected item, `decision-rule.md`, and every design
   document named by the item.
2. Reverify dated claims against the current worktree. Plans describe intent;
   current code decides feasibility.
3. Explain the decision in user terms: context, options, recommendation,
   consequences, and affected later items.
4. Record the decision and its reasoning in the item. Update dependent queue
   entries when the decision changes their scope.
5. Do not implement unless the invocation authorizes implementation.

## Implementation work

1. Confirm that every `done` dependency is complete and that the working tree
   has no overlapping user changes.
2. State the slice boundary, public API changes, focused tests, and expected
   cleanup before editing.
3. Add or identify a contract test before implementing the behavior.
4. Implement the smallest accepted contract in the package that owns it. Reuse
   existing YAGE lifecycles, services, events, assets, and error handling.
5. Do not add an unapproved cross-package dependency, service, global registry,
   lifecycle phase, serialization channel, generic event system, or public
   extension point. Return the item to a decision gate if one becomes
   necessary.
6. Run the item's focused checks and the shared queue checks that apply to the
   changed packages.
7. Update the five editor documents when verified behavior changes a contract.
8. Remove rejected experiments and temporary public exports.
9. Record the implementation, verification, and remaining limits in the item.
   Leave the item `in progress` for the mandatory independent reviews. Do
   not mark it `done` before those reviews pass.
10. Leave changes uncommitted unless the user separately asks for a commit.

## Mandatory independent review and slice gates

Implementation and review are separate stages. Every implemented item requires
the review passes below before its status can change to `done`. No pass may be
combined with another, or replaced by an implementation author's self-review.

Each pass uses a distinct independent reviewer; none may be the item's
implementation author. Each reviewer starts in a fresh context and reads the
recorded Decision, the current pending diff, the selected item, and the
relevant source before reading prior conversation. If the required independent
reviewers are not available, stop with the item `in progress`; do not
substitute a local reread.

**Which passes an item needs.** The critical and coherence passes run on every
item. A slice gate additionally runs the use pass described below, which is
not a review of a diff. The adversarial pass runs on an item that touches persistence,
concurrency, or a public API — anything writing a file, ordering operations
across tabs or requests, or shipping a surface a game will depend on. An item
that touches none of those (a panel layout, a pure view helper) does not need
it. Say in the item's record which passes ran and why.

**The threat model, for the adversarial pass.** The editor is a development
tool that runs on loopback with the developer's own project permissions, and
its inputs — level files, project code, editor config — are authored by that
same developer. Hostile input is out of scope. Data loss, ordering races,
partial writes, failed cleanup, and broken restored references are in scope,
because those happen to a developer working alone. A finding that requires an
attacker is not a finding here; the system design's "Security boundaries"
section states the same boundary.

1. **Critical implementation review.** Check the claimed behavior against the
   decision, tests, error paths, rollback, cleanup, lifecycle order, error
   attribution, package dependencies, public API size, asset ownership,
   save/restore identity, and stale asynchronous work.
2. **Adversarial review** (when the item qualifies above). Try to disprove the
   contract within the threat model. Look for partial writes, data loss,
   ordering races, failed setup and cleanup, broken restored references,
   public API leaks, and tests that would pass for the wrong reason. Run or add
   only in-scope checks needed to confirm a finding.
3. **Big-picture coherence review.** Check the diff in the full engine and
   delivery context. Compare it with existing YAGE mechanisms and the five
   editor documents — including each changed module's section in
   `editor-module-architecture.md`, which states its public surface, ownership,
   and allowed imports — then inspect completed and future queue items. Look for
   duplicate logic, split ownership, accidental new systems, incompatible
   contracts, misplaced package responsibilities, and shortcuts that would
   force later slices to work around this one.

Each reviewer records the files and evidence inspected, commands run, confirmed
and dismissed findings, required corrections, and the impact on later items.
A finding that changes behavior, data meaning, public API, package ownership,
or a future contract returns the item to implementation. A serious unresolved
finding stops the queue.

Review scope is proportional to the change:

- An item's first review round runs every pass the item requires, each prompted for
  coverage: enumerate the implementation's exports and contract claims and
  attack each at least once. Focus lists belong to re-reviews, not first
  rounds.
- After corrections, one focused reviewer verifies the changed surface and
  the prior round's dispositions. Run the full set of passes again only when a
  correction reworks the design, rather than fixing a bounded defect inside
  it.
- Re-review prompts lead with the new state of the code. A returning
  reviewer re-checks only its own prior findings, not the other passes'
  dispositions.

Severity and triage:

- P1 is reserved for a defect in behavior, data meaning, public API, or a
  recorded contract that occurs in practice. Wording drift between documents
  is at most a P2.
- A finding that will not occur in practice and cannot be fixed in a few
  lines is routed as a recorded obligation on the owning item, not fixed in
  code.
- Prose, comment, and record hygiene is fixed directly by the agent
  running the item, never through a review pass. Formatting and line
  length of documents under `plans/` are out of scope for every pass.

## The use pass, at every slice gate

The three passes above are engineering lenses over a diff. None of them asks
whether a developer can build a level, and a slice can satisfy all three while
leaving the tool unusable — slice 3 shipped with a view that cannot move, and
no gate step caught it.

So a slice gate also runs a use pass, which is not a review:

1. Build something real with the editor — a level for an actual small scene,
   not a test fixture, in a project of your own rather than `e2e/`.
2. Record every point where the tool was slow, confusing, or unable to do what
   the task needed, in the gate item, as the friction happened rather than
   summarized afterwards.
3. Dispose of each entry: fixed inside the slice, routed to a named queue item,
   or written into both documentation surfaces as a limitation. An entry left
   undisposed keeps the gate open.

Reading the code, passing the Playwright path, and reviewing the diff do not
substitute for it. The record it produces, not the test count, is what says
the slice met its purpose.

A slice gate passes only after every item in the slice is `done`, each item's
required review records are present, the use pass has run and its friction
record is disposed, focused and slice-wide checks pass, the end-to-end path
still runs, the documents match the implementation, and no placeholder
implementation or experimental public export remains.

## Mandatory stop conditions

Stop and ask for a decision when work requires:

- changing a user-visible contract that the item does not authorize;
- inventing an engine mechanism because the planned one does not fit;
- widening the package graph or public API beyond the recorded decision;
- overwriting or discarding overlapping user changes;
- choosing between two outcomes with different saved-data or lifecycle
  behavior;
- proceeding after a slice-wide test failure that is not understood;
- committing, pushing, publishing, or deleting material outside the item.
