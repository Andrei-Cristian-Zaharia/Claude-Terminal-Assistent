# Claude Terminal Assistant: prints a line above the PowerShell prompt that shows whether this
# terminal is the voice target. Dot-sourced from the PowerShell profile (Settings > Connect Claude
# Code, or npm run install-prompt); it wraps whatever prompt function the profile set up before it.
# It runs src/statusline.cjs through the launcher the app writes at every start (the app's own exe
# in Node mode, so no Node.js is needed), or with node from a source checkout.
# Kept ASCII-only (the symbols are built from char codes) because Windows PowerShell 5.1 reads
# BOM-less scripts in the ANSI codepage.

$global:__tchLauncher = Join-Path $env:APPDATA "claude-terminal-assistant\bin\statusline.cmd"
$global:__tchNode = (Get-Command node -ErrorAction SilentlyContinue).Source
$global:__tchScript = Join-Path $PSScriptRoot "..\src\statusline.cjs"
$global:__tchPrompt = $function:prompt

function global:prompt {
  $exitCode = $global:LASTEXITCODE
  $state = $null
  if (Test-Path $global:__tchLauncher) { $state = & $global:__tchLauncher --plain 2>$null }
  elseif ($global:__tchNode) { $state = & $global:__tchNode $global:__tchScript --plain 2>$null }
  if ($state -eq "selected") {
    # The app's ember accent where the console takes 24-bit color, the nearest console color otherwise.
    if ($Host.UI.SupportsVirtualTerminal) { Write-Host "$([char]27)[38;2;255;122;26m$([char]0x25CF) Selected$([char]27)[0m" }
    else { Write-Host "$([char]0x25CF) Selected" -ForegroundColor DarkYellow }
  }
  elseif ($state) { Write-Host "$([char]0x25CB) Not selected" -ForegroundColor DarkGray }
  $global:LASTEXITCODE = $exitCode # the check must not change what the original prompt sees
  & $global:__tchPrompt
}
