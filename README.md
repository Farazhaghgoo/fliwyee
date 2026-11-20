# Fliwyee

**F**araz's **L**earning **I**talian **W**ith **Y**ouTube **E**asier **E**xtension.

A small Chrome extension for studying Italian with YouTube. Turn it on and click a word in the
subtitles: its sentence is copied with the word in **bold**, ready to paste into your AI chat, and
saved to the video's notebook. Every video gets its own notebook, with one line per sentence,
the words you clicked highlighted, your tags and notes, and every minute a working link back to
that moment. Press <kbd>N</kbd> and the notebook opens next to the video. It's saved as a small
web page you can open, filter by tag, copy, and load back into Fliwyee later to keep working on.

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

**From 0.4:** your sessions are moved into notebooks (one per video) the first time 0.5 runs.
Nothing is lost: same sentences are joined, with all their words and notes, and the old data is
also kept as it was inside Fliwyee.

## Use

Fliwyee is **off** until you turn it on. While it's off, YouTube works exactly as normal.

| Do this | What happens |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> or the side panel button | Turn capture on, or pause it |
| Click a word in the subtitles | Copies its sentence with the word in bold, saves the word (tag **Word**) |
| Drag across words | The same for a phrase (cut words are completed) |
| <kbd>S</kbd> | Copies and saves the whole subtitle line (tag **Sentence / idiom**) |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> | Switch a tag on or off for the last capture: **Word**, **Sentence / idiom**, **Grammar structure**, **Listening** |
| <kbd>R</kbd> | Replays the whole sentence from its start and pauses at its end |
| <kbd>Shift</kbd>+<kbd>R</kbd> | The same replay, at 0.75× speed |
| <kbd>Q</kbd> or **Ask AI** in the message | Asks your AI chat about the last capture (or the line on screen) |
| <kbd>N</kbd> | Opens this video's notes in the side panel, with the editor for the last capture |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> or **Undo** in the message | Takes back the last capture |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> | Writes the notebook files now |

The single keys only work while capture is on. They're ignored while you type in YouTube's
search box or comments. YouTube's subtitles (CC) must be on. While capture is on, YouTube's own
<kbd>1</kbd>–<kbd>4</kbd> (jump to 10%–40% of the video) are Fliwyee's tag keys instead.

- **What a click copies:** the whole sentence, with the word marked. Apps that understand
  formatting (Word, Google Docs, email) paste it in real bold. Everywhere else, including AI chat
  boxes, it pastes as `Non posso **fare a meno di** te.`, which every AI reads as "this part".
- **One line per sentence:** a word from a sentence you already saved is added to that line (and
  gets the Word tag) instead of saving the sentence again. Pressing <kbd>S</kbd> on a line you
  already took words from adds the Sentence / idiom tag to it. Clicking the same word twice is
  skipped.
- **Tags:** a line can have any number of them. A click always adds Word, <kbd>S</kbd> always adds
  Sentence / idiom; the other two are yours to add with <kbd>3</kbd>, <kbd>4</kbd> or in the panel.
- The word under the mouse is highlighted, so you can see what a click will grab.
- Words joined by an apostrophe stay whole: *c'entra*, *un'ora*, *dov'è*, *l'acqua*.
- A small "Copied ✓" message fades away by itself.
- The toolbar icon shows how many things you captured today: green while capturing, grey while
  paused. The pill on the video shows how many lines this video's notebook has.

### Replay (R)

A subtitle line is often only part of a sentence (with auto-generated subtitles, 3 to 6 words),
so <kbd>R</kbd> replays the **whole sentence**: back to where it starts and on to its full stop,
plus a moment more so the last word isn't cut off. Auto-generated subtitles have no full stops:
there <kbd>R</kbd> replays the lines on screen together. Pressing <kbd>R</kbd> again (during the
replay or right after it) repeats the same sentence. Right after a new sentence begins,
<kbd>R</kbd> replays the one you just heard.

### Ask AI

<kbd>Q</kbd> on YouTube, **Ask AI** in the Copied message, the **AI** button next to a line, or
**Ask AI about all** in the side panel (with a filter on: **Ask AI about these**):

1. The prompt is copied, and the video pauses.
2. Fliwyee switches to the AI chat tab you used last (ChatGPT, Claude or Gemini). If none is open,
   it opens a new chat on the AI you chose in Settings.
