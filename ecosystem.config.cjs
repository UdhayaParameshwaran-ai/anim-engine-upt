// pm2 process for the Studio behind the Cloudflare tunnel (animation.tandemloop.tech -> 127.0.0.1:5199).
// Set ANIM_PASSWORD in .env (gitignored) to put the Studio behind a login page.
//   pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "animation-studio",
      cwd: __dirname,
      script: "node_modules/vite/bin/vite.js",
      args: "--config apps/studio/vite.config.ts",
      autorestart: true,
      // No live reload for the hosted Studio: restart it (pm2 restart animation-studio) after a git pull.
      env: { ANIM_HMR: "off" },
    },
  ],
};
