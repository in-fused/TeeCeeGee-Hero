# TCG Hero - Beginner Version

This is the simplified version for absolute beginners.

## Files Explained:
- `server.js` - The brain (backend API)
- `public/index.html` - The pretty interface (frontend)
- `package.json` - Shopping list for computer (dependencies)

## How to Run (Choose one):

### Option A: GitHub Codespaces (Easiest - No install)
1. In your repo, click the green "Code" button
2. Click "Codespaces" tab → "Create codespace on main"
3. Wait 2 minutes for it to load
4. In the terminal that appears, type: `npm install`
5. Then type: `npm start`
6. Click "Open in Browser" when the popup appears

### Option B: Local Computer (Requires installing Node.js)
1. Install Node.js from https://nodejs.org (click the big green button)
2. Download this repo as ZIP (Code → Download ZIP)
3. Unzip, open folder in computer's terminal/command prompt
4. Type: `npm install`
5. Type: `npm start`
6. Open browser to http://localhost:3000

## First Time Setup:
1. Open the app in browser
2. Click the **green "Load Demo Data"** button (creates fake stores for testing)
3. Try searching ZIP code: **90210**
4. You should see Target and GameStop results

## Making it Real:
To add real data, edit the arrays in the `/api/seed-demo-data` section of `server.js` with real store addresses.
