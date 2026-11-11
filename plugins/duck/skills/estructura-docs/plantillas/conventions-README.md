# Conventions

Rules the project always follows. One rule per line, with its reason and who enforces it.

| # | Rule | Why | Enforced by |
|---|---|---|---|
| R1 | Every change starts with its spec in `specs/`. | Scope and criteria are agreed before the code. | PR review |
| R2 | Nobody pushes or merges by hand onto the base branch. | Merging goes through the PR and its review. | GitHub (branch protection); duck (`guard-git`) in Claude sessions |

## Who enforces each rule

- **duck**: a plugin hook, named by its script (`guard-git`, `push-con-issue`, `guard-adr`…). It only stops a Claude session: a person in their own terminal does not go through it.
- **git**: a project git hook (`commit-msg`, `pre-commit`), versioned in `conventions/hooks/` with its setup in the guides. It stops anyone who has the hook installed.
- **GitHub**: branch protection, required reviews, required checks. It stops everyone.
- **PR review**: nobody automates it; the reviewer guards it.

A rule only duck guards is a rule a person can skip. If it must hold for everyone, it also needs git or GitHub.
