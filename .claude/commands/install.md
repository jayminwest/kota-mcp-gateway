# Install & Prime

## Read
.env.example (never read .env)

## Read and Execute
.claude/commands/prime.md

## Run
- Remove the existing git remote: `git remote remove origin`
- Initialize a new git repository: `git init`
- Run `cp .env.example .env`
- Install gateway dependencies: `npm ci`
- Compile the TypeScript build output: `npm run build`

## Report
- Output the work you've just done in a concise bullet point list.
- Instruct the user to fill out the root level ./.env based on .env.example.
- Mention: 'To setup your AFK Agent, be sure to update the remote repo url and push to a new repo so you have access to git issues and git prs:
  ```
  git remote add origin <your-new-repo-url>
  git push -u origin main
  ```'
