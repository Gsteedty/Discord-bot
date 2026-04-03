# GTBP Discord Bot

  Made by **gsteedty**

  A feature-rich Discord bot with prefix `-` and slash `/` commands, powered by **Groq Llama 3.3** AI.

  ---

  ## Features

  - **AI commands** — chat with AI, roast people (`/bully`), mock text
  - **Economy system** — earn coins, buy/sell cars, garage, leaderboard
  - **Role tools** — view role members & permissions (`/uwr`), lock/unlock channels
  - **Moderation** — spam, DM sender, say command
  - **Fun** — flip, 8ball, avatar, user profile, and more

  ---

  ## Setup

  ### Requirements
  - [Node.js](https://nodejs.org) v18+
  - [pnpm](https://pnpm.io) v9+
  - A Discord bot token ([create one here](https://discord.com/developers/applications))
  - A [Groq](https://console.groq.com) API key

  ### Environment Variables
  Create a `.env` file in the root:
  ```
  DISCORD_BOT_TOKEN=your_token_here
  DISCORD_OWNER_ID=your_discord_user_id
  GROQ_API_KEY=your_groq_api_key
  SESSION_SECRET=any_random_string
  ```

  ### Discord Developer Portal
  Go to your bot's settings and enable these **Privileged Gateway Intents**:
  - Message Content Intent
  - Server Members Intent

  ### Run it
  ```bash
  pnpm install
  pnpm --filter @workspace/api-server run build
  node main.js
  ```

  ---

  ## Commands

  | Command | Description |
  |---|---|
  | `-help` / `/help` | Full list of commands |
  | `-chat <msg>` / `/chat` | Talk to the AI |
  | `-bully @user [1-10]` / `/bully` | AI roast at a given intensity |
  | `-uwr @role` / `/uwr` | Members and permissions for a role |
  | `-bal` / `/bal` | Check your coin balance |
  | `-buy` / `/buy` | Buy a car |
  | `-garage` / `/garage` | View your car collection |
  | `-sell` / `/sell` | Sell a car for coins |
  | `-lb` / `/lb` | Economy leaderboard |
  | `-spam <n> <msg>` | Spam a message n times |
  | `-dm @user <msg>` | DM someone |
  | `-say <msg>` / `/say` | Bot sends a message |
  | `-mock <msg>` / `/mock` | MoCk TeXt |
  | `-lock` / `/lock` | Lock the current channel |
  | `-unlock` / `/unlock` | Unlock the current channel |

  ---

  ## Hosting

  Hosted 24/7 on [Render](https://render.com) using the included `Dockerfile`.

  The main bot source is in `artifacts/api-server/src/bot.ts`.

  ---

  *Built with [discord.js](https://discord.js.org) v14 and [Groq](https://groq.com)*
  