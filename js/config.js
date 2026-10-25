// Firebase settings for the optional global leaderboard.
//
// Leave these empty and the game works fully offline (the leaderboard screen
// explains how to switch it on). To enable it, follow docs/FIREBASE_SETUP.md and
// paste the two values from your Firebase project settings below.
//
// A Firebase *web* API key is a public identifier, not a password: Google's docs
// say it is safe to include in client code. Security comes from firestore.rules
// and from restricting the key to your GitHub Pages domain (see the setup guide).

export const FIREBASE = Object.freeze({
  apiKey: '',
  projectId: '',
});
