---
title: Interactive Mode
order: 2
---

# Interactive Mode

Interactive mode reads captions line by line from standard input. It is useful for scripting, piping text from another program, or captioning in a terminal without the full-screen UI.

---

## Starting Interactive Mode

```bash
lcyt -i
lcyt --interactive
```

Once started, the CLI waits for you to type a line and press **Enter**. Each line is sent to YouTube as a separate caption.

---

## How It Works

```
$ lcyt -i
> Hello, welcome to the stream!       ← you type this, then Enter
✓ Caption sent [seq 1]
> Today we will be discussing...
✓ Caption sent [seq 2]
```

- Each line you enter is sent immediately after pressing Enter.
- The sequence counter increments automatically.
- Press **Ctrl+D** (EOF) or **Ctrl+C** to quit.

---

## Reading from a File or Pipe

Because interactive mode reads from stdin, you can pipe any program's output directly into it:

```bash
# Send all lines of a text file, one by one
cat script.txt | lcyt -i

# Send output of a real-time transcription tool
my-transcriber | lcyt -i
```

When stdin is a pipe (not a TTY), the CLI reads lines until EOF and then exits automatically.

---

## Options

| Flag | Description |
|------|-------------|
| `-i`, `--interactive` | Enable interactive/pipe mode |
| `-k`, `--stream-key KEY` | YouTube stream key |
| `-t`, `--timestamp ISO` | Manual timestamp override for every caption |
| `--heartbeat` | Send a single heartbeat and exit (useful to test the connection before starting) |
| `--verbose` | Print detailed HTTP request/response information |
| `--log-stderr` | Write log output to stderr (useful when stdout is consumed by a pipe) |

---

## Example: Scripted Session

```bash
#!/bin/bash
# Send a series of pre-written captions with a delay between each
captions=(
  "Welcome to the show!"
  "Today's topic: live captioning"
  "Stay tuned for more"
)

for caption in "${captions[@]}"; do
  echo "$caption" | lcyt -i
  sleep 5
done
```

---

## Notes

- Interactive mode does **not** display the full-screen blessed UI; it is purely text-based and safe to use in CI pipelines, cron jobs, or scripts.
- The stream key must be configured either via `--stream-key` or stored in `~/.lcyt-config.json` beforehand.
- Timestamps default to the current system time unless overridden with `--timestamp`.
