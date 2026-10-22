/**
 * Close only the launched test browser and its parent-side capture streams.
 * On macOS Chrome 155, crashpad/updater descendants can inherit stderr after
 * Chrome has exited, keeping Puppeteer's capture pipe referenced indefinitely.
 * Never signal those descendants or touch an existing personal browser.
 */
export async function closeTestBrowser(browser) {
  if (!browser) return;
  const child = typeof browser.process === 'function' ? browser.process() : null;
  try {
    await browser.close();
  } finally {
    // A rejected close can leave Chrome alive; retain its diagnostic streams.
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  }
}
