# Fliwyee

**F**araz's **L**earning **I**talian **W**ith **Y**ouTube **E**asier **E**xtension.

A small Chrome extension for studying Italian with YouTube. Turn it on, click a word in the
subtitles (or drag across a phrase, or press <kbd>S</kbd> for the whole line). It's copied, so you
can paste it straight into ChatGPT or another AI. It's also saved to the study session, together
with its sentence and the moment in the video. When you turn it off, the whole session is
written to a text file, all on one line.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `fliwyee` folder.
4. Pin the Fliwyee icon in the toolbar (puzzle piece → pin).
5. Reload any YouTube tab that was already open.

## Use

Fliwyee is **off** until you turn it on. While it's off, YouTube works exactly as normal.

| Do this | What happens |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> or the side panel button | Turn capture on / off |
| Click a word in the subtitles | Copies the word, saves it with its sentence |
| Drag across words | Copies the phrase (cut words are completed), saves it with its sentence |
| <kbd>S</kbd> | Copies and saves the whole subtitle line |
| <kbd>R</kbd> | Replays the current line from its start and pauses at its end |
| <kbd>Shift</kbd>+<kbd>R</kbd> | The same replay, at 0.75× speed |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> or **Undo** in the message | Removes the last capture |

The keys only work while capture is on. They're ignored while you type in YouTube's search box
or comments. YouTube's subtitles (CC) must be on.

- The word under the mouse is highlighted, so you can see what a click will grab.
- Words joined by an apostrophe stay whole: *c'entra*, *un'ora*, *dov'è*, *l'acqua*.
- A small "Copied ✓" message fades away by itself.
- The toolbar icon shows how many items the session has.
- Duplicates are skipped. They are still copied, but not saved twice.

### Sessions and the file

- A session starts with your first capture. Every capture is saved immediately, so closing the
  tab or the browser loses nothing.
- Turning capture off ends the session and writes
  `Downloads/italian-subtitles/fliwyee_YYYY-MM-DD_HH-MM.txt`.
- The file is one line, items in the order you captured them:

  ```
  spiccioli (Non ho spiccioli per il caffè) | fare a meno di (Non posso fare a meno di te) | Ci metto un'ora ad arrivare.
  ```

- Capture is always off when Chrome starts. If Chrome was closed while capture was on, that
  session is ended and its file is written.

### Side panel

Click the toolbar icon to open it next to the video.

- The on/off button, plus your shortcut and a link to change it.
- This session, newest first. Each item shows its sentence, the video title and a **▶ 4:12**
  link that jumps back to that moment (it opens the video if it's closed). Click an item to
  copy it again, or ✕ to remove it.
- **Copy all** copies the one-line text, **Save file** writes the file now, and **End session**
  ends the session without turning capture off.
- Past sessions can be copied, saved again or deleted.
- Items from auto-generated subtitles get an **auto subs** tag, since that text can contain
  mistakes.

## Change the shortcut

Open `chrome://extensions/shortcuts`, or use the **change** link in the side panel. If
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> is already used by another extension, Chrome leaves
Fliwyee's shortcut empty and the side panel shows "not set". Pick another one there.

## Privacy

Everything stays in your browser (`chrome.storage.local`) and in the files written to your
Downloads folder. Nothing is sent anywhere. The extension only runs on `www.youtube.com`.

## How it works

| File | Job |
|---|---|
| `manifest.json` | Chrome extension setup (Manifest V3) |
| `background.js` | On/off, sessions, duplicates, undo, icon counter, writing the file |
| `content/page-hook.js` | Runs in the YouTube page and passes on a copy of the subtitle track the player downloads, so each line's start and end time is known |
| `content/content.js` | Clicks, drags, keys, replay, highlight and messages on the player |
| `content/content.css` | Makes the subtitles clickable and selectable while capture is on |
| `sidepanel/` | The side panel |
| `lib/format.js` | The one-line format, file names and times, shared by the background and the side panel |
| `tools/make-icons.ps1` | Draws the icons |
| `dev/` | A fake YouTube page and a small server for testing without YouTube |

If the subtitle timing can't be read (for example after a YouTube change), capture still works
from the text on screen, and <kbd>R</kbd> replays the last 3 seconds instead.

With auto-generated subtitles, a "line" is whatever YouTube shows at once, which is sometimes
half a sentence.

## Development

- After editing, click the reload button on Fliwyee's card in `chrome://extensions`, then
  reload the YouTube tab.
- Test page: run `py dev/serve.py` in this folder and open
  `http://localhost:8765/dev/mock-youtube.html?v=demo123`. It fakes the YouTube player,
  subtitles and the parts of the Chrome extension API Fliwyee uses, and shows the side panel
  next to it. The log under the player shows the session, the clipboard, the written file and
  anything that leaked through to "YouTube".
- Icons: `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`
