# Fliwyee

**F**araz's **L**earning **I**talian **W**ith **Y**ouTube **E**asier **E**xtension.

A small Chrome extension for studying Italian with YouTube. Turn it on, click a word in the
subtitles (or drag across a phrase, or press <kbd>S</kbd> for the whole line). It's copied and
saved to your study session, together with its sentence and the moment in the video. Press
<kbd>Q</kbd> and Fliwyee takes you to your AI chat with a ready prompt about it. When you end the
session, it's saved as a small web page: one sentence per line, your words highlighted, and every
minute a working link back to that moment in the video.

YouTube is the main site. Fliwyee also runs on Netflix, and on other video websites when you
add it with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> (see [Other websites](#other-websites)).

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `fliwyee` folder.
4. Pin the Fliwyee icon in the toolbar (puzzle piece → pin).
5. Reload any YouTube tab that was already open.

**Updating:** click the reload button on Fliwyee's card in `chrome://extensions`. Open YouTube
tabs then show "Fliwyee was updated. Reload this tab": click **Reload** (or press F5). Until you
do, the old Fliwyee in that tab switches itself off and YouTube works normally. Restarting Chrome
also works.

## Use

Fliwyee is **off** until you turn it on. While it's off, YouTube works exactly as normal.

| Do this | What happens |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> or the side panel button | Turn capture on, or pause it. **Pausing keeps the session going.** |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> or **End session** | End the session and save its file |
| Click a word in the subtitles | Copies the word, saves it with its sentence |
| Drag across words | Copies the phrase (cut words are completed), saves it with its sentence |
| <kbd>S</kbd> | Copies and saves the whole subtitle line |
| <kbd>R</kbd> | Replays the current line from its start and pauses at its end |
| <kbd>Shift</kbd>+<kbd>R</kbd> | The same replay, at 0.75× speed |
| <kbd>Q</kbd> or **Ask AI** in the message | Asks your AI chat about the last capture (or the line on screen) |
| <kbd>N</kbd> | Opens the editor for the last capture: add a note (the meaning, what the AI said) or fix the text |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> or **Undo** in the message | Removes the last capture |

The single keys only work while capture is on. They're ignored while you type in YouTube's
search box or comments. YouTube's subtitles (CC) must be on.

- The word under the mouse is highlighted, so you can see what a click will grab.
- Words joined by an apostrophe stay whole: *c'entra*, *un'ora*, *dov'è*, *l'acqua*.
- A small "Copied ✓" message fades away by itself.
- The toolbar icon shows how many items the session has: green while capturing, grey while
  paused.
- Duplicates are skipped. They are still copied, but not saved twice.

### Ask AI

<kbd>Q</kbd> on YouTube, **Ask AI** in the Copied message, the **AI** button next to an item, or
**Ask AI about all** in the side panel:

1. The prompt is copied, and the video pauses.
2. Fliwyee switches to the AI chat tab you used last (ChatGPT, Claude or Gemini). If none is open,
   it opens a new chat on the AI you chose in Settings.
3. The prompt is put in the message box. Check it and press Enter.

If the AI site has changed and the prompt can't be put in the box, it's still copied: click the
message box and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

The prompts are yours to change in the side panel's **Settings**: one for a word or phrase
(`{text}`, `{sentence}`), one for a sentence (`{sentence}`) and one for the whole session
(`{items}`). **Reset prompts** brings back the defaults.

### Notes and fixes

Editing only happens when you ask for it: nothing opens on the video.

- <kbd>N</kbd> on the video opens the editor for the last capture, in the side panel next to the
  video (if the side panel is closed, it opens, and closes again when you're done). If Chrome
  doesn't let Fliwyee open the side panel, the editor opens as a small window instead.
- In the side panel, the ✎ next to an item (shown when you hover over it) edits older items.
- The editor has the word or phrase, its sentence and your note. <kbd>Enter</kbd> saves,
  <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line, <kbd>Esc</kbd> cancels.
- Fixing a sentence (for example a mistake in auto-generated subtitles) fixes it for every item
  from that sentence.
- Notes show in the side panel and in both saved files.

### Sessions and the files

- A session starts with your first capture. Every capture is saved immediately, so closing the
  tab or the browser loses nothing.
- Pausing (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>) keeps the session open, also after you
  restart Chrome. Capture itself is always off when Chrome starts.
- Ending the session (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> or **End session**) writes
  two files to `Downloads/italian-subtitles/`:
  - `fliwyee_YYYY-MM-DD_HH-MM.html`, a small web page for reading, with working links
  - `fliwyee_YYYY-MM-DD_HH-MM.txt`, the same as plain text that opens anywhere
- **Open file** writes the latest version of both at any time (it rewrites the same files) and
  opens the web page. **Show in folder** opens their folder.
- The web page opens in your browser (double-click it). Grouped by video, one sentence per line,
  with the words you took from it highlighted and your notes under it:

  | | |
  |---|---|
  | **[0:03](#)** | Non posso **fare a meno di** te. |
  | **[0:10](#)** | Che **c'entra questo** con me? |
  | **[0:14](#)** | Avere a che fare con lui è difficile. |

  Every minute is a link that plays the video from that moment. All links open in the same
  YouTube tab. The `.txt` file (and **Plain text** at the bottom of the page) looks like this:

  ```
  0:03  Non posso fare a meno di te.  →  fare a meno di
        fare a meno di: to do without
  0:10  Che c'entra questo con me?  →  c'entra, c'entra questo
  0:14  Avere a che fare con lui è difficile.
        note: Dealing with him is hard.
  ```

- The minute is 1 second before the line starts, so you hear the whole line. With
  auto-generated subtitles (two lines on screen), it's the line that really contains the word.

### Side panel

Click the toolbar icon to open it next to the video.

- The on/off button (On / Paused / Off), your two shortcuts and a link to change them.
- This session, newest first. Each item shows its sentence, the video title and a **▶ 4:12**
  link that jumps to that moment (it opens the video if it's closed), plus your note. Click an
  item to copy it again, **AI** to ask about it, ✎ to edit it, or ✕ to remove it.
- **Ask AI about all**, **Copy all** (as plain text), **Open file**, **Show in folder**,
  **End session**.
- Past sessions can be asked about, copied, opened, shown in their folder or deleted.
- Items from auto-generated subtitles get an **auto subs** tag, since that text can contain
  mistakes.
- **Settings**: which AI to open when none is open, and the three prompts.

## Other websites

| Where | How | What works |
|---|---|---|
| **YouTube** (also players embedded in other pages) | Runs by itself | Everything |
| **Netflix** | Runs by itself | Capturing, notes, Ask AI, files. Replay and minute links go through Netflix's own player. Best effort: not tested on Netflix yet |
| **Any other video website** | Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> on the page: the first press adds Fliwyee to that tab and turns capture on | Capturing, notes, Ask AI, files, replay when the video has a subtitle track |

On other websites:

- If the page shows subtitles in a way that can't be clicked (the browser draws them), Fliwyee
  hides that drawing while capture is on and shows the same lines itself, clickable. Turning
  capture off brings the page's own subtitles back.
- Subtitles drawn by common web players (Video.js, JW Player, Shaka, Plyr, Bitmovin, Prime Video,
  Disney+) are made clickable directly.
- There's no general way to link to a moment on another website, so the minute links in the side
  panel and the files open the page, and the minute tells you where to go.
- After you reload the page or go to another site, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>
  again there.
- Installed apps (the Netflix app for Windows, phone apps) can't work: a Chrome extension can't
  see inside them. Watch in Chrome instead.

## Change the shortcuts

Open `chrome://extensions/shortcuts`, or use the **change** link in the side panel. If a
shortcut is already used by another extension, Chrome leaves Fliwyee's empty and the side panel
shows "not set". Pick another one there.

## Privacy

Your captures stay in your browser (`chrome.storage.local`) and in the files written to your
Downloads folder. Fliwyee runs on YouTube and Netflix. On other websites it runs only in a tab
where you press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> (Chrome's "active tab" permission).
It touches `chatgpt.com`, `claude.ai` and `gemini.google.com` only when you ask the AI, to put the
prompt in the message box. It never sends anything by itself: you press Enter. It only reads
subtitle text; it never downloads videos.

## How it works

| File | Job |
|---|---|
| `manifest.json` | Chrome extension setup (Manifest V3) |
| `background.js` | On/off, sessions, duplicates, undo, icon counter, writing the file, Ask AI |
| `content/page-hook.js` | Runs in the video page and passes on a copy of the subtitle file the player downloads (YouTube, Netflix), so each line's start and end time is known; on Netflix it also jumps through Netflix's own player |
| `content/sites.js` | One adapter per site (YouTube, Netflix, any other website): where the subtitles are, how to jump, what a link looks like |
| `content/content.js` | Clicks, drags, keys, replay, highlight, Fliwyee's own subtitle line and messages on the player |
| `content/content.css` | Makes the subtitles clickable and selectable while capture is on |
| `sidepanel/` | The side panel |
| `lib/format.js` | The file layout, prompts, file names and times, shared by all parts |
| `tools/make-icons.ps1` | Draws the icons |
| `dev/` | A fake YouTube page and a small server for testing without YouTube |

If the subtitle timing can't be read (for example after a YouTube change), capture still works
from the text on screen, the minute is 3 seconds before the capture, and <kbd>R</kbd> replays
the last 3 seconds instead.

With auto-generated subtitles, a "line" is whatever YouTube shows at once, which is sometimes
half a sentence.

## Development

- Test page: run `py dev/serve.py` in this folder and open
  `http://localhost:8765/dev/mock-youtube.html?v=demo123`. It fakes the YouTube player,
  subtitles (including two auto-subtitle lines at once), the Chrome extension APIs Fliwyee uses
  and a ChatGPT message box, and shows the side panel next to it. The log under the player shows
  the session, the clipboard, the written file and anything that leaked through to "YouTube".
- `http://localhost:8765/dev/mock-web.html` is a fake "other website": `?mode=track` has
  subtitles drawn by the browser, `?mode=dom` has subtitles drawn by the page (like Video.js).
- Icons: `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`
