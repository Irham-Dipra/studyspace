# Using StudySpace on your phone

Your files stay on the computer. The phone doesn't get a copy: it opens StudySpace in its browser, like a website that your computer serves. When you add a note or a highlight on the phone, the files and notes on the computer change.

So every time you use it, three things must be true:

- the computer is **on and awake** (not asleep);
- **StudySpace is running** on it (`npm run dev`);
- the phone can **reach** the computer, through home Wi-Fi or through Tailscale (below).

There are two ways to connect. You can set up one or both.

| | A. Home Wi-Fi | B. Anywhere, with Tailscale |
| --- | --- | --- |
| Works on | the same Wi-Fi as the computer | any network: mobile data, BUET Wi-Fi… |
| Address on the phone | `http://192.168.0.114:4317` | `https://<your-pc>.<name>.ts.net` |
| Encrypted | no | yes |
| Copy buttons | don't work (use the phone's own Copy) | work |
| Setup | about 2 minutes | about 10 minutes, one app on each device |

---

## Step 1. Set a password (once, needed for both ways)

Without a password, StudySpace refuses every device except the computer itself.

1. Open the file `.env` in the `Study Helper` folder, for example in VS Code. (It is a hidden file: in the Files app press `Ctrl+H` to see it.)
2. Add this line, with your own password:
   ```
   STUDYSPACE_PASSWORD=pick-a-long-password
   ```
   Anyone who knows it can read and change your files, so don't reuse a simple one.
3. Save the file.

## Step 2. Build the app the phone uses (once, and after updates)

The phone always gets the built version of StudySpace (port 4317), not the live one you use on the computer (port 5173). In a terminal:

```bash
cd "/home/dipra/Study Helper"
npm run build
```

Run it again whenever StudySpace has been updated, or the phone keeps showing the old version.

---

## Way A. Home Wi-Fi

### Setup (once)

1. In `.env`, add one more line. It lets devices on your Wi-Fi in:
   ```
   STUDYSPACE_HOST=0.0.0.0
   ```
2. Check the firewall:
   ```bash
   sudo ufw status
   ```
   If it says `Status: active`, allow StudySpace on your home network:
   ```bash
   sudo ufw allow from 192.168.0.0/24 to any port 4317
   ```
3. Restart StudySpace: in its terminal press `Ctrl+C`, then run `npm run dev` again. Among the first lines it prints:
   ```
   [studyspace] on your phone (same Wi-Fi), open: http://192.168.0.114:4317
   ```

### Each time

1. Connect the phone to the same Wi-Fi as the computer.
2. Open the address StudySpace printed (e.g. `http://192.168.0.114:4317`) in the phone's browser.
3. The first time, type your password and tap **Log in**. The phone then stays logged in for 90 days.

### Good to know

- The address can change after the router restarts. StudySpace prints the new one when it starts; `hostname -I` also shows it (the first number). To stop it changing, give the computer a fixed address in your router's settings (often called *DHCP reservation*).
- This connection isn't encrypted. Use it only on your own home Wi-Fi, not on hall or public Wi-Fi. Use Way B there.
- Copy buttons don't work over `http://`. Long-press the text and use the phone's own Copy instead.

---

## Way B. Anywhere, with Tailscale

Tailscale is a free app that links your own devices privately and encrypted, over any network. Only devices logged into your Tailscale account can reach the computer. You don't need the `STUDYSPACE_HOST` line for this way.

### Setup (once)

**On the computer:**

