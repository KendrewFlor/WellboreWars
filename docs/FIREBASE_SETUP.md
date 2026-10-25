# Switching on the global leaderboard (Firebase, free tier)

Wellbore Wars works fully offline. Collection, decks, packs, records and achievements all live in the player's browser. The **global leaderboard** is the only online feature and it is off until you connect a Firebase project. This guide takes about 15 minutes and stays on the free **Spark** plan, which has no billing account, so it can never charge you. If the daily quota runs out, the leaderboard pauses until the next day.

What gets stored per player: an engineer name (2–16 letters, numbers, spaces), a win count, a loss count and a server timestamp. Nothing else is stored.

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Select **Create a project** and name it, for example `wellbore-wars`.
3. Google Analytics is optional. The game doesn't use it, so you can switch it off.
4. Stay on the **Spark (no-cost)** plan. Don't add a billing account.

## 2. Turn on anonymous sign-in

Players don't make accounts. Each browser gets an anonymous ID so that it can only write its own row.

1. Open **Build → Authentication** and select **Get started**.
2. On the **Sign-in method** tab, choose **Anonymous**, switch it on, and **Save**.

## 3. Create the Firestore database

1. Open **Build → Firestore Database** and select **Create database**.
2. Pick a location near your players. You can't change it later.
3. Start in **production mode** so that everything is denied until you add rules.

## 4. Paste the security rules

1. In Firestore, open the **Rules** tab.
2. Delete what's there and paste the whole contents of [`firestore.rules`](../firestore.rules) from this repository.
3. Select **Publish**.

These rules let anyone read the top of the leaderboard (25 rows at most per query). A player can only write their own document, and each write adds at most one result. Counters can never go down, writes are limited to one every 30 seconds, and every other path in the database is denied.

## 5. Get the two values the game needs

1. Select the gear icon, then **Project settings → General**.
2. Under **Your apps**, select the web icon **`</>`**, give the app a nickname, and select **Register app**. Leave Firebase Hosting unticked; GitHub Pages hosts the game.
3. Firebase shows a `firebaseConfig` snippet. You only need two values from it:
   - `apiKey`, which starts with `AIza…`
   - `projectId`, for example `wellbore-wars-1a2b3`
4. Ignore the `npm install firebase` / `<script>` instructions. The game talks to Firebase's REST API directly, with no SDK and no third-party code.

## 6. Paste them into the game

Edit [`js/config.js`](../js/config.js), either on GitHub (pencil icon) or in your local copy:

```js
export const FIREBASE = Object.freeze({
  apiKey: 'AIza...your key...',
  projectId: 'your-project-id',
});
```

Commit and push. The **Deploy to GitHub Pages** workflow republishes the site.

**If GitHub warns about a secret:** GitHub's push protection and secret scanning recognise Google API keys. A Firebase *web* API key is not a password. It only identifies your project, Google documents that it's meant to be in client code, and the security boundary is the Firestore rules from step 4. You can allow the push. The repository's own scanner (`npm run scan`) accepts this key only in `js/config.js` and still fails on it anywhere else.

## 7. Lock the key to your site (recommended)

This stops other websites from using your key and your quota.

1. Open <https://console.cloud.google.com/apis/credentials> and select the same project.
2. Open the key named **Browser key (auto created by Firebase)**.
3. Under **Application restrictions**, choose **Websites** and add:
   - `https://kendrewflor.github.io/*` (your GitHub Pages address)
   - `http://127.0.0.1:5173/*` (optional, for `npm start` on your own machine)
4. Under **API restrictions**, choose **Restrict key** and tick only:
   - **Identity Toolkit API**
   - **Token Service API**
   - **Cloud Firestore API**
5. **Save.** Changes can take a few minutes to apply.

Referrer restrictions stop casual reuse in other websites, but a script outside a browser can fake a referrer. That's why the rules in step 4, not the key, are what actually protect the data.

## 8. Try it

1. Open your GitHub Pages site and go to **Settings → Global leaderboard**.
2. Switch on **Send my wins and losses**, then play and finish a match.
3. Open **Leaderboard**. You should see your engineer name. Your own row is highlighted.

If it says it can't reach the leaderboard, open the browser console. A `403` usually means the rules weren't published, and an `API key not valid` error usually means the referrer restriction doesn't match your site's address.

## How far the free tier goes

On the Spark plan, Firestore allows about 50,000 document reads and 20,000 writes per day. In this game:

| Action | Cost |
|---|---|
| Finishing a match (with sending switched on) | 1 write |
| Opening the Leaderboard screen | up to 10 reads |
| Signing in (once per browser, refreshed hourly) | Authentication only, no Firestore cost |

That's roughly 5,000 leaderboard views and thousands of matches a day before anything pauses. Check the current quotas on Firebase's pricing page, because Google changes them from time to time.

## Honest limitations

- There's no game server, so the game can't prove a reported win was earned. The rules make cheating slow (one result per 30 seconds, counters only go up) but not impossible. Don't attach prizes to this leaderboard.
- Names are limited to letters, numbers, spaces, `_`, `.` and `-`, so they can't carry markup or links. They aren't filtered for rude words. To remove a row, delete it in the Firestore console.
- Firebase App Check needs the Firebase SDK, which this project deliberately doesn't ship.

## Switching it off again

Empty the two values in `js/config.js` and push. The game goes back to offline-only. To delete the data too, delete the Firebase project.
