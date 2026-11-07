// Names given to Windows Terminal tabs (Rename tab, or a profile's tabTitle). Windows Terminal
// keeps them apart from the console title, which is all AttachConsole can read, so they are read
// from the tab strip through UI Automation and matched to the consoles by `assignTabNames`.
const { spawn } = require("node:child_process");

const norm = (t) => (t ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();

// A tab that still shows its console's title (the title may carry a prefix such as
// "Administrator: ", and Claude Code animates a glyph in front of it).
function sameTitle(tabName, consoleTitle) {
  const a = norm(tabName), b = norm(consoleTitle);
  if (!a || !b) return false;
  return a === b || (b.length >= 3 && a.includes(b));
}

// consoles: console-helper `list` entries; windows: [{ hwnd, tabs: [{ name, selected }] }].
// -> the consoles, with `tabName` on those whose tab was renamed. Only matches that cannot be
// wrong are made: a renamed tab is one whose name is no console's title in that window; it is
// given to the console(s) of that window whose title no tab shows, when that leaves no choice
// (one renamed tab and one such console, or a window with a single tab, whose panes all share
// its name). Several renamed tabs in one window can't be told apart, so they get no name: a wrong
// one would send dictation to the wrong terminal.
function assignTabNames(consoles, windows) {
  const out = consoles.map((c) => ({ ...c }));
  for (const w of windows ?? []) {
    const tabs = (w.tabs ?? []).filter((t) => norm(t.name));
    const group = out.filter((c) => c.owner && c.owner === w.hwnd);
    if (!tabs.length || !group.length) continue;
    const renamed = tabs.filter((t) => !group.some((c) => sameTitle(t.name, c.title)));
    const unshown = group.filter((c) => !tabs.some((t) => sameTitle(t.name, c.title)));
    if (renamed.length !== 1 || !unshown.length) continue;
    if (unshown.length === 1 || tabs.length === 1) for (const c of unshown) c.tabName = renamed[0].name.trim();
  }
  return out;
}

// The tabs of the given Windows Terminal windows (by hwnd: enumerating all windows through UI
// Automation took 2.5 s, asking for known windows about 0.4 s).
const TAB_NAMES_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$tabCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$out = @()
foreach ($h in ($env:CTA_HWNDS -split ',')) {
  try { $w = $A::FromHandle([IntPtr][long]$h) } catch { continue }
  $tabs = @(foreach ($t in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)) {
    $sp = $null; $sel = $false
    if ($t.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) { $sel = $sp.Current.IsSelected }
    @{ name = $t.Current.Name; selected = $sel }
  })
  $out += @{ hwnd = [long]$h; tabs = $tabs }
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress`;

// -> Promise of [{ hwnd, tabs }]; [] when there is no Windows Terminal or the lookup fails (the
// list then simply shows console titles).
function readTabNames(hwnds) {
  if (!hwnds.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(TAB_NAMES_PS, "utf16le").toString("base64")], {
      env: { ...process.env, CTA_HWNDS: hwnds.join(",") }, windowsHide: true,
    });
    let out = "";
    const timer = setTimeout(() => ps.kill(), 8000);
    ps.stdout.setEncoding("utf8");
    ps.stdout.on("data", (d) => { out += d; });
    ps.on("error", () => { clearTimeout(timer); resolve([]); });
    ps.on("close", () => {
      clearTimeout(timer);
      try {
        const list = JSON.parse(out.trim() || "[]");
        resolve((Array.isArray(list) ? list : [list]).map((w) => ({ hwnd: Number(w.hwnd), tabs: [].concat(w.tabs ?? []) })));
      } catch {
        resolve([]);
      }
    });
  });
}

module.exports = { assignTabNames, sameTitle, readTabNames };
