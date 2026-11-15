# Pluto MCP demo runbook

One URL, every AI. Rehearse each script twice before going on stage.

## Pre-flight checklist
- [ ] Hosted env: `APP_URL` is the public origin; `PLUTO_DEMO_MCP_TOKEN` is set (32+ chars); `PLUTO_DEMO_MCP_URL_ENABLED=1` (demo only); `SMS_PROVIDER=sendblue` with the `SENDBLUE_*` keys.
- [ ] Migration `20261114060000` (`saved_notes.source`, magic links to saved notes) is applied on the hosted DB.
- [ ] Demo phone is linked to the demo student (Settings, phone: `/settings/phone`).
- [ ] Sendblue 24-hour window is open: text the Pluto number from the demo phone first, within 24 hours of the show.
- [ ] Open `<APP_URL>/mcp`. Claude, ChatGPT and Cursor each connected, and each has run `list_courses` once.
- [ ] Backup screen recording of every script below is on the laptop.

Server URL: `<APP_URL>/api/mcp`. Fallback URL (no OAuth): `<APP_URL>/api/mcp/demo/<PLUTO_DEMO_MCP_TOKEN>`. Treat the fallback URL like a password.

## Connect steps
OAuth first, sign in as the demo student when the window opens.
- **Claude**: Customize, Connectors, +, Add custom connector. Name `Pluto`, paste the URL, Add, then Connect.
- **ChatGPT**: Settings, Apps (or Apps & Connectors), Advanced, turn on Developer mode, Create app. Name `Pluto`, paste the URL, auth OAuth. Needs a plan that allows developer mode.
- **Cursor**: on `/mcp` press Cursor, then Add to Cursor and confirm. Or put `{"mcpServers":{"pluto":{"url":"<URL>"}}}` in `~/.cursor/mcp.json`.
- **OAuth fails**: use the fallback URL above in the same field. No sign-in needed.

## Scripts
1. **Save back + text (about 60 s).** In Claude type: `Build me a study guide from my History 105 notes from the past 2 weeks, use Pluto, and save it to Pluto.` Audience sees Claude call the read tools, then `save_study_guide`. The demo phone buzzes with a link. Tap it: the guide opens in Notes with a "From Claude" chip.
2. **One-click prompts (about 30 s).** In Claude press +, then Pluto, pick **Quiz me** (or **Study guide**), type `History 105`, send. In Cursor type `/` and pick the Pluto prompt. ChatGPT has no MCP prompts: paste the matching example from `/mcp`.
3. **Same URL in three AIs (about 60 s).** Show `/mcp`, copy the URL once. Show Claude, ChatGPT and Cursor side by side, each with Pluto connected. Type `List my courses. Use Pluto.` in all three.
4. **Quiz with citations (about 60 s).** Type verbatim: `Quiz me on my History 105 notes with 8 questions. Put the answers at the end, each linking to the exact page. Use Pluto.` Scroll to Answers, tap an answer link: the notes page opens at that page.
5. **Crunch text, reply YES, plan (about 60 s).** Open `/sms-sim` and press **Crunch week alert** to send the crunch-week text. It ends "Want a plan? Reply YES." Reply `YES` from the demo phone within 24 hours. Pluto texts back a plan for that week.

## Fallbacks
- OAuth fails: fallback URL with the demo token.
- ChatGPT fails: play its recording.
- Texts fail or the Sendblue window closed: do the same steps in `/sms-sim`; saved-note links show in the simulator.

## After the demo
Rotate `PLUTO_DEMO_MCP_TOKEN` and unset `PLUTO_DEMO_MCP_URL_ENABLED` (or set it to anything but `1`).
