# Changelog

## 0.3.1 (2026-10-28)

- **Usage rings readable on the default blue status bar:** with the default Light+ theme the rings blended into the bar (the 5-hour one was almost invisible), and with Dark+ the pastel blue and the red were faint. In light themes the 5-hour and weekly rings now take the status bar's own text color, white on Light+'s blue bar and dark on a light one; the dark themes' are lighter pastels.
- **Sharper percent inside the rings:** the digits (7 px tall, 3 wide, or 4 for a single digit) are drawn on whole pixels with square ends, so they no longer blur at 100% scaling, and keep a pixel of margin to the ring, which is thinner. The 1 has a flag, and the unfilled part of the ring is fainter so the filled arc stands out.

## 0.3.0 (2026-10-28)

- **Usage limits:** right after the chip, two rings show how much of your Claude plan's 5-hour (pastel blue) and weekly (peach) usage limits is used, with the percent written inside and filling up like a progress spinner as you use them. A ring turns red from 80%, and stands out like an error once its limit is used up. The weekly ring follows whichever weekly limit is most used, a single model's included. Their hover, and the chip's, lists every limit `/usage` shows with how much is used, when it resets and when the reading was taken; a click lists them with how long until each resets (also *Agent Watch: Show Usage Limits*). Claude Code only takes a new reading now and then, so the rings dim once it is over 30 minutes old, and a limit whose window started over since then shows a question mark. They are read from the reading Claude Code caches in `~/.claude.json`, with no network calls, and hidden when there is none, such as with an API key. They stay when `agentWatch.hideWhenEmpty` hides the chip. `agentWatch.showUsage` turns them off; the colors are `agentWatch.usage.session`, `agentWatch.usage.weekly` and `agentWatch.usage.high`.

## 0.2.0 (2026-10-07)

- **Archived sessions are hidden:** a session you archive in Claude Code no longer stays in the chip, hover, picker and panel while it is idle, although its process keeps running. It shows again while it works or waits for you. `agentWatch.showArchivedSessions` brings them back.
- **Which session finished:** for 10 seconds after a turn ends, the chip shows the session's number, title and how long it worked (`✓ 3 feat/login · 31 min`), also for other windows' sessions with the `workspace` or `all` scope. Clicking the chip then opens the picker on that session.
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