3. The prompt is put in the message box. Check it and press Enter.

If the AI site has changed and the prompt can't be put in the box, it's still copied: click the
message box and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.

The prompts are yours to change in the side panel's **Settings**: one for a word or phrase
(`{text}`, `{sentence}`), one for a sentence (`{sentence}`) and one for a whole notebook or the
lines you filtered (`{items}`). **Reset prompts** brings back the defaults.

### Your notes (N)

<kbd>N</kbd> on the video opens the side panel next to it with **this video's notebook**: your
lines in video order, the words you clicked highlighted, their tags and your notes. The editor
for the last capture opens at the top. Nothing opens on the video itself.

- **Review:** click the **▶ minute** of any line and the video jumps there and plays (if the video
  isn't open, it opens). Click a sentence to copy it, or a word to copy it inside its sentence.
- **Filter:** the tag buttons above the lines show only Words, only Grammar structure, and so on.
  The search box finds any word, sentence or note. **Copy these** and **Ask AI about these** use
  just the lines you see.
- **Edit:** the editor has the sentence, the tags, every word or phrase with a note of its own
  (the meaning, what the AI said) and a note on the whole sentence. <kbd>Enter</kbd> saves,
  <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line, <kbd>Esc</kbd> cancels. ✎ next to a line
  edits older lines.
- **Tags in the panel:** point at a line to see all four tags; click one to switch it.
- ✕ removes a line (with **Undo** in the message).
- If Chrome doesn't let Fliwyee open the side panel, your notes open in a small window instead.

### Notebooks and files

- **Every capture, tag and note is saved in Fliwyee immediately.** Closing the tab, closing
  Chrome or a crash loses nothing. Fliwyee has no storage limit (Chrome's usual 10 MB limit is
  lifted), so years of notebooks fit.
- **One notebook per video.** Coming back to a video, even weeks later, you continue in the same
  notebook, and its practice days are listed.
- **The file:** each notebook is also written as a web page in `Downloads/italian-subtitles/`,
  named after the day you first practiced with the video and its name:
  `2026-11-20 - Italiano facile, episodio 1.html`. It's rewritten (same name) as the notebook grows.
- **When the file is written:** when you press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> or
  **Save file**, when you leave the video (another video, closing or reloading the tab), when you
  close the side panel, and when Chrome starts (anything that wasn't written yet, for example
  because Chrome was closed). The automatic writes hide Chrome's download message for that moment.
  In the side panel, the line under the title says whether the newest changes are in the file.
- **The web page** (double-click it to open it in your browser) has tag buttons to filter it
  (only Words, only Grammar structure…), a search box, and **Copy all** (or **Copy these** when
  filtered), which copies it as plain text, ready to paste anywhere:

  ```
  Italiano facile, episodio 1
  https://www.youtube.com/watch?v=...
  Practiced: Fri 20 Nov 2026

  0:02  Non posso fare a meno di te.  →  fare a meno di   [Word, Sentence / idiom]
        fare a meno di: to do without
  0:05  Ci metto un'ora ad arrivare in ufficio.  →  un'ora   [Word, Grammar structure]
        note: It takes me an hour to get to the office.
  ```

  Every minute is a link that plays the video from that moment. All links open in the same tab.
- **Load notebook file…** in the side panel (or dropping the file on the panel) loads a notebook
  page back into Fliwyee, for example on another computer, or after you deleted it. If Fliwyee
  already has notes for that video, the two are joined: nothing is dropped on either side, and
  loading the same file twice doesn't double anything. Each page keeps a full copy of the
  notebook inside it, so it loads back exactly. Older Fliwyee 0.4 pages load too.
- The minute is 1 second before the line starts, so you hear the whole line. With
  auto-generated subtitles (two lines on screen), it's the line that really contains the word.

**Keep in mind:** removing Fliwyee from Chrome deletes what it keeps inside Chrome (reloading or
updating it doesn't). The notebook files in `Downloads/italian-subtitles/` are your backup: load
them back if you ever need to.

### Side panel

Click the toolbar icon (or press <kbd>N</kbd> on the video) to open it next to the video.

- The on/off button, your shortcuts and a link to change them.
- **This video**: its notebook (see [Your notes](#your-notes-n)), with **Ask AI about all**,
  **Copy all**, **Save file**, **Open file** (writes the file and opens it) and **Show in folder**.
  It follows the video in the tab you're looking at.
- **All notebooks**: every video you studied, newest first. A dot means the newest changes
  aren't in the file yet. **Load notebook file…** is here.
- Notebooks from auto-generated subtitles get an **auto subs** tag, since that text can contain
  mistakes.
- **Settings**: which AI to open when none is open, and the three prompts.

## Other websites

| Where | How | What works |
|---|---|---|
| **YouTube** (also players embedded in other pages) | Runs by itself | Everything |
| **Netflix** | Runs by itself | Capturing, tags, notes, Ask AI, files. Replay and minute links go through Netflix's own player. Best effort: not tested on Netflix yet |
| **Any other video website** | Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> on the page: the first press adds Fliwyee to that tab and turns capture on | Capturing, tags, notes, Ask AI, files, replay when the video has a subtitle track |

On other websites:

- If the page shows subtitles in a way that can't be clicked (the browser draws them), Fliwyee
  hides that drawing while capture is on and shows the same lines itself, clickable. Turning
  capture off brings the page's own subtitles back.
- Subtitles drawn by common web players (Video.js, JW Player, Shaka, Plyr, Bitmovin, Prime Video,
  Disney+) are made clickable directly.
- The notebook belongs to the page's address. There's no general way to link to a moment on
  another website, so the minute links open the page, and the minute tells you where to go.
- After you reload the page or go to another site, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>
  again there.
- Installed apps (the Netflix app for Windows, phone apps) can't work: a Chrome extension can't
  see inside them. Watch in Chrome instead.

## Change the shortcuts

Open `chrome://extensions/shortcuts`, or use the **change** link in the side panel. If a
shortcut is already used by another extension, Chrome leaves Fliwyee's empty and the side panel
shows "not set". Pick another one there.

## Privacy

Your notebooks stay in your browser (`chrome.storage.local`) and in the files written to your
Downloads folder. Fliwyee runs on YouTube and Netflix. On other websites it runs only in a tab
where you press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> (Chrome's "active tab" permission).
It touches `chatgpt.com`, `claude.ai` and `gemini.google.com` only when you ask the AI, to put the
prompt in the message box. It never sends anything by itself: you press Enter. It only reads
subtitle text; it never downloads videos.

## How it works

| File | Job |
|---|---|
| `manifest.json` | Chrome extension setup (Manifest V3) |
| `background.js` | On/off, notebooks, joining a word to its sentence's line, tags, undo, the icon counter, writing and loading the files, moving 0.4 sessions over, Ask AI |
| `content/page-hook.js` | Runs in the video page and passes on a copy of the subtitle file the player downloads (YouTube, Netflix), so each line's start and end time is known; on Netflix it also jumps through Netflix's own player |
| `content/sites.js` | One adapter per site (YouTube, Netflix, any other website): where the subtitles are, how to jump, what a link looks like |
| `content/content.js` | Clicks, drags, keys, the bold copy, sentence replay, highlight, Fliwyee's own subtitle line and messages on the player |
| `content/content.css` | Makes the subtitles clickable and selectable while capture is on |
| `sidepanel/` | The side panel: notebooks, filter, search, editor, loading files |
| `lib/format.js` | Notebooks, tags, the notebook page (and reading it back), plain text, prompts, file names and times, shared by all parts |
| `tools/make-icons.ps1` | Draws the icons |
| `dev/` | A fake YouTube page, a fake other website and a small server for testing without YouTube |

If the subtitle timing can't be read (for example after a YouTube change), capture still works
from the text on screen, the minute is 3 seconds before the capture, and <kbd>R</kbd> replays
the last 3 seconds instead.

## Development

- Test page: run `py dev/serve.py` in this folder and open
  `http://localhost:8765/dev/mock-youtube.html?v=demo123`. It fakes the YouTube player,
  subtitles (including two auto-subtitle lines at once), the Chrome extension APIs Fliwyee uses
  and a ChatGPT message box, and shows the side panel next to it. The log under the player shows
  the notebooks, the clipboard (plain and bold), the written files and anything that leaked
  through to "YouTube".
- `http://localhost:8765/dev/mock-web.html` is a fake "other website": `?mode=track` has
  subtitles drawn by the browser, `?mode=dom` has subtitles drawn by the page (like Video.js).
- Icons: `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`
