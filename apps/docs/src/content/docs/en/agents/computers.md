---
title: "Computers and the browser"
description: "Each agent's machine: files, commands and a real browser."
sidebar:
  order: 2
---

An agent can use a **computer**: a Linux machine with files, a terminal and a browser. That is how it edits spreadsheets, runs scripts and operates sites that have no API.

- **Team computer (default):** every agent in the space shares files and installed tools. Each agent starts in its own folder; what is shared goes in `shared/`. Folders organize the work, they do not isolate.
- **Private computer:** one agent gets the whole machine for itself.

Files persist between runs. When nobody uses it, the computer shuts down and keeps its workspace.

## The browser

Each agent has its own browser with a **separate, persistent profile**: logins, cookies and history never mix with another agent's, and the agent stays signed in on the next run. You can **watch live** and **take control** when the agent asks for help (a captcha, two-step authentication).

How many computers, how much storage and how many people fit in a space depends on the plan (Personal, Team or Company).
