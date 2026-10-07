# Changelog

## Unreleased

- **Archived sessions are hidden:** a session you archive in Claude Code no longer stays in the chip, hover, picker and panel while it is idle, although its process keeps running. It shows again while it works or waits for you. `agentWatch.showArchivedSessions` brings them back.
- **Which session finished:** for 10 seconds after a turn ends, the chip shows the session's number, title and how long it worked (`✓ 3 feat/login · 31 min`), also for other windows' sessions with the `workspace` or `all` scope.
- **System notifications** while the window is minimized or in the background, when one of its sessions finishes or needs your decision (Linux and macOS). `agentWatch.desktopNotifications` turns them off.
- **`agentWatch.minTurnSeconds`:** turns shorter than this finish quietly, so a quick reply does not sound like a long task.

## 0.1.0 (2026-10-02)

First release on the Visual Studio Marketplace.

- **Status bar chip:** the Agent Watch robot, the number of agents working, and one dot per session: 🟡 working, 🔴 waiting for you, 🟢 idle. With no sessions it says *No agents* (in English or Spanish, following VS Code).
- **Hover card:** every session with its title, status, time in that status, folder, branch and what it is doing right now, with filters by status.
- **Session picker** with search. Opening a session shows it in Claude Code, where it already is or restored from its transcript; Agent Watch never starts a new session.
- **Agent Watch panel:** sessions grouped by branch or worktree; what each one is doing; the files it edited inside the workspace or in worktrees of its repositories, tracked by git and measured from where its branch left the default branch, each with a diff.
- **Sounds and notifications:** a blip when a session finishes its turn, an alert and a notification with an Open button when it needs your decision.
- **Claude Code** support: chats in the Claude Code extension and `claude` CLI sessions in VS Code terminals.