1. Install curl (it isn't installed yet), then Tailscale:
   ```bash
   sudo apt install curl
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
   If the script says your Ubuntu version isn't supported, follow the steps at https://tailscale.com/download/linux instead.
2. Connect the computer:
   ```bash
   sudo tailscale up
   ```
   It prints a link. Open it in Firefox and log in (a Google account is fine). Remember which account you used.

**On the phone:**

3. Install the **Tailscale** app (Play Store or App Store) and log in with the **same account**. Allow the VPN when the phone asks, and switch Tailscale on.

**On the computer again:**

4. Share StudySpace with your devices:
   ```bash
   sudo tailscale serve --bg 4317
   ```
   - The first time, it may print a link to turn on *Serve* / HTTPS for your account. Open it, click **Enable**, then run the command again if it stopped.
   - It then shows your address, like `https://your-pc.tail1234.ts.net/`.
   - To see the address again later: `sudo tailscale serve status`.
5. If StudySpace has been running since before you added the password, restart it: `Ctrl+C`, then `npm run dev`.

### Each time

1. Make sure Tailscale is switched on in the phone (the app says *Connected*).
2. Open your `https://….ts.net` address in the phone's browser.
3. The first time, type your password and tap **Log in**. The phone stays logged in for 90 days.

### Good to know

- The `serve` setting stays after the computer restarts, and Tailscale starts by itself.
- Everything works over this address, including the copy buttons.

---

## Add it to the home screen (optional)

- **Android (Chrome):** menu ⋮ → **Add to Home screen** (or **Install app**).
- **iPhone (Safari):** Share → **Add to Home Screen**.

You then get a StudySpace icon that opens it like an app.

## Keep the computer ready

- **StudySpace must be running.** Open a terminal and run:
  ```bash
  cd "/home/dipra/Study Helper"
  npm run dev
  ```
  Leave that terminal open.
- **The computer must not go to sleep.** In Ubuntu Settings → Power, turn off *Automatic Suspend*, at least when it's plugged in.

---

## Using it on the phone

- **Files:** the first button at the top left. Tap a file to open it. Its ✏ and 🗑 buttons rename or delete it.
- **Notes:** the last button at the top right.
- **Highlight:** long-press a word, drag the handles over the text, then tap a colour in the bar that appears below it. The bar also has *Note* (the text into a new note) and *Copy*.
- **Undo:** ↶ at the top left of the toolbar.
- **Search:** the 🔍 button at the top.
- **Zoom:** the **+** and **−** buttons at the bottom. Pinching doesn't zoom the PDF.
- **Log out:** ⚙ → **Log out of this device**.
- Adding or changing study folders works only on the computer, for safety.
- The phone and the computer don't update each other live. After changing something on one, reload the page on the other.

## Turning it off

- **Wi-Fi access:** delete the `STUDYSPACE_HOST=0.0.0.0` line from `.env` and restart StudySpace.
- **Tailscale access:** `sudo tailscale serve reset`
- **All phone access:** delete the `STUDYSPACE_PASSWORD` line from `.env` and restart StudySpace. Phones that were logged in can't get in either.
- Changing the password does **not** log out phones that are already logged in. Log them out with ⚙ → **Log out of this device** on the phone.

## If something goes wrong

| On the phone you see | What to do |
| --- | --- |
| *"Can't reach StudySpace"* | Is the computer on and awake, with `npm run dev` running? Way A: is the phone on the same Wi-Fi? Way B: is Tailscale switched on in the phone? |
| The Tailscale address works but the Wi-Fi one doesn't | The phone and the computer can't see each other over the Wi-Fi. Check that the phone is really on the same Wi-Fi (turn mobile data off) and that its address there starts with `192.168.0.` (phone Settings → Wi-Fi → ⚙ next to the network). If it does and it still fails, the router keeps devices apart: turn off *AP isolation* / *client isolation* in its settings (often at `http://192.168.0.1`), or just use the Tailscale address at home too. |
| The browser can't open the page at all | Way A: did you add `STUDYSPACE_HOST=0.0.0.0`, restart StudySpace and do the firewall step? Is the address still right (`hostname -I`)? Way B: does `sudo tailscale serve status` show the address? |
| *"StudySpace has no password yet"* | Do Step 1, then restart StudySpace. |
| *"Wrong password."* | Check the `STUDYSPACE_PASSWORD` line in `.env`. |
| *"Too many wrong passwords"* | Wait a minute, then try again. |
| *"Unknown address …"* | StudySpace only answers to the computer's own names and addresses. Add the one you used to `.env` as `STUDYSPACE_ALLOWED_HOSTS=that-name` and restart StudySpace. |
| The phone shows an old version | Run `npm run build` on the computer, then reload the page on the phone. |
| *Copy* does nothing | Normal over `http://` (Way A). Use Way B, or the phone's own Copy. |
