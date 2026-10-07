# WTF meter

![GOOD SESSION vs BAD SESSION: two doors labeled CLAUDE CODE, the bad one surrounded by WTF, KURWA!, SCHEISSE, DUDE WTF, WHY DID YOU DELETE THE TESTS](docs/hero.jpg)

In 2008 Thom Holwerda drew the definitive code quality metric for [OSNews](https://www.osnews.com/story/19557/Fools): two doors marked CODE REVIEW, and the only number that matters is how many WTFs per minute come out from behind them. Robert C. Martin opened *Clean Code* with it.

The code review is a chat with Claude now, and the WTFs are typed. So this is a Claude Code mod that counts them, live, per message: in English, German, Polish, Russian and Ukrainian.

<img src="docs/meter.jpg" alt="A vintage panel meter labeled WTF / MSG, needle slammed into MELTDOWN, with kurwa, wtf and Scheiße floating above it" width="420" align="right">

**What you get**

- Every message where you swore gets stamped: `[WTF +3 · бля]`
- A strip above the prompt tracks the heat, one bar per message
- The status line keeps score: `WTF 9 · 3.0/msg ▲ Meltdown`
- A toast pops when the session changes level
- `/wtf` prints the tally
- Or switch to [swear jar mode](#swear-jar-mode) and let the team see who is paying in

Works in the Claude Code terminal and the Code tab of the Claude desktop app. Nothing leaves your machine unless you turn on Slack posting, and even then your words don't.

<br clear="right">

## The four stages of a Claude Code session

![CALM, GRUMBLING (dammit), HEATED (WTF?!), MELTDOWN (KURWA!)](docs/levels.jpg)

The level is the average score of your last 4 messages, so one truly bad message can skip a stage.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Calm
  Calm --> Grumbling: avg ≥ 0.6
  Grumbling --> Heated: avg ≥ 1.5
  Heated --> Meltdown: avg ≥ 2.5
  Meltdown --> Heated: avg < 2.5
  Heated --> Grumbling: avg < 1.5
  Grumbling --> Calm: avg < 0.6
```

## Swear jar mode

Inspired by Bud Light's "Swear Jar" ad: the office jar that paid for beer, until everyone started swearing on purpose. Switch `mode` to `jar` and every swear drops coins in, 25¢ per point (`damn` 25¢, `wtf` 50¢, `kurwa` 75¢). The jar never empties and carries over between sessions. Every $20 is a beer run.

### Post to a team Slack channel

Point the jar at a Slack channel and your team sees who is paying in:

> 🫙 Dima put $2.50 in the swear jar, fighting a release.
> 🫙 Serge put $1.75 in the swear jar, losing it at CI. 🍺 That fills Serge's jar: $20.25 in all. Beer run!

**Your words never reach Slack.** A post is built only from your name, the amount and one topic picked from a fixed list (`a flaky test`, `a deploy`, `CI`, `a merge conflict`, `the AI itself`, …; see [`hooks/jar.ts`](hooks/jar.ts)). A small model picks the topic, and any answer that is not exactly on the list becomes `something`. File names, project names, numbers and your actual message can't get into a post, whatever the model says.

Posts wait 2 minutes, so a burst of swearing becomes one post. `/wtf skip` or the strip's **Skip Slack post** button cancels the waiting post; the coins stay in your jar.

Setup:

1. Create the channel, e.g. `#swear-jar`.
2. Make an incoming webhook for it: [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch → Incoming Webhooks → on → Add New Webhook → pick the channel. Copy the `https://hooks.slack.com/services/...` URL. Share it with your team: one webhook serves everyone.
3. Set the plugin options, from `/config` in the terminal, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "wtf-meter@wtf-meter": {
    "options": {
      "mode": "jar",
      "name": "Dima",
      "slackWebhookUrl": "https://hooks.slack.com/services/..."
    }
  }
}
```

The webhook URL sits in your settings file in plain text. Anyone holding it can post to that channel, so treat it like a password.

## Install

Needs a Claude Code build with function-hook mods (early access; built against 2.1.293).

```
/plugin marketplace add dreamiurg/wtf-meter
/plugin install wtf-meter@wtf-meter
```

Or from a shell:

```bash
claude plugin marketplace add dreamiurg/wtf-meter
claude plugin install wtf-meter@wtf-meter
```

Start a new session after installing.

## Scoring

Every word in [`hooks/lexicon.ts`](hooks/lexicon.ts) has a weight: 1 mild (`damn`, `kurde`, `блин`), 2 medium (`wtf`, `verdammt`, `сука`), 3 strong (the f-word, `kurwa`, `Scheiße`, the Russian and Ukrainian mat roots). Censored spellings that dictation tools produce (`f***`, `п***ц`) count too.

Russian and Ukrainian share most of the mat roots, so they share patterns. Each pattern needs a non-letter before it, because JavaScript's `\b` does not see Cyrillic. That keeps `hello`, `class`, `fickle`, `mister`, `корабля`, `Херсон` and `блины` clean. Known miss: `Ебург`.

Only what you type counts. Background task notifications, scheduled prompts and messages from other agents are skipped.

## Privacy

Meter scores live in the session's own state and go away with it; the jar total is kept in the plugin's local store. The stamps change only how your message is drawn: Claude still reads exactly what you typed. Slack posting is off until you set a webhook, and a post never contains your words (see [swear jar mode](#swear-jar-mode)). Picking the topic is one small model call through your own Claude Code session.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

Run a session with `claude --plugin-dir .` to load your working copy; saving a file reloads it. Disable the installed copy first (`/plugin disable wtf-meter@wtf-meter`), or every message counts twice. `tsc -p .` works after the first load, which lays the API types into `.claude-plugin/types/`.

## Credits

- The idea: Thom Holwerda's [WTFs/minute](https://www.osnews.com/story/19557/Fools) cartoon, OSNews, 2008. The drawings here are new homages generated with an image model, not copies; the prompts are in [docs/image-prompts.md](docs/image-prompts.md).

## License

MIT
