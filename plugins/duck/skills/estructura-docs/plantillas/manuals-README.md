# Manuals

The manuals are a deliverable of the system, not an extra: without them the knowledge stays with whoever built it.

| File | For whom | What it answers |
|---|---|---|
| `user.html` | Whoever uses the system | What can I do, and how. |
| `technical.html` | Whoever maintains it | How it is built and what connects to what. |

Rules:

- **They come from the real code**: views and routes, permissions, validations, integrations, configuration, dependencies. Each section names the part of the code it comes from, so anyone can check whether it still holds.
- **They describe what exists**, never what the system should do. Without working code, the manual waits.
- **One HTML file** each, which opens with no server or network; screenshots, if any, are embedded.
- They are updated in the same change that modifies what they describe.
